/// <reference types="vite/client" />
import type { TonConnectUI } from '@tonconnect/ui';
import { Api, AppConfig, httpApi, Me, mockApi } from './api';
import { Lang, strings } from './i18n';
import './style.css';

declare global {
    interface Window {
        Telegram?: { WebApp: TelegramWebApp };
    }
}

interface TelegramMainButton {
    setParams(params: { text?: string; is_active?: boolean; is_visible?: boolean }): void;
    showProgress(leaveActive?: boolean): void;
    hideProgress(): void;
    onClick(callback: () => void): void;
}

interface TelegramWebApp {
    initData: string;
    initDataUnsafe: { user?: { language_code?: string } };
    ready(): void;
    expand(): void;
    openTelegramLink(url: string): void;
    setHeaderColor?(color: string): void;
    setBackgroundColor?(color: string): void;
    MainButton?: TelegramMainButton;
    HapticFeedback?: { notificationOccurred(type: 'success' | 'error' | 'warning'): void };
}

const SOURCE_URL = 'https://github.com/StepanCEO/ton-access-pass';
const POLL_INTERVAL_MS = 4000;
const POLL_ATTEMPTS = 45; // ~3 минуты
// CHAIN из TON Connect: сам SDK тяжёлый и грузится отдельно, после первого экрана
const CHAIN_MAINNET = '-239';
const CHAIN_TESTNET = '-3';
// цена + 0.05 TON на контракт подписки + 0.01 запас на комиссию (см. backend/chain.ts)
const FEES_NANO = 60_000_000n;

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
tg?.setHeaderColor?.('secondary_bg_color');
tg?.setBackgroundColor?.('secondary_bg_color');

const devParams = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
const mockMode = devParams?.get('mock') ?? null;
const initData = mockMode ? 'mock' : (tg?.initData ?? '');
const api: Api = mockMode ? mockApi(mockMode) : httpApi(initData);

const userLang = devParams?.get('lang') ?? tg?.initDataUnsafe.user?.language_code ?? navigator.language;
const lang: Lang = userLang.toLowerCase().startsWith('ru') ? 'ru' : 'en';
const t = strings(lang);
const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
document.documentElement.lang = lang;

type Notice = { kind: 'success' | 'error'; text: string; retry?: boolean } | null;

const state: { config?: AppConfig; me?: Me; waiting: boolean; notice: Notice } = { waiting: false, notice: null };

