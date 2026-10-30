/**
 * Ссылка для развёртывания AccessMaster из кошелька (Tonkeeper): сид-фраза не нужна ни скрипту, ни серверу.
 * Запуск: npx ts-node scripts/deploy-contract.ts <адрес-владельца> [цена в TON = 1] [дней = 30]
 */
import { Address, beginCell, storeStateInit, toNano } from '@ton/core';
import { AccessMaster } from '../build/access_pass/access_pass_AccessMaster';

const DEPLOY_VALUE = toNano('0.2'); // 0.1 остаётся неснижаемым резервом на хранение

async function main() {
    const [ownerArg, priceArg = '1', daysArg = '30'] = process.argv.slice(2);
    if (!ownerArg) throw new Error('Укажите адрес кошелька владельца: npx ts-node scripts/deploy-contract.ts <адрес>');

    const owner = Address.parseFriendly(ownerArg);
    const price = toNano(priceArg);
    const period = BigInt(Math.round(Number(daysArg) * 24 * 60 * 60));
    if (price <= 0n || period <= 0n) throw new Error('Цена и срок должны быть больше нуля');

    const master = await AccessMaster.fromInit(owner.address, price, period);
    const init = beginCell().store(storeStateInit(master.init!)).endCell().toBoc().toString('base64url');
    const address = master.address.toString({ testOnly: owner.isTestOnly, bounceable: false });
    const query = `amount=${DEPLOY_VALUE}&init=${init}`;

    console.log(`Сеть:      ${owner.isTestOnly ? 'testnet' : 'MAINNET'}`);
    console.log(`Владелец:  ${ownerArg}`);
    console.log(`Условия:   ${priceArg} TON за ${daysArg} дн.`);
    console.log(`Контракт:  ${master.address.toString({ testOnly: owner.isTestOnly })}`);
    console.log(`\nОткройте в кошельке владельца (отправка 0.2 TON развернёт контракт):`);
    console.log(`ton://transfer/${address}?${query}`);
    console.log(`\nили https://app.tonkeeper.com/transfer/${address}?${query}`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
