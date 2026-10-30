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

interface TelegramWebApp {
    initData: string;
    initDataUnsafe: { user?: { language_code?: string } };
    ready(): void;
    expand(): void;
    openTelegramLink(url: string): void;
    HapticFeedback?: { notificationOccurred(type: 'success' | 'error' | 'warning'): void };
}

const SOURCE_URL = 'https://github.com/StepanCEO/ton-access-pass';
const POLL_INTERVAL_MS = 4000;
const POLL_ATTEMPTS = 45; // ~3 минуты
// CHAIN из TON Connect: сам SDK тяжёлый и грузится отдельно, после первого экрана
const CHAIN_MAINNET = '-239';
const CHAIN_TESTNET = '-3';

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const devParams = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
const mockMode = devParams?.get('mock') ?? null;
const initData = mockMode ? 'mock' : (tg?.initData ?? '');
const api: Api = mockMode ? mockApi(mockMode) : httpApi(initData);

const userLang = devParams?.get('lang') ?? tg?.initDataUnsafe.user?.language_code ?? navigator.language;
const lang: Lang = userLang.toLowerCase().startsWith('ru') ? 'ru' : 'en';
const t = strings(lang);
document.documentElement.lang = lang;

type Notice = { kind: 'info' | 'success' | 'error'; text: string; hint?: string } | null;

const state: { config?: AppConfig; me?: Me; busy: boolean; waiting: boolean; notice: Notice } = {
    busy: false,
    waiting: false,
    notice: null,
};

const root = document.getElementById('app')!;
let tonConnect: TonConnectUI | undefined;

const escape = (text: string) =>
    text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const formatTon = (nano: bigint) =>
    (Number(nano) / 1e9).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 2 });

const formatDate = (unix: number) =>
    new Date(unix * 1000).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
    });

const totalNano = () => BigInt(state.config!.price) + 60_000_000n; // цена + 0.05 на подписку + 0.01 запас

const explorer = (address: string) =>
    `https://${state.config?.network === 'testnet' ? 'testnet.' : ''}tonviewer.com/${address}`;

const openLink = (url: string) => (tg && url.startsWith('https://t.me/') ? tg.openTelegramLink(url) : window.open(url, '_blank'));

function renderShell() {
    const { config } = state;
    const days = Math.round(config!.period / 86400);
    root.innerHTML = `
        <header class="hero">
            <div class="hero__top">
                <img class="hero__logo" src="/icon.svg" width="44" height="44" alt="" />
                ${config!.network === 'testnet' ? `<span class="badge">${t.testnet}</span>` : ''}
            </div>
            <h1>TON Access Pass</h1>
            <p class="muted">${t.tagline}</p>
        </header>
        <section class="card" id="status"></section>
        <section class="card price">
            <div class="price__main">${t.price(formatTon(BigInt(config!.price)), days)}</div>
            <div class="muted small">${t.fee}</div>
        </section>
        <div id="ton-connect" class="wallet" ${initData && !mockMode ? '' : 'hidden'}></div>
        <section id="actions" class="actions"></section>
        <section class="how">
            <h2>${t.howTitle}</h2>
            <ol>${t.how.map((step) => `<li>${step}</li>`).join('')}</ol>
        </section>
        <footer class="footer">
            <a href="${explorer(config!.master)}" target="_blank" rel="noopener">${t.contract} ↗</a>
            <a href="${SOURCE_URL}" target="_blank" rel="noopener">${t.source} ↗</a>
        </footer>`;
}

