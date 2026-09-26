import { store } from '../store.js';
import { esc, money, pct, fmtDate, todayISO, monthKey, monthLabel, monthsBetween, toCSV, download } from '../util.js';
import {
  PERIODS, periodRange, filterTx, totals, monthlyTotals, byCategory, byPayee,
  detectRecurring, netWorthSeries, cats,
} from '../calc.js';
import * as charts from '../charts.js';
import { icon } from '../icons.js';
import { bindActions, catChip, deltaBadge, accountOptions, rerender, rateText } from '../ui.js';

export const title = 'Berichte';
const S = { period: 'year', from: '', to: '', account: '' };

export function render(root) {
  const range = periodRange(S.period, { from: S.from, to: S.to });
  let from = range.from, to = range.to;
  const allTx = store.all('transactions');
  if (S.period === 'all' && allTx.length) {
    from = allTx.reduce((m, t) => (t.date < m ? t.date : m), '9999');
    to = todayISO();
  }
  const base = { account: S.account };
  const txs = filterTx({ ...base, from, to });
  const prevTx = range.prev ? filterTx({ ...base, from: range.prev.from, to: range.prev.to }) : [];
  const t = totals(txs), p = totals(prevTx);
  const rate = t.income > 0 ? t.net / t.income : null;
  const prate = p.income > 0 ? p.net / p.income : null;
  const endMk = monthKey(to && to < todayISO() ? to : todayISO());
  const startMk = from ? monthKey(from) : endMk;
  let months = monthsBetween(startMk, endMk);
  if (months.length > 36) months = months.slice(-36);
  const monthly = monthlyTotals(txs, months);
  const catsNow = byCategory(txs);
  const catsPrev = new Map(byCategory(prevTx).map((c) => [c.id, c.amount]));
  const incomeCats = byCategory(txs, 'income');
  const payees = byPayee(txs, 10);
  const recurring = detectRecurring(S.account ? allTx.filter((x) => x.accountId === S.account) : allTx);
  const recurringYear = recurring.reduce((s, r) => s + r.yearly, 0);
  const accounts = store.all('accounts').filter((a) => !a.archived && (!S.account || a.id === S.account));
  const nw = netWorthSeries(accounts, allTx, months);
  const cm = cats();
  const accName = S.account ? store.get('accounts', S.account)?.name : 'Alle Konten';
  const months_n = Math.max(1, months.length);
  const cmpLabel = range.partial ? 'vs. Vorperiode bis heute' : 'vs. Vorperiode';

  // Gruppen-Summen
  const groups = new Map();
  for (const c of catsNow) { const g = c.group; groups.set(g, (groups.get(g) || 0) + c.amount); }
  const topCats = catsNow.slice(0, 10);

  root.innerHTML = `
    <div class="page-head no-print">
      <div><h1>Finanzbericht</h1><p class="sub">${esc(range.label)} · ${esc(accName)}</p></div>
      <div class="actions">
        <select data-s="period" aria-label="Zeitraum">${PERIODS.map(([k, l]) => `<option value="${k}" ${S.period === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${S.period === 'custom' ? `<input type="date" data-s="from" value="${S.from || range.from}" aria-label="Von"><input type="date" data-s="to" value="${S.to || range.to}" aria-label="Bis">` : ''}
        <select data-s="account" aria-label="Konto">${accountOptions(S.account, { all: 'Alle Konten', includeArchived: true })}</select>
        <button class="btn" data-action="csv">${icon('download')}<span>CSV</span></button>
        <button class="btn btn-primary" data-action="print">${icon('printer')}<span>PDF / Drucken</span></button>
      </div>
    </div>
    <div class="print-head">
      <h1>Finanzbericht ${esc(range.label)}</h1>
      <p>${esc(accName)} · ${from ? `${fmtDate(from)} – ${fmtDate(to)}` : ''} · erstellt am ${fmtDate(todayISO())}</p>
    </div>

    <section class="stats">
      <div class="card stat"><div class="stat-label">Einnahmen</div><div class="stat-value">${money(t.income)}</div><div>${range.prev ? deltaBadge(t.income, p.income, true, cmpLabel) : ''}</div></div>
      <div class="card stat"><div class="stat-label">Ausgaben</div><div class="stat-value">${money(t.expense)}</div><div>${range.prev ? deltaBadge(t.expense, p.expense, false, cmpLabel) : ''}</div></div>
      <div class="card stat"><div class="stat-label">Überschuss</div><div class="stat-value ${t.net < 0 ? 'text-bad' : ''}">${money(t.net)}</div><div class="muted small">Ø ${money(Math.round(t.net / months_n))} pro Monat</div></div>
      <div class="card stat"><div class="stat-label">Sparquote</div><div class="stat-value">${rateText(rate)}</div><div class="muted small">${prate == null ? '' : `Vorperiode ${rateText(prate)}`}</div></div>
    </section>

    <div class="grid">
      <section class="card span-12 avoid-break">
        <div class="card-h"><h2>Einnahmen und Ausgaben je Monat</h2>
          <div class="legend"><span><i class="key s1"></i>Einnahmen</span><span><i class="key s2"></i>Ausgaben</span></div></div>
        <div class="chart-box h-280"><canvas id="r-io" aria-label="Einnahmen und Ausgaben je Monat"></canvas></div>
      </section>

      <section class="card span-7 avoid-break">
        <div class="card-h"><h2>Top-Ausgabenkategorien</h2></div>
        ${topCats.length ? `<div class="chart-box" style="height:${topCats.length * 34 + 30}px"><canvas id="r-cat" aria-label="Ausgaben nach Kategorie"></canvas></div>` : '<p class="muted">Keine Ausgaben im Zeitraum.</p>'}
      </section>
      <section class="card span-5 avoid-break">
        <div class="card-h"><h2>Vermögensverlauf</h2></div>
        <div class="chart-box h-260"><canvas id="r-nw" aria-label="Vermögensverlauf"></canvas></div>
      </section>

      <section class="card span-12 avoid-break">
        <div class="card-h"><h2>Ausgaben nach Kategorie</h2><span class="muted small">${range.prev ? 'mit Vergleich zur Vorperiode' : ''}</span></div>
        <div class="table-wrap"><table class="table compact report-table">
          <thead><tr><th>Kategorie</th><th class="num">Betrag</th><th class="num">Anteil</th><th class="num">Ø / Monat</th>${range.prev ? '<th class="num">Vorperiode</th><th class="num">Veränderung</th>' : ''}</tr></thead>
          <tbody>${[...groups.entries()].sort((a, b) => b[1] - a[1]).map(([g, gs]) => `
            <tr class="group-row"><td>${esc(g)}</td><td class="num">${money(gs)}</td><td class="num">${pct(t.expense ? gs / t.expense : 0, 1)}</td><td class="num">${money(Math.round(gs / months_n))}</td>${range.prev ? '<td></td><td></td>' : ''}</tr>
            ${catsNow.filter((c) => c.group === g).map((c) => {
              const pv = catsPrev.get(c.id) || 0;
              const d = pv ? (c.amount - pv) / pv : null;
              return `<tr><td class="indent"><a class="plain" href="#/buchungen?cat=${c.id}&period=custom&from=${from}&to=${to}">${catChip(c.cat)}</a></td><td class="num">${money(c.amount)}</td><td class="num muted">${pct(t.expense ? c.amount / t.expense : 0, 1)}</td><td class="num muted">${money(Math.round(c.amount / months_n))}</td>
                ${range.prev ? `<td class="num muted">${pv ? money(pv) : '–'}</td><td class="num ${d == null ? 'muted' : d > 0.05 ? 'text-bad' : d < -0.05 ? 'text-good' : 'muted'}">${d == null ? 'neu' : `${d > 0 ? '+' : ''}${Math.round(d * 100)} %`}</td>` : ''}</tr>`;
            }).join('')}`).join('')}
            <tr class="total"><td>Summe Ausgaben</td><td class="num">${money(t.expense)}</td><td class="num">100 %</td><td class="num">${money(Math.round(t.expense / months_n))}</td>${range.prev ? `<td class="num">${money(p.expense)}</td><td></td>` : ''}</tr>
          </tbody></table></div>
      </section>

      <section class="card span-6 avoid-break">
        <div class="card-h"><h2>Einnahmen nach Kategorie</h2></div>
        <table class="table compact"><tbody>${incomeCats.map((c) => `<tr><td>${catChip(c.cat)}</td><td class="num">${money(c.amount)}</td><td class="num muted">${pct(t.income ? c.amount / t.income : 0, 1)}</td></tr>`).join('') || '<tr><td class="muted">Keine Einnahmen</td></tr>'}
        <tr class="total"><td>Summe Einnahmen</td><td class="num">${money(t.income)}</td><td></td></tr></tbody></table>
      </section>

      <section class="card span-6 avoid-break">
        <div class="card-h"><h2>Größte Zahlungsempfänger</h2></div>
        <table class="table compact"><tbody>${payees.map((x) => `<tr><td>${esc(x.name)}<div class="tx-sub">${x.count}× </div></td><td class="num">${money(x.amount)}</td></tr>`).join('') || '<tr><td class="muted">Keine Daten</td></tr>'}</tbody></table>
      </section>

      <section class="card span-12 avoid-break">
        <div class="card-h"><h2>${icon('repeat')} Fixkosten und Abos</h2><span class="small"><b>${money(Math.round(recurringYear / 12))}</b> <span class="muted">pro Monat · ${money(recurringYear)} pro Jahr</span></span></div>
        ${recurring.length ? `<div class="table-wrap"><table class="table compact">
          <thead><tr><th>Empfänger</th><th class="hide-sm">Kategorie</th><th>Rhythmus</th><th class="num">Betrag</th><th class="num">pro Jahr</th><th class="num hide-sm">Nächste</th></tr></thead>
          <tbody>${recurring.map((r) => `<tr><td>${esc(r.payee)}<div class="tx-sub">${r.count} Zahlungen, zuletzt ${fmtDate(r.last)}</div></td><td class="hide-sm">${catChip(cm.get(r.categoryId))}</td><td>${r.interval}</td><td class="num">${money(r.amount)}</td><td class="num">${money(r.yearly)}</td><td class="num muted hide-sm">${fmtDate(r.next)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="muted">Noch keine wiederkehrenden Zahlungen erkannt. Dafür braucht es mindestens drei gleichartige Zahlungen.</p>'}
      </section>
    </div>`;

  root.querySelectorAll('[data-s]').forEach((el) => el.addEventListener('change', () => {
    S[el.dataset.s] = el.value;
    if (el.dataset.s === 'period' && el.value === 'custom' && !S.from) { S.from = range.from; S.to = range.to; }
    rerender();
  }));

  bindActions(root, {
    print: () => { charts.resizeCharts(); window.print(); },
    csv: () => {
      const rows = [['Finanzbericht', range.label, accName], [], ['Kennzahl', 'Betrag'],
        ['Einnahmen', eur(t.income)], ['Ausgaben', eur(t.expense)], ['Überschuss', eur(t.net)], [],
        ['Monat', 'Einnahmen', 'Ausgaben', 'Saldo'], ...monthly.map((m) => [monthLabel(m.month, true), eur(m.income), eur(m.expense), eur(m.income - m.expense)]), [],
        ['Gruppe', 'Kategorie', 'Ausgaben', 'Vorperiode'], ...catsNow.map((c) => [c.group, c.name, eur(c.amount), eur(catsPrev.get(c.id) || 0)])];
      download(`finanzbericht-${range.label.replace(/\s+/g, '-')}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
    },
  });

  const s1 = charts.series(1), s2 = charts.series(2);
  charts.bar(root.querySelector('#r-io'), {
    labels: months.map((m) => monthLabel(m)),
    datasets: [
      { label: 'Einnahmen', data: monthly.map((m) => m.income / 100), backgroundColor: s1 },
      { label: 'Ausgaben', data: monthly.map((m) => m.expense / 100), backgroundColor: s2 },
    ],
  });
  if (topCats.length) {
    charts.bar(root.querySelector('#r-cat'), {
      horizontal: true, labels: topCats.map((c) => c.name),
      datasets: [{ label: 'Ausgaben', data: topCats.map((c) => c.amount / 100), backgroundColor: s2 }],
      onClick: (i) => { location.hash = `#/buchungen?cat=${topCats[i].id}&period=custom&from=${from}&to=${to}`; },
    });
  }
  charts.line(root.querySelector('#r-nw'), { labels: months.map((m) => monthLabel(m)), datasets: [{ label: 'Vermögen', data: nw.map((v) => v / 100), borderColor: s1 }] });
}

const eur = (c) => (c / 100).toFixed(2).replace('.', ',');
