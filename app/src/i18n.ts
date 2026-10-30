const ru = {
    channelFallback: 'Закрытый канал',
    subtitle: (network: string) => `Платный доступ · ${network}`,
    subscription: 'Подписка',
    status: 'Статус',
    statusActive: 'Активна',
    statusExpired: 'Закончилась',
    statusNone: 'Нет',
    statusChecking: 'Проверяем платёж',
    validUntil: 'Действует до',
    endedAt: 'Закончилась',
    left: 'Осталось',
    days: (n: number) => `${n} ${plural(n, ['день', 'дня', 'дней'])}`,
    plan: 'Тариф',
    networkFee: 'Комиссия сети',
    planNote: 'Платёж уходит в смарт-контракт. Если продлить заранее, срок прибавится к оставшемуся.',
    wallet: 'Кошелёк',
    walletNone: 'Не подключён',
    channel: 'Канал',
    openChannel: 'Открыть канал',
    extend: (ton: string) => `Продлить за ${ton} TON`,
    pay: (ton: string) => `Оплатить ${ton} TON`,
    connect: 'Подключить кошелёк',
    contract: 'Контракт в Tonviewer',
    source: 'Исходный код на GitHub',
    paid: 'Оплата получена, доступ открыт.',
    rejected: 'Оплата отменена в кошельке.',
    wrongNetwork: 'Кошелёк подключён к основной сети. Демо работает в testnet: переключите кошелёк.',
    timeout: 'Транзакция пока не видна в блокчейне. Проверьте кошелёк и обновите статус.',
    refresh: 'Обновить статус',
    error: 'Сервер не ответил. Попробуйте ещё раз.',
    outsideTelegram: 'Подписка привязана к Telegram-аккаунту, поэтому оплатить можно только из бота.',
    openBot: 'Открыть в Telegram',
};

type Strings = typeof ru;

const en: Strings = {
    channelFallback: 'Private channel',
    subtitle: (network) => `Paid access · ${network}`,
    subscription: 'Subscription',
    status: 'Status',
    statusActive: 'Active',
    statusExpired: 'Expired',
    statusNone: 'None',
    statusChecking: 'Checking payment',
    validUntil: 'Valid until',
    endedAt: 'Ended',
    left: 'Left',
    days: (n) => `${n} ${n === 1 ? 'day' : 'days'}`,
    plan: 'Plan',
    networkFee: 'Network fee',
    planNote: 'The payment goes to a smart contract. Renewing early adds to the time you have left.',
    wallet: 'Wallet',
    walletNone: 'Not connected',
    channel: 'Channel',
    openChannel: 'Open channel',
    extend: (ton) => `Extend for ${ton} TON`,
    pay: (ton) => `Pay ${ton} TON`,
    connect: 'Connect wallet',
    contract: 'Contract on Tonviewer',
    source: 'Source code on GitHub',
    paid: 'Payment received, access granted.',
    rejected: 'Payment cancelled in the wallet.',
    wrongNetwork: 'Your wallet is on mainnet. This demo runs on testnet, please switch.',
    timeout: 'The transaction is not on-chain yet. Check your wallet and refresh.',
    refresh: 'Refresh status',
    error: 'The server did not respond. Please try again.',
    outsideTelegram: 'The subscription is tied to your Telegram account, so you can only pay from the bot.',
    openBot: 'Open in Telegram',
};

function plural(n: number, forms: [string, string, string]) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
}

export type Lang = 'ru' | 'en';
export const strings = (lang: Lang): Strings => (lang === 'ru' ? ru : en);
