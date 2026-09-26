// Auswertungen: Summen, Salden, Zeiträume, Budgets, Urlaubskasse, Fixkosten-Erkennung
import { store } from './store.js';
import {
  monthKey, addMonths, todayISO, monthEnd, monthStart, norm, daysBetween, addDays,
  parseMoney, fmtDate, monthLabel,
} from './util.js';
import { GROUPS } from './defaults.js';

export const cats = () => store.byId('categories');

// 'income' | 'expense' | 'transfer'
export function kind(tx, cm = cats()) {
  const c = tx.categoryId && cm.get(tx.categoryId);
  if (c) return c.type;
  return tx.amount >= 0 ? 'income' : 'expense';
}

export function totals(txs) {
  const cm = cats();
  let income = 0, expense = 0;
  for (const t of txs) {
    const k = kind(t, cm);
    if (k === 'income') income += t.amount;
    else if (k === 'expense') expense -= t.amount;
  }
  return { income, expense, net: income - expense };
}

export function lastMonths(n, endMk = monthKey(todayISO())) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(addMonths(endMk, -i));
  return out;
}

export function monthlyTotals(txs, months) {
  const cm = cats();
  const idx = new Map(months.map((m, i) => [m, i]));
  const out = months.map((m) => ({ month: m, income: 0, expense: 0 }));
  for (const t of txs) {
    const i = idx.get(t.date.slice(0, 7));
    if (i === undefined) continue;
    const k = kind(t, cm);
    if (k === 'income') out[i].income += t.amount;
    else if (k === 'expense') out[i].expense -= t.amount;
  }
  return out;
}

