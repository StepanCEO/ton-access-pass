import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramUser {
    id: number;
    first_name?: string;
    username?: string;
    language_code?: string;
}

/**
 * Проверяет initData из Telegram Mini App: подпись HMAC от токена бота и свежесть auth_date.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyInitData(
    initData: string,
    botToken: string,
    maxAgeSeconds = 24 * 60 * 60,
    now = Math.floor(Date.now() / 1000),
): TelegramUser | null {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
    params.delete('hash');

    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const expected = createHmac('sha256', secret).update(dataCheckString).digest();
    if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;

    const authDate = Number(params.get('auth_date'));
    if (!Number.isFinite(authDate) || now - authDate > maxAgeSeconds) return null;

    try {
        const user = JSON.parse(params.get('user') ?? '');
        return typeof user?.id === 'number' ? user : null;
    } catch {
        return null;
    }
}

export type BotApi = <T = any>(method: string, params?: Record<string, unknown>) => Promise<T>;

export class TelegramError extends Error {
    constructor(
        readonly method: string,
        readonly code: number,
        readonly description: string,
    ) {
        super(`Telegram ${method}: ${code} ${description}`);
    }
}

/** Клиент Bot API. Токен живёт только в URL запроса и никогда не попадает в тексты ошибок. */
export function createBotApi(token: string, fetchImpl: typeof fetch = fetch): BotApi {
    return async (method, params = {}) => {
        let response: Response;
        try {
            response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(params),
                signal: AbortSignal.timeout(60_000),
            });
        } catch {
            throw new TelegramError(method, 0, 'сеть недоступна');
        }
        const body: any = await response.json().catch(() => null);
        if (!body?.ok) throw new TelegramError(method, body?.error_code ?? response.status, body?.description ?? 'пустой ответ');
        return body.result;
    };
}
