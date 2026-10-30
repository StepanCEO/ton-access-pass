/**
 * Оплачивает подписку с кошелька разработчика за указанный Telegram ID — проверка без Mini App
 * (та же транзакция, что собирает бэкенд для TON Connect).
 * Запуск: npx ts-node scripts/pay-testnet.ts <MASTER_ADDRESS> <telegramId>
 */
import { Address, fromNano, internal } from '@ton/core';
import { AccessChain, sleep } from '../backend/chain';
import { loadDevWallet, retry, testnetClient } from './dev-wallet';

async function main() {
    const [masterArg, idArg] = process.argv.slice(2);
    if (!masterArg || !idArg) throw new Error('Запуск: npx ts-node scripts/pay-testnet.ts <MASTER_ADDRESS> <telegramId>');

    const client = testnetClient();
    const chain = new AccessChain(
        { open: (contract) => client.open(contract), isDeployed: (address) => client.isContractDeployed(address) },
        Address.parse(masterArg),
        1100,
    );
    const telegramId = BigInt(idArg);
    const { wallet, keys } = await loadDevWallet();
    const opened = client.open(wallet);

    const before = await retry(() => chain.expiresAt(telegramId));
    const payment = await retry(() => chain.paymentFor(telegramId));
    console.log(`Подписка ${idArg} сейчас до: ${before || 'нет'}; плачу ${fromNano(payment.amount)} TON`);

    await sleep(1100);
    const seqno = await retry(() => opened.getSeqno());
    await sleep(1100);
    await retry(() =>
        opened.sendTransfer({
            seqno,
            secretKey: keys.secretKey,
            messages: [internal({ to: payment.address, value: payment.amount, body: payment.payload, bounce: true })],
        }),
    );

    for (let attempt = 0; attempt < 30; attempt++) {
        await sleep(3000);
        const after = await chain.expiresAt(telegramId).catch(() => before);
        if (after > before) {
            console.log(`Готово: подписка до ${new Date(after * 1000).toISOString()} (${after})`);
            console.log(`https://testnet.tonviewer.com/${(await chain.subscriptionAddress(telegramId)).toString({ testOnly: true })}`);
            return;
        }
    }
    throw new Error('Подписка не обновилась за 90 секунд');
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
