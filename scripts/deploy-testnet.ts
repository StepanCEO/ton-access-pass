/**
 * Разворачивает AccessMaster в testnet с кошелька разработчика (scripts/dev-wallet.ts) — он же владелец контракта.
 * Запуск: npx ts-node scripts/deploy-testnet.ts [цена в TON = 1] [дней = 30]
 */
import { fromNano, internal, toNano } from '@ton/core';
import { AccessMaster } from '../build/access_pass/access_pass_AccessMaster';
import { sleep } from '../backend/chain';
import { loadDevWallet, retry, testnetClient } from './dev-wallet';

const DEPLOY_VALUE = toNano('0.2'); // 0.1 остаётся неснижаемым резервом на хранение

async function main() {
    const [priceArg = '1', daysArg = '30'] = process.argv.slice(2);
    const client = testnetClient();
    const { wallet, keys } = await loadDevWallet();
    const opened = client.open(wallet);

    const balance = await retry(() => opened.getBalance());
    if (balance < DEPLOY_VALUE + toNano('0.05')) {
        throw new Error(`На кошельке ${fromNano(balance)} TON — нужно хотя бы 0.25. Пополните через @testgiver_ton_bot.`);
    }

    const period = BigInt(Math.round(Number(daysArg) * 24 * 60 * 60));
    const master = await AccessMaster.fromInit(wallet.address, toNano(priceArg), period);
    const address = master.address.toString({ testOnly: true });

    if (await retry(() => client.isContractDeployed(master.address))) {
        console.log(`Контракт уже развёрнут: ${address}`);
        return;
    }

    await sleep(1100);
    const seqno = await retry(() => opened.getSeqno());
    await sleep(1100);
    await retry(() =>
        opened.sendTransfer({
            seqno,
            secretKey: keys.secretKey,
            messages: [internal({ to: master.address, value: DEPLOY_VALUE, init: master.init, bounce: false })],
        }),
    );
    console.log(`Отправил 0.2 TON на развёртывание, жду подтверждения…`);

    for (let attempt = 0; attempt < 30; attempt++) {
        await sleep(3000);
        if (await client.isContractDeployed(master.address).catch(() => false)) {
            await sleep(1100);
            const deployed = client.open(master);
            console.log(`Готово: ${priceArg} TON за ${daysArg} дн., продаж ${await retry(() => deployed.getSales())}`);
            console.log(`MASTER_ADDRESS=${address}`);
            console.log(`https://testnet.tonviewer.com/${address}`);
            return;
        }
    }
    throw new Error(`Контракт не появился за 90 секунд — проверьте https://testnet.tonviewer.com/${address}`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
