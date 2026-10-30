import { Address, beginCell, Cell, Contract, OpenedContract, toNano } from '@ton/core';
import { AccessMaster, storeSubscribe, SUBSCRIPTION_VALUE } from '../build/access_pass/access_pass_AccessMaster';
import { Subscription } from '../build/access_pass/access_pass_Subscription';

/** То, что нужно от сети: TonClient в проде, Blockchain из песочницы в тестах. */
export interface ChainAccess {
    open<T extends Contract>(contract: T): OpenedContract<T>;
    isDeployed(address: Address): Promise<boolean>;
}

export interface Terms {
    price: bigint;
    period: number;
}

export interface Payment {
    address: Address;
    amount: bigint;
    payload: Cell;
}

const TERMS_TTL_MS = 60_000;
/** Запас сверх минимума контракта: некоторые кошельки вычитают комиссию пересылки из суммы перевода. */
export const FEE_RESERVE = toNano('0.01');

export class AccessChain {
    private termsCache?: { value: Terms; until: number };
    private queue: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly access: ChainAccess,
        readonly master: Address,
        /** Пауза между запросами: публичный toncenter без ключа пускает 1 запрос в секунду. */
        private readonly minIntervalMs = 0,
    ) {}

    async subscriptionAddress(telegramId: bigint): Promise<Address> {
        return (await Subscription.fromInit(this.master, telegramId)).address;
    }

    /** Unix-время окончания подписки, 0 — если пользователь ещё ни разу не платил. */
    async expiresAt(telegramId: bigint): Promise<number> {
        const address = await this.subscriptionAddress(telegramId);
        return this.limited(async () => {
            try {
                return Number(await this.access.open(Subscription.fromAddress(address)).getExpiresAt());
            } catch (error) {
                if (!(await this.access.isDeployed(address))) return 0;
                throw error;
            }
        });
    }

    async terms(): Promise<Terms> {
        if (this.termsCache && this.termsCache.until > Date.now()) return this.termsCache.value;
        const master = this.access.open(AccessMaster.fromAddress(this.master));
        const value = await this.limited(async () => ({
            price: await master.getPrice(),
            period: Number(await master.getPeriod()),
        }));
        this.termsCache = { value, until: Date.now() + TERMS_TTL_MS };
        return value;
    }

    /** Транзакция для TON Connect: цена + 0.05 TON на развёртывание контракта подписки + запас на комиссию. */
    async paymentFor(telegramId: bigint): Promise<Payment> {
        const { price } = await this.terms();
        const payload = beginCell()
            .store(storeSubscribe({ $$type: 'Subscribe', queryId: BigInt(Date.now()), telegramId }))
            .endCell();
        return { address: this.master, amount: price + SUBSCRIPTION_VALUE + FEE_RESERVE, payload };
    }

    private limited<T>(task: () => Promise<T>): Promise<T> {
        const run = this.queue.then(() => this.withRetry(task));
        this.queue = run.catch(() => undefined).then(() => sleep(this.minIntervalMs));
        return run;
    }

    private async withRetry<T>(task: () => Promise<T>): Promise<T> {
        try {
            return await task();
        } catch (error: any) {
            // toncenter отвечает 429, если превысить лимит, — одна повторная попытка
            if (error?.response?.status !== 429 && error?.status !== 429) throw error;
            await sleep(1500);
            return task();
        }
    }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
