import type { BotApi } from './telegram';
import type { Store } from './store';

export interface ServiceDeps {
    api: BotApi;
    chain: { expiresAt(telegramId: bigint): Promise<number> };
    store: Store;
    channelId?: number;
    miniAppUrl?: string;
    now?: () => number;
    log?: (message: string) => void;
}

const formatDate = (unix: number) =>
    new Date(unix * 1000).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
    });

/**
 * Логика доступа: вход в канал только по заявке, бот одобряет её, если подписка в блокчейне активна,
 * и убирает участника, когда срок закончился и продления нет.
 */
export class AccessService {
    private readonly now: () => number;
    private readonly log: (message: string) => void;

    constructor(private readonly deps: ServiceDeps) {
        this.now = deps.now ?? (() => Math.floor(Date.now() / 1000));
        this.log = deps.log ?? ((message) => console.log(message));
    }

    get channelId(): number | undefined {
        return this.deps.channelId ?? this.deps.store.state.channelId;
    }

    async handleUpdate(update: any) {
        if (update.message?.text) await this.onMessage(update.message);
        else if (update.chat_join_request) await this.onJoinRequest(update.chat_join_request);
        else if (update.my_chat_member) this.onBotMembership(update.my_chat_member);
    }

    /** Ссылка-заявка в канал: по ней не войти без одобрения бота, поэтому её можно отдавать кому угодно. */
    async inviteLink(): Promise<string | undefined> {
        const { store } = this.deps;
        if (store.state.inviteLink || !this.channelId) return store.state.inviteLink;
        const link = await this.deps.api<{ invite_link: string }>('createChatInviteLink', {
            chat_id: this.channelId,
            name: 'TON Access Pass',
            creates_join_request: true,
        });
        store.state.inviteLink = link.invite_link;
        store.save();
        return link.invite_link;
    }

    /** Раз в минуту: повторить непроверенные заявки и убрать тех, у кого кончилась подписка. */
    async sweep() {
        const { store } = this.deps;
        for (const userId of Object.keys(store.state.pending)) await this.review(Number(userId));

        for (const [userId, member] of Object.entries(store.state.members)) {
            if (member.expiresAt > this.now()) continue;
            let fresh: number;
            try {
                fresh = await this.deps.chain.expiresAt(BigInt(userId));
            } catch (error) {
                this.log(`Не удалось проверить подписку ${userId}: ${error}`);
                continue;
            }
            if (fresh > this.now()) {
                member.expiresAt = fresh; // продлил заранее — просто обновляем срок
                store.save();
                continue;
            }
            await this.removeFromChannel(Number(userId));
        }
    }

    private async onMessage(message: any) {
        if (message.chat?.type !== 'private') return;
        const command = message.text.split(/[\s@]/)[0];

        if (command === '/start') {
            await this.send(
                message.chat.id,
                'Это демо платного доступа на TON.\n\n' +
                    'Оплачиваешь подписку в Mini App — бот сам пускает тебя в закрытый канал, ' +
                    'а когда срок заканчивается, убирает. Все платежи проверяются в блокчейне.\n\n' +
                    'Сеть testnet: платишь тестовыми TON, настоящие деньги не нужны.',
                this.appButton('Открыть'),
            );
        } else if (command === '/status') {
            let expiresAt: number;
            try {
                expiresAt = await this.deps.chain.expiresAt(BigInt(message.from.id));
            } catch {
                await this.send(message.chat.id, 'Не получилось проверить подписку, сеть TON не ответила. Попробуй через минуту.');
                return;
            }
            const text =
                expiresAt > this.now()
                    ? `Подписка активна до ${formatDate(expiresAt)} (МСК).`
                    : expiresAt > 0
                      ? `Подписка закончилась ${formatDate(expiresAt)}.`
                      : 'Подписки пока нет.';
            await this.send(message.chat.id, text, this.appButton(expiresAt > this.now() ? 'Продлить' : 'Оформить'));
        }
    }

    private async onJoinRequest(request: any) {
        if (request.chat.id !== this.channelId) return;
        this.deps.store.state.pending[request.from.id] = request.user_chat_id;
        this.deps.store.save();
        await this.review(request.from.id);
    }

    private async review(userId: number) {
        const { store, api } = this.deps;
        const userChatId = store.state.pending[userId];
        let expiresAt: number;
        try {
            expiresAt = await this.deps.chain.expiresAt(BigInt(userId));
        } catch (error) {
            this.log(`Заявка ${userId} ждёт: ${error}`); // останется в pending, sweep повторит
            return;
        }
        delete store.state.pending[userId];
        store.save();

        const active = expiresAt > this.now();
        try {
            await api(active ? 'approveChatJoinRequest' : 'declineChatJoinRequest', {
                chat_id: this.channelId,
                user_id: userId,
            });
        } catch (error) {
            this.log(`Заявка ${userId} уже обработана: ${error}`);
            return;
        }

        if (active) {
            store.state.members[userId] = { expiresAt, joinedAt: this.now() };
            store.save();
            this.log(`Пустил ${userId} до ${expiresAt}`);
            await this.send(userChatId, `Готово, ты в канале. Подписка активна до ${formatDate(expiresAt)} (МСК).`);
        } else {
            await this.send(userChatId, 'Подписка не найдена. Оформи её в Mini App и отправь заявку ещё раз.', this.appButton('Оформить'));
        }
    }

    private async removeFromChannel(userId: number) {
        const { store, api } = this.deps;
        try {
            // бан + разбан = исключить из канала без вечного бана, вернуться можно после оплаты
            await api('banChatMember', { chat_id: this.channelId, user_id: userId });
            await api('unbanChatMember', { chat_id: this.channelId, user_id: userId, only_if_banned: true });
        } catch (error) {
            this.log(`Не удалось убрать ${userId}: ${error}`);
            return;
        }
        delete store.state.members[userId];
        store.save();
        this.log(`Убрал ${userId}: подписка закончилась`);
        await this.send(userId, 'Подписка закончилась, доступ к каналу закрыт. Продлить можно в Mini App.', this.appButton('Продлить'));
    }

    private onBotMembership(update: any) {
        if (update.chat.type !== 'channel' || this.deps.channelId) return;
        const { store } = this.deps;
        const status = update.new_chat_member?.status;
        if (status === 'administrator') {
            store.state.channelId = update.chat.id;
            this.log(`Канал подключён: ${update.chat.title} (${update.chat.id})`);
        } else if (update.chat.id === store.state.channelId && (status === 'left' || status === 'kicked')) {
            store.state.channelId = undefined;
            this.log('Бота убрали из канала');
        } else return;
        store.state.inviteLink = undefined;
        store.save();
    }

    private appButton(text: string) {
        if (!this.deps.miniAppUrl) return undefined;
        return { inline_keyboard: [[{ text, web_app: { url: this.deps.miniAppUrl } }]] };
    }

    /** Пользователь мог не запускать бота или заблокировать его — это не ошибка сервиса. */
    private async send(chatId: number, text: string, replyMarkup?: object) {
        try {
            await this.deps.api('sendMessage', { chat_id: chatId, text, reply_markup: replyMarkup });
        } catch (error) {
            this.log(`Сообщение ${chatId} не доставлено: ${error}`);
        }
    }
}
