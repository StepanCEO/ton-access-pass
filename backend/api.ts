import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import type { AccessChain } from './chain';
import type { Network } from './config';
import type { AccessService } from './service';
import { TelegramUser, verifyInitData } from './telegram';

export interface ApiDeps {
    chain: Pick<AccessChain, 'master' | 'terms' | 'expiresAt' | 'paymentFor'>;
    service: Pick<AccessService, 'inviteLink'>;
    botToken: string;
    botUsername?: string;
    network: Network;
    now?: () => number;
}

class HttpError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

/**
 * HTTP API для Mini App (за Caddy, только 127.0.0.1).
 * Пользователь определяется по initData из Telegram: заголовок `Authorization: tma <initData>`.
 */
export function createApiServer(deps: ApiDeps) {
    const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
    const testOnly = deps.network === 'testnet';

    const authorize = (request: IncomingMessage): TelegramUser => {
        const header = request.headers.authorization ?? '';
        const user = header.startsWith('tma ') ? verifyInitData(header.slice(4), deps.botToken) : null;
        if (!user) throw new HttpError(401, 'Откройте приложение из Telegram');
        return user;
    };

    const routes: Record<string, (request: IncomingMessage) => Promise<unknown>> = {
        '/api/health': async () => ({ ok: true }),

        '/api/config': async () => {
            const { price, period } = await deps.chain.terms();
            return {
                network: deps.network,
                botUsername: deps.botUsername ?? null,
                master: deps.chain.master.toString({ testOnly }),
                price: price.toString(),
                period,
            };
        },

        '/api/me': async (request) => {
            const user = authorize(request);
            const expiresAt = await deps.chain.expiresAt(BigInt(user.id));
            const active = expiresAt > now();
            return {
                telegramId: user.id,
                firstName: user.first_name,
                expiresAt,
                active,
                joinLink: active ? ((await deps.service.inviteLink()) ?? null) : null,
            };
        },

        '/api/payment': async (request) => {
            const user = authorize(request);
            const payment = await deps.chain.paymentFor(BigInt(user.id));
            return {
                validUntil: now() + 5 * 60,
                messages: [
                    {
                        address: payment.address.toString({ testOnly }),
                        amount: payment.amount.toString(),
                        payload: payment.payload.toBoc().toString('base64'),
                    },
                ],
            };
        },
    };

    return createServer(async (request: IncomingMessage, response: ServerResponse) => {
        const send = (status: number, body: unknown) => {
            response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            response.end(JSON.stringify(body));
        };
        const route = routes[new URL(request.url ?? '/', 'http://localhost').pathname];
        if (!route) return send(404, { error: 'Не найдено' });
        if (request.method !== 'GET') return send(405, { error: 'Только GET' });
        try {
            send(200, await route(request));
        } catch (error) {
            if (error instanceof HttpError) return send(error.status, { error: error.message });
            console.error(`API ${request.url}: ${error}`);
            send(502, { error: 'Сеть TON не ответила, попробуйте ещё раз' });
        }
    });
}