const root = document.getElementById('app')!;
let tonConnect: TonConnectUI | undefined;

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const formatTon = (nano: bigint) => (Number(nano) / 1e9).toLocaleString(locale, { maximumFractionDigits: 2 });
const formatDate = (unix: number) =>
    new Date(unix * 1000).toLocaleString(locale, {
        day: 'numeric',
        month: lang === 'ru' ? 'long' : 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
const totalTon = () => formatTon(BigInt(state.config!.price) + FEES_NANO);
const explorer = (address: string) =>
    `https://${state.config?.network === 'testnet' ? 'testnet.' : ''}tonviewer.com/${address}`;
const openLink = (url: string) =>
    tg && url.startsWith('https://t.me/') ? tg.openTelegramLink(url) : window.open(url, '_blank', 'noopener');

const row = (label: string, value = '') =>
    `<div class="row"><span class="row__label">${label}</span><span class="row__value">${value}</span></div>`;
const linkRow = (label: string, attrs: string) =>
    `<a class="row row--link" ${attrs}><span class="row__label">${label}</span><span class="chevron" aria-hidden="true"></span></a>`;

/* Главная кнопка: нативная MainButton внутри Telegram, вне его — такая же панель внизу страницы. */
const nativeButton = !mockMode && initData && tg?.MainButton ? tg.MainButton : null;
let mainAction: (() => void) | null = null;

function setMainButton(text: string | null, { progress = false } = {}) {
    if (nativeButton) {
        nativeButton.setParams({ text: text ?? '', is_visible: text !== null, is_active: !progress });
        progress ? nativeButton.showProgress(false) : nativeButton.hideProgress();
        return;
    }
    const bar = document.getElementById('bottom-bar');
    const button = document.getElementById('main-button') as HTMLButtonElement | null;
    if (!bar || !button) return;
    bar.hidden = text === null;
    button.disabled = progress;
    button.classList.toggle('is-loading', progress);
    button.textContent = text ?? '';
}

function renderShell() {
    const config = state.config!;
    const title = config.channelTitle ?? t.channelFallback;
    const days = Math.round(config.period / 86400);
    root.innerHTML = `
        <header class="head">
            <div class="avatar" aria-hidden="true">${escape(title.trim().charAt(0).toUpperCase())}</div>
            <h1 class="head__title">${escape(title)}</h1>
            <p class="head__sub">${t.subtitle(config.network)}</p>
        </header>

        <section class="group">
            <h2 class="group__title">${t.subscription}</h2>
            <div class="list" id="status"></div>
            <p class="group__note" id="notice" hidden></p>
        </section>

        <section class="group">
            <h2 class="group__title">${t.plan}</h2>
            <div class="list">
                ${row(t.days(days), `${formatTon(BigInt(config.price))} TON`)}
                ${row(t.networkFee, `${formatTon(FEES_NANO)} TON`)}
            </div>
            <p class="group__note">${t.planNote}</p>
        </section>

        <section class="group" ${initData ? '' : 'hidden'}>
            <h2 class="group__title">${t.wallet}</h2>
            <div class="list">
                <div class="row row--wallet">
                    <span class="row__label">${mockMode ? 'Tonkeeper' : t.wallet}</span>
                    ${mockMode ? `<span class="row__value mono">0QAP…CBKQ</span>` : `<div id="ton-connect"></div>`}
                </div>
            </div>
        </section>

        <section class="group" id="extra-group" hidden>
            <div class="list" id="extra"></div>
        </section>

        <section class="group">
            ${initData ? '' : `<p class="group__note group__note--top">${t.outsideTelegram}</p>`}
            <div class="list">
                ${linkRow(t.contract, `href="${explorer(config.master)}" target="_blank" rel="noopener"`)}
                ${linkRow(t.source, `href="${SOURCE_URL}" target="_blank" rel="noopener"`)}
            </div>
        </section>

        ${nativeButton ? '' : `<div class="bottom-bar" id="bottom-bar" hidden><button class="main-button" id="main-button"></button></div>`}`;
}

function renderStatus() {
    const status = document.getElementById('status');
    if (!status) return;
    const { me, waiting } = state;
    if (!initData) {
        status.innerHTML = row(t.status, `<span class="muted">${t.statusNone}</span>`);
        return;
    }
    if (!me) {
        status.innerHTML = row(t.status, '<span class="skeleton"></span>');
        return;
    }
    const daysLeft = Math.max(0, Math.ceil((me.expiresAt - Date.now() / 1000) / 86400));
    const value = waiting
        ? `<span class="spinner" aria-hidden="true"></span>${t.statusChecking}`
        : me.active
          ? `<span class="ok">${t.statusActive}</span>`
          : `<span class="muted">${me.expiresAt ? t.statusExpired : t.statusNone}</span>`;
    status.innerHTML = [
        row(t.status, value),
        me.active ? row(t.validUntil, formatDate(me.expiresAt)) : me.expiresAt ? row(t.endedAt, formatDate(me.expiresAt)) : '',
        me.active ? row(t.left, t.days(daysLeft)) : '',
    ].join('');
}

function renderNotice() {
    const notice = document.getElementById('notice');
    if (!notice) return;
    notice.hidden = !state.notice;
    notice.className = `group__note ${state.notice ? `is-${state.notice.kind}` : ''}`;
    notice.textContent = state.notice?.text ?? '';
}

function renderExtra() {
    const group = document.getElementById('extra-group');
    const extra = document.getElementById('extra');
    if (!group || !extra) return;
    const rows: string[] = [];
    // главная кнопка у активного подписчика открывает канал, продление — строкой в списке
    if (state.me?.active && state.me.joinLink && !state.waiting) {
        rows.push(`<button class="row row--action" data-action="pay">${t.extend(totalTon())}</button>`);
    }
    if (state.notice?.retry) rows.push(`<button class="row row--action" data-action="refresh">${t.refresh}</button>`);
    group.hidden = rows.length === 0;
    extra.innerHTML = rows.join('');
}

function renderMainButton() {
    const { me, waiting, config } = state;
    if (!initData) {
        mainAction = config?.botUsername ? () => openLink(`https://t.me/${config.botUsername}`) : null;
        return setMainButton(mainAction ? t.openBot : null);
    }
    if (!me) return setMainButton(null);
    if (waiting) return setMainButton(t.statusChecking, { progress: true });
    if (me.active && me.joinLink) {
        mainAction = () => openLink(me.joinLink!);
        return setMainButton(t.openChannel);
    }
    const connected = mockMode !== null || tonConnect?.connected;
    mainAction = () => void pay();
    setMainButton(connected ? (me.active ? t.extend(totalTon()) : t.pay(totalTon())) : t.connect);
}

function render() {
    renderStatus();
    renderNotice();
    renderExtra();
    renderMainButton();
}

async function refresh() {
    state.me = await api.me();
    render();
}

function fail(text: string, retry = false) {
    state.notice = { kind: 'error', text, retry };
    tg?.HapticFeedback?.notificationOccurred('error');
    render();
}

async function pay() {
    if (!mockMode && !tonConnect?.connected) {
        await tonConnect?.openModal();
        return;
    }
    if (!mockMode && state.config!.network === 'testnet' && tonConnect?.wallet?.account.chain !== CHAIN_TESTNET) {
        return fail(t.wrongNetwork);
    }

    const before = state.me?.expiresAt ?? 0;
    state.notice = null;
    state.waiting = true;
    render();
    try {
        const payment = await api.payment();
        if (!mockMode) {
            await tonConnect!.sendTransaction({
                ...payment,
                network: state.config!.network === 'testnet' ? CHAIN_TESTNET : CHAIN_MAINNET,
            });
        }
    } catch (error) {
        state.waiting = false;
        const sdk = await tonConnectModule();
        return fail(sdk !== null && error instanceof sdk.UserRejectsError ? t.rejected : t.error);
    }

    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, mockMode ? 1800 : POLL_INTERVAL_MS));
        const me = await api.me().catch(() => null);
        if (me && me.expiresAt > before) {
            state.me = me;
            state.waiting = false;
            state.notice = { kind: 'success', text: t.paid };
            tg?.HapticFeedback?.notificationOccurred('success');
            render();
            return;
        }
    }
    state.waiting = false;
    fail(t.timeout, true);
}

nativeButton?.onClick(() => mainAction?.());
root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('#main-button')) return mainAction?.();
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'pay') void pay();
    if (action === 'refresh') {
        state.notice = null;
        refresh().catch(() => fail(t.error, true));
    }
});

const tonConnectModule = () => (mockMode ? Promise.resolve(null) : import('@tonconnect/ui'));

async function start() {
    try {
        state.config = await api.config();
    } catch {
        root.innerHTML = `<p class="group__note is-error">${t.error}</p>`;
        return;
    }
    renderShell();
    render();
    if (!initData) return;

    // статус подписки не ждёт загрузки TON Connect
    const status = refresh().catch(() => fail(t.error, true));

    const sdk = await tonConnectModule();
    if (sdk) {
        tonConnect = new sdk.TonConnectUI({
            manifestUrl: `${location.origin}/tonconnect-manifest.json`,
            buttonRootId: 'ton-connect',
            language: lang,
            actionsConfiguration: state.config.botUsername
                ? { twaReturnUrl: `https://t.me/${state.config.botUsername}` }
                : undefined,
        });
        tonConnect.onStatusChange(() => {
            if (state.notice?.text === t.wrongNetwork) state.notice = null;
            render();
        });
    }
    await status;
}

void start();
