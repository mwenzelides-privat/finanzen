import { store } from '../store.js';
import { money, pct, monthKey, todayISO, monthLabel, fmtDate, esc, monthEnd, monthStart } from '../util.js';
import {
  lastMonths, monthlyTotals, byCategory, currentBalance, netWorthSeries, vacationStats,
  budgetStatus, kind, cats, byDateDesc,
} from '../calc.js';
import * as charts from '../charts.js';
import { icon } from '../icons.js';
import { bindActions, catChip, amountCell, progress, deltaBadge, rateText } from '../ui.js';
import { openTxForm, openAccountForm } from '../forms.js';
import { loadDemo } from '../demo.js';
import { ACCOUNT_TYPES } from '../defaults.js';
import * as drive from '../drive.js';
import * as sync from '../sync.js';

export const title = 'Übersicht';

export function render(root) {
  const accounts = store.all('accounts').filter((a) => !a.archived);
  const txs = store.all('transactions');
  if (!accounts.length && !txs.length) return welcome(root);

  const today = todayISO();
  const mk = monthKey(today);
  const months = lastMonths(12);
  const monthly = monthlyTotals(txs, months);
  const cur = monthly[11], prev = monthly[10];
  const nw = netWorthSeries(accounts, txs, months);
  const netWorth = accounts.reduce((s, a) => s + currentBalance(a, txs), 0);
  const monthTx = txs.filter((t) => t.date.startsWith(mk));
  const topCats = byCategory(monthTx).slice(0, 8);
  const vacs = store.all('vacations').filter((v) => !v.archived).map((v) => ({ v, s: vacationStats(v) }));
  const vacTotal = vacs.reduce((s, x) => s + x.s.balance, 0);
  const saveRate = cur.income > 0 ? (cur.income - cur.expense) / cur.income : null;
  const prevRate = prev.income > 0 ? (prev.income - prev.expense) / prev.income : null;
  const budgets = budgetStatus(mk).slice(0, 6);
  const recent = [...txs].sort(byDateDesc).slice(0, 8);
  const cm = cats();
  const uncategorized = txs.filter((t) => !t.categoryId).length;
  const nwStart = nw[0];

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Übersicht</h1><p class="sub">${monthLabel(mk, true)} · Stand ${fmtDate(today)}</p></div>
      <div class="actions">
        <a class="btn" href="#/import">${icon('upload')}<span>Import</span></a>
        <button class="btn btn-primary" data-action="addTx">${icon('plus')}<span>Buchung</span></button>
      </div>
    </div>

    ${uncategorized ? `<a class="notice" href="#/buchungen?cat=_none&period=all">${icon('wand')}<span><b>${uncategorized} ${uncategorized === 1 ? 'Buchung' : 'Buchungen'}</b> ohne Kategorie – jetzt zuordnen</span>${icon('chevRight')}</a>` : ''}

    <section class="card hero">
      <div class="hero-main">
        <div class="stat-label">Gesamtvermögen</div>
        <div class="hero-value">${money(netWorth)}</div>
        <div>${deltaBadge(netWorth, nwStart, true, 'in 12 Monaten')}</div>
      </div>
      <div class="hero-chart chart-box"><canvas id="c-nw" aria-label="Vermögensverlauf der letzten 12 Monate"></canvas></div>
    </section>

    <section class="stats">
      <div class="card stat"><div class="stat-label">Einnahmen ${monthLabel(mk)}</div><div class="stat-value">${money(cur.income)}</div><div>${deltaBadge(cur.income, prev.income, true)}</div></div>
      <div class="card stat"><div class="stat-label">Ausgaben ${monthLabel(mk)}</div><div class="stat-value">${money(cur.expense)}</div><div>${deltaBadge(cur.expense, prev.expense, false)}</div></div>
      <div class="card stat"><div class="stat-label">Sparquote</div><div class="stat-value">${rateText(saveRate)}</div><div class="muted small">${prevRate == null ? 'Einnahmen minus Ausgaben' : `Vormonat ${rateText(prevRate)}`}</div></div>
      <a class="card stat link-card" href="#/urlaub"><div class="stat-label">Urlaubskasse</div><div class="stat-value">${money(vacTotal)}</div><div class="muted small">${vacs.length ? `${vacs.length} ${vacs.length === 1 ? 'Kasse' : 'Kassen'}` : 'Noch keine Kasse angelegt'}</div></a>
    </section>

    <div class="grid">
      <section class="card span-8">
        <div class="card-h"><h2>Einnahmen und Ausgaben</h2>
          <div class="legend"><span><i class="key s1"></i>Einnahmen</span><span><i class="key s2"></i>Ausgaben</span></div></div>
        <div class="chart-box h-280"><canvas id="c-io" aria-label="Einnahmen und Ausgaben je Monat"></canvas></div>
      </section>

      <section class="card span-4">
        <div class="card-h"><h2>Konten</h2><a class="link" href="#/konten">Alle</a></div>
        <ul class="acc-list">
          ${accounts.map((a) => `<li><a href="#/buchungen?account=${a.id}&period=12m"><span class="acc-name">${esc(a.name)}<small>${esc(ACCOUNT_TYPES[a.type] || '')}${a.bank ? ' · ' + esc(a.bank) : ''}</small></span><span class="acc-bal ${currentBalance(a, txs) < 0 ? 'neg' : ''}">${money(currentBalance(a, txs))}</span></a></li>`).join('')}
        </ul>
        <button class="btn btn-ghost btn-sm" data-action="addAccount">${icon('plus')} Konto hinzufügen</button>
      </section>

      <section class="card span-6">
        <div class="card-h"><h2>Ausgaben nach Kategorie</h2><span class="muted small">${monthLabel(mk, true)}</span></div>
        ${topCats.length ? `<div class="chart-box" style="height:${Math.max(160, topCats.length * 34 + 30)}px"><canvas id="c-cat" aria-label="Ausgaben nach Kategorie im laufenden Monat"></canvas></div>` : '<p class="muted">Noch keine Ausgaben in diesem Monat.</p>'}
      </section>

      <section class="card span-6">
        <div class="card-h"><h2>Budgets</h2><a class="link" href="#/budgets">Verwalten</a></div>
        ${budgets.length ? `<ul class="budget-list">${budgets.map((b) => `
          <li>
            <div class="row-between"><span>${catChip(b.cat)}</span><span class="small"><b>${money(b.spent)}</b> <span class="muted">von ${money(b.budget.amount)}</span></span></div>
            ${progress(b.ratio, b.level, b.cat.name)}
            <div class="small ${b.left < 0 ? 'text-bad' : 'muted'}">${b.left < 0 ? `${icon('alert')} ${money(-b.left)} überschritten` : `${money(b.left)} übrig`}</div>
          </li>`).join('')}</ul>` : `<p class="muted">Noch keine Budgets. <a class="link" href="#/budgets">Budget anlegen</a></p>`}
      </section>

      <section class="card span-12">
        <div class="card-h"><h2>Letzte Buchungen</h2><a class="link" href="#/buchungen">Alle Buchungen</a></div>
        <div class="table-wrap"><table class="table">
          <tbody>${recent.map((t) => `
            <tr data-action="editTx" data-id="${t.id}" class="clickable">
              <td class="nowrap muted">${fmtDate(t.date)}</td>
              <td class="grow"><div class="tx-main">${esc(t.payee || t.purpose || '–')}</div><div class="tx-sub">${esc(t.payee ? t.purpose : '')}</div></td>
              <td class="hide-sm">${catChip(cm.get(t.categoryId))}</td>
              <td class="num">${amountCell(t.amount, kind(t, cm))}</td>
            </tr>`).join('')}</tbody>
        </table></div>
      </section>
    </div>`;

  bindActions(root, {
    addTx: () => openTxForm(),
    addAccount: () => openAccountForm(),
    editTx: (el) => openTxForm(store.get('transactions', el.dataset.id)),
  });

  const s1 = charts.series(1), s2 = charts.series(2);
  charts.line(root.querySelector('#c-nw'), {
    labels: months.map((m) => monthLabel(m)),
    datasets: [{ label: 'Vermögen', data: nw.map((v) => v / 100), borderColor: s1 }],
  });
  charts.bar(root.querySelector('#c-io'), {
    labels: months.map((m) => monthLabel(m)),
    datasets: [
      { label: 'Einnahmen', data: monthly.map((m) => m.income / 100), backgroundColor: s1 },
      { label: 'Ausgaben', data: monthly.map((m) => m.expense / 100), backgroundColor: s2 },
    ],
    onClick: (i) => { const m = months[i]; location.hash = `#/buchungen?period=custom&from=${monthStart(m)}&to=${monthEnd(m)}`; },
  });
  if (topCats.length) {
    charts.bar(root.querySelector('#c-cat'), {
      horizontal: true,
      labels: topCats.map((c) => c.name),
      datasets: [{ label: 'Ausgaben', data: topCats.map((c) => c.amount / 100), backgroundColor: s2 }],
      onClick: (i) => { location.hash = `#/buchungen?period=month&cat=${topCats[i].id}`; },
    });
  }
}

