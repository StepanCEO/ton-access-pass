import { TonClient } from '@ton/ton';
import { createApiServer } from './api';
import { AccessChain, sleep } from './chain';
import { loadConfig } from './config';
import { AccessService } from './service';
import { Store } from './store';
import { createBotApi } from './telegram';

const TONCENTER = {
    testnet: 'https://testnet.toncenter.com/api/v2/jsonRPC',
    mainnet: 'https://toncenter.com/api/v2/jsonRPC',
};

async function main() {
    const config = loadConfig();
    const api = createBotApi(config.botToken);
    const client = new TonClient({ endpoint: TONCENTER[config.network], apiKey: config.toncenterApiKey });
    const chain = new AccessChain(
        { open: (contract) => client.open(contract), isDeployed: (address) => client.isContractDeployed(address) },
        config.masterAddress,
        config.toncenterApiKey ? 100 : 1100,
    );
    const store = new Store(config.dataFile);
    const service = new AccessService({
        api,
        chain,
        store,
        channelId: config.channelId,
        miniAppUrl: config.miniAppUrl,
    });

    const me = await api<{ username: string }>('getMe');
    console.log(`Бот @${me.username}, сеть ${config.network}, контракт ${config.masterAddress.toString({ testOnly: config.network === 'testnet' })}`);
    if (!service.channelId) console.log('Канал не подключён: добавьте бота в канал администратором с правом приглашать');
    if (config.miniAppUrl) {
        await api('setChatMenuButton', {
            menu_button: { type: 'web_app', text: 'Подписка', web_app: { url: config.miniAppUrl } },
        }).catch((error) => console.log(`Кнопка меню не установлена: ${error}`));
    }

    const server = createApiServer({
        chain,
        service,
        botToken: config.botToken,
        botUsername: me.username,
        network: config.network,
    });
    server.listen(config.port, '127.0.0.1', () => console.log(`API на 127.0.0.1:${config.port}`));

    let running = true;
    const stop = () => {
        running = false;
        server.close();
        clearInterval(sweepTimer);
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);

    let sweeping = false;
    const sweepTimer = setInterval(async () => {
        if (sweeping || !service.channelId) return;
        sweeping = true;
        await service.sweep().catch((error) => console.error(`Проверка подписок: ${error}`));
        sweeping = false;
    }, 60_000);

    while (running) {
        try {
            const updates = await api<any[]>('getUpdates', {
                offset: store.state.updateOffset,
                timeout: 30,
                allowed_updates: ['message', 'chat_join_request', 'my_chat_member'],
            });
            for (const update of updates) {
                store.state.updateOffset = update.update_id + 1;
                await service.handleUpdate(update).catch((error) => console.error(`Обновление ${update.update_id}: ${error}`));
            }
            if (updates.length) store.save();
        } catch (error) {
            console.error(`${error}`);
            await sleep(5000);
        }
    }
}

main().catch((error) => {
    console.error(`${error instanceof Error ? error.message : error}`);
    process.exit(1);
});
