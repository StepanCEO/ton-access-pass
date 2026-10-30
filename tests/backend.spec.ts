import { createHmac } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, Cell, SendMode, toNano } from '@ton/core';
import '@ton/test-utils';
import { AccessMaster, loadSubscribe } from '../build/access_pass/access_pass_AccessMaster';
import { AccessChain } from '../backend/chain';
import { createApiServer } from '../backend/api';
import { AccessService } from '../backend/service';
import { Store } from '../backend/store';
import { BotApi, verifyInitData } from '../backend/telegram';

const BOT_TOKEN = '123456:TEST-token-for-unit-tests';
const PRICE = toNano('1');
const PERIOD = 30 * 24 * 60 * 60;
const CHANNEL = -1001234567890;
const NOW = 1_800_000_000;

function signInitData(fields: Record<string, string>, token = BOT_TOKEN) {
    const dataCheckString = Object.keys(fields)
        .sort()
        .map((key) => `${key}=${fields[key]}`)
        .join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
    return new URLSearchParams({ ...fields, hash }).toString();
}

const initDataFor = (id: number, authDate = NOW) =>
    signInitData({ auth_date: String(authDate), query_id: 'AAE1', user: JSON.stringify({ id, first_name: 'Тест' }) });

describe('verifyInitData', () => {
    it('accepts data signed with the bot token', () => {
        expect(verifyInitData(initDataFor(42), BOT_TOKEN, 3600, NOW + 60)?.id).toBe(42);
    });

    it('rejects a forged user, another bot and stale data', () => {
        const forged = initDataFor(42).replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
        expect(verifyInitData(forged, BOT_TOKEN, 3600, NOW)).toBeNull();
        expect(verifyInitData(initDataFor(42), '999:other-bot', 3600, NOW)).toBeNull();
        expect(verifyInitData(initDataFor(42), BOT_TOKEN, 3600, NOW + 7200)).toBeNull();
        expect(verifyInitData('user=%7B%22id%22%3A1%7D', BOT_TOKEN)).toBeNull();
    });
});

describe('AccessChain on the sandbox', () => {
    let blockchain: Blockchain;
    let buyer: SandboxContract<TreasuryContract>;
    let chain: AccessChain;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.now = NOW;
        const owner = await blockchain.treasury('owner');
        buyer = await blockchain.treasury('buyer');
        const master = blockchain.openContract(await AccessMaster.fromInit(owner.address, PRICE, BigInt(PERIOD)));
        await master.send(owner.getSender(), { value: toNano('0.2') }, null);

        chain = new AccessChain(
            {
                open: (contract) => blockchain.openContract(contract) as any,
                isDeployed: async (address: Address) =>
                    (await blockchain.getContract(address)).accountState?.type === 'active',
            },
            master.address,
        );
    });

    it('reads terms and reports 0 for someone who never paid', async () => {
        expect(await chain.terms()).toEqual({ price: PRICE, period: PERIOD });
        expect(await chain.expiresAt(777n)).toBe(0);
    });

    it('builds a payment that the contract accepts', async () => {
        const payment = await chain.paymentFor(777n);
        expect(payment.amount).toBe(PRICE + toNano('0.06'));
        expect(loadSubscribe(payment.payload.beginParse()).telegramId).toBe(777n);

        // то же, что отправит кошелёк через TON Connect
        const result = await buyer.send({ to: payment.address, value: payment.amount, body: payment.payload });
        expect(result.transactions).toHaveTransaction({ to: payment.address, success: true });
        expect(await chain.expiresAt(777n)).toBe(NOW + PERIOD);
    });

    it('still works when the wallet takes the forwarding fee out of the amount', async () => {
        const payment = await chain.paymentFor(778n);
        // так отправил реальный кошелёк в testnet: до контракта дошло меньше, чем было в переводе
        const result = await buyer.send({
            to: payment.address,
            value: payment.amount,
            body: payment.payload,
            sendMode: SendMode.NONE,
        });
        expect(result.transactions).toHaveTransaction({ to: payment.address, success: true });
        expect(await chain.expiresAt(778n)).toBe(NOW + PERIOD);
    });
});

/** Поддельный Telegram: запоминает вызовы, отвечает как Bot API. */
function fakeTelegram() {
    const calls: { method: string; params: any }[] = [];
    const api: BotApi = async (method, params = {}) => {
        calls.push({ method, params });
        if (method === 'createChatInviteLink') return { invite_link: 'https://t.me/+join' } as any;
        return true as any;
    };
    const methods = () => calls.map((call) => call.method);
    return { api, calls, methods };
}

function setup(subscriptions: Record<number, number>, failing = false) {
    const telegram = fakeTelegram();
    let now = NOW;
    const chain = {
        expiresAt: async (id: bigint) => {
            if (failing) throw new Error('toncenter недоступен');
            return subscriptions[Number(id)] ?? 0;
        },
    };
    const store = new Store();
    const service = new AccessService({
        api: telegram.api,
        chain,
        store,
        channelId: CHANNEL,
        miniAppUrl: 'https://pass.example/app',
        now: () => now,
        log: () => {},
    });
    return {
        ...telegram,
        store,
        service,
        chain,
        setNow: (value: number) => (now = value),
        setFailing: (value: boolean) => (failing = value),
    };
}

const joinRequest = (userId: number) => ({
    update_id: 1,
    chat_join_request: { chat: { id: CHANNEL, type: 'channel' }, from: { id: userId }, user_chat_id: userId },
});