function welcome(root) {
  root.innerHTML = `
    <div class="welcome card">
      <div class="welcome-icon">${icon('coins')}</div>
      <h1>Willkommen in deiner Finanzverwaltung</h1>
      <p class="sub">Alle Konten, Budgets, Urlaubskasse und Steuer an einem Ort. Die Daten liegen auf diesem Gerät und in deinem Google Drive, sonst nirgends.</p>
      <ol class="steps">
        <li><b>Konto anlegen</b><span>Girokonto, Tagesgeld, Kreditkarte, Bargeld …</span><button class="btn" data-action="addAccount">${icon('plus')} Konto anlegen</button></li>
        <li><b>Kontoauszug importieren</b><span>CSV- oder Excel-Export aus dem Online-Banking</span><a class="btn" href="#/import">${icon('upload')} Import öffnen</a></li>
        <li><b>Google Drive verbinden</b><span>Sync zwischen allen Geräten und automatische Backups. Schon auf einem anderen Gerät genutzt? Dann hier verbinden, die Daten werden geladen.</span>
          ${drive.isConfigured() ? `<button class="btn btn-primary" data-action="driveLoad">${icon('cloud')} Verbinden & Daten laden</button>` : `<a class="btn" href="#/einstellungen">${icon('cloud')} Einrichten</a>`}</li>
      </ol>
      <p class="muted small">Erst mal nur umschauen? <button class="link-btn" data-action="demo">Beispieldaten laden</button>. Die lassen sich in den Einstellungen mit einem Klick wieder entfernen.</p>
    </div>`;
  bindActions(root, {
    addAccount: () => openAccountForm(),
    demo: () => loadDemo(),
    driveLoad: () => sync.syncNow({ interactive: true }),
  });
}
