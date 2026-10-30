import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano } from '@ton/core';
import '@ton/test-utils';
import { AccessMaster } from '../build/access_pass/access_pass_AccessMaster';
import { Subscription } from '../build/access_pass/access_pass_Subscription';

const PRICE = toNano('1');
const PERIOD = 30n * 24n * 60n * 60n; // 30 дней
const PAYMENT = PRICE + toNano('0.05'); // цена + развёртывание Subscription
const TELEGRAM_ID = 123456789n;
const GAS = toNano('0.05'); // запас на газ для служебных сообщений

const errors = AccessMaster.errors;

describe('AccessPass', () => {
    let blockchain: Blockchain;
    let owner: SandboxContract<TreasuryContract>;
    let buyer: SandboxContract<TreasuryContract>;
    let stranger: SandboxContract<TreasuryContract>;
    let master: SandboxContract<AccessMaster>;

    const subscriptionOf = async (telegramId: bigint) =>
        blockchain.openContract(Subscription.fromAddress(await master.getSubscriptionAddress(telegramId)));

    const subscribe = (via: SandboxContract<TreasuryContract>, value: bigint, telegramId = TELEGRAM_ID) =>
        master.send(via.getSender(), { value }, { $$type: 'Subscribe', queryId: 0n, telegramId });

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.now = 1_800_000_000;

        owner = await blockchain.treasury('owner');
        buyer = await blockchain.treasury('buyer');
        stranger = await blockchain.treasury('stranger');

        master = blockchain.openContract(await AccessMaster.fromInit(owner.address, PRICE, PERIOD));
        const deploy = await master.send(owner.getSender(), { value: toNano('0.2') }, null);
        expect(deploy.transactions).toHaveTransaction({
            from: owner.address,
            to: master.address,
            deploy: true,
            success: true,
        });
    });

    it('stores price, period and owner', async () => {
        expect(await master.getPrice()).toBe(PRICE);
        expect(await master.getPeriod()).toBe(PERIOD);
        expect(await master.getSales()).toBe(0n);
        expect((await master.getOwner()).equals(owner.address)).toBe(true);
    });

    it('deploys a Subscription for the buyer and activates access', async () => {
        const subscriptionAddress = await master.getSubscriptionAddress(TELEGRAM_ID);
        const result = await subscribe(buyer, PAYMENT);

        expect(result.transactions).toHaveTransaction({ from: buyer.address, to: master.address, success: true });
        expect(result.transactions).toHaveTransaction({
            from: master.address,
            to: subscriptionAddress,
            deploy: true,
            success: true,
        });

        const subscription = await subscriptionOf(TELEGRAM_ID);
        expect(await subscription.getTelegramId()).toBe(TELEGRAM_ID);
        expect(await subscription.getExpiresAt()).toBe(BigInt(blockchain.now!) + PERIOD);
        expect(await subscription.getIsActive()).toBe(true);
        expect(await master.getSales()).toBe(1n);
    });

    it('adds a period on top of the remaining time when paying early', async () => {
        await subscribe(buyer, PAYMENT);
        const subscription = await subscriptionOf(TELEGRAM_ID);
        const firstEnd = await subscription.getExpiresAt();

        blockchain.now! += 10 * 24 * 60 * 60; // через 10 дней, подписка ещё активна
        await subscribe(buyer, PAYMENT);

        expect(await subscription.getExpiresAt()).toBe(firstEnd + PERIOD);
        expect(await master.getSales()).toBe(2n);
    });

    it('expires, and a renewal after expiry counts from now', async () => {
        await subscribe(buyer, PAYMENT);
        const subscription = await subscriptionOf(TELEGRAM_ID);

        blockchain.now! += Number(PERIOD) + 60;
        expect(await subscription.getIsActive()).toBe(false);

        await subscribe(buyer, PAYMENT);
        expect(await subscription.getExpiresAt()).toBe(BigInt(blockchain.now!) + PERIOD);
        expect(await subscription.getIsActive()).toBe(true);
    });

    it('keeps separate subscriptions per Telegram ID', async () => {
        await subscribe(buyer, PAYMENT, 1n);
        await subscribe(buyer, PAYMENT, 2n);

        const first = await master.getSubscriptionAddress(1n);
        const second = await master.getSubscriptionAddress(2n);
        expect(first.equals(second)).toBe(false);
        expect(await (await subscriptionOf(1n)).getIsActive()).toBe(true);
        expect(await (await subscriptionOf(2n)).getIsActive()).toBe(true);
    });

    it('rejects a payment below the price and bounces the money back', async () => {
        const result = await subscribe(buyer, PRICE); // без 0.05 TON на развёртывание

        expect(result.transactions).toHaveTransaction({
            from: buyer.address,
            to: master.address,
            success: false,
            exitCode: errors['Not enough TON'],
        });
        expect(result.transactions).toHaveTransaction({ from: master.address, to: buyer.address, inMessageBounced: true });
        expect(await master.getSales()).toBe(0n);
        const subscriptionAddress = await master.getSubscriptionAddress(TELEGRAM_ID);
        expect((await blockchain.getContract(subscriptionAddress)).accountState?.type ?? 'uninit').not.toBe('active');
    });

    it('lets only the master extend a subscription', async () => {
        await subscribe(buyer, PAYMENT);
        const subscription = await subscriptionOf(TELEGRAM_ID);
        const before = await subscription.getExpiresAt();

        const attack = await subscription.send(
            stranger.getSender(),
            { value: GAS },
            { $$type: 'Extend', queryId: 0n, period: 365n * 24n * 60n * 60n, payer: stranger.address },
        );

        expect(attack.transactions).toHaveTransaction({
            from: stranger.address,
            to: subscription.address,
            success: false,
            exitCode: Subscription.errors['Only master'],
        });
        expect(await subscription.getExpiresAt()).toBe(before);
    });

    it('lets only the owner withdraw, and keeps a storage reserve', async () => {
        await subscribe(buyer, PAYMENT);

        const byStranger = await master.send(stranger.getSender(), { value: GAS }, { $$type: 'Withdraw', amount: PRICE });
        expect(byStranger.transactions).toHaveTransaction({
            to: master.address,
            success: false,
            exitCode: errors['Only owner'],
        });

        const drainAll = await master.send(owner.getSender(), { value: GAS }, { $$type: 'Withdraw', amount: toNano('5') });
        expect(drainAll.transactions).toHaveTransaction({
            to: master.address,
            success: false,
            exitCode: errors['Keep balance for storage'],
        });

        const withdraw = await master.send(owner.getSender(), { value: GAS }, { $$type: 'Withdraw', amount: PRICE });
        expect(withdraw.transactions).toHaveTransaction({ from: master.address, to: owner.address, value: PRICE });
    });

    it('lets only the owner change the price, and enforces the new price', async () => {
        const byStranger = await master.send(stranger.getSender(), { value: GAS }, { $$type: 'SetPrice', price: 1n });
        expect(byStranger.transactions).toHaveTransaction({
            to: master.address,
            success: false,
            exitCode: errors['Only owner'],
        });

        const newPrice = toNano('2');
        await master.send(owner.getSender(), { value: GAS }, { $$type: 'SetPrice', price: newPrice });
        expect(await master.getPrice()).toBe(newPrice);

        const oldPayment = await subscribe(buyer, PAYMENT);
        expect(oldPayment.transactions).toHaveTransaction({
            to: master.address,
            success: false,
            exitCode: errors['Not enough TON'],
        });
        const newPayment = await subscribe(buyer, newPrice + toNano('0.05'));
        expect(newPayment.transactions).toHaveTransaction({ to: master.address, success: true });
    });

    it('reports the fee for a subscription payment', async () => {
        const result = await subscribe(buyer, PAYMENT);
        const fees = result.transactions.reduce((sum, tx) => sum + tx.totalFees.coins, 0n);
        // Комиссии сети за весь путь оплаты (мастер + развёртывание подписки) должны быть копеечными
        expect(fees).toBeLessThan(toNano('0.02'));
        console.log(`Subscribe: ${result.transactions.length} transactions, network fees ${Number(fees) / 1e9} TON`);
    });
});
