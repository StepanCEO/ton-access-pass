/**
 * Тестовый кошелёк разработчика (только testnet). Фраза хранится в .wallet.testnet.json (права 600, в .gitignore)
 * и никуда не выводится. Запуск: npx ts-node scripts/dev-wallet.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromNano } from '@ton/core';
import { KeyPair, mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { TonClient, WalletContractV4 } from '@ton/ton';

export const WALLET_FILE = join(__dirname, '..', '.wallet.testnet.json');

export const testnetClient = () =>
    new TonClient({ endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC', apiKey: process.env.TONCENTER_API_KEY });

/** Публичный toncenter без ключа пускает ~1 запрос в секунду: повторяем при 429 с паузой. */
export async function retry<T>(task: () => Promise<T>, attempts = 6): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await task();
        } catch (error: any) {
            if (error?.response?.status !== 429 || attempt >= attempts) throw error;
            await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
        }
    }
}

export async function loadDevWallet(): Promise<{ wallet: WalletContractV4; keys: KeyPair }> {
    if (!existsSync(WALLET_FILE)) {
        writeFileSync(WALLET_FILE, JSON.stringify({ network: 'testnet', mnemonic: await mnemonicNew(24) }), { mode: 0o600 });
    }
    const { mnemonic } = JSON.parse(readFileSync(WALLET_FILE, 'utf8'));
    const keys = await mnemonicToPrivateKey(mnemonic);
    return { wallet: WalletContractV4.create({ workchain: 0, publicKey: keys.publicKey }), keys };
}

async function main() {
    const { wallet } = await loadDevWallet();
    const balance = await retry(() => testnetClient().getBalance(wallet.address));
    console.log(`Адрес (testnet): ${wallet.address.toString({ testOnly: true, bounceable: false })}`);
    console.log(`Баланс: ${fromNano(balance)} TON`);
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
