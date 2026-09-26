// Beispieldaten zum Ausprobieren – alle Datensätze tragen demo:true und lassen sich wieder entfernen
import { store, COLLECTIONS } from './store.js';
import { todayISO, addMonths, monthKey, uid } from './util.js';

function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function loadDemo() {
  const r = rng(42);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const between = (a, b) => Math.round((a + r() * (b - a)) * 100);
  const today = todayISO();
  const end = monthKey(today);
  const giro = { id: uid(), name: 'Girokonto', type: 'giro', bank: 'Sparkasse', demo: true };
  const tagesgeld = { id: uid(), name: 'Tagesgeld', type: 'spar', bank: 'ING', demo: true };
  const kk = { id: uid(), name: 'Kreditkarte', type: 'kredit', bank: 'DKB', demo: true };
  const txs = [];
  const add = (acc, date, amount, payee, purpose, cat, extra = {}) => {
    if (date > today) return;
    txs.push({ id: uid(), accountId: acc.id, date, amount, payee, purpose, categoryId: cat ? 'cat-' + cat : null, tags: [], source: 'demo', demo: true, ...extra });
  };
  const d = (mk, day) => `${mk}-${String(Math.min(day, 28)).padStart(2, '0')}`;
  const vac = { id: uid(), name: 'Sommerurlaub 2027 – Sardinien', goal: 350000, targetDate: `${+end.slice(0, 4) + 1}-07-15`, monthlyRate: 25000, startBalance: 40000, demo: true };
  const entries = [];

  for (let i = 15; i >= 0; i--) {
    const mk = addMonths(end, -i);
    const m = +mk.slice(5, 7);
    add(giro, d(mk, 28), 348000 + (m === 11 ? 210000 : 0), 'Muster GmbH', `Lohn/Gehalt ${mk}`, 'gehalt');
    add(giro, d(mk, 1), -115000, 'Hausverwaltung Schmidt', 'Miete inkl. NK', 'miete');
    add(giro, d(mk, 5), -9800, 'Stadtwerke', 'Abschlag Strom/Gas', 'energie');
    add(giro, d(mk, 3), -3999, 'Telekom Deutschland', 'Festnetz/Internet', 'internet');
    add(giro, d(mk, 15), -1799, 'Vodafone', 'Mobilfunk', 'internet');
    add(kk, d(mk, 12), -1399, 'Netflix', 'Abo', 'abos');
    add(kk, d(mk, 20), -1099, 'Spotify', 'Premium', 'abos');
    add(giro, d(mk, 2), -5800, 'Deutschlandticket', 'Abo', 'oepnv');
    add(giro, d(mk, 1), -2890, 'HUK-Coburg', 'Kfz-Versicherung', 'versicherung');
    add(giro, d(mk, 1), -1250, 'Allianz', 'Privathaftpflicht', 'versicherung', { taxCategory: 'so_vorsorge' });
    add(giro, d(mk, 28), -40000, 'Eigenes Tagesgeld', 'Umbuchung Sparen', 'umbuchung');
    add(tagesgeld, d(mk, 28), 40000, 'Girokonto', 'Umbuchung Sparen', 'umbuchung');
    add(tagesgeld, d(mk, 30), between(8, 14), 'ING', 'Zinsen', 'zinsen', { taxCategory: 'kap' });
    const shops = ['REWE', 'EDEKA', 'ALDI SÜD', 'LIDL', 'Kaufland'];
    for (let k = 0; k < 7; k++) add(giro, d(mk, 1 + Math.floor(r() * 28)), -between(18, 95), pick(shops), 'Kartenzahlung', 'lebensmittel');
    for (let k = 0; k < 2; k++) add(giro, d(mk, 1 + Math.floor(r() * 28)), -between(8, 35), 'dm-drogerie markt', 'Kartenzahlung', 'drogerie');
    for (let k = 0; k < 2; k++) add(kk, d(mk, 1 + Math.floor(r() * 28)), -between(55, 85), pick(['ARAL', 'Shell', 'JET Tankstelle']), 'Tanken', 'tanken');
    for (let k = 0; k < 3; k++) add(kk, d(mk, 1 + Math.floor(r() * 28)), -between(14, 70), pick(['Pizzeria Roma', 'Starbucks', 'Lieferando', 'Gasthaus Linde']), 'Kartenzahlung', 'restaurant');
    if (r() > 0.4) add(kk, d(mk, 1 + Math.floor(r() * 28)), -between(30, 140), pick(['Zalando', 'H&M', 'Deichmann']), 'Online-Bestellung', 'kleidung');
    if (r() > 0.5) add(giro, d(mk, 1 + Math.floor(r() * 28)), -between(20, 120), pick(['Kino', 'Fitnessstudio Aktiv', 'Thalia']), 'Kartenzahlung', 'freizeit');
    if (r() > 0.7) add(giro, d(mk, 1 + Math.floor(r() * 28)), -between(10, 60), 'Apotheke am Markt', 'Zuzahlung', 'gesundheit', { taxCategory: 'ag_krank' });
    add(giro, d(mk, 10), -2000, 'Ärzte ohne Grenzen', 'Spende', 'geschenke', { taxCategory: 'so_spenden' });
    if (m === 3) add(giro, d(mk, 18), -64000, 'Malerbetrieb Klein', 'Rechnung 2031 Arbeitslohn', 'haushalt', { taxCategory: 'hh_handwerker' });
    if (m === 9) add(kk, d(mk, 9), -129900, 'MediaMarkt', 'Laptop (beruflich)', 'bildung', { taxCategory: 'wk_arbeitsmittel' });
    if (m === 8) {
      add(kk, d(mk, 2), -68000, 'Booking.com', 'Hotel Gardasee', 'urlaub');
      add(kk, d(mk, 6), -9500, 'Ristorante Lago', 'Kartenzahlung', 'urlaub');
    }
    if (i <= 11 && d(mk, 28) <= today) entries.push({ id: uid(), vacationId: vac.id, date: d(mk, 28), amount: 25000, note: 'Sparrate', demo: true });
  }

  // Salden so setzen, dass sie realistisch aussehen
  giro.balanceAnchor = 284512; giro.anchorDate = today;
  tagesgeld.balanceAnchor = 1250000; tagesgeld.anchorDate = today;
  kk.balanceAnchor = -34570; kk.anchorDate = today;

  store.putMany('accounts', [giro, tagesgeld, kk]);
  store.putMany('transactions', txs);
  store.putMany('vacations', [vac]);
  store.putMany('vacationEntries', entries);
  store.putMany('budgets', [
    ['lebensmittel', 45000], ['restaurant', 15000], ['kleidung', 10000], ['tanken', 16000], ['freizeit', 10000], ['drogerie', 5000],
  ].map(([c, a]) => ({ id: uid(), categoryId: 'cat-' + c, amount: a, demo: true })));
}

export const hasDemo = () => store.all('accounts').some((a) => a.demo) || store.all('transactions').some((t) => t.demo);

export function removeDemo() {
  for (const c of COLLECTIONS) {
    const ids = store.all(c).filter((r) => r.demo).map((r) => r.id);
    if (ids.length) store.removeMany(c, ids);
  }
}
