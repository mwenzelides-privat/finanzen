import { store } from '../store.js';
import { money, monthKey, todayISO, monthLabel, addMonths, monthStart, monthEnd, pct } from '../util.js';
import { budgetStatus, spentByCategory, avgMonthlyExpense, lastMonths, cats } from '../calc.js';
import * as charts from '../charts.js';
import { icon } from '../icons.js';
import { bindActions, catChip, progress, emptyState, rerender } from '../ui.js';
import { openBudgetForm } from '../forms.js';

export const title = 'Budgets';
let month = monthKey(todayISO());

export function render(root) {
  const status = budgetStatus(month);
  const totalBudget = status.reduce((s, b) => s + b.budget.amount, 0);
  const totalSpent = status.reduce((s, b) => s + b.spent, 0);
  const spent = spentByCategory(month);
  const budgeted = new Set(status.map((b) => b.cat.id));
  const cm = cats();
  const unbudgeted = [...spent.entries()].filter(([id]) => !budgeted.has(id)).map(([id, s]) => ({ cat: cm.get(id), s })).filter((x) => x.cat && x.s > 0).sort((a, b) => b.s - a.s);
  const unbudgetedSum = unbudgeted.reduce((s, x) => s + x.s, 0);
  const isCurrent = month === monthKey(todayISO());
  const dayRatio = isCurrent ? new Date().getDate() / new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate() : 1;

  // Vorschläge: häufige Ausgabe-Kategorien ohne Budget
  const suggestions = store.all('categories')
    .filter((c) => c.type === 'expense' && !budgeted.has(c.id))
    .map((c) => ({ c, avg: avgMonthlyExpense(c.id) }))
    .filter((x) => x.avg >= 2000)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 6);

  const months6 = lastMonths(6, month);

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Budgets</h1><p class="sub">Monatliche Limits je Kategorie</p></div>
      <div class="actions">
        <div class="month-switch">
          <button class="icon-btn" data-action="prev" aria-label="Vormonat">${icon('chevLeft')}</button>
          <span>${monthLabel(month, true)}</span>
          <button class="icon-btn" data-action="next" aria-label="Nächster Monat">${icon('chevRight')}</button>
        </div>
        <button class="btn btn-primary" data-action="add">${icon('plus')}<span>Budget</span></button>
      </div>
    </div>
    ${status.length ? `
    <section class="stats stats-3">
      <div class="card stat"><div class="stat-label">Budget gesamt</div><div class="stat-value">${money(totalBudget)}</div></div>
      <div class="card stat"><div class="stat-label">Ausgegeben</div><div class="stat-value">${money(totalSpent)}</div><div class="muted small">${pct(totalBudget ? totalSpent / totalBudget : 0)} des Budgets${isCurrent ? ` · ${pct(dayRatio)} des Monats vorbei` : ''}</div></div>
      <div class="card stat"><div class="stat-label">Noch verfügbar</div><div class="stat-value ${totalBudget - totalSpent < 0 ? 'text-bad' : ''}">${money(totalBudget - totalSpent)}</div></div>
    </section>
    <div class="grid">
      <section class="card span-7">
        <div class="card-h"><h2>Budgets ${monthLabel(month, true)}</h2></div>
        <ul class="budget-list big">${status.map((b) => {
          const pace = isCurrent && b.ratio < 1 && b.ratio > dayRatio + 0.1;
          return `<li>
            <div class="row-between">
              <span>${catChip(b.cat)}</span>
              <span class="small"><b>${money(b.spent)}</b> <span class="muted">von ${money(b.budget.amount)}</span>
                <button class="icon-btn sm" data-action="edit" data-id="${b.budget.id}" aria-label="Bearbeiten">${icon('edit')}</button></span>
            </div>
            <div class="progress-wrap">${progress(b.ratio, b.level, b.cat.name)}${isCurrent ? `<i class="pace-mark" style="left:${dayRatio * 100}%" title="Heute"></i>` : ''}</div>
            <div class="row-between small">
              <span class="${b.left < 0 ? 'text-bad' : 'muted'}">${b.left < 0 ? `${icon('alert')} ${money(-b.left)} überschritten` : `${money(b.left)} übrig`}</span>
              <span class="muted">${pace ? `${icon('alert')} schneller als geplant` : ''} <a class="link" href="#/buchungen?cat=${b.cat.id}&period=custom&from=${monthStart(month)}&to=${monthEnd(month)}">Buchungen</a></span>
            </div>
          </li>`;
        }).join('')}</ul>
      </section>
      <section class="card span-5">
        <div class="card-h"><h2>Budget und Ist, 6 Monate</h2>
          <div class="legend"><span><i class="key s1"></i>Budget</span><span><i class="key s2"></i>Ausgegeben</span></div></div>
        <div class="chart-box h-260"><canvas id="c-bud" aria-label="Budget und Ausgaben der letzten sechs Monate"></canvas></div>
        ${unbudgeted.length ? `<h3 class="mini-title">Ohne Budget: ${money(unbudgetedSum)}</h3>
          <ul class="plain-list">${unbudgeted.slice(0, 6).map((x) => `<li class="row-between"><span>${catChip(x.cat)}</span><span class="small">${money(x.s)} <button class="link-btn" data-action="addFor" data-cat="${x.cat.id}">Budget</button></span></li>`).join('')}</ul>` : ''}
      </section>
    </div>` : `<section class="card">${emptyState('target', 'Noch keine Budgets', 'Lege für deine wichtigsten Ausgabe-Kategorien ein Monatslimit fest. Du siehst dann jederzeit, wie viel noch übrig ist.', `<button class="btn btn-primary" data-action="add">${icon('plus')} Budget anlegen</button>`)}</section>`}
    ${suggestions.length ? `<section class="card">
      <div class="card-h"><h2>Vorschläge</h2><span class="muted small">Durchschnitt der letzten 3 Monate</span></div>
      <div class="suggest-grid">${suggestions.map((x) => `<div class="suggest">${catChip(x.c)}<b>${money(x.avg)}</b><button class="btn btn-sm" data-action="suggest" data-cat="${x.c.id}" data-amount="${Math.ceil(x.avg / 1000) * 1000}">${icon('plus')} ${money(Math.ceil(x.avg / 1000) * 1000)} übernehmen</button></div>`).join('')}</div>
    </section>` : ''}`;

  bindActions(root, {
    prev: () => { month = addMonths(month, -1); rerender(); },
    next: () => { month = addMonths(month, 1); rerender(); },
    add: () => openBudgetForm(),
    addFor: (el) => openBudgetForm(null, { categoryId: el.dataset.cat, amount: avgMonthlyExpense(el.dataset.cat) }),
    edit: (el) => openBudgetForm(store.get('budgets', el.dataset.id)),
    suggest: (el) => store.put('budgets', { categoryId: el.dataset.cat, amount: +el.dataset.amount }),
  });

  const canvas = root.querySelector('#c-bud');
  if (canvas) {
    const budgets = store.all('budgets');
    const budgetSum = budgets.reduce((s, b) => s + b.amount, 0);
    const ids = new Set(budgets.map((b) => b.categoryId));
    const actual = months6.map((m) => { const sp = spentByCategory(m); let s = 0; for (const [id, v] of sp) if (ids.has(id)) s += v; return s; });
    charts.bar(canvas, {
      labels: months6.map((m) => monthLabel(m)),
      datasets: [
        { label: 'Budget', data: months6.map(() => budgetSum / 100), backgroundColor: charts.series(1) },
        { label: 'Ausgegeben', data: actual.map((v) => v / 100), backgroundColor: charts.series(2) },
      ],
    });
  }
}