function renderStatus() {
    const status = document.getElementById('status')!;
    const { me } = state;
    if (!initData) {
        status.innerHTML = `
            <div class="status__label">${t.openInTelegram}</div>
            <p class="muted small">${t.openInTelegramHint}</p>`;
        return;
    }
    if (!me) {
        status.innerHTML = `<div class="skeleton"></div>`;
        return;
    }
    const now = Date.now() / 1000;
    const daysLeft = Math.max(0, Math.ceil((me.expiresAt - now) / 86400));
    const periodDays = state.config!.period / 86400;
    const progress = Math.min(100, (daysLeft / periodDays) * 100);
    status.innerHTML = `
        <div class="status__label muted small">${t.statusTitle}</div>
        <div class="status__value ${me.active ? 'is-active' : ''}">
            <span class="dot"></span>
            ${me.active ? t.active(formatDate(me.expiresAt)) : me.expiresAt ? t.expired(formatDate(me.expiresAt)) : t.none}
        </div>
        ${
            me.active
                ? `<div class="meter" role="progressbar" aria-valuenow="${daysLeft}" aria-valuemin="0" aria-valuemax="${periodDays}">
                       <span style="width:${progress}%"></span>
                   </div>
                   <div class="muted small">${t.daysLeft(daysLeft)}</div>`
                : ''
        }`;
}

function renderActions() {
    const actions = document.getElementById('actions')!;
    const { me, notice, busy, waiting } = state;
    const parts: string[] = [];

    if (notice) {
        parts.push(`
            <div class="notice notice--${notice.kind}">
                ${notice.kind === 'info' ? '<span class="spinner" aria-hidden="true"></span>' : ''}
                <div><div>${escape(notice.text)}</div>${notice.hint ? `<div class="small muted">${escape(notice.hint)}</div>` : ''}</div>
            </div>`);
    }

    if (!initData) {
        const bot = state.config?.botUsername;
        if (bot) parts.push(`<a class="button" href="https://t.me/${bot}" target="_blank" rel="noopener">${t.openBot}</a>`);
    } else if (me) {
        if (me.active && me.joinLink) parts.push(`<button class="button" data-action="join">${t.join}</button>`);
        const connected = mockMode !== null || tonConnect?.connected;
        const label = !connected ? t.connectFirst : me.active ? t.extend(formatTon(totalNano())) : t.pay(formatTon(totalNano()));
        parts.push(
            `<button class="button ${me.active ? 'button--secondary' : ''}" data-action="pay" ${busy || waiting ? 'disabled' : ''}>${label}</button>`,
        );
    }
    if (initData && notice?.kind === 'error') parts.push(`<button class="link" data-action="refresh">${t.refresh}</button>`);
    actions.innerHTML = parts.join('');
}

function render() {
    renderStatus();
    renderActions();
}

async function refresh() {
    state.me = await api.me();
    render();
}

async function pay() {
    if (!mockMode && !tonConnect?.connected) {
        await tonConnect?.openModal();
        return;
    }
    const wallet = tonConnect?.wallet;
    if (!mockMode && state.config!.network === 'testnet' && wallet?.account.chain !== CHAIN_TESTNET) {
        state.notice = { kind: 'error', text: t.wrongNetwork };
        render();
        return;
    }

    const before = state.me?.expiresAt ?? 0;
    state.busy = true;
    state.notice = null;
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
        state.busy = false;
        const sdk = await tonConnectModule();
        const rejected = sdk !== null && error instanceof sdk.UserRejectsError;
        state.notice = { kind: 'error', text: rejected ? t.rejected : t.error };
        tg?.HapticFeedback?.notificationOccurred('error');
        render();
        return;
    }

    state.busy = false;
    state.waiting = true;
    state.notice = { kind: 'info', text: t.waiting, hint: t.waitingHint };
    render();

    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, mockMode ? 1500 : POLL_INTERVAL_MS));
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
    state.notice = { kind: 'error', text: t.timeout };
    render();
}

root.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'pay') void pay();
    if (action === 'join' && state.me?.joinLink) openLink(state.me.joinLink);
    if (action === 'refresh') {
        state.notice = null;
        refresh().catch(() => {
            state.notice = { kind: 'error', text: t.error };
            render();
        });
    }
});

const tonConnectModule = () => (mockMode ? Promise.resolve(null) : import('@tonconnect/ui'));

async function start() {
    try {
        state.config = await api.config();
    } catch {
        root.innerHTML = `<div class="notice notice--error">${t.error}</div>`;
        return;
    }
    renderShell();
    render();
    if (!initData) return;

    // статус подписки не ждёт загрузки TON Connect
    const status = refresh().catch(() => {
        state.notice = { kind: 'error', text: t.error };
        render();
    });

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
            renderActions();
        });
    }
    await status;
}

void start();
