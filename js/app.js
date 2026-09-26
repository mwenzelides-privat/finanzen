// App-Start, Navigation, Sperrbildschirm, Sync-Anzeige
import { store, loadLocal, ensureDefaults, unlock, kvSet } from './store.js';
import * as sync from './sync.js';
import * as drive from './drive.js';
import { icon } from './icons.js';
import { promptDialog, toast } from './ui.js';
import { destroyCharts, resizeCharts } from './charts.js';
import { ls, esc } from './util.js';
import * as dashboard from './views/dashboard.js';
import * as transactions from './views/transactions.js';
import * as accounts from './views/accounts.js';
import * as budgets from './views/budgets.js';
import * as vacation from './views/vacation.js';
import * as tax from './views/tax.js';
import * as reports from './views/reports.js';
import * as importView from './views/import.js';
import * as settings from './views/settings.js';

const ROUTES = [
  { path: '', icon: 'dashboard', view: dashboard, label: 'Übersicht' },
  { path: 'buchungen', icon: 'list', view: transactions, label: 'Buchungen' },
  { path: 'konten', icon: 'wallet', view: accounts, label: 'Konten' },
  { path: 'budgets', icon: 'target', view: budgets, label: 'Budgets' },
  { path: 'urlaub', icon: 'plane', view: vacation, label: 'Urlaubskasse' },
  { path: 'steuer', icon: 'file', view: tax, label: 'Steuer' },
  { path: 'berichte', icon: 'chart', view: reports, label: 'Berichte' },
  { path: 'import', icon: 'upload', view: importView, label: 'Import' },
  { path: 'einstellungen', icon: 'sliders', view: settings, label: 'Einstellungen' },
];

const app = document.getElementById('app');

// ---------- Design (hell/dunkel/automatisch) ----------
const THEMES = ['auto', 'light', 'dark'];
function setTheme(t, rerenderNow = true) {
  ls.set('fv.theme', t);
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const btn = document.getElementById('themeBtn');
  if (btn) {
    btn.innerHTML = icon(t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'auto');
    btn.title = `Design: ${{ auto: 'automatisch', light: 'hell', dark: 'dunkel' }[t]}`;
  }
  if (rerenderNow) schedule();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if ((ls.get('fv.theme') || 'auto') === 'auto') schedule(); });

// ---------- Sperrbildschirm ----------
function lockScreen(envelope) {
  return new Promise((resolve) => {
    app.innerHTML = `<div class="lock">
      <form class="card lock-card" autocomplete="on">
        <div class="welcome-icon">${icon('lock')}</div>
        <h1>Finanzen gesperrt</h1>
        <p class="sub">Deine Daten sind verschlüsselt. Bitte Passwort eingeben.</p>
        <input type="text" name="username" value="finanzverwaltung" autocomplete="username" hidden>
        <input type="password" name="p" placeholder="Passwort" autocomplete="current-password" required autofocus>
        <label class="check"><input type="checkbox" name="trust"> Diesem Gerät vertrauen</label>
        <button class="btn btn-primary btn-block" type="submit">Entsperren</button>
        <p class="small text-bad" data-err hidden>Falsches Passwort.</p>
      </form></div>`;
    const form = app.querySelector('form');
    form.p.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true; btn.textContent = 'Entsperre …';
      try {
        const key = await unlock(envelope, form.p.value);
        if (form.trust.checked) await kvSet('trustedKey', key);
        resolve();
      } catch {
        form.querySelector('[data-err]').hidden = false;
        form.p.select();
        btn.disabled = false; btn.textContent = 'Entsperren';
      }
    });
  });
}

