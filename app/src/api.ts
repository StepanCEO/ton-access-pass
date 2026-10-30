export interface AppConfig {
    network: 'testnet' | 'mainnet';
    botUsername: string | null;
    master: string;
    price: string;
    period: number;
}

export interface Me {
    telegramId: number;
    firstName?: string;
    expiresAt: number;
    active: boolean;
    joinLink: string | null;
}

/** Транзакция в формате TON Connect, собранная бэкендом. */
export interface Payment {
    validUntil: number;
    messages: { address: string; amount: string; payload?: string }[];
}

export interface Api {
    config(): Promise<AppConfig>;
    me(): Promise<Me>;
    payment(): Promise<Payment>;
}

export class ApiError extends Error {}

/** Бэкенд узнаёт пользователя по initData, подписанной Telegram. */
export function httpApi(initData: string): Api {
    const get = async <T>(path: string): Promise<T> => {
        const response = await fetch(path, { headers: initData ? { authorization: `tma ${initData}` } : {} });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new ApiError(body.error ?? `HTTP ${response.status}`);
        return body;
    };
    return {
        config: () => get('/api/config'),
        me: () => get('/api/me'),
        payment: () => get('/api/payment'),
    };
}

/** Только для разработки и скриншотов: `npm run app:dev` → /?mock=new | active | expired. */
export function mockApi(mode: string): Api {
    const now = Math.floor(Date.now() / 1000);
    let expiresAt = mode === 'active' ? now + 23 * 86400 : mode === 'expired' ? now - 3 * 86400 : 0;
    const config: AppConfig = {
        network: 'testnet',
        botUsername: 'ton_access_pass_bot',
        master: 'kQAcI3X5Pt46n3grbyZBW5QegZDhjkfd2wVTb1s8PupuSg1m',
        price: '1000000000',
        period: 30 * 86400,
    };
    return {
        config: async () => config,
        me: async () => ({
            telegramId: 1,
            firstName: 'Степан',
            expiresAt,
            active: expiresAt > now,
            joinLink: expiresAt > now ? 'https://t.me/+demo' : null,
        }),
        payment: async () => {
            expiresAt = Math.max(expiresAt, now) + config.period;
            return { validUntil: now + 300, messages: [] };
        },
    };
}
