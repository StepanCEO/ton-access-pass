const ru = {
    tagline: 'Закрытый канал по подписке. Оплата в TON, доступ выдаёт смарт-контракт.',
    statusTitle: 'Подписка',
    active: (date: string) => `Активна до ${date}`,
    expired: (date: string) => `Закончилась ${date}`,
    none: 'Ещё не оформлена',
    daysLeft: (days: number) => `${days} ${plural(days, ['день', 'дня', 'дней'])} осталось`,
    price: (ton: string, days: number) => `${ton} TON за ${days} ${plural(days, ['день', 'дня', 'дней'])}`,
    fee: 'плюс 0,06 TON на комиссию сети и хранение подписки',
    pay: (ton: string) => `Оплатить ${ton} TON`,
    extend: (ton: string) => `Продлить за ${ton} TON`,
    connectFirst: 'Подключить кошелёк',
    join: 'Войти в канал',
    waiting: 'Ждём подтверждения в блокчейне…',
    waitingHint: 'Обычно 5–15 секунд. Окно можно не закрывать.',
    paid: 'Оплата прошла — доступ открыт',
    rejected: 'Оплата отменена',
    wrongNetwork: 'Кошелёк в основной сети. Это демо работает в testnet — подключите тестовый кошелёк.',
    timeout: 'Транзакция ещё не появилась. Проверьте кошелёк и обновите статус чуть позже.',
    refresh: 'Обновить статус',
    openInTelegram: 'Откройте приложение в Telegram',
    openInTelegramHint: 'Подписка привязана к вашему Telegram-аккаунту, поэтому оплата работает только внутри Telegram.',
    openBot: 'Открыть бота',
    howTitle: 'Как это работает',
    how: [
        'Платёж уходит в смарт-контракт — никаких посредников и ручной проверки.',
        'Контракт создаёт для вас отдельную подписку со сроком действия.',
        'Бот видит подписку в блокчейне и пускает в канал, а когда срок выйдет — убирает.',
    ],
    contract: 'Контракт',
    source: 'Исходный код',
    testnet: 'Testnet',
    error: 'Не удалось связаться с сервером. Попробуйте ещё раз.',
};

type Strings = typeof ru;

const en: Strings = {
    tagline: 'A private channel by subscription. Paid in TON, access granted by a smart contract.',
    statusTitle: 'Subscription',
    active: (date) => `Active until ${date}`,
    expired: (date) => `Expired on ${date}`,
    none: 'Not purchased yet',
    daysLeft: (days) => `${days} ${days === 1 ? 'day' : 'days'} left`,
    price: (ton, days) => `${ton} TON for ${days} days`,
    fee: 'plus 0.06 TON for network fees and subscription storage',
    pay: (ton) => `Pay ${ton} TON`,
    extend: (ton) => `Extend for ${ton} TON`,
    connectFirst: 'Connect wallet',
    join: 'Join the channel',
    waiting: 'Waiting for blockchain confirmation…',
    waitingHint: 'Usually 5–15 seconds. You can keep this window open.',
    paid: 'Payment confirmed — access granted',
    rejected: 'Payment cancelled',
    wrongNetwork: 'Your wallet is on mainnet. This demo runs on testnet — connect a testnet wallet.',
    timeout: 'The transaction has not appeared yet. Check your wallet and refresh a bit later.',
    refresh: 'Refresh status',
    openInTelegram: 'Open the app in Telegram',
    openInTelegramHint: 'The subscription is tied to your Telegram account, so payment works only inside Telegram.',
    openBot: 'Open the bot',
    howTitle: 'How it works',
    how: [
        'The payment goes straight to a smart contract — no middlemen, no manual checks.',
        'The contract creates a separate subscription for you with an expiry date.',
        'The bot reads it on-chain, lets you into the channel and removes you when it expires.',
    ],
    contract: 'Contract',
    source: 'Source code',
    testnet: 'Testnet',
    error: 'Could not reach the server. Please try again.',
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
