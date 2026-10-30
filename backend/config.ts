import { Address } from '@ton/core';

export type Network = 'testnet' | 'mainnet';

export interface Config {
    botToken: string;
    masterAddress: Address;
    network: Network;
    /** Если не задан, бот запомнит канал, в который его добавят админом. */
    channelId?: number;
    miniAppUrl?: string;
    port: number;
    dataFile: string;
    toncenterApiKey?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const missing = ['BOT_TOKEN', 'MASTER_ADDRESS'].filter((key) => !env[key]);
    if (missing.length) throw new Error(`Не заданы переменные окружения: ${missing.join(', ')}`);

    return {
        botToken: env.BOT_TOKEN!,
        masterAddress: Address.parse(env.MASTER_ADDRESS!),
        network: env.TON_NETWORK === 'mainnet' ? 'mainnet' : 'testnet',
        channelId: env.CHANNEL_ID ? Number(env.CHANNEL_ID) : undefined,
        miniAppUrl: env.MINI_APP_URL || undefined,
        port: Number(env.PORT ?? 8096),
        dataFile: env.DATA_FILE ?? './data/state.json',
        toncenterApiKey: env.TONCENTER_API_KEY || undefined,
    };
}
