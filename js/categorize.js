// Automatische Kategorisierung über Regeln
import { store } from './store.js';
import { norm } from './util.js';

export function compileRules() {
  return store.all('rules')
    .filter((r) => r.categoryId && r.match)
    .sort((a, b) => (b.prio || 0) - (a.prio || 0))
    .map((r) => ({ r, alts: norm(r.match).split('|').map((s) => s.trim()).filter(Boolean) }));
}

export function matchRule(tx, compiled = compileRules()) {
  const payee = norm(tx.payee);
  const purpose = norm(`${tx.purpose || ''} ${tx.bookingText || ''}`);
  for (const { r, alts } of compiled) {
    if (r.sign === 'in' && tx.amount < 0) continue;
    if (r.sign === 'out' && tx.amount > 0) continue;
    const hay = r.field === 'payee' ? payee : r.field === 'purpose' ? purpose : `${payee} ${purpose}`;
    if (alts.some((a) => hay.includes(a))) return r;
  }
  return null;
}

// Regeln auf bestehende Buchungen anwenden. Manuell gesetzte Kategorien bleiben unangetastet.
export function applyRules({ onlyUncategorized = true, ruleIds = null } = {}) {
  let compiled = compileRules();
  if (ruleIds) compiled = compiled.filter((c) => ruleIds.includes(c.r.id));
  const changes = [];
  for (const t of store.all('transactions')) {
    if (t.catManual) continue;
    if (onlyUncategorized && t.categoryId) continue;
    const r = matchRule(t, compiled);
    if (!r) continue;
    const taxCategory = t.taxCategory || r.taxCategory || null;
    if (r.categoryId !== t.categoryId || taxCategory !== t.taxCategory) changes.push({ ...t, categoryId: r.categoryId, taxCategory });
  }
  store.putMany('transactions', changes);
  return changes.length;
}

// Aus einer Buchung eine Regel lernen und auf ähnliche Buchungen anwenden
export function learnRule(tx) {
  const byPayee = norm(tx.payee).length >= 3;
  const match = byPayee
    ? norm(tx.payee).slice(0, 40)
    : norm(tx.purpose).split(' ').filter((w) => w.length > 2 && !/\d{3,}/.test(w)).slice(0, 3).join(' ');
  if (!match) return 0;
  const existing = store.all('rules').find((r) => norm(r.match) === match && (r.field || 'any') === (byPayee ? 'payee' : 'purpose'));
  const rule = store.put('rules', {
    ...(existing || {}),
    match, field: byPayee ? 'payee' : 'purpose', sign: 'any',
    categoryId: tx.categoryId, taxCategory: tx.taxCategory || null, prio: 10,
  });
  return applyRules({ onlyUncategorized: false, ruleIds: [rule.id] });
}