// Ausgaben (oder Einnahmen) je Kategorie, absteigend
export function byCategory(txs, which = 'expense') {
  const cm = cats();
  const m = new Map();
  for (const t of txs) {
    if (kind(t, cm) !== which) continue;
    const id = t.categoryId || '_none';
    m.set(id, (m.get(id) || 0) + (which === 'expense' ? -t.amount : t.amount));
  }
  return [...m.entries()]
    .map(([id, amount]) => ({ id, amount, cat: cm.get(id), name: cm.get(id)?.name || 'Unkategorisiert', group: cm.get(id)?.group || 'Ohne Kategorie' }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

export function byPayee(txs, limit = 10) {
  const cm = cats();
  const m = new Map();
  for (const t of txs) {
    if (kind(t, cm) !== 'expense') continue;
    const name = (t.payee || t.purpose || '–').trim().slice(0, 60);
    const key = norm(name);
    const e = m.get(key) || { name, amount: 0, count: 0 };
    e.amount -= t.amount; e.count++;
    m.set(key, e);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
}

// ---------- Salden ----------
// Kontostand bekannt am anchorDate (inkl. aller Buchungen bis einschließlich dieses Tages)
export function balanceAt(acc, date, txs = store.all('transactions')) {
  let b = acc.balanceAnchor || 0;
  const a = acc.anchorDate || '0000-00-00';
  for (const t of txs) {
    if (t.accountId !== acc.id) continue;
    if (t.date > a && t.date <= date) b += t.amount;
    else if (t.date <= a && t.date > date) b -= t.amount;
  }
  return b;
}
export const currentBalance = (acc, txs) => balanceAt(acc, '9999-12-31', txs);

export function netWorthSeries(accounts, txs, months) {
  return months.map((m) => accounts.reduce((s, a) => s + balanceAt(a, monthEnd(m), txs), 0));
}

// ---------- Filter ----------
export function filterTx(f) {
  const cm = cats();
  const q = norm(f.q);
  const qAmount = /^[-+]?[\d.,]+$/.test(q) ? Math.abs(parseMoney(q) ?? NaN) : null;
  const min = f.min !== '' && f.min != null ? parseMoney(f.min) : null;
  const max = f.max !== '' && f.max != null ? parseMoney(f.max) : null;
  return store.all('transactions').filter((t) => {
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.account && t.accountId !== f.account) return false;
    if (f.cat) { if (f.cat === '_none' ? t.categoryId : t.categoryId !== f.cat) return false; }
    if (f.group && (cm.get(t.categoryId)?.group || '') !== f.group) return false;
    if (f.kind && kind(t, cm) !== f.kind) return false;
    if (f.tax === '1' && !t.taxCategory) return false;
    if (f.tax && f.tax !== '1' && t.taxCategory !== f.tax) return false;
    if (f.vacation && t.vacationId !== f.vacation) return false;
    if (f.batch && t.importBatch !== f.batch) return false;
    if (f.tag && !(t.tags || []).some((x) => norm(x) === norm(f.tag))) return false;
    if (min != null && Math.abs(t.amount) < Math.abs(min)) return false;
    if (max != null && Math.abs(t.amount) > Math.abs(max)) return false;
    if (q) {
      if (qAmount != null && Number.isFinite(qAmount)) { if (Math.abs(t.amount) === qAmount) return true; }
      const hay = norm(`${t.payee} ${t.purpose} ${t.bookingText || ''} ${t.note || ''} ${(t.tags || []).join(' ')} ${cm.get(t.categoryId)?.name || ''}`);
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort(byDateDesc);
}
export const byDateDesc = (a, b) => b.date.localeCompare(a.date) || (b.updatedAt || 0) - (a.updatedAt || 0);

// ---------- Zeiträume ----------
export const PERIODS = [
  ['month', 'Dieser Monat'], ['lastmonth', 'Letzter Monat'], ['quarter', 'Dieses Quartal'],
  ['lastquarter', 'Letztes Quartal'], ['year', 'Dieses Jahr'], ['lastyear', 'Letztes Jahr'],
  ['12m', 'Letzte 12 Monate'], ['all', 'Gesamter Zeitraum'], ['custom', 'Benutzerdefiniert'],
];

export function periodRange(p, custom = {}) {
  const mk = monthKey(todayISO());
  const y = +mk.slice(0, 4);
  const qStart = addMonths(`${y}-01`, Math.floor((+mk.slice(5, 7) - 1) / 3) * 3);
  const r = (fromMk, toMk, label, prevFrom, prevTo) => ({
    from: monthStart(fromMk), to: monthEnd(toMk), label,
    prev: prevFrom ? { from: monthStart(prevFrom), to: monthEnd(prevTo) } : null,
  });
  // Laufende Zeiträume fair vergleichen: Vorperiode nur bis zum gleichen Tag
  const toDate = (res, back) => {
    const t = todayISO();
    const m = addMonths(monthKey(t), -back);
    const day = Math.min(+t.slice(8, 10), +monthEnd(m).slice(8, 10));
    res.prev.to = `${m}-${String(day).padStart(2, '0')}`;
    res.to = t;
    res.partial = true;
    return res;
  };
  switch (p) {
    case 'month': return toDate(r(mk, mk, monthLabel(mk, true), addMonths(mk, -1), addMonths(mk, -1)), 1);
    case 'lastmonth': { const m = addMonths(mk, -1); return r(m, m, monthLabel(m, true), addMonths(m, -1), addMonths(m, -1)); }
    case 'quarter': return toDate(r(qStart, addMonths(qStart, 2), `Q${Math.floor((+qStart.slice(5, 7) - 1) / 3) + 1} ${y}`, addMonths(qStart, -3), addMonths(qStart, -1)), 3);
    case 'lastquarter': { const q = addMonths(qStart, -3); return r(q, addMonths(q, 2), `Q${Math.floor((+q.slice(5, 7) - 1) / 3) + 1} ${q.slice(0, 4)}`, addMonths(q, -3), addMonths(q, -1)); }
    case 'year': return toDate(r(`${y}-01`, `${y}-12`, `Jahr ${y}`, `${y - 1}-01`, `${y - 1}-12`), 12);
    case 'lastyear': return r(`${y - 1}-01`, `${y - 1}-12`, `Jahr ${y - 1}`, `${y - 2}-01`, `${y - 2}-12`);
    case '12m': return r(addMonths(mk, -11), mk, 'Letzte 12 Monate', addMonths(mk, -23), addMonths(mk, -12));
    case 'custom': {
      const from = custom.from || monthStart(mk), to = custom.to || todayISO();
      const len = Math.max(1, daysBetween(from, to) + 1);
      return { from, to, label: `${fmtDate(from)} – ${fmtDate(to)}`, prev: { from: addDays(from, -len), to: addDays(from, -1) } };
    }
    default: return { from: '', to: '', label: 'Gesamter Zeitraum', prev: null };
  }
}

// ---------- Budgets ----------
export function spentByCategory(mk, txs = store.all('transactions')) {
  const cm = cats();
  const m = new Map();
  for (const t of txs) {
    if (!t.date.startsWith(mk) || !t.categoryId) continue;
    if (kind(t, cm) !== 'expense') continue;
    m.set(t.categoryId, (m.get(t.categoryId) || 0) - t.amount);
  }
  return m;
}

export function budgetStatus(mk) {
  const spent = spentByCategory(mk);
  return store.all('budgets')
    .map((b) => {
      const cat = store.get('categories', b.categoryId);
      if (!cat) return null;
      const s = spent.get(b.categoryId) || 0;
      const ratio = b.amount > 0 ? s / b.amount : 0;
      return { budget: b, cat, spent: s, left: b.amount - s, ratio, level: ratio > 1 ? 'crit' : ratio >= 0.85 ? 'warn' : 'good' };
    })
    .filter(Boolean)
    .sort((a, b) => b.ratio - a.ratio);
}

export function avgMonthlyExpense(categoryId, months = 3) {
  const mk = monthKey(todayISO());
  let total = 0;
  for (let i = 1; i <= months; i++) total += spentByCategory(addMonths(mk, -i)).get(categoryId) || 0;
  return Math.round(total / months);
}

// ---------- Urlaubskasse ----------
export function vacationStats(v) {
  const entries = store.all('vacationEntries').filter((e) => e.vacationId === v.id);
  const linked = store.all('transactions').filter((t) => t.vacationId === v.id);
  let deposits = 0, manualSpent = 0;
  for (const e of entries) { if (e.amount >= 0) deposits += e.amount; else manualSpent -= e.amount; }
  const linkedSpent = -linked.reduce((s, t) => s + t.amount, 0);
  const saved = (v.startBalance || 0) + deposits;
  const spent = manualSpent + linkedSpent;
  const balance = saved - spent;
  const today = todayISO();
  let monthsLeft = null, needed = null;
  if (v.targetDate && v.targetDate > today) {
    monthsLeft = Math.max(1, (+v.targetDate.slice(0, 4) - +today.slice(0, 4)) * 12 + (+v.targetDate.slice(5, 7) - +today.slice(5, 7)));
    needed = Math.max(0, Math.ceil(((v.goal || 0) - saved) / monthsLeft));
  }
  const progress = v.goal ? Math.min(1, saved / v.goal) : 0;
  return { entries, linked, deposits, spent, saved, balance, monthsLeft, needed, progress };
}

// ---------- Fixkosten & Abos erkennen ----------
export function detectRecurring(txs = store.all('transactions')) {
  const cm = cats();
  const today = todayISO();
  const since = addMonths(monthKey(today), -25) + '-01';
  const groups = new Map();
  for (const t of txs) {
    if (t.amount >= 0 || t.date < since || kind(t, cm) !== 'expense') continue;
    const key = norm(t.payee || t.purpose).replace(/\d{4,}/g, '').replace(/[^a-zäöüß ]/g, '').trim().slice(0, 32);
    if (key.length < 3) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const out = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const amounts = list.map((t) => -t.amount).sort((a, b) => a - b);
    const med = amounts[Math.floor(amounts.length / 2)];
    const similar = list.filter((t) => Math.abs(-t.amount - med) <= Math.max(med * 0.15, 150))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (similar.length < 2) continue;
    const gaps = [];
    for (let i = 1; i < similar.length; i++) gaps.push(daysBetween(similar[i - 1].date, similar[i].date));
    gaps.sort((a, b) => a - b);
    const g = gaps[Math.floor(gaps.length / 2)];
    let interval = null, perYear = 0, minCount = 3;
    if (g >= 6 && g <= 8) { interval = 'wöchentlich'; perYear = 52; minCount = 5; }
    else if (g >= 26 && g <= 35) { interval = 'monatlich'; perYear = 12; }
    else if (g >= 84 && g <= 98) { interval = 'vierteljährlich'; perYear = 4; }
    else if (g >= 174 && g <= 196) { interval = 'halbjährlich'; perYear = 2; minCount = 2; }
    else if (g >= 350 && g <= 380) { interval = 'jährlich'; perYear = 1; minCount = 2; }
    if (!interval || similar.length < minCount) continue;
    const last = similar[similar.length - 1];
    if (daysBetween(last.date, today) > g * 1.6 + 10) continue; // gekündigt / veraltet
    out.push({
      key, payee: last.payee || last.purpose, amount: med, interval, perYear,
      yearly: med * perYear, monthly: Math.round((med * perYear) / 12),
      last: last.date, next: addDays(last.date, g), count: similar.length, categoryId: last.categoryId,
    });
  }
  return out.sort((a, b) => b.yearly - a.yearly);
}

// ---------- Farben je Kategorie-Gruppe (feste Reihenfolge, nie zyklisch neu vergeben) ----------
export function groupSlot(group) {
  const i = GROUPS.indexOf(group);
  if (i >= 0) return i + 1;
  let h = 0;
  for (const ch of String(group || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 8) + 1;
}
export const catSlot = (cat) => (cat ? groupSlot(cat.group) : 0);
