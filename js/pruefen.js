// Kategorien prüfen (Reiter Kategorien › Prüfen): Checkliste der Buchungen ohne passende Kategorie, je Empfänger mit allen
// Einzelheiten der Bank (Verwendungszweck, IBAN, Mandat, Gläubiger-ID, Umsatzart, Kategorie laut Quelle, Datei) und mit
// Hinweisen, was dahinterstecken könnte. Du entscheidest selbst; die Entscheidung gilt sofort in der App.
// Gespeichert wird auf dem Gerät und – am PC – über den Einlese-Dienst in Auswertung\Kategorie-Entscheidungen.json; am Handy
// als Datei sichern und in den Eingang legen. finanzen_aufbauen.py übernimmt die Entscheidungen beim nächsten Aufbau.
// Schlüssel: e|<Name wie norm() in Python>|<+, - oder leer> = alle Buchungen des Empfängers; b|Datum|Konto|Cent = eine Buchung.
import * as Q from './quelle.js';

const KV = 'kategorie-entscheidungen';
const FREMD_ART = new Set(['Kinderkonto', 'Gemeinschaftskonto']);
let ENT = {};               // alle Entscheidungen (eigene und aus den Daten)
let UNSYNC = new Set();     // Schlüssel, die der PC noch nicht hat
let dienstOk = null;        // null = nicht versucht, true = PC-Dienst erreichbar, false = nicht
let H = null;               // Helfer aus app.js
let filter = 'offen', sortierung = 'betrag', suche = '', mehrBuchungen = false;
const angehakt = new Set();
let G = null;               // Gruppen-Cache (je Datenstand)