// ---------- Rahmen ----------
function shell() {
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <a class="brand" href="#/"><span class="brand-mark">${icon('coins')}</span><span>Finanzen</span></a>
        <nav class="nav">${ROUTES.map((r) => `<a href="#/${r.path}" data-path="${r.path}">${icon(r.icon)}<span>${r.label}</span></a>`).join('')}</nav>
        <div class="side-foot">
          <button class="sync-chip" id="syncChip" type="button"></button>
          <div class="side-row">
            <button class="icon-btn" id="themeBtn" type="button"></button>
            <span class="muted small" id="netState"></span>
          </div>
        </div>
      </aside>
      <div class="main-wrap">
        <header class="topbar">
          <button class="icon-btn" id="menuBtn" type="button" aria-label="Menü">${icon('menu')}</button>
          <span class="topbar-title" id="topTitle">Finanzen</span>
          <button class="sync-chip compact" id="syncChip2" type="button"></button>
        </header>
        <main id="main" tabindex="-1"></main>
      </div>
      <div class="scrim" id="scrim"></div>
    </div>`;
  document.getElementById('menuBtn').onclick = () => document.body.classList.toggle('nav-open');
  document.getElementById('scrim').onclick = () => document.body.classList.remove('nav-open');
  document.getElementById('themeBtn').onclick = () => {
    const cur = ls.get('fv.theme') || 'auto';
    setTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
  };
  const onChip = () => {
    const s = sync.getStatus().state;
    if (s === 'unconfigured' || s === 'disconnected') location.hash = '#/einstellungen';
    else sync.syncNow({ interactive: true });
  };
  document.getElementById('syncChip').onclick = onChip;
  document.getElementById('syncChip2').onclick = onChip;
  setTheme(ls.get('fv.theme') || 'auto', false);
}

const SYNC_UI = {
  synced: ['cloudCheck', 'Synchronisiert'],
  pending: ['cloud', 'Änderungen warten'],
  syncing: ['refresh', 'Synchronisiere …'],
  offline: ['cloudOff', 'Offline – lokal gespeichert'],
  'needs-auth': ['cloud', 'Anmelden & synchronisieren'],
  'needs-pass': ['lock', 'Passwort nötig'],
  disconnected: ['cloudOff', 'Drive nicht verbunden'],
  unconfigured: ['cloudOff', 'Nur lokal gespeichert'],
  error: ['alert', 'Sync-Fehler – erneut versuchen'],
  idle: ['cloud', '…'],
};
let lastState = null;
function renderSync(st) {
  const [ic, text] = SYNC_UI[st.state] || SYNC_UI.idle;
  const last = sync.lastSync();
  const time = last ? new Date(last).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
  for (const id of ['syncChip', 'syncChip2']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.className = `sync-chip st-${st.state}${id === 'syncChip2' ? ' compact' : ''}`;
    el.innerHTML = `${icon(ic, st.state === 'syncing' ? 'spin' : '')}<span>${esc(text)}${st.state === 'synced' && time ? ` · ${time}` : ''}</span>`;
    el.title = st.message || text;
  }
  if (lastState && lastState !== st.state && current?.path === 'einstellungen') schedule();
  if (st.state === 'error' && lastState !== 'error') toast(`Synchronisierung fehlgeschlagen: ${st.message}`, 'error', 6000);
  lastState = st.state;
}

// ---------- Router ----------
let current = null;
const parse = () => {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { path: path || '', params: new URLSearchParams(qs || '') };
};

function selectorFor(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  for (const a of ['data-cfg', 'data-j', 'data-map', 'data-s', 'name']) {
    const v = el.getAttribute(a);
    if (v) return `[${a}="${CSS.escape(v)}"]`;
  }
  return null;
}

let renderToken = 0;
async function render(fresh = false) {
  const main = document.getElementById('main');
  if (!main) return;
  const { path, params } = parse();
  const route = ROUTES.find((r) => r.path === path) || ROUTES[0];
  const token = ++renderToken;
  let focusSel = null, caret = null;
  const scroll = window.scrollY;
  if (!fresh) {
    const a = document.activeElement;
    if (a && main.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { focusSel = selectorFor(a); try { caret = a.selectionStart; } catch { caret = null; } }
  }
  if (fresh) document.querySelectorAll('dialog.modal[open]').forEach((d) => d.close());
  destroyCharts();
  const view = document.createElement('div');
  view.className = 'view';
  main.replaceChildren(view);
  current = { path: route.path };
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === route.path));
  document.getElementById('topTitle').textContent = route.label;
  document.title = `${route.label} · Finanzen`;
  try {
    await route.view.render(view, { params, fresh });
  } catch (e) {
    console.error(e);
    view.innerHTML = `<section class="card"><h2>${icon('alert')} Da ist etwas schiefgelaufen</h2><pre class="small">${esc(e.stack || e)}</pre></section>`;
  }
  if (token !== renderToken) return;
  if (fresh) { window.scrollTo(0, 0); document.body.classList.remove('nav-open'); }
  else {
    window.scrollTo(0, scroll);
    if (focusSel) {
      const el = view.querySelector(focusSel);
      if (el) { el.focus({ preventScroll: true }); if (caret != null) try { el.setSelectionRange(caret, caret); } catch { /* select */ } }
    }
  }
}

// Mehrere Änderungen kurz hintereinander → ein einziges Neuzeichnen.
// requestAnimationFrame ruht in Hintergrund-Tabs, daher zusätzlich ein Timeout.
let pendingRender = false;
function schedule() {
  if (pendingRender) return;
  pendingRender = true;
  const run = () => { if (!pendingRender) return; pendingRender = false; render(false); };
  requestAnimationFrame(run);
  setTimeout(run, 120);
}

// ---------- Service Worker (offline + Updates) ----------
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  let userAccepted = false;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (w) => {
      const bar = document.createElement('div');
      bar.className = 'update-bar';
      bar.innerHTML = `${icon('refresh')}<span>Neue Version verfügbar</span><button class="btn btn-sm btn-primary">Aktualisieren</button>`;
      bar.querySelector('button').onclick = () => { userAccepted = true; w.postMessage('skipWaiting'); };
      document.body.appendChild(bar);
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch((e) => console.warn('Service Worker nicht registriert', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (userAccepted) location.reload(); });
}

function netState() {
  const el = document.getElementById('netState');
  if (el) el.textContent = navigator.onLine ? '' : 'offline';
  document.body.classList.toggle('is-offline', !navigator.onLine);
}

// ---------- Start ----------
async function boot() {
  let res;
  try {
    res = await loadLocal();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="lock"><div class="card lock-card"><h1>Speicher nicht verfügbar</h1><p>Der Browser erlaubt keinen lokalen Speicher (z. B. privates Fenster). Bitte ein normales Fenster verwenden.</p></div></div>`;
    return;
  }
  if (res.status === 'locked') await lockScreen(res.envelope);
  ensureDefaults();
  shell();

  sync.hooks.askPassphrase = (msg) => promptDialog({ title: 'Passwort erforderlich', label: msg, type: 'password', ok: 'Entsperren', cancel: 'Später' });
  store.subscribe(() => schedule());
  window.addEventListener('hashchange', () => render(true));
  window.addEventListener('fv:rerender', () => schedule());
  window.addEventListener('fv:theme', (e) => setTheme(e.detail));
  window.addEventListener('beforeprint', resizeCharts);
  window.addEventListener('afterprint', resizeCharts);
  window.addEventListener('online', netState);
  window.addEventListener('offline', netState);
  window.addEventListener('pagehide', () => store.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush(); });
  netState();
  sync.onStatus(renderSync);
  drive.preload();
  sync.startAuto();
  navigator.storage?.persist?.().catch(() => {});
  await render(true);
  registerSW();
}

boot();
