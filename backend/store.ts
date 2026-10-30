import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Member {
    expiresAt: number;
    joinedAt: number;
}

export interface State {
    updateOffset: number;
    channelId?: number;
    inviteLink?: string;
    /** Пользователи в канале: telegramId → срок подписки на момент последней проверки. */
    members: Record<string, Member>;
    /** Заявки в канал, которые не удалось проверить (сеть недоступна): telegramId → user_chat_id. */
    pending: Record<string, number>;
}

/** Состояние бота в одном JSON-файле. Источник правды о подписках — блокчейн, здесь только кэш. */
export class Store {
    state: State;

    constructor(private readonly file?: string) {
        this.state = { updateOffset: 0, members: {}, pending: {} };
        if (!file) return;
        try {
            this.state = { ...this.state, ...JSON.parse(readFileSync(file, 'utf8')) };
        } catch (error: any) {
            if (error.code !== 'ENOENT') throw error;
        }
    }

    save() {
        if (!this.file) return;
        mkdirSync(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        writeFileSync(tmp, JSON.stringify(this.state, null, 2));
        renameSync(tmp, this.file);
    }
}