// wie norm() in finanzen_aufbauen.py – damit Empfänger-Regeln dort dieselben Buchungen treffen
export function pyNorm(s) {
  return String(s ?? '').toLowerCase().replace(/\d{4,}/g, '').replace(/[^a-zäöüß ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}
const jetzt = () => new Date().toISOString().slice(0, 19);
const neuer = (a, b) => !b || String(a?.zeit || '') > String(b.zeit || '');
function mischen(obj) {
  let n = 0;
  for (const [k, e] of Object.entries(obj || {})) if (e && typeof e === 'object' && neuer(e, ENT[k])) { ENT[k] = e; n++; }
  return n;
}

// ---------------------------------------------------------------- Einzelheiten einer Buchung (details aus dashboard_daten.py)
export function det(r, j) {
  const d = j?.details;
  if (!d) return {};
  const z = d.zeilen[r.i] || [], o = {};
  d.spalten.forEach((k, i) => { o[k] = d.listen[k][z[i] || 0] || ''; });
  return o;
}
const eigeneRegel = (t) => /^(Deine Entscheidung|Von dir geprüft)/.test(t || '');

// ---------------------------------------------------------------- Entscheidungen auf die Buchungen anwenden (in aufbereiten)
// Gibt die geänderten Buchungen zurück (deren Suchtext neu gebildet werden muss).
export function entscheidungenAnwenden(rows, j) {
  mischen(j.kategorie_entscheidungen);
  const konten = j.konten, geaendert = [];
  for (const r of rows) {
    const rg = det(r, j).regel;
    if (eigeneRegel(rg)) r.ent = 'daten';
    if (rg) r.regel = rg;
  }
  const keys = Object.keys(ENT).filter((k) => !ENT[k].geloescht).sort((a, b) => (a[0] === 'e' ? 0 : 1) - (b[0] === 'e' ? 0 : 1));
  if (!keys.length) return geaendert;
  const nachName = new Map(), nachB = new Map();
  for (const r of rows) {
    const n = pyNorm(r.g);
    if (n) { if (!nachName.has(n)) nachName.set(n, []); nachName.get(n).push(r); }
    const b = `${r.d}|${konten[r.k].name}|${r.c}`;
    if (!nachB.has(b)) nachB.set(b, []); nachB.get(b).push(r);
  }
  const anwenden = (r, e, k, wie) => {
    if (FREMD_ART.has(r.art)) return;
    if (e.kat) { r.kat = e.kat; r.ukat = e.ukat || ''; }
    if (e.kat || 'umb' in e) {
      const umb = 'umb' in e ? !!e.umb : r.art === 'Umbuchung';
      r.art = umb ? 'Umbuchung' : r.kat === 'Sparen' ? 'Sparen' : r.c > 0 ? 'Einnahme' : 'Ausgabe';
    }
    r.ent = k; r.regel = wie + (e.notiz ? `: ${e.notiz}` : '');
    geaendert.push(r);
  };
  for (const k of keys) {
    const e = ENT[k], t = k.split('|');
    const nurGeprueft = e.ok && !e.kat && !('umb' in e);
    if (t[0] === 'e' && t[1]) {
      for (const r of nachName.get(t[1]) || []) {
        if ((t[2] === '+' && r.c <= 0) || (t[2] === '-' && r.c >= 0)) continue;
        anwenden(r, e, k, nurGeprueft ? 'Von dir geprüft' : `Deine Entscheidung (alle Buchungen von ${e.name || t[1]})`);
      }
    } else if (t[0] === 'b' && t.length >= 4) {
      let l = nachB.get(t.slice(1, 4).join('|')) || [];
      if (l.length > 1 && e.name) { const l2 = l.filter((r) => r.g === e.name || pyNorm(r.g) === pyNorm(e.name)); if (l2.length) l = l2; }
      for (const r of l) anwenden(r, e, k, nurGeprueft ? 'Von dir geprüft' : 'Deine Entscheidung (diese Buchung)');
    }
  }
  return geaendert;
}

// ---------------------------------------------------------------- Laden, speichern, mit dem PC abgleichen
// true = es gibt eigene Entscheidungen, die in den geladenen Daten noch fehlen (dann neu aufbereiten)
let ladenP = null;   // Abgleich mit dem PC erst, wenn die Entscheidungen vom Gerät geladen sind
export function entscheidungenLaden(j) {
  ladenP = laden(j);
  return ladenP;
}
async function laden(j) {
  const lokal = await Q.kvLesen(KV).catch(() => null);
  if (lokal?.ent) mischen(lokal.ent);
  UNSYNC = new Set(lokal?.unsync || []);
  const dj = j.kategorie_entscheidungen || {};
  for (const k of [...UNSYNC]) if (dj[k] && !neuer(ENT[k], dj[k])) UNSYNC.delete(k);   // inzwischen in den Daten
  await lokalSpeichern();
  return Object.entries(ENT).some(([k, e]) => neuer(e, dj[k]));
}
const lokalSpeichern = () => Q.kvSchreiben(KV, { ent: ENT, unsync: [...UNSYNC] }).catch(() => {});
const amPc = () => matchMedia('(pointer: fine)').matches && !/android|iphone|ipad/i.test(navigator.userAgent);

async function abgleichen() {
  if (ladenP) await ladenP.catch(() => {});
  if (!H || !amPc()) { dienstOk = false; return false; }
  const neu = {};
  for (const k of UNSYNC) if (ENT[k]) neu[k] = ENT[k];
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch(H.DIENST + '/kategorien', { method: 'POST', headers: { 'X-Finanzen': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ entscheidungen: neu }), signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const x = await r.json();
    const mehr = mischen(x.entscheidungen);
    UNSYNC.clear(); dienstOk = true;
    await lokalSpeichern();
    return mehr > 0;
  } catch { dienstOk = false; return false; } finally { clearTimeout(t); }
}

async function dateiSichern() {
  const n = new Date(), p = (x) => String(x).padStart(2, '0');
  const name = `Kategorie-Entscheidungen-${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}-${p(n.getHours())}${p(n.getMinutes())}.json`;
  const text = JSON.stringify({ version: 1, geaendert: jetzt(), entscheidungen: ENT }, null, 1);
  const datei = new File([text], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [datei] })) { await navigator.share({ files: [datei], title: name }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  H.herunterladen(new Blob([text], { type: 'application/json' }), name);
}

// ---------------------------------------------------------------- Gruppen (je Empfänger)
const zaehlt = (r, D) => (r.art === 'Ausgabe' || r.art === 'Einnahme') && !(D.konten[r.k].kind || D.konten[r.k].gemeinsam);
const istOffen = (r, D) => zaehlt(r, D) && !r.ent && (r.kat === 'Nicht zugeordnet' || !r.kat || r.ukat === 'Unkategorisiert');
const gKey = (r) => pyNorm(r.g) || `?${pyNorm(r.z).slice(0, 25)}`;
export const gruppenSchluessel = gKey;
// Anzahl offener Buchungen (für den Knopf „Prüfen“)
export function offenZahl(D) {
  if (D._offen == null) D._offen = D.rows.filter((r) => istOffen(r, D)).length;
  return D._offen;
}

function gruppen() {
  const D = H.D();
  if (G && G.D === D) return G;
  const m = new Map(), nachIban = new Map();
  for (const r of D.rows) {
    const k = gKey(r);
    if (k === '?') continue;
    let g = m.get(k);
    if (!g) m.set(k, (g = { key: k, ohneName: k[0] === '?', namen: new Map(), rows: [], offen: [] }));
    g.rows.push(r);
    if (r.g) g.namen.set(r.g, (g.namen.get(r.g) || 0) + 1);
    if (istOffen(r, D)) g.offen.push(r);
    const ib = det(r, D.j).iban;
    if (ib) { if (!nachIban.has(ib)) nachIban.set(ib, []); nachIban.get(ib).push(r); }
  }
  const liste = [];
  for (const g of m.values()) {
    g.name = [...g.namen].sort((a, b) => b[1] - a[1])[0]?.[0] || (g.rows[0].z || '').slice(0, 50) || '(ohne Namen)';
    const z = g.rows.filter((r) => zaehlt(r, D));
    g.aus = -z.filter((r) => r.c < 0).reduce((t, r) => t + r.c, 0);
    g.ein = z.filter((r) => r.c > 0).reduce((t, r) => t + r.c, 0);
    g.oAus = -g.offen.filter((r) => r.c < 0).reduce((t, r) => t + r.c, 0);
    g.oEin = g.offen.filter((r) => r.c > 0).reduce((t, r) => t + r.c, 0);
    g.entschieden = g.rows.some((r) => r.ent);
    g.letzt = g.rows.reduce((t, r) => (r.d > t ? r.d : t), '');
    // Zur Kontrolle: viel unter „Sonstige Einnahmen“ oder Buchungen in vielen verschiedenen Kategorien
    const sonst = z.filter((r) => r.ukat === 'Sonstige Einnahmen' && r.c > 0 && !r.ent);
    g.kontrolleRows = sonst.reduce((t, r) => t + r.c, 0) >= 30000 ? sonst : [];
    if (g.kontrolleRows.length) g.kontrolle = 'als „Sonstige Einnahmen“';
    liste.push(g);
  }
  G = { D, m, nachIban, liste };
  return G;
}

// ---------------------------------------------------------------- Hinweise und Vorschläge
const STICHWORTE = [
  [/\bmiete\b|kaltmiete|nebenkosten/, 'Wohnen', 'Miete'], [/kindesunterhalt/, 'Kinder', 'Kindesunterhalt'], [/trennungsunterhalt/, 'Finanzen', 'Trennungsunterhalt'],
  [/urlaub|ferienwohnung|ferienhaus|hotel|booking\.com|airbnb/, 'Freizeit', 'Urlaub'], [/geschenk|geburtstag|hochzeit|weihnacht/, 'Lifestyle', 'Geschenke'],
  [/darlehen|kredit|tilgung/, 'Finanzen', 'Kredit'], [/kindergeld|familienkasse/, 'Einnahmen', 'Kindergeld'], [/taschengeld/, 'Kinder', 'Taschengeld'],
  [/kita\b|kindergarten|\bhort\b|betreuung/, 'Kinder', 'Kinderbetreuung'], [/schule|nachhilfe|klassenfahrt/, 'Kinder', 'Schule & Foerderung'],
  [/zahnarzt|arztpraxis|\bpraxis\b|klinik|physio|\bdr\.? med/, 'Gesundheit', 'Aerztliche Behandlung'], [/apotheke/, 'Gesundheit', 'Apotheke'],
  [/rechtsanwalt|anwalt|kanzlei|amtsgericht|gerichtskasse/, 'Finanzen', 'Rechtsanwalt'], [/spende/, 'Finanzen', 'Spende'],
  [/mitgliedsbeitrag|\bverein\b|\be\.\s?v\.|ortsverein/, 'Freizeit', 'Mitgliedschaft'], [/jagd|revier|wildschaden|jagdpacht/, 'Freizeit', 'Jagd'],
  [/geldautomat|bargeld/, 'Sonstiges', 'Bargeld'], [/werkstatt|reifen|\bkfz\b|autohaus/, 'Mobilitaet', 'Auto'], [/stadtwerke|\bstrom\b/, 'Wohnen', 'Strom'],
  [/handwerk|renovier|baumarkt|fliesen|maler/, 'Wohnen', 'Bauen / Renovieren'], [/finanzamt|steuer/, 'Finanzen', 'Steuern'], [/versicherung/, 'Versicherungen', 'Sonstige Versicherungen'],
  [/bundesagentur f\w* arbeit|arbeitsagentur|arbeitslosengeld/, 'Einnahmen', 'Arbeitslosengeld', '+', 'neu'],
  [/honorar|\brnr\b|rechnungs?nr|\brechnung\b/, 'Einnahmen', 'Honorar / Nebeneinkünfte', '+', 'neu'],
  [/reisekosten|spesen|auslagen/, 'Einnahmen', 'Reisekosten-Erstattung', '+', 'neu'],
  [/gehalt|\blohn\b|bezuege|bezüge/, 'Einnahmen', 'Lohn / Gehalt', '+'], [/rueckzahlung|rückzahlung|erstattung|auslage|zurueck|zurück/, 'Einnahmen', 'Sonstige Einnahmen', '+'],
];
const FIRMA = /\b(gmbh|ag|kg|se|ohg|ug|e\.?\s?v|mbh|gbr|bank|kasse|versicherung|stadt|gemeinde|amt|verlag|service|shop|markt|apotheke|\.de|\.com|inc|ltd|paypal)\b/i;
const paar = (k, u) => `${k}|${u}`;
// IBAN in Vierergruppen; ältere Kontoauszüge haben nur die Kontonummer, PayPal die E-Mail-Adresse der Gegenseite
export const ibanText = (ib) => (!ib ? '' : /^[A-Z]{2}\d{2}/.test(ib) ? ib.replace(/(.{4})/g, '$1 ').trim() : ib.includes('@') ? `PayPal: ${ib.toLowerCase()}` : `Konto-Nr. ${ib}`);
const katText = (k, u) => `${H.schoen(k)}${u ? ` › ${H.schoen(u)}` : ''}`;

function analyse(g, richtung = null) {
  const { D, nachIban } = gruppen(), j = D.j;
  const hinw = [], vor = new Map();
  const vorschlag = (k, u, w, grund, umb = false, neu = false) => {
    if (!k || k === 'Nicht zugeordnet' || u === 'Unkategorisiert' || (ri < 0 && k === 'Einnahmen')) return;
    if (!umb && !neu && u && !D.ukatZu.has(u)) return;
    const key = umb ? 'umb' : paar(k, u), x = vor.get(key) || { kat: k, ukat: u, umb, w: 0, gruende: [] };
    x.w += w; if (grund && !x.gruende.includes(grund)) x.gruende.push(grund); vor.set(key, x);
  };
  const dts = g.rows.map((r) => det(r, j));
  // Vorschläge passend zur Richtung der offenen Buchungen (eine Ausgabe wird keine Einnahme)
  const ri = richtung ?? (g.offen.length && g.offen.every((r) => r.c < 0) ? -1 : g.offen.length && g.offen.every((r) => r.c > 0) ? 1 : 0);
  const passt = (r) => !ri || Math.sign(r.c) === ri;
  // 1. IBAN: dieselbe Gegenseite unter anderem Namen bereits eingeordnet?
  const ibans = [...new Set(dts.map((d) => d.iban).filter(Boolean))];
  for (const ib of ibans.slice(0, 3)) {
    const andere = (nachIban.get(ib) || []).filter((r) => gKey(r) !== g.key && zaehlt(r, D) && !istOffen(r, D) && passt(r));
    if (!andere.length) continue;
    const c = new Map();
    for (const r of andere) { const k = paar(r.kat, r.ukat); c.set(k, (c.get(k) || 0) + 1); }
    const [top, n] = [...c].sort((a, b) => b[1] - a[1])[0];
    const namen = [...new Set(andere.map((r) => r.g).filter(Boolean))].slice(0, 2).join(', ');
    hinw.push(`Dieselbe IBAN kennst du auch als <b>${H.esc(namen)}</b> – dort meist <b>${H.esc(katText(...top.split('|')))}</b> (${n} von ${andere.length} Buchungen).`);
    vorschlag(...top.split('|'), 3, `gleiche IBAN wie „${namen.split(', ')[0]}“`);
  }
  // 2. Derselbe Empfänger hat andere Buchungen, die schon eingeordnet sind
  const fertig = g.rows.filter((r) => zaehlt(r, D) && !istOffen(r, D) && passt(r));
  if (fertig.length) {
    const c = new Map();
    for (const r of fertig) { const k = paar(r.kat, r.ukat); c.set(k, (c.get(k) || 0) + 1); }
    const s = [...c].sort((a, b) => b[1] - a[1]);
    hinw.push(`Andere ${ri < 0 ? 'Ausgänge' : ri > 0 ? 'Eingänge' : 'Buchungen'} dieses Empfängers stehen unter ${s.slice(0, 3).map(([k, n]) => `<b>${H.esc(katText(...k.split('|')))}</b> (${n}×)`).join(', ')}.`);
    s.slice(0, 2).forEach(([k], i) => vorschlag(...k.split('|'), 2 - i * 0.5, 'so sind seine anderen Buchungen eingeordnet'));
  }
  // 3. Lastschrift eines Unternehmens
  const gid = dts.find((d) => d.gid)?.gid, mref = dts.find((d) => d.mref)?.mref;
  if (gid) hinw.push(`Lastschrift mit Gläubiger-ID <code>${H.esc(gid)}</code>${mref ? ` (Mandat <code>${H.esc(mref)}</code>)` : ''} – ein Unternehmen zieht ein: meist Vertrag, Abo oder Rechnung.`);
  // 4. Kartenzahlung
  if (dts.some((d) => /karte/i.test(d.uart)) || g.rows.some((r) => /debitkarten|kartenzahlung|visa/i.test(r.z))) hinw.push('Kartenzahlung – also ein Geschäft, eine Tankstelle oder ein Online-Händler.');
  // 5. Regelmäßig gleicher Betrag
  const o = g.offen.length ? g.offen : g.rows;
  const betr = new Map();
  for (const r of o) betr.set(r.c, (betr.get(r.c) || 0) + 1);
  const [bc, bn] = [...betr].sort((a, b) => b[1] - a[1])[0] || [];
  if (bn >= 3) {
    const ds = o.filter((r) => r.c === bc).map((r) => r.d).sort();
    const tage = (new Date(ds.at(-1)) - new Date(ds[0])) / 864e5 / (ds.length - 1);
    const rh = tage < 10 ? '' : tage < 45 ? 'etwa monatlich' : tage < 120 ? 'etwa vierteljährlich' : tage < 400 ? 'etwa jährlich' : '';
    hinw.push(`Regelmäßig: <b>${bn}× ${H.eur(bc)}</b>${rh ? ` (${rh})` : ''} von ${H.dde(ds[0])} bis ${H.dde(ds.at(-1))} – sieht nach einer festen Zahlung aus.`);
  }
  // 6. Geld in beide Richtungen
  if (g.ein && g.aus) hinw.push(`Geld ging in beide Richtungen: raus <b class="neg">${H.eur0(g.aus)}</b>, rein <b class="pos">${H.eur0(g.ein)}</b> – z. B. Auslagen, geliehenes Geld oder Erstattungen.`);
  // 7. Gegenbuchung auf einem eigenen Konto (± 3 Tage, gleicher Betrag) → Umbuchung?
  const proKonto = D.proKonto;
  let gegen = null;
  for (const r of g.offen.slice(0, 40)) {
    const t0 = new Date(r.d).getTime();
    for (let k = 0; k < proKonto.length && !gegen; k++) {
      if (k === r.k) continue;
      // nur wenn die Gegenbuchung selbst nach eigenem Geld aussieht (Umbuchung, Sparen oder dein Name)
      const x = proKonto[k].find((y) => y.c === -r.c && Math.abs(new Date(y.d).getTime() - t0) <= 3 * 864e5
        && (y.art === 'Umbuchung' || y.art === 'Sparen' || /wenzelides/i.test(y.g)));
      if (x) gegen = [r, x];
    }
    if (gegen) break;
  }
  if (gegen) {
    hinw.push(`Am ${H.dde(gegen[1].d)} ${gegen[1].c > 0 ? 'kam' : 'ging'} derselbe Betrag (${H.eur(Math.abs(gegen[0].c))}) auf deinem Konto <b>${H.esc(D.konten[gegen[1].k].name)}</b> ${gegen[1].c > 0 ? 'an' : 'ab'} – vermutlich Geld zwischen deinen eigenen Konten.`);
    vorschlag('Umbuchung', '', 3, `gleicher Betrag auf deinem Konto ${D.konten[gegen[1].k].name}`, true);
  }
  // 8. Stichwörter im Text
  const text = H.norm(g.rows.slice(0, 80).map((r) => `${r.g} ${r.z}`).join(' '));
  for (const [re, k, u, vz, neu] of STICHWORTE) {
    const tr = text.match(re);
    if (!tr) continue;
    if (vz === '+' && !g.ein) continue;
    vorschlag(k, u, neu ? 2.5 : 1.5, `im Text steht „${tr[0].trim().slice(0, 30)}“`, false, !!neu);
  }
  // eigenes Geld: dein Name als Gegenseite oder automatischer Ausgleich der Banksoftware
  if (/marcus wenzelides|starmoney autom/.test(text)) vorschlag('Umbuchung', '', 3, /starmoney/.test(text) ? 'automatischer Ausgleich der Banksoftware' : 'Geld von dir selbst', true);
  // 9. Privatperson?
  if (!g.ohneName && !FIRMA.test(g.name) && /^[a-zäöüß.-]+,?\s+[a-zäöüß.-]+(\s+[a-zäöüß.-]+)?$/i.test(g.name.trim()) && !gid) {
    hinw.push('Der Name sieht nach einer <b>Privatperson</b> aus – typisch: Geld an Familie oder Freunde, Privatverkauf, geteilte Kosten oder Rückzahlungen.');
  }
  // 10. Was Finanzguru bzw. die alte Quelle gesagt hat, und was eine Regel geändert hat
  const k0 = new Map();
  for (const d of dts) if (d.kat0) k0.set(d.kat0, (k0.get(d.kat0) || 0) + 1);
  const k0s = [...k0].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (k0s.length) hinw.push(`Kategorie laut Quelle (Finanzguru bzw. Bank/WISO): ${k0s.map(([k, n]) => `${H.esc(k.replace(/ › $/, ''))} (${n}×)`).join(', ')}.`);
  const vs = [...vor.values()].sort((a, b) => b.w - a.w).slice(0, 4);
  return { hinw, vor: vs, ibans, gegen };
}

// ---------------------------------------------------------------- Seite: eine Zeile je Buchung, ein Klick zum Abhaken
// Vorschlag passt → ✓; sonst Kategorie aus der Liste wählen; „zählt nicht“ für Geld zwischen eigenen Konten.
// Haken „auch die anderen von …“: dieselbe Entscheidung gilt für alle offenen Buchungen dieses Empfängers.
let zeigAnzahl = 30;
const analyseCache = new Map();
function vorschlagFuer(g, r) {
  const ri = Math.sign(r.c), k = `${g.key}|${ri}`;   // Vorschlag passend zur Richtung dieser Buchung
  if (!analyseCache.has(k)) analyseCache.set(k, analyse(g, ri));
  return analyseCache.get(k);
}

let katOpts = null;
function katOptionen() {
  const { D } = gruppen();
  if (katOpts && katOpts.D === D) return katOpts.html;
  const m = new Map();
  for (const r of D.rows) {
    if (!r.kat || r.kat === 'Nicht zugeordnet' || r.kat === 'Umbuchung' || r.kat === 'Gemeinschaftskonto' || r.ukat === 'Unkategorisiert') continue;
    if (!m.has(r.kat)) m.set(r.kat, new Map());
    const u = m.get(r.kat); u.set(r.ukat, (u.get(r.ukat) || 0) + 1);
  }
  const html = [...m].sort((a, b) => H.schoen(a[0]).localeCompare(H.schoen(b[0]), 'de')).map(([k, u]) =>
    `<optgroup label="${H.esc(H.schoen(k))}">${[...u].sort((a, b) => b[1] - a[1]).map(([x]) => `<option value="${H.esc(`${k}|${x}`)}">${H.esc(H.schoen(x || k))}</option>`).join('')}</optgroup>`).join('');
  katOpts = { D, html };
  return html;
}

export function pruefenSeite(h) {
  H = h;
  const { D, m, liste } = gruppen();
  const nur = H.S().wahl ? m.get(H.S().wahl) : null;            // aus „Buchungen“: nur dieser Empfänger
  const offen = liste.flatMap((g) => g.offen);
  const erledigt = D.rows.filter((r) => r.ent && zaehlt(r, D));
  const kontrolle = liste.flatMap((g) => g.kontrolleRows || []);
  let rows = nur ? [...nur.rows].filter((r) => zaehlt(r, D)) : filter === 'erledigt' ? erledigt : filter === 'kontrolle' ? kontrolle : offen;
  if (suche) { const q = H.norm(suche); rows = rows.filter((r) => H.norm(`${r.g} ${r.z}`).includes(q)); }
  rows.sort(sortierung === 'datum' ? (a, b) => b.d.localeCompare(a.d) : (a, b) => Math.abs(b.c) - Math.abs(a.c));
  if (nur) rows.sort((a, b) => istOffen(b, D) - istOffen(a, D));
  const gesamt = offen.length + erledigt.length;
  const pz = gesamt ? Math.round((erledigt.length / gesamt) * 100) : 100;
  const satz = nur ? `Alle Buchungen von <b>${H.esc(nur.name)}</b> – Kategorie per Klick ändern.`
    : filter === 'kontrolle' ? `<b>${H.NUM.format(kontrolle.length)} Einnahmen</b> stehen nur unter „Sonstige Einnahmen“ – oft steckt mehr dahinter (Honorar, Arbeitslosengeld, Erstattung, eigenes Geld). Passt der Vorschlag, klick auf <b>✓</b>; stimmt es so, auf <b>„passt so“</b>.`
    : filter === 'erledigt' ? `<b>${H.NUM.format(erledigt.length)} Buchungen</b> hast du entschieden – hier kannst du sie ändern oder zurücknehmen.`
    : offen.length ? `Noch <b>${H.NUM.format(offen.length)} Buchungen</b> ohne passende Kategorie. Passt der Vorschlag, klick auf <b>✓</b> – sonst wähl eine Kategorie aus der Liste. Die Buchung ist dann erledigt.`
      : 'Alle Buchungen haben eine Kategorie. 🎉';
  const rechts = '<div class="seg" role="group" aria-label="Ausgaben, Einnahmen oder Prüfen"><button data-k2art="aus">Ausgaben</button><button data-k2art="ein">Einnahmen</button><button data-k2art="pruefen" class="an">Prüfen</button></div>';
  const ung = [...UNSYNC].filter((k) => ENT[k]).length;
  const speicher = dienstOk ? '✓ am PC gespeichert' : ung ? `${ung} Entscheidungen nur auf diesem Gerät · <button class="link" id="pr-sichern">als Datei sichern</button> (dann in Google Drive › 10 Finanzen › Eingang legen)` : '';
  const leiste = `<div class="pc-leiste">
    ${nur ? `<button class="btn sm" id="pr-alle">‹ zurück zu allen offenen</button>` : `<div class="pc-fort" title="${erledigt.length} von ${gesamt} erledigt"><i style="width:${pz}%"></i></div><span class="klein"><b>${H.NUM.format(erledigt.length)}</b> erledigt · <b>${H.NUM.format(offen.length)}</b> offen</span>`}
    <input id="pr-suche" type="search" placeholder="Suchen …" value="${H.esc(suche)}" autocomplete="off">
    <select id="pr-sort" aria-label="Reihenfolge"><option value="betrag"${sortierung === 'betrag' ? ' selected' : ''}>größte zuerst</option><option value="datum"${sortierung === 'datum' ? ' selected' : ''}>neueste zuerst</option></select>
    ${nur ? '' : `<div class="seg pc-bereich" role="group" aria-label="Bereich">${[['offen', 'Offen', offen.length], ['kontrolle', 'Zur Kontrolle', kontrolle.length], ['erledigt', 'Erledigt', erledigt.length]].map(([k, t, n]) => `<button data-pc-f="${k}" class="${filter === k ? 'an' : ''}">${t} <small>${H.NUM.format(n)}</small></button>`).join('')}</div>`}
    ${speicher ? `<span class="klein muted pc-speicher">${speicher}</span>` : ''}</div>`;
  const zeig = rows.slice(0, zeigAnzahl);
  const html = zeig.map((r) => zeileHtml(r, D, filter === 'erledigt' && !nur, filter === 'kontrolle' && !nur)).join('');
  return H.kopf5('Kategorien prüfen', satz, rechts) + `<section class="card s5-karte pc-karte">${leiste}
    <div class="pc-liste">${html || '<p class="leer">Nichts zu tun.</p>'}</div>
    ${rows.length > zeig.length ? `<button class="btn" id="pr-mehr">Weitere ${Math.min(30, rows.length - zeig.length)} zeigen (noch ${rows.length - zeig.length})</button>` : ''}</section>`;
}

// Liste, auf die sich „auch die anderen von …“ bezieht
const andereVon = (g, r, kontr) => (kontr ? g.kontrolleRows || [] : g.offen).filter((x) => x !== r && Math.sign(x.c) === Math.sign(r.c));
function zeileHtml(r, D, erledigtAnsicht, kontr = false) {
  const g = gruppen().m.get(gKey(r)), d = det(r, D.j), of = istOffen(r, D) || kontr;
  const wt = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(`${r.d}T12:00:00Z`).getUTCDay()];
  const extra = [d.uart, d.iban && ibanText(d.iban), d.gid && `Gläubiger-ID ${d.gid}`, d.mref && `Mandat ${d.mref}`].filter(Boolean).map(H.esc).join(' · ');
  const andere = g ? andereVon(g, r, kontr) : [];
  let aktion;
  if (!of) {
    aktion = `<span class="pc-ist">${r.art === 'Umbuchung' ? 'zählt nicht' : H.esc(katText(r.kat, r.ukat))}</span>
      ${r.ent && r.ent !== 'daten' && erledigtAnsicht ? `<button class="btn sm" data-pc-zurueck="${r.i}">Rückgängig</button>` : ''}
      <select data-pc-kat="${r.i}" aria-label="Kategorie ändern"><option value="">ändern …</option>${katOptionen()}</select>`;
  } else {
    const v = g ? vorschlagFuer(g, r).vor.find((x) => x.umb || x.kat !== r.kat || x.ukat !== r.ukat) : null;
    aktion = `${v ? `<button class="btn primary pc-ok" data-pc-ok="${r.i}" title="${H.esc(v.gruende.join(', '))}">✓ ${v.umb ? 'zählt nicht' : H.esc(katText(v.kat, v.ukat))}</button><small class="pc-grund">${H.esc(v.gruende[0] || '')}</small>` : ''}
      <select data-pc-kat="${r.i}" aria-label="Kategorie wählen"><option value="">${v ? 'andere Kategorie …' : 'Kategorie wählen …'}</option>${katOptionen()}</select>
      <span class="pc-links">${kontr ? `<button class="link" data-pc-passt="${r.i}" title="Die Kategorie stimmt so – aus der Kontrolle nehmen">passt so</button> · ` : ''}<button class="link pc-umb" data-pc-umb="${r.i}" title="Geld zwischen deinen eigenen Konten oder durchlaufendes Geld – zählt weder als Einnahme noch als Ausgabe">zählt nicht</button></span>
      ${andere.length ? `<label class="pc-alle"><input type="checkbox" data-pc-alle="${r.i}" checked> auch die ${andere.length} ${andere.length === 1 ? 'andere' : 'anderen'} von „${H.esc((g.name || '').slice(0, 30))}“</label>` : ''}`;
  }
  return `<div class="pc${of ? '' : ' fertig'}" data-pc="${r.i}"${kontr ? ' data-kontr="1"' : ''}>
    <div class="pc-l"><span>${wt} ${H.dde(r.d)}</span><small>${H.esc(D.konten[r.k].name)}</small></div>
    <div class="pc-m"><b>${H.esc(r.g || '(ohne Namen)')}</b><span class="pc-z">${H.esc(r.z || '')}</span>${extra ? `<small>${extra}</small>` : ''}
      ${g && !H.S().wahl && g.rows.length > 1 ? `<button class="link klein" data-pc-wer="${H.esc(g.key)}">alle ${g.rows.length} Buchungen von „${H.esc((g.name || '').slice(0, 30))}“ ansehen</button>` : ''}</div>
    <b class="pc-b ${r.c < 0 ? 'neg' : 'pos'}">${H.eur(r.c)}</b>
    <div class="pc-a">${aktion}</div></div>`;
}

// ---------------------------------------------------------------- Klicks
export function pruefenBinden(el) {
  const D = gruppen().D;
  const row = (i) => D.rows[+i];
  const mitAnderen = (i) => {
    const r = row(i), box = el.querySelector(`[data-pc-alle="${i}"]`);
    const g = gruppen().m.get(gKey(r)), kontr = !!el.querySelector(`[data-pc="${i}"][data-kontr]`);
    return box?.checked && g ? [r, ...andereVon(g, r, kontr)] : [r];
  };
  el.querySelectorAll('[data-pc-ok]').forEach((b) => b.onclick = () => {
    const r = row(b.dataset.pcOk), v = vorschlagFuer(gruppen().m.get(gKey(r)), r).vor.find((x) => x.umb || x.kat !== r.kat || x.ukat !== r.ukat);
    entscheiden(mitAnderen(b.dataset.pcOk), v.umb ? { kat: 'Umbuchung', ukat: '', umb: true } : { kat: v.kat, ukat: v.ukat, umb: false });
  });
  el.querySelectorAll('[data-pc-kat]').forEach((s) => s.onchange = () => {
    if (!s.value) return;
    const [kat, ukat] = s.value.split('|');
    const akt = istOffen(row(s.dataset.pcKat), D) || el.querySelector(`[data-pc="${s.dataset.pcKat}"][data-kontr]`);
    entscheiden(akt ? mitAnderen(s.dataset.pcKat) : [row(s.dataset.pcKat)], { kat, ukat, umb: false });
  });
  el.querySelectorAll('[data-pc-umb]').forEach((b) => b.onclick = () => entscheiden(mitAnderen(b.dataset.pcUmb), { kat: 'Umbuchung', ukat: '', umb: true }));
  el.querySelectorAll('[data-pc-passt]').forEach((b) => b.onclick = () => entscheiden(mitAnderen(b.dataset.pcPasst), { ok: true }));
  el.querySelectorAll('[data-pc-f]').forEach((b) => b.onclick = () => { filter = b.dataset.pcF; zeigAnzahl = 30; H.neuZeichnen(); });
  el.querySelectorAll('[data-pc-zurueck]').forEach((b) => b.onclick = () => {
    const r = row(b.dataset.pcZurueck), k = r.ent;
    if (!ENT[k]) { H.toast('Diese Entscheidung stammt aus der Auswertung und lässt sich hier nur ändern.'); return; }
    const vorher = [[k, ENT[k]]];
    ENT[k] = { geloescht: true, zeit: jetzt() }; UNSYNC.add(k);
    fertig(`Zurückgenommen: ${r.g || 'Buchung'} vom ${H.dde(r.d)}.`, vorher, H.S().wahl);
  });
  el.querySelectorAll('[data-pc-wer]').forEach((b) => b.onclick = () => { zeigAnzahl = 30; H.setze({ wahl: b.dataset.pcWer }); window.scrollTo({ top: 0 }); });
  el.querySelector('#pr-alle')?.addEventListener('click', () => { zeigAnzahl = 30; H.setze({ wahl: '' }); });
  el.querySelector('#pr-mehr')?.addEventListener('click', () => { zeigAnzahl += 30; H.neuZeichnen(); });
  el.querySelector('#pr-sort')?.addEventListener('change', (e) => { sortierung = e.target.value; H.neuZeichnen(); });
  el.querySelector('#pr-sichern')?.addEventListener('click', dateiSichern);
  const su = el.querySelector('#pr-suche');
  let suT;
  if (su) su.oninput = () => {
    clearTimeout(suT);
    suT = setTimeout(() => { suche = su.value; H.neuZeichnen(); const s2 = document.querySelector('#pr-suche'); if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); } }, 250);
  };
}

