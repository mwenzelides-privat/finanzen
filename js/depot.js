// Depot-Import (ING-Depotübersicht und andere Exporte mit ISIN + Kurswert) und Depotbewertung
import { store } from './store.js';
import { norm, parseMoney, parseDate, todayISO } from './util.js';

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

const COLS = {
  isin: [/^isin$/],
  name: [/^wertpapiername$/, /^wertpapier$/, /^bezeichnung$/, /^name$/, /wertpapier/, /bezeichnung/],
  qty: [/^stück\/nominale$/, /^stueck\/nominale$/, /^stück$/, /^stueck$/, /nominale/, /^anzahl$/, /^menge$/, /^bestand$/, /stück|stueck/],
  price: [/^kurs$/, /^aktueller kurs$/, /^kurs in/, /^kurs \(/, /^letzter kurs$/],
  value: [/^kurswert$/, /^kurswert in/, /^marktwert$/, /^aktueller wert$/, /^wert in eur$/, /^depotwert$/, /kurswert|marktwert/],
  cost: [/^einstandswert$/, /^kaufwert$/, /^einstand gesamt$/, /^investiert$/, /einstandswert|kaufwert/],
  date: [/^kursdatum$/, /^datum$/, /kursdatum/],
};

export function isDepotExport(rows) {
  return findDepotHeader(rows) >= 0;
}

function findDepotHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const h = rows[i].map((c) => norm(c));
    if (h.includes('isin') && h.some((c) => /kurswert|marktwert|aktueller wert|wert in eur|depotwert/.test(c))) return i;
  }
  return -1;
}

export function parseDepot(rows) {
  const hi = findDepotHeader(rows);
  if (hi < 0) return null;
  const h = rows[hi].map((c) => norm(c));
  const col = {};
  const used = new Set();
  for (const [k, pats] of Object.entries(COLS)) {
    for (const re of pats) {
      const i = h.findIndex((c, j) => c && !used.has(j) && re.test(c));
      if (i >= 0) { col[k] = i; used.add(i); break; }
    }
  }
  const num = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')));
  const positions = [];
  for (const r of rows.slice(hi + 1)) {
    const isin = String(r[col.isin] ?? '').trim().toUpperCase();
    if (!ISIN.test(isin)) continue;
    const value = parseMoney(r[col.value]);
    if (value == null) continue;
    positions.push({
      isin,
      name: String(r[col.name] ?? '').trim() || isin,
      qty: col.qty != null ? num(r[col.qty]) || 0 : null,
      price: col.price != null ? parseMoney(r[col.price]) : null,
      value,
      cost: col.cost != null ? parseMoney(r[col.cost]) : null,
      date: col.date != null ? parseDate(r[col.date]) : null,
    });
  }
  // Kopfbereich: Depotnummer und Stichtag
  let depotNo = '', stand = null;
  for (const r of rows.slice(0, hi)) {
    const line = r.map((c) => (c instanceof Date ? parseDate(c) : String(c ?? ''))).join(' ');
    if (!depotNo && /depot/i.test(line)) { const m = line.match(/\b\d{8,12}\b/); if (m) depotNo = m[0]; }
    if (!stand && /stand|datum|erstellt|stichtag/i.test(line)) { const m = line.match(/\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{2}-\d{2}/); if (m) stand = parseDate(m[0]); }
  }
  const date = stand || positions.reduce((mx, p) => (p.date && p.date > mx ? p.date : mx), '') || todayISO();
  const value = positions.reduce((s, p) => s + p.value, 0);
  const hasCost = positions.some((p) => p.cost != null);
  const cost = hasCost ? positions.reduce((s, p) => s + (p.cost || 0), 0) : null;
  return { positions, value, cost, date, depotNo, columns: col };
}

// Käufe/Verkäufe auf Verrechnungskonten erkennen: ISIN im Verwendungszweck UND eine echte
// Wertpapierabrechnung. Geldüberweisungen für den Sparplan (ebenfalls mit ISIN) zählen nicht.
const TRADE = /abrechnung|\bkauf|verkauf|ausf(ü|ue)hrung|\border\b|execution|\bstk\b|stück/i;
export function linkedTrades(isins, txs = store.all('transactions')) {
  const set = [...isins].map((i) => i.toUpperCase());
  if (!set.length) return [];
  return txs.filter((t) => {
    if (t.transfer) return false;
    const text = `${t.purpose || ''} ${t.bookingText || ''}`;
    const up = text.toUpperCase().replace(/\s+/g, '');
    return set.some((i) => up.includes(i)) && TRADE.test(text);
  });
}

// Depotstand übernehmen: Positionen, Wertverlauf (ein Eintrag je Stichtag), Saldo-Anker für ältere Versionen
export function commitDepot(parsed, { accountId, newAccount }) {
  let acc = accountId ? store.get('accounts', accountId) : null;
  if (!acc) acc = store.put('accounts', { type: 'depot', balanceAnchor: 0, anchorDate: '', ...newAccount });
  const hist = (acc.valueHistory || []).filter((h) => h.date !== parsed.date);
  hist.push({ date: parsed.date, value: parsed.value, cost: parsed.cost });
  hist.sort((a, b) => a.date.localeCompare(b.date));
  const isins = [...new Set([...(acc.isins || []), ...parsed.positions.map((p) => p.isin)])];
  const latest = hist[hist.length - 1];
  store.put('accounts', {
    ...acc, type: 'depot',
    positions: latest.date === parsed.date ? parsed.positions : acc.positions,
    valueHistory: hist, isins,
    ref: acc.ref || parsed.depotNo || '',
    balanceAnchor: latest.value, anchorDate: latest.date,
  });
  return acc.id;
}

// Depotwert zu einem Datum: letzter bekannter Stand; davor geschätzt aus dem ersten Einstandswert
// abzüglich der danach gekauften Wertpapiere (über die ISIN in den Buchungen erkannt).
export function depotValueAt(acc, date, txs) {
  const hist = acc.valueHistory;
  let snap = null;
  for (const h of hist) if (h.date <= date) snap = h;
  if (snap) return snap.value;
  const first = hist[0];
  let v = first.cost ?? first.value;
  const isins = acc.isins || [];
  if (isins.length) {
    for (const t of linkedTrades(isins, txs)) {
      if (t.date > date && t.date <= first.date) v += t.amount; // Kauf: amount < 0 → Wert davor kleiner
    }
  }
  return Math.max(0, v);
}
