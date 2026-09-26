import { store } from '../store.js';
import { esc, money, fmtDate } from '../util.js';
import { currentBalance, lastMonths, netWorthSeries, monthlyTotals } from '../calc.js';
import * as charts from '../charts.js';
import { icon } from '../icons.js';
import { bindActions, emptyState } from '../ui.js';
import { openAccountForm } from '../forms.js';
import { ACCOUNT_TYPES } from '../defaults.js';

export const title = 'Konten';

export function render(root) {
  const txs = store.all('transactions');
  const all = store.all('accounts');
  const active = all.filter((a) => !a.archived);
  const archived = all.filter((a) => a.archived);
  const months = lastMonths(12);
  const total = active.reduce((s, a) => s + currentBalance(a, txs), 0);
  const assets = active.reduce((s, a) => s + Math.max(0, currentBalance(a, txs)), 0);
  const debts = active.reduce((s, a) => s + Math.min(0, currentBalance(a, txs)), 0);

  const card = (a) => {
    const own = txs.filter((t) => t.accountId === a.id);
    const last = own.reduce((m, t) => (t.date > m ? t.date : m), '');
    const bal = currentBalance(a, txs);
    const m = monthlyTotals(own, months.slice(-1))[0];
    return `<article class="card acc-card ${a.archived ? 'archived' : ''}">
      <div class="row-between">
        <div><h3>${esc(a.name)}</h3><div class="muted small">${esc(ACCOUNT_TYPES[a.type] || 'Konto')}${a.bank ? ' · ' + esc(a.bank) : ''}</div></div>
        <button class="icon-btn" data-action="edit" data-id="${a.id}" aria-label="Bearbeiten">${icon('edit')}</button>
      </div>
      <div class="acc-card-bal ${bal < 0 ? 'neg' : ''}">${money(bal)}</div>
      <div class="spark"><canvas data-spark="${a.id}" aria-hidden="true"></canvas></div>
      <dl class="kv">
        <div><dt>Diesen Monat</dt><dd><span class="amt-in">+${money(m.income)}</span> / <span class="amt-out">−${money(m.expense)}</span></dd></div>
        <div><dt>Buchungen</dt><dd>${own.length.toLocaleString('de-DE')}${last ? ` · letzte ${fmtDate(last)}` : ''}</dd></div>
        ${a.iban ? `<div><dt>IBAN</dt><dd class="mono">${esc(a.iban.replace(/(.{4})/g, '$1 ').trim())}</dd></div>` : ''}
        ${a.anchorDate ? `<div><dt>Saldo abgeglichen</dt><dd>${fmtDate(a.anchorDate)}</dd></div>` : ''}
      </dl>
      <div class="acc-card-actions">
        <a class="btn btn-sm" href="#/buchungen?account=${a.id}&period=12m">${icon('list')} Buchungen</a>
        <a class="btn btn-sm btn-ghost" href="#/import?account=${a.id}">${icon('upload')} Import</a>
      </div>
    </article>`;
  };

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Konten</h1><p class="sub">${active.length} aktive Konten</p></div>
      <div class="actions"><button class="btn btn-primary" data-action="add">${icon('plus')}<span>Konto</span></button></div>
    </div>
    ${active.length ? `
    <section class="stats stats-3">
      <div class="card stat"><div class="stat-label">Nettovermögen</div><div class="stat-value">${money(total)}</div></div>
      <div class="card stat"><div class="stat-label">Guthaben</div><div class="stat-value">${money(assets)}</div></div>
      <div class="card stat"><div class="stat-label">Verbindlichkeiten</div><div class="stat-value ${debts < 0 ? 'text-bad' : ''}">${money(debts)}</div></div>
    </section>
    <div class="card-grid">${active.map(card).join('')}</div>` : `<section class="card">${emptyState('wallet', 'Noch keine Konten', 'Lege dein erstes Konto an, z. B. dein Girokonto. Beim Import eines Kontoauszugs kann auch direkt ein Konto erstellt werden.', `<button class="btn btn-primary" data-action="add">${icon('plus')} Konto anlegen</button>`)}</section>`}
    ${archived.length ? `<h2 class="section-title">Archiviert</h2><div class="card-grid">${archived.map(card).join('')}</div>` : ''}
    <p class="muted small help">Tipp: Den Kontostand gleichst du über „Bearbeiten“ mit dem Stand deiner Bank ab. Ältere, später importierte Buchungen verändern den aktuellen Saldo dann nicht mehr.</p>`;

  bindActions(root, {
    add: () => openAccountForm(),
    edit: (el) => openAccountForm(store.get('accounts', el.dataset.id)),
  });

  const color = charts.series(1);
  root.querySelectorAll('[data-spark]').forEach((c) => {
    const acc = store.get('accounts', c.dataset.spark);
    charts.spark(c, netWorthSeries([acc], txs, months).map((v) => v / 100), color);
  });
}