function entscheiden(rows, e) {
  const { D } = gruppen();
  const z = jetzt();
  const keys = rows.map((r) => [`b|${r.d}|${D.konten[r.k].name}|${r.c}`, { ...e, zeit: z, name: r.g || '' }]);
  const vorher = keys.map(([k]) => [k, ENT[k]]);
  for (const [k, x] of keys) { ENT[k] = x; UNSYNC.add(k); }
  const was = e.ok ? 'passt so' : e.umb ? 'zählt nicht' : katText(e.kat, e.ukat);
  fertig(`${rows[0].g || 'Buchung'}: ${was}${rows.length > 1 ? ` (${rows.length} Buchungen)` : ''}`, vorher, H.S().wahl);
}

let rueckT;
async function fertig(text, vorher, weiter) {
  angehakt.clear(); mehrBuchungen = false;
  if (ladenP) await ladenP.catch(() => {});
  await lokalSpeichern();
  H.neuAufbauen();       // Entscheidungen wirken sofort auf alle Seiten
  G = null;
  H.setze({ wahl: weiter });
  let bar = document.querySelector('#pr-rueck');
  if (!bar) { bar = Object.assign(document.createElement('div'), { id: 'pr-rueck', className: 'toast st-rueck' }); document.body.append(bar); }
  bar.innerHTML = `<span>${H.esc(text)}</span><button class="link">Rückgängig</button>`;
  bar.hidden = false;
  bar.querySelector('button').onclick = async () => {
    for (const [k, v] of vorher) { ENT[k] = v ? { ...v, zeit: jetzt() } : { geloescht: true, zeit: jetzt() }; UNSYNC.add(k); }
    bar.hidden = true;
    await lokalSpeichern(); H.neuAufbauen(); G = null; H.neuZeichnen(); abgleichen().then(() => H.S().kart === 'pruefen' && H.neuZeichnen());
  };
  clearTimeout(rueckT); rueckT = setTimeout(() => (bar.hidden = true), 7000);
  abgleichen().then((mehr) => { if (mehr) { H.neuAufbauen(); G = null; } if (H.S().kart === 'pruefen') H.neuZeichnen(); });
}

// beim Öffnen der Prüfseite: mit dem PC abgleichen (nur einmal je Sitzung, danach nach jeder Entscheidung)
let abgeglichen = false;
export function pruefenGeoeffnet() {
  if (abgeglichen) return;
  abgeglichen = true;
  abgleichen().then((mehr) => { if (mehr) { H.neuAufbauen(); G = null; } if (H.S().kart === 'pruefen') H.neuZeichnen(); });
}