describe('AccessService', () => {
    it('approves a join request when the subscription is active', async () => {
        const t = setup({ 7: NOW + PERIOD });
        await t.service.handleUpdate(joinRequest(7));
        expect(t.methods()).toEqual(['approveChatJoinRequest', 'sendMessage']);
        expect(t.store.state.members['7'].expiresAt).toBe(NOW + PERIOD);
    });

    it('declines a join request without a subscription and offers to pay', async () => {
        const t = setup({ 7: NOW - 10 });
        await t.service.handleUpdate(joinRequest(7));
        expect(t.methods()).toEqual(['declineChatJoinRequest', 'sendMessage']);
        expect(t.calls[1].params.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://pass.example/app');
        expect(t.store.state.members).toEqual({});
    });

    it('ignores join requests to other chats', async () => {
        const t = setup({ 7: NOW + PERIOD });
        await t.service.handleUpdate({ chat_join_request: { chat: { id: -100999 }, from: { id: 7 }, user_chat_id: 7 } });
        expect(t.calls).toEqual([]);
    });

    it('keeps a request pending while the chain is down and retries on sweep', async () => {
        const t = setup({ 7: NOW + PERIOD }, true);
        await t.service.handleUpdate(joinRequest(7));
        expect(t.calls).toEqual([]);
        expect(t.store.state.pending['7']).toBe(7);

        t.setFailing(false);
        await t.service.sweep();
        expect(t.methods()).toContain('approveChatJoinRequest');
        expect(t.store.state.pending).toEqual({});
    });

    it('removes a member after expiry, but not one who renewed', async () => {
        const subscriptions = { 7: NOW + PERIOD, 8: NOW + PERIOD };
        const t = setup(subscriptions);
        await t.service.handleUpdate(joinRequest(7));
        await t.service.handleUpdate(joinRequest(8));
        t.calls.length = 0;

        subscriptions[8] = NOW + 2 * PERIOD; // 8 продлил заранее
        t.setNow(NOW + PERIOD + 1);
        await t.service.sweep();

        expect(t.calls.filter((c) => c.method === 'banChatMember').map((c) => c.params.user_id)).toEqual([7]);
        expect(t.calls.find((c) => c.method === 'unbanChatMember')?.params).toMatchObject({ user_id: 7, only_if_banned: true });
        expect(Object.keys(t.store.state.members)).toEqual(['8']);
        expect(t.store.state.members['8'].expiresAt).toBe(NOW + 2 * PERIOD);
    });

    it('remembers the channel the bot was made admin of', async () => {
        const telegram = fakeTelegram();
        const store = new Store();
        const service = new AccessService({ api: telegram.api, chain: { expiresAt: async () => 0 }, store, log: () => {} });
        await service.handleUpdate({
            my_chat_member: { chat: { id: CHANNEL, type: 'channel', title: 'Клуб' }, new_chat_member: { status: 'administrator' } },
        });
        expect(service.channelId).toBe(CHANNEL);
        expect(service.channelTitle).toBe('Клуб');
        expect(await service.inviteLink()).toBe('https://t.me/+join');
        expect(telegram.calls[0].params).toMatchObject({ chat_id: CHANNEL, creates_join_request: true });
    });
});

describe('API', () => {
    const master = Address.parse('EQCGoUGmGqq9P42RZJQbhbDFT3VFVddiHg_xmce209V5_B6H');
    let base: string;
    let close: () => void;

    beforeAll(async () => {
        const server = createApiServer({
            botToken: BOT_TOKEN,
            network: 'testnet',
            now: () => NOW,
            service: { inviteLink: async () => 'https://t.me/+join', channelTitle: 'Клуб' },
            chain: {
                master,
                terms: async () => ({ price: PRICE, period: PERIOD }),
                expiresAt: async (id) => (id === 7n ? NOW + 100 : 0),
                paymentFor: async (id) => ({
                    address: master,
                    amount: PRICE + toNano('0.05'),
                    payload: Cell.EMPTY,
                }),
            },
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        close = () => server.close();
    });
    afterAll(() => close());

    const get = (path: string, initData?: string) =>
        fetch(base + path, { headers: initData ? { authorization: `tma ${initData}` } : {} });

    it('serves public terms', async () => {
        const body = await (await get('/api/config')).json();
        expect(body).toMatchObject({ network: 'testnet', price: PRICE.toString(), period: PERIOD, channelTitle: 'Клуб' });
        expect(Address.parse(body.master).equals(master)).toBe(true);
    });

    it('requires a valid Telegram signature', async () => {
        expect((await get('/api/me')).status).toBe(401);
        expect((await get('/api/me', initDataFor(7) + '&premium=1')).status).toBe(401);
    });

    it('returns status with a join link only for active subscribers', async () => {
        const active = await (await get('/api/me', initDataFor(7))).json();
        expect(active).toMatchObject({ telegramId: 7, active: true, joinLink: 'https://t.me/+join' });
        const inactive = await (await get('/api/me', initDataFor(8))).json();
        expect(inactive).toMatchObject({ telegramId: 8, active: false, joinLink: null });
    });

    it('returns a TON Connect transaction', async () => {
        const body = await (await get('/api/payment', initDataFor(7))).json();
        expect(body.validUntil).toBe(NOW + 300);
        expect(body.messages[0]).toMatchObject({ amount: (PRICE + toNano('0.05')).toString() });
    });
});
