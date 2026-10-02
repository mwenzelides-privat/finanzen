// Finanzen – Dashboard: Übersicht mit Grafiken, Buchungen, Kategorien, Fixkosten, Konten, Steuer. Alles reagiert auf Suche und Filter.
import { norm, parse, matcher, highlightWords } from './suche.js';
import * as Q from './quelle.js';
import { alsExcel, alsCsv, herunterladen } from './export.js';
import { chatStart, chatDaten, chatVergessen } from './chat.js';
import { kontostaende, STATUS_TEXT } from './salden.js';
import { steuerDaten, steuerZeigen, postenOptionen, steuerPosten, steuerZuordnen, steuerStand } from './steuer.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const EUR0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat('de-DE');
const eur = (c) => EUR.format(c / 100);
const eur0 = (c) => EUR0.format(Math.round(c / 100));
const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MONAT = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const dde = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const cls = (c) => (c < 0 ? 'neg' : c > 0 ? 'pos' : '');
const LOKAL = ['localhost', '127.0.0.1'].includes(location.hostname);
// Konten, die nicht zu deinen Finanzen zählen: die der Kinder und die gemeinsamen mit Kathrin (dort zählen nur deine Einzahlungen)
const fremd = (k) => !!(k?.kind || k?.gemeinsam);
const FREMD_ART = new Set(['Kinderkonto', 'Gemeinschaftskonto']);

let D = null;          // aufbereitete Daten
let quelle = null;     // gespeicherte Fassung (Text + Herkunft)
const S0 = { q: '', jahr: '', monat: '', konto: '', kat: '', ukat: '', art: 'alle', umb: false, tab: 'start', sort: 'datum', dir: -1, stichtag: '' };
let S = { ...S0 };
let F = [];            // gefilterte Buchungen (nach Datum aufsteigend)
let limit = 150;
const offen = new Set();
const charts = {};

// ======================================================================= Daten aufbereiten
function aufbereiten(j) {
  const K = j.kategorien, U = j.unterkategorien, A = j.arten, konten = j.konten, ST = j.steuerkategorien || [];
  const rows = j.buchungen.map((b, i) => {
    const [d, k, c, g, z, kat, ukat, art, v, t, n, st] = b;
    const r = { i, d, y: +d.slice(0, 4), m: +d.slice(5, 7), k, c, g, z, kat: K[kat], ukat: U[ukat], art: A[art], v, t, n };
    r.st = ST[st] || '';
    r.s = norm(`${g} ${z} ${r.kat} ${r.ukat} ${konten[k].name} ${v} ${t} ${n} ${r.st}`);
    return r;
  });
  const emp = new Map(), ukatZu = new Map();
  for (const r of rows) {
    if (r.ukat && !ukatZu.has(r.ukat)) ukatZu.set(r.ukat, r.kat);
    if (!r.g || r.art === 'Umbuchung') continue;
    const key = norm(r.g);
    let e = emp.get(key);
    if (!e) emp.set(key, (e = { name: r.g, key, n: 0, c: 0 }));
    e.n++; e.c += r.c;
  }
  return {
    j, konten, rows, von: j.von, bis: j.bis,
    jahre: [...new Set(rows.map((r) => r.y))].sort((a, b) => a - b),
    kats: K.filter(Boolean).sort((a, b) => a.localeCompare(b, 'de')),
    ukatZu, emp: [...emp.values()].sort((a, b) => b.n - a.n),
    kontoIdx: new Map(konten.map((k, i) => [k.name, i])),
    proKonto: konten.map((_, i) => rows.filter((r) => r.k === i)),
  };
}

// ======================================================================= Filtern
// Gewählte Jahre: S.jahr ist „2025“ oder „2023,2025“ (mehrere = Vergleich)
const jahreWahl = () => (S.jahr ? String(S.jahr).split(',').map(Number).filter(Boolean).sort((a, b) => a - b) : []);
const einJahr = () => { const j = jahreWahl(); return j.length === 1 ? j[0] : 0; };
const vergleichsModus = () => jahreWahl().length > 1;
// Gewählte Monate: S.monat ist „3“ oder „1,2,3“
const monateWahl = () => (S.monat ? String(S.monat).split(',').map(Number).filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b) : []);
const einMonat = () => { const m = monateWahl(); return m.length === 1 ? m[0] : 0; };
const JAHRES_FARBEN = ['--accent', '--aus', '--ein', '#9085e9', '#eda100', '#e87ba4', '#4a3aa7', '--muted'];
// Farbe je Jahr im Vergleich: das neueste Jahr in Blau, davor Orange, Grün, …
function jahresFarbe(idx, anzahl) { const f = JAHRES_FARBEN[(anzahl - 1 - idx) % JAHRES_FARBEN.length]; return f.startsWith('--') ? css(f) : f; }

// Prüffunktion für alle Filter; mitJahr = false lässt Jahr und Zeitangaben der Suche weg (für den Vorjahresvergleich),
// mitArt = false den Filter „nur Einnahmen/Ausgaben“ (für die Kennzahlen, die immer beide Seiten zeigen)
function pruefer(conds, mitJahr = true, mitArt = true) {
  const test = matcher(mitJahr ? conds : conds.filter((c) => c.kind !== 'zeit'));
  const jahre = mitJahr ? jahreWahl() : [], monate = monateWahl();
  const konto = S.konto ? D.kontoIdx.get(S.konto) ?? -2 : -1;
  const fremdGewaehlt = konto >= 0 && fremd(D.konten[konto]);
  return (r) => (S.umb || r.art !== 'Umbuchung') && (!FREMD_ART.has(r.art) || fremdGewaehlt)
    && (!jahre.length || jahre.includes(r.y)) && (!monate.length || monate.includes(r.m)) && (konto === -1 || r.k === konto)
    && (!S.kat || r.kat === S.kat) && (!S.ukat || r.ukat === S.ukat)
    && (!mitArt || S.art === 'alle' || (S.art === 'aus' ? r.art === 'Ausgabe' : r.art === 'Einnahme'))
    && test(r);
}

let V = null;          // Vergleichszeitraum (ein Jahr früher) mit seinen Buchungen
let FK = [];           // wie F, aber ohne den Filter Einnahmen/Ausgaben (für die Kennzahlen)
function filtern() {
  const conds = parse(S.q);
  F = D.rows.filter(pruefer(conds));
  FK = S.art === 'alle' ? F : D.rows.filter(pruefer(conds, true, false));
  V = vergleich(conds);
  return conds;
}

// Gewählter Zeitraum (Jahr/Monat oder Zeitangaben in der Suche) → derselbe Zeitraum ein Jahr früher.
// Im laufenden Jahr wird nur bis zum selben Tag verglichen (01.01.–28.09. mit 01.01.–28.09. des Vorjahres).
function vergleich(conds) {
  const spans = conds.filter((c) => c.span);
  if (vergleichsModus() || (!einJahr() && !spans.length)) return null;
  let a = '0000-00-00', b = '9999-99-99';
  const ej = einJahr();
  if (ej) { const mm = einMonat() ? String(einMonat()).padStart(2, '0') : ''; a = `${ej}-${mm || '01'}-01`; b = `${ej}-${mm || '12'}-31`; }
  for (const c of spans) { if (c.span[0] + '-01' > a) a = c.span[0] + '-01'; if (c.span[1] + '-31' < b) b = c.span[1] + '-31'; }
  const bVoll = b;
  if (b > D.bis) b = D.bis;
  if (a > b) return null;
  const zurueck = (iso) => `${+iso.slice(0, 4) - 1}${iso.slice(4)}`;
  const va = zurueck(a), vb = zurueck(b);
  if (vb < D.von) return null;
  const t = pruefer(conds, false);
  const rows = D.rows.filter((r) => r.d >= va && r.d <= vb && t(r));
  const tk = pruefer(conds, false, false);
  const rowsAlle = S.art === 'alle' ? rows : D.rows.filter((r) => r.d >= va && r.d <= vb && tk(r));
  const y1 = +va.slice(0, 4), y2 = +vb.slice(0, 4);
  const ganzesJahr = va.slice(5) === '01-01' && bVoll === b && b.slice(5) === '12-31';
  const ganzerMonat = va.slice(5, 7) === vb.slice(5, 7) && va.slice(8) === '01' && bVoll === b;
  const tm = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
  const label = ganzesJahr ? (y1 === y2 ? String(y1) : `${y1}–${y2}`)
    : ganzerMonat && y1 === y2 ? `${MON[+va.slice(5, 7) - 1]} ${y1}`
      : `${tm(va)}–${tm(vb)}${y2}`;
  return { va, vb, rows, rowsAlle, label, jahr: y1 === y2 ? y1 : 0 };
}

// Alle Treffer in einem Jahr? Dann zeigen Grafik und Übersicht Monate statt Jahre.
const proMonat = () => (einJahr() || (vergleichsModus() ? 0 : F.length && F[0].y === F[F.length - 1].y ? F[0].y : 0));

function monatsSpanne(conds) {
  const mw = monateWahl();
  if (einJahr() && mw.length) return mw.length;
  const k = S.konto ? D.konten[D.kontoIdx.get(S.konto)] : null;
  let lo = (k?.von || D.von).slice(0, 7), hi = (k?.bis || D.bis).slice(0, 7);
  const jw = jahreWahl();
  if (jw.length > 1) {
    if (mw.length) return jw.length * mw.length;
    let n = 0;
    for (const y of jw) {
      const a = `${y}-01` < lo ? lo : `${y}-01`, b = `${y}-12` > hi ? hi : `${y}-12`;
      if (a <= b) n += (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)) + 1;
    }
    return Math.max(1, n);
  }
  if (mw.length) return new Set(D.rows.filter((r) => mw.includes(r.m) && r.d.slice(0, 7) >= lo && r.d.slice(0, 7) <= hi).map((r) => r.d.slice(0, 7))).size || 1;
  let a = lo, b = hi;
  if (einJahr()) { a = `${einJahr()}-01`; b = `${einJahr()}-12`; }
  for (const c of conds) if (c.span) { if (c.span[0] > a) a = c.span[0]; if (c.span[1] < b) b = c.span[1]; }
  if (a < lo) a = lo;
  if (b > hi) b = hi;
  const n = (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)) + 1;
  return Math.max(1, n);
}

// ======================================================================= Anzeige: Filterleiste
function selectsFuellen() {
  const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  jahrListeBauen();
  // Monatsleiste: Klick = Monat an/aus, Umschalt + Klick = Zeitraum (z. B. Jan–Mär)
  const mBox = $('#monate');
  mBox.innerHTML = `<button data-m="">Alle Monate</button>` + MON.map((m, i) => `<button data-m="${i + 1}">${m}</button>`).join('');
  mBox.title = 'Klick: Monat an/aus – mehrere möglich. Umschalt + Klick: ganzer Zeitraum.';
  let letzterM = 0;
  mBox.querySelectorAll('button').forEach((b) => b.onclick = (e) => {
    const m = +b.dataset.m;
    if (!m) { letzterM = 0; return setze({ monat: '' }); }
    let w = monateWahl();
    if (e.shiftKey && letzterM) { const a = Math.min(m, letzterM), z = Math.max(m, letzterM); w = []; for (let x = a; x <= z; x++) w.push(x); }
    else w = w.includes(m) ? w.filter((x) => x !== m) : [...w, m];
    letzterM = m;
    setze({ monat: w.sort((x, y) => x - y).join(',') });
  });
  const eigene = D.konten.filter((k) => !fremd(k)), kinder = D.konten.filter((k) => k.kind), gemeinsam = D.konten.filter((k) => k.gemeinsam);
  $('#f-konto').innerHTML = opt('', 'Alle Konten') + eigene.map((k) => opt(k.name, k.name)).join('')
    + (gemeinsam.length ? `<optgroup label="Gemeinsam mit Kathrin – zählen nicht mit">${gemeinsam.map((k) => opt(k.name, k.name)).join('')}</optgroup>` : '')
    + (kinder.length ? `<optgroup label="Konten der Kinder – zählen nicht mit">${kinder.map((k) => opt(k.name, k.name)).join('')}</optgroup>` : '');
  $('#f-kat').innerHTML = opt('', 'Alle Kategorien') + D.kats.map((k) => opt(k, schoen(k))).join('');
}

// Zeitraum-Menü: Kästchen = Jahr an/aus (mehrere = Vergleich), Jahreszahl = nur dieses Jahr
function jahrListeBauen() {
  const n = new Map();
  for (const r of D.rows) n.set(r.y, (n.get(r.y) || 0) + 1);
  const liste = $('#f-jahr-liste');
  liste.innerHTML = `<button class="auswahl-alle" data-jalle>Alle Jahre <small>${NUM.format(D.rows.length)} Buchungen</small></button>
    <div class="auswahl-jahre">${[...D.jahre].reverse().map((y) => `<div class="auswahl-zeile"><input type="checkbox" id="jchk-${y}" data-jchk="${y}" aria-label="${y} zum Vergleich"><button type="button" data-jnur="${y}" title="Nur ${y} zeigen">${y}</button><small>${NUM.format(n.get(y) || 0)}</small></div>`).join('')}</div>
    <div class="auswahl-fuss">Kästchen anhaken: mehrere Jahre vergleichen<br>Jahreszahl anklicken: nur dieses Jahr</div>`;
  liste.querySelector('[data-jalle]').onclick = () => { jahrMenu(false); setze({ jahr: '' }); };
  liste.querySelectorAll('[data-jnur]').forEach((b) => b.onclick = () => { jahrMenu(false); setze({ jahr: b.dataset.jnur }); });
  liste.querySelectorAll('[data-jchk]').forEach((c) => c.onchange = () => {
    setze({ jahr: [...liste.querySelectorAll('[data-jchk]:checked')].map((x) => +x.dataset.jchk).sort((a, b) => a - b).join(',') });
  });
}
function jahrMenu(auf) {
  const l = $('#f-jahr-liste');
  auf = auf ?? l.hidden;
  l.hidden = !auf;
  $('#f-jahr').setAttribute('aria-expanded', String(auf));
}

let filterMehr = (() => { try { return localStorage.getItem('fd.filtermehr') === '1'; } catch { return false; } })();
function filterZeigen(conds) {
  const jw = jahreWahl();
  $('#f-jahr-text').textContent = !jw.length ? 'Alle Jahre' : jw.length === 1 ? String(jw[0]) : jw.length <= 3 ? `${jw.join(', ')} · Vergleich` : `${jw.length} Jahre · Vergleich`;
  $('#f-jahr').classList.toggle('aktiv', jw.length > 0);
  $('#f-jahr-liste').querySelectorAll('[data-jchk]').forEach((c) => { c.checked = jw.includes(+c.dataset.jchk); });
  $('#f-jahr-liste').querySelector('[data-jalle]')?.classList.toggle('an', !jw.length);
  const mw = monateWahl();
  $('#monate')?.querySelectorAll('button').forEach((b) => { const an = b.dataset.m ? mw.includes(+b.dataset.m) : !mw.length; b.classList.toggle('an', an); b.setAttribute('aria-pressed', String(an)); });
  for (const [id, v] of [['#f-konto', S.konto], ['#f-kat', S.kat]]) {
    const el = $(id); el.value = v; el.classList.toggle('aktiv', !!v);
  }
  document.querySelectorAll('#f-art button').forEach((b) => b.classList.toggle('an', b.dataset.v === S.art));
  $('#f-umb').checked = S.umb;
  $('#f-umb').closest('.schalter').classList.toggle('an', S.umb);
  if ($('#q').value !== S.q) $('#q').value = S.q;
  const chips = conds.map((c, i) => `<button class="chip" data-cond="${i}" title="Aus der Suche entfernen">${esc(c.label)}<span class="x">×</span></button>`);
  // eingeklappte Filter als Chips, damit man sieht, was wirkt
  const mehrAktiv = [S.konto && ['konto', `Konto <b>${esc(S.konto)}</b>`], S.kat && ['kat', `Kategorie <b>${esc(schoen(S.kat))}</b>`],
    S.art !== 'alle' && ['art', S.art === 'aus' ? 'nur Ausgaben' : 'nur Einnahmen'], S.umb && ['umb', 'mit Umbuchungen']].filter(Boolean);
  $('#f-mehr').hidden = !filterMehr;
  $('#f-mehr-knopf').setAttribute('aria-expanded', String(filterMehr));
  $('#f-mehr-knopf').classList.toggle('aktiv', mehrAktiv.length > 0);
  $('#f-mehr-n').hidden = !mehrAktiv.length; $('#f-mehr-n').textContent = mehrAktiv.length;
  if (!filterMehr) for (const [k, t] of mehrAktiv) chips.push(`<button class="chip" data-mehr="${k}" title="Filter entfernen">${t}<span class="x">×</span></button>`);
  if (S.ukat) chips.push(`<button class="chip" data-ukat="1" title="Unterkategorie-Filter entfernen">Unterkategorie <b>${esc(S.ukat)}</b><span class="x">×</span></button>`);
  $('#chips').innerHTML = chips.join('');
  $('#chips').querySelectorAll('[data-cond]').forEach((b) => b.onclick = () => {
    const raw = conds[+b.dataset.cond].raw;
    setze({ q: S.q.replace(raw, '').replace(/\s+/g, ' ').trim() });
  });
  $('#chips').querySelector('[data-ukat]')?.addEventListener('click', () => setze({ ukat: '' }));
  $('#chips').querySelectorAll('[data-mehr]').forEach((b) => b.onclick = () => setze(({ konto: { konto: '' }, kat: { kat: '', ukat: '' }, art: { art: 'alle' }, umb: { umb: false } })[b.dataset.mehr]));
  const aktiv = S.q || S.jahr || S.monat || S.konto || S.kat || S.ukat || S.art !== 'alle' || S.umb;
  $('#f-reset').hidden = !aktiv;
  $('#f-zurueck').hidden = stufe <= 0;
}

// ======================================================================= Kennzahlen
function summen(rows) {
  let ein = 0, aus = 0;
  for (const r of rows) { if (r.art === 'Einnahme') ein += r.c; else if (r.art === 'Ausgabe') aus += r.c; }
  return { ein, aus, erg: ein + aus, n: rows.length };
}

// Veränderung gegenüber dem Vorjahr: mehr Einnahmen = gut, mehr Ausgaben = schlecht
function veraenderung(jetzt, vorher, mehrIstGut) {
  if (!V) return '';
  const tip = `${V.label}: ${eur0(vorher)}`;
  if (!vorher) return `<div class="d muted" title="${tip}">${V.label}: –</div>`;
  const p = Math.round(((Math.abs(jetzt) - Math.abs(vorher)) / Math.abs(vorher)) * 100);
  const gut = (p > 0) === mehrIstGut;
  const pf = p > 0 ? '▲' : p < 0 ? '▼' : '=';
  return `<div class="d ${p === 0 ? 'muted' : gut ? 'pos' : 'neg'}" title="${tip}">${pf} ${Math.abs(p)} % · ${V.label}: ${eur0(vorher)}</div>`;
}

// Vergleich mehrerer Jahre: Veränderung vom ersten zum letzten gewählten Jahr, alle Jahre im Tooltip
function jahresZeile(proJahr, feld, mehrIstGut, alsBetrag = false) {
  const [y1, s1] = proJahr[0], [y2, s2] = proJahr[proJahr.length - 1];
  const a = s1[feld], b = s2[feld];
  const tip = proJahr.map(([y, x]) => `${y}: ${feld === 'n' ? NUM.format(x[feld]) : eur0(x[feld])}`).join(' · ');
  const teil = y2 === +D.bis.slice(0, 4) && D.bis.slice(5) !== '12-31' ? ` (${y2} bis ${dde(D.bis).slice(0, 6)})` : '';
  if (alsBetrag) { const d = b - a; return `<div class="d ${cls(d)}" title="${tip}${teil}">${d >= 0 ? '▲ +' : '▼ '}${eur0(d)} · ${y2} ggü. ${y1}</div>`; }
  if (feld === 'n') return `<div class="d muted" title="${tip}">${tip}</div>`;
  if (!a) return `<div class="d muted" title="${tip}">${tip}</div>`;
  const p = Math.round(((Math.abs(b) - Math.abs(a)) / Math.abs(a)) * 100);
  const gut = (p > 0) === mehrIstGut;
  return `<div class="d ${p === 0 ? 'muted' : gut ? 'pos' : 'neg'}" title="${tip}${teil}">${p > 0 ? '▲' : p < 0 ? '▼' : '='} ${Math.abs(p)} % · ${y2} ggü. ${y1}: ${eur0(a)}</div>`;
}

function kennzahlen(conds) {
  // Einnahmen, Ausgaben und Saldo immer aus beiden Seiten – „nur Ausgaben“ wirkt auf Liste und Grafiken, nicht auf die Kacheln
  const { ein, aus, erg } = summen(FK);
  const jw = jahreWahl();
  const proJahr = jw.length > 1 ? jw.map((y) => [y, { ...summen(FK.filter((r) => r.y === y)), n: F.filter((r) => r.y === y).length }]) : null;
  const vs = V ? { ...summen(V.rowsAlle), n: V.rows.length } : null;
  const mon = monatsSpanne(conds);
  const text = conds.some((c) => c.kind === 'text' || c.kind === 'betrag');
  const gesamt = !text && !S.kat;
  const quote = ein > 0 && gesamt ? Math.round((erg / ein) * 100) : null;
  const zr = F.length ? `${dde(F[0].d)} – ${dde(F[F.length - 1].d)}` : 'keine Treffer';
  const avg = (c) => (mon > 24 ? eur0((c / mon) * 12) : eur0(c / mon));
  const IC = {
    ein: '<path d="M12 5v14M6 13l6 6 6-6"/>', aus: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    erg: '<path d="M12 4v16M5 8h14M7 8l-3 7h6zM17 8l-3 7h6z"/>', n: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  };
  const kpi = (l, v, c, s, d = '', k = '', tip = '', an = false) => `<button class="kpi${an ? ' an' : ''}${(k === 'ein' || k === 'aus') && S.art !== 'alle' && S.art !== k ? ' neben' : ''}" data-kpi="${k}" title="${tip}"><div class="l"><span class="kpi-ic ${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[k] || ''}</svg></span>${l}</div><div class="v ${c}">${v}</div><div class="s">${s}</div>${d}</button>`;
  const diffErg = () => {
    if (!V) return '';
    const d = erg - vs.erg;
    return `<div class="d ${cls(d)}" title="${V.label}: ${eur0(vs.erg)}">${d >= 0 ? '▲ +' : '▼ '}${eur0(d)} · ${V.label}: ${eur0(vs.erg)}</div>`;
  };
  $('#kpis').innerHTML = [
    kpi('Einnahmen', eur0(ein), 'pos', mon > 1 ? `Ø ${avg(ein)} pro ${mon > 24 ? 'Jahr' : 'Monat'}` : '&nbsp;', proJahr ? jahresZeile(proJahr, 'ein', true) : veraenderung(ein, vs?.ein, true),
      'ein', S.art === 'ein' ? 'Klick: wieder alle Buchungen zeigen' : 'Klick: nur Einnahmen zeigen', S.art === 'ein'),
    kpi('Ausgaben', eur0(aus), 'neg', mon > 1 ? `Ø ${avg(aus)} pro ${mon > 24 ? 'Jahr' : 'Monat'}` : '&nbsp;', proJahr ? jahresZeile(proJahr, 'aus', false) : veraenderung(aus, vs?.aus, false),
      'aus', S.art === 'aus' ? 'Klick: wieder alle Buchungen zeigen' : 'Klick: nur Ausgaben zeigen', S.art === 'aus'),
    gesamt ? kpi(erg >= 0 ? 'Überschuss' : 'Fehlbetrag', eur0(erg), cls(erg), quote === null ? 'Einnahmen minus Ausgaben' : quote >= 0 ? `${quote} % der Einnahmen übrig` : `${-quote} % mehr ausgegeben als eingenommen`, proJahr ? jahresZeile(proJahr, 'erg', true, true) : diffErg(),
      'erg', 'Klick: Einnahmen und Ausgaben nach Kategorien', S.tab === 'uebersicht' && S.art === 'alle')
      : kpi('Summe der Treffer', eur0(erg), cls(erg), 'Einnahmen minus Ausgaben', proJahr ? jahresZeile(proJahr, 'erg', true, true) : diffErg(), 'erg', 'Klick: nach Kategorien aufteilen', S.tab === 'uebersicht'),
    kpi(S.art === 'alle' ? 'Buchungen' : S.art === 'aus' ? 'Buchungen (nur Ausgaben)' : 'Buchungen (nur Einnahmen)', NUM.format(F.length), '', zr, proJahr ? jahresZeile(proJahr, 'n') : V ? `<div class="d muted">${V.label}: ${NUM.format(vs.n)}</div>` : '',
      'n', 'Klick: Liste der Buchungen', S.tab === 'buchungen' && S.art === 'alle'),
  ].join('');
  $('#kpis').querySelectorAll('[data-kpi]').forEach((b) => b.onclick = () => kpiKlick(b.dataset.kpi));
}

// Klick auf eine Kennzahl: Einnahmen/Ausgaben filtern (nochmal klicken = aus), Überschuss → Kategorien, Buchungen → Liste
function kpiKlick(k) {
  if (k === 'ein' || k === 'aus') setze({ art: S.art === k ? 'alle' : k });   // Reiter und Scrollposition bleiben
  else if (k === 'erg') setze({ art: 'alle', tab: 'uebersicht' });
  else setze({ art: 'alle', tab: 'buchungen' });
}

// ======================================================================= Grafiken
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function achse(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' Mio. €';
  if (a >= 1000) return (v / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' T€';
  return v.toLocaleString('de-DE') + ' €';
}
function alpha(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function basis() {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
    devicePixelRatio: Math.max(2, window.devicePixelRatio || 1),
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: css('--surface'), titleColor: css('--text'), bodyColor: css('--text-2'), footerColor: css('--text'),
        borderColor: css('--border-strong'), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
      },
    },
    scales: {},
  };
}
const achsenStil = () => ({ grid: { color: css('--grid') }, border: { display: false }, ticks: { color: css('--muted'), font: { size: 12 } } });

function zeichne(id, cfg) {
  if (!window.Chart) return;
  charts[id]?.destroy();
  charts[id] = new window.Chart($('#' + id), cfg);
}

// Werte an die Balkenenden schreiben (ruhiger als eine Achse). Die Formatierung steckt im Plugin selbst – nicht in
// chart.options, denn dort hinterlegte Funktionen ruft Chart.js mit einem eigenen Kontext auf.
const wertLabelsMit = (fmt) => ({
  id: 'wertLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart, meta = chart.getDatasetMeta(0);
    ctx.save();
    ctx.font = '12px ' + css('--font');
    ctx.fillStyle = css('--text-2');
    ctx.textBaseline = 'middle';
    meta.data.forEach((bar, i) => ctx.fillText(fmt(chart.data.datasets[0].data[i], i), bar.x + 6, bar.y));
    ctx.restore();
  },
});
const wertLabels = wertLabelsMit((v) => EUR0.format(v));

// Werte an senkrechten Säulen, damit man sie ohne Mauszeiger sieht (kurz: „8,4 T“ = 8.400 €)
const kurzWert = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} T` : NUM.format(Math.round(v)));
const saeulenWerteMit = (opt) => ({
  id: 'saeulenWerte',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = `600 ${opt.groesse || 10.5}px ${css('--font')}`;
    ctx.textAlign = 'center';
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      const linie = meta.type === 'line';
      if (linie && !opt.linie) return;
      meta.data.forEach((el, i) => {
        const v = ds.data[i];
        if (v == null || (!linie && (!v || el.width < 15))) return;
        const neg = v < 0;
        ctx.fillStyle = linie ? ds.borderColor : css('--text-2');
        ctx.textBaseline = neg && !linie ? 'top' : 'bottom';
        const y = linie ? el.y - 6 : neg ? Math.max(el.y, el.base) + 3 : Math.min(el.y, el.base) - 3;
        const text = linie ? opt.linie(v) : (opt.fmt || kurzWert)(v);
        ctx.lineWidth = 3; ctx.strokeStyle = css('--surface'); ctx.lineJoin = 'round';
        ctx.strokeText(text, el.x, y);   // heller Rand: Zahlen bleiben auch über Linien lesbar
        ctx.fillText(text, el.x, y);
      });
    });
    ctx.restore();
  },
});

// Ist der Monat (bzw. das Jahr) mit dem Datenstand noch nicht abgeschlossen? Dann fehlen oft noch Gehalt oder Abbuchungen.
const monatsletzter = (iso) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7), 0)).toISOString().slice(0, 10);
function laeuftNoch(jahr, k) {
  if (jahr) return jahr === +D.bis.slice(0, 4) && k === +D.bis.slice(5, 7) && D.bis !== monatsletzter(D.bis);
  return k === +D.bis.slice(0, 4) && D.bis.slice(5) !== '12-31';
}
const laufendText = () => `noch nicht abgeschlossen – Daten bis ${dde(D.bis).slice(0, 6)}`;

// Überschuss/Fehlbetrag je Monat (bzw. Jahr): immer aus Einnahmen und Ausgaben, auch wenn „nur Ausgaben“ gewählt ist
function ergebnis() {
  const jw = jahreWahl(), vgl = vergleichsModus(), jahr = vgl ? 0 : proMonat();
  let keys, key;
  if (vgl) { keys = jw; key = (r) => r.y; }
  else if (jahr) { keys = MON.map((_, i) => i + 1); key = (r) => (r.y === jahr ? r.m : null); }
  else {
    const a = FK.length ? FK[0].y : D.jahre[0], b = FK.length ? FK[FK.length - 1].y : a;
    keys = []; for (let y = a; y <= b; y++) keys.push(y);
    key = (r) => r.y;
  }
  const pos = new Map(keys.map((k, i) => [k, i]));
  const ein = keys.map(() => 0), aus = keys.map(() => 0);
  for (const r of FK) {
    const i = pos.get(key(r));
    if (i === undefined) continue;
    if (r.art === 'Einnahme') ein[i] += r.c; else if (r.art === 'Ausgabe') aus[i] += r.c;
  }
  const erg = keys.map((_, i) => ein[i] + aus[i]);
  let letzte = erg.length - 1;
  while (letzte > 0 && !ein[letzte] && !aus[letzte]) letzte--;
  let sum = 0;
  const kum = erg.map((v, i) => { sum += v; return i <= letzte ? sum / 100 : null; });
  const tl = (i) => (jahr ? `${MONAT[keys[i] - 1]} ${jahr}` : String(keys[i]));
  $('#t-ergebnis').textContent = `Überschuss / Fehlbetrag ${jahr ? `${jahr} je Monat` : 'je Jahr'}`;
  $('#h-ergebnis').textContent = vgl ? 'gewählte Jahre' : `Linie: aufsummiert${sum ? ` – ${sum >= 0 ? '+' : ''}${eur0(sum)}` : ''}`;
  const cE = css('--ein'), cA = css('--aus'), cL = css('--accent');
  const lauf = keys.map((k) => !vgl && laeuftNoch(jahr, k));
  const ds = [{ label: jahr ? 'Monatsergebnis' : 'Jahresergebnis', data: erg.map((c) => c / 100), backgroundColor: erg.map((c, i) => alpha(c >= 0 ? cE : cA, lauf[i] ? .3 : .85)),
    hoverBackgroundColor: erg.map((c) => (c >= 0 ? cE : cA)), borderRadius: 4, maxBarThickness: 34, order: 2 }];
  if (!vgl && keys.length > 1) ds.push({ type: 'line', label: 'aufsummiert', data: kum, borderColor: cL, backgroundColor: cL, borderWidth: 2, pointRadius: 2.5, pointHoverRadius: 4, tension: 0.3, fill: false, order: 1 });
  const o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.plugins.legend = { display: ds.length > 1, position: 'top', align: 'end', labels: { color: css('--text-2'), usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, font: { size: 12 } } };
  o.plugins.tooltip.callbacks = {
    title: (it) => tl(it[0].dataIndex),
    label: (it) => (it.dataset.type === 'line' ? ` aufsummiert: ${EUR0.format(it.raw)}` : ` ${it.raw >= 0 ? 'Überschuss' : 'Fehlbetrag'}: ${EUR0.format(it.raw)}`),
    afterBody: (it) => { const i = it[0].dataIndex; return [`Einnahmen ${eur0(ein[i])}`, `Ausgaben ${eur0(aus[i])}`, ...(ein[i] > 0 ? [`${erg[i] >= 0 ? 'übrig' : 'mehr ausgegeben'}: ${Math.abs(Math.round((erg[i] / ein[i]) * 100))} % der Einnahmen`] : []), ...(lauf[i] ? [laufendText()] : [])]; },
  };
  o.scales = {
    x: { ...achsenStil(), grid: { display: false } },
    y: { ...achsenStil(), grid: { color: (c) => (c.tick.value === 0 ? css('--border-strong') : css('--grid')) }, ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 6 } },
  };
  o.onClick = (_, el) => {
    if (!el.length) return;
    const k = keys[el[0].index];
    if (jahr) setze({ jahr: String(jahr), monat: S.monat === String(k) ? '' : String(k) }); else setze({ jahr: String(k) });
  };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; };
  o.layout = { padding: { top: 14, bottom: 4 } };
  zeichne('c-ergebnis', { type: 'bar', data: { labels: keys.map((_, i) => (jahr ? MON[keys[i] - 1] : String(keys[i]))), datasets: ds }, options: o, plugins: [saeulenWerteMit({ groesse: 10.5 })] });
}

// Die zehn größten Empfänger (bzw. Einnahmequellen) im gewählten Zeitraum
function topEmpfaenger() {
  const einMode = S.art === 'ein';
  const m = new Map();
  for (const r of F) {
    if (einMode ? r.art !== 'Einnahme' : r.art !== 'Ausgabe') continue;
    const name = r.g || '(ohne Empfänger)', k = norm(name);
    let e = m.get(k);
    if (!e) m.set(k, (e = { name, c: 0, n: 0 }));
    e.c += einMode ? r.c : -r.c; e.n++;
  }
  const list = [...m.values()].filter((e) => e.c > 0).sort((a, b) => b.c - a.c).slice(0, 10);
  const gesamt = [...m.values()].reduce((t, e) => t + Math.max(0, e.c), 0);
  $('#t-top').textContent = einMode ? 'Größte Einnahmequellen' : 'Größte Empfänger';
  $('#h-top').textContent = list.length ? 'anklicken: alle Buchungen' : '';
  $('#chart-top').style.height = `${Math.max(180, list.length * 28 + 30)}px`;
  if (!list.length) { charts['c-top']?.destroy(); delete charts['c-top']; return; }
  const c = css('--accent');
  const o = basis();
  o.indexAxis = 'y';
  o.layout = { padding: { right: 124 } };
  const topFmt = (v) => `${EUR0.format(v)} · ${gesamt ? Math.round((v * 10000) / gesamt) : 0} %`;
  o.plugins.tooltip.callbacks = { title: (it) => list[it[0].dataIndex].name, label: (it) => ` ${EUR0.format(it.raw)} · ${NUM.format(list[it.dataIndex].n)} Buchungen · ${gesamt ? Math.round((it.raw * 10000) / gesamt) : 0} % aller ${einMode ? 'Einnahmen' : 'Ausgaben'}` };
  o.scales = {
    x: { display: false, beginAtZero: true },
    y: { ...achsenStil(), grid: { display: false }, ticks: { color: css('--text-2'), font: { size: 12.5 }, autoSkip: false, callback(v) { const t = this.getLabelForValue(v); return t.length > 24 ? t.slice(0, 23) + '…' : t; } } },
  };
  o.onClick = (_, el) => { if (el.length) setze({ q: `"${list[el[0].index].name}"`, tab: 'buchungen' }); };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; };
  zeichne('c-top', { type: 'bar', data: { labels: list.map((e) => e.name), datasets: [{ data: list.map((e) => e.c / 100), backgroundColor: alpha(c, .78), hoverBackgroundColor: c, borderRadius: 4, barThickness: 18 }] }, options: o, plugins: [wertLabelsMit(topFmt)] });
}

// ======================================================================= Übersicht: das Wichtigste auf einem Bildschirm
// Zeitraum: das gewählte Jahr (laufendes Jahr bis heute) oder die letzten 12 Monate. Die Übersicht zeigt immer das ganze
// Bild – Suche, Konto- und Kategorie-Filter gelten nur in den anderen Reitern.
const WTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const plusTage = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const vorjahrVon = (iso) => `${+iso.slice(0, 4) - 1}${iso.slice(4)}`;

function ueZeitraum() {
  const jw = jahreWahl(), ende = D.bis;
  if (jw.length) {
    const y = jw[jw.length - 1], bis = `${y}-12-31` < ende ? `${y}-12-31` : ende;
    const monate = []; for (let m = 1; m <= 12; m++) monate.push(mkey(y, m));
    return { jahr: y, von: `${y}-01-01`, bis, monate, titel: `Übersicht ${y}`, zeit: bis < `${y}-12-31` ? `1. Januar bis ${dde(bis)}` : 'ganzes Jahr' };
  }
  let [y, m] = ende.slice(0, 7).split('-').map(Number);
  const monate = []; for (let i = 0; i < 12; i++) { monate.unshift(mkey(y, m)); if (--m === 0) { m = 12; y--; } }
  return { jahr: 0, von: `${monate[0]}-01`, bis: ende, monate, titel: 'Übersicht – letzte 12 Monate', zeit: `${MONAT[+monate[0].slice(5) - 1]} ${monate[0].slice(0, 4)} bis ${dde(ende)}` };
}

// Einnahmen, Ausgaben, je Monat und je Kategorie – ohne Umbuchungen, Sparen und die Konten der Kinder
function ueSummen(von, bis) {
  let ein = 0, aus = 0;
  const kat = new Map(), mon = new Map();
  let groesste = null;
  for (const r of D.rows) {
    if (r.d < von || r.d > bis || (r.art !== 'Einnahme' && r.art !== 'Ausgabe')) continue;
    const k = r.d.slice(0, 7), x = mon.get(k) || { ein: 0, aus: 0 };
    if (r.art === 'Einnahme') { ein += r.c; x.ein += r.c; }
    else { aus -= r.c; x.aus -= r.c; kat.set(r.kat, (kat.get(r.kat) || 0) - r.c); if (!groesste || r.c < groesste.c) groesste = r; }
    mon.set(k, x);
  }
  return { ein, aus, erg: ein - aus, kat, mon, groesste };
}

// Summe aller eigenen Konten an einem Tag (wie im Reiter Konten: ohne Depot und ohne die Konten der Kinder)
const kontenSumme = (tag) => (tag < D.von ? null : kontostaende(D, tag).filter((x) => !fremd(x.k) && x.c != null && x.status !== 'unbekannt').reduce((t, x) => t + x.c, 0));

// Übersicht: Ansicht „Monate“ (aktueller Stand) oder „Jahr“ (Jahr bzw. letzte 12 Monate)
function uebersicht() {
  document.documentElement.style.setProperty('--kopf', `${$('.top').offsetHeight}px`);
  const jahrAnsicht = ueModus === 'jahr';
  $('#ue').hidden = !jahrAnsicht; $('#uem').hidden = jahrAnsicht;
  document.querySelectorAll('.ue-modus-wahl').forEach((el) => {
    el.innerHTML = `<button data-uemod="monat" class="${jahrAnsicht ? '' : 'an'}" title="Aktueller Stand: letzte 3 Monate, dieser Monat, Prognose">Monate</button><button data-uemod="jahr" class="${jahrAnsicht ? 'an' : ''}" title="Ganzes Jahr oder letzte 12 Monate">Jahr</button>`;
    el.querySelectorAll('[data-uemod]').forEach((b) => b.onclick = () => { ueModus = b.dataset.uemod; try { localStorage.setItem('fd.uemodus', ueModus); } catch {} uebersicht(); });
  });
  if (jahrAnsicht) ueJahr(); else ueMonate();
}

function ueJahr() {
  const Z = ueZeitraum();
  document.documentElement.style.setProperty('--kopf', `${$('.top').offsetHeight}px`);
  const A = ueSummen(Z.von, Z.bis), V0 = ueSummen(vorjahrVon(Z.von), vorjahrVon(Z.bis));
  const laufend = D.bis !== monatsletzter(D.bis) ? D.bis.slice(0, 7) : '';
  const fertig = Z.monate.filter((k) => k !== laufend && k <= D.bis.slice(0, 7) && k >= D.von.slice(0, 7));
  const nF = Math.max(1, fertig.length);
  const proMon = (feld) => fertig.reduce((t, k) => t + (A.mon.get(k)?.[feld] || 0), 0) / nF;
  const proz = (a, b) => (b ? Math.round(((a - b) / Math.abs(b)) * 100) : null);
  const delta = (p, mehrGut, text) => (p == null ? '' : `<span class="ue-d ${p === 0 ? '' : (p > 0) === mehrGut ? 'gut' : 'schlecht'}">${p > 0 ? '▲' : p < 0 ? '▼' : '='} ${Math.abs(p)} %</span> <span class="muted">${text}</span>`);
  const vjText = Z.jahr ? `ggü. ${Z.jahr - 1}${Z.bis < `${Z.jahr}-12-31` ? ' (gleicher Zeitraum)' : ''}` : 'ggü. Vorjahreszeitraum';

  // Kopf mit Zeitraum
  const y0 = +D.bis.slice(0, 4), jahrAn = Z.jahr;
  $('#ue-titel').textContent = Z.titel;
  $('#ue-zeit').textContent = Z.zeit;
  $('#ue-zeitraum').innerHTML = [y0, y0 - 1, y0 - 2].filter((y) => y >= D.jahre[0]).map((y) => `<button data-uej="${y}" class="${jahrAn === y ? 'an' : ''}">${y}</button>`).join('')
    + `<button data-uej="" class="${jahrAn ? '' : 'an'}">12 Monate</button>`;
  $('#ue-zeitraum').querySelectorAll('[data-uej]').forEach((b) => b.onclick = () => setze({ jahr: b.dataset.uej, monat: '' }));

  // Kacheln
  const stand = kontenSumme(Z.bis), vorher = kontenSumme(Z.jahr ? `${Z.jahr - 1}-12-31` : plusTage(Z.von, -1));
  const spark = (() => {
    const tage = Z.monate.map((k) => { const d = monatsletzter(`${k}-01`); return d > Z.bis ? Z.bis : d; }).filter((d, i, a) => d >= D.von && a.indexOf(d) === i && d <= Z.bis);
    const w = tage.map(kontenSumme);
    if (w.length < 2) return '';
    const lo = Math.min(...w), hi = Math.max(...w), sp = hi - lo || 1;
    const pt = w.map((v, i) => `${((i / (w.length - 1)) * 100).toFixed(1)},${(30 - ((v - lo) / sp) * 26 - 2).toFixed(1)}`);
    return `<svg class="ue-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path class="ue-spark-f" d="M0,30 L${pt.join(' L')} L100,30 Z"/><path class="ue-spark-l" d="M${pt.join(' L')}"/></svg>`;
  })();
  const fixV = fixkostenErkennen().filter((f) => !f.gemeinsam && f.aktiv);
  const pm = fixV.reduce((t, f) => t + f.proMonat, 0);
  const ek = einkommen(), B = ek.schnitt.wert || ek.einnahmen.wert, L = lebenshaltung().schnitt, spiel = B - pm - L;
  const quote = A.ein ? Math.round((A.erg / A.ein) * 100) : null;
  const kachel = (ziel, icon, titel, wert, cls_, zeile1, zeile2, extra = '') => `<button class="ue-kpi" data-uez="${ziel}" title="Details öffnen">
      <span class="ue-kpi-l"><span class="ue-ic ${icon}">${UE_ICON[icon]}</span>${titel}</span><b class="${cls_}">${wert}</b>${extra}
      <span class="ue-kpi-s">${zeile1}</span><span class="ue-kpi-s">${zeile2}</span></button>`;
  const dStand = stand != null && vorher != null ? stand - vorher : null;
  $('#ue-kpis').innerHTML = [
    kachel('konten', 'konto', `Kontostand ${Z.bis === D.bis ? 'heute' : `am ${dde(Z.bis)}`}`, stand == null ? '–' : eur0(stand), stand < 0 ? 'neg' : '',
      dStand == null ? '' : `<span class="ue-d ${dStand >= 0 ? 'gut' : 'schlecht'}">${dStand >= 0 ? '+' : '−'}${eur0(Math.abs(dStand))}</span> <span class="muted">seit ${Z.jahr ? `31.12.${Z.jahr - 1}` : dde(plusTage(Z.von, -1))}</span>`,
      '<span class="muted">alle Konten, ohne Depot</span>', spark),
    kachel('ein', 'ein', 'Einnahmen', eur0(A.ein), 'pos', `<span class="muted">Ø ${eur0(proMon('ein'))} pro Monat</span>`, delta(proz(A.ein, V0.ein), true, vjText)),
    kachel('aus', 'aus', 'Ausgaben', eur0(A.aus), 'neg', `<span class="muted">Ø ${eur0(proMon('aus'))} pro Monat</span>`, delta(proz(A.aus, V0.aus), false, vjText)),
    kachel('erg', 'erg', A.erg >= 0 ? 'Überschuss' : 'Fehlbetrag', `${A.erg < 0 ? '−' : '+'}${eur0(Math.abs(A.erg))}`, A.erg >= 0 ? 'pos' : 'neg',
      quote == null ? '' : `<span class="ue-d ${quote >= 10 ? 'gut' : quote >= 0 ? '' : 'schlecht'}">Sparquote ${quote < 0 ? '−' : ''}${Math.abs(quote)} %</span> <span class="muted">Ziel: 20 %</span>`,
      V0.ein || V0.aus ? `<span class="muted">Vorjahr: ${V0.erg < 0 ? '−' : '+'}${eur0(Math.abs(V0.erg))}</span>` : ''),
    kachel('fix', 'fix', 'Fixkosten pro Monat', eur0(pm), '', `<span class="ue-d ${pm <= B * 0.5 ? 'gut' : 'schlecht'}">${B ? Math.round((pm / B) * 100) : '–'} % vom Gehalt</span> <span class="muted">Ziel: höchstens 50 %</span>`,
      `<span class="muted">Spielraum nach Lebenshaltung:</span> <b class="${spiel >= 0 ? 'pos' : 'neg'}">${spiel < 0 ? '−' : '+'}${eur0(Math.abs(spiel))}</b>`),
  ].join('');
  $('#ue-kpis').querySelectorAll('[data-uez]').forEach((b) => b.onclick = () => ({
    konten: () => setze({ tab: 'konten' }), ein: () => setze({ tab: 'uebersicht', art: 'ein' }), aus: () => setze({ tab: 'uebersicht', art: 'aus' }),
    erg: () => setze({ tab: 'kennzahlen' }), fix: () => setze({ tab: 'fix' }),
  })[b.dataset.uez]());

  ueVerlauf(Z, A, laufend);
  ueKategorien(Z, A, V0);
  ueBudget(pm, L, B, ek);
  ueTermine(fixV);
  ueBlick(Z, A, V0, laufend);
}

const UE_ICON = {
  kal: '<svg viewBox="0 0 24 24"><path d="M4 6.5h16v13H4zM4 10.5h16M8.5 4v4M15.5 4v4"/></svg>',
  konto: '<svg viewBox="0 0 24 24"><path d="M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20.5h18"/></svg>',
  ein: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  aus: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  erg: '<svg viewBox="0 0 24 24"><path d="M4 17l5-5 4 4 7-8M14 8h6v6"/></svg>',
  fix: '<svg viewBox="0 0 24 24"><path d="M17 2.5 20.5 6 17 9.5M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5M7 21.5 3.5 18 7 14.5M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5"/></svg>',
};

// Einnahmen und Ausgaben je Monat, darunter das Ergebnis jedes Monats
function ueVerlauf(Z, A, laufend) {
  const keys = Z.monate;
  const ein = keys.map((k) => (A.mon.get(k)?.ein || 0) / 100), aus = keys.map((k) => (A.mon.get(k)?.aus || 0) / 100);
  const leer = keys.map((k) => k > D.bis.slice(0, 7) || k < D.von.slice(0, 7));
  const erg = keys.map((_, i) => (leer[i] ? null : ein[i] - aus[i]));
  const lauf = keys.map((k) => k === laufend);
  const cE = css('--ein'), cA = css('--aus');
  $('#ue-verlauf-leg').innerHTML = `<span><i style="background:${cE}"></i>Einnahmen</span><span><i style="background:${cA}"></i>Ausgaben</span><span class="muted">Zeile darunter: Ergebnis</span>`;
  const o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.layout = { padding: { top: 16, bottom: 4 } };
  o.plugins.tooltip.callbacks = {
    title: (it) => { const k = keys[it[0].dataIndex]; return `${MONAT[+k.slice(5) - 1]} ${k.slice(0, 4)}`; },
    label: (it) => ` ${it.dataset.label}: ${EUR0.format(it.raw)}`,
    footer: (it) => { const i = it[0].dataIndex; return erg[i] == null ? '' : [`${erg[i] >= 0 ? 'Überschuss' : 'Fehlbetrag'}: ${EUR0.format(erg[i])}`, lauf[i] ? laufendText() : ''].filter(Boolean); },
  };
  o.scales = {
    x: { ...achsenStil(), grid: { display: false }, ticks: { ...achsenStil().ticks, padding: 22, font: { size: 12 } } },
    y: { ...achsenStil(), beginAtZero: true, ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 5 } },
  };
  o.onClick = (_, el) => { if (el.length) { const k = keys[el[0].index]; setze({ tab: 'buchungen', jahr: k.slice(0, 4), monat: String(+k.slice(5)) }); } };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; };
  // Ergebniszeile unter den Monatsnamen (grün = Überschuss, orange = Fehlbetrag)
  const ergebnisZeile = {
    id: 'ergebnisZeile',
    afterDraw(ch) {
      const c = ch.ctx, x = ch.scales.x, y = ch.chartArea.bottom + 12;
      c.save(); c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `650 11px ${css('--font')}`;
      erg.forEach((v, i) => {
        if (v == null) return;
        c.fillStyle = css(v >= 0 ? '--ein-text' : '--aus-text');
        c.globalAlpha = lauf[i] ? 0.5 : 1;
        c.fillText(`${v >= 0 ? '+' : '−'}${kurzWert(Math.abs(v))}`, x.getPixelForValue(i), y);
      });
      c.restore();
    },
  };
  zeichne('c-ue', {
    type: 'bar',
    data: { labels: keys.map((k) => MON[+k.slice(5) - 1]), datasets: [
      { label: 'Einnahmen', data: ein.map((v, i) => (leer[i] ? null : v)), backgroundColor: lauf.map((l) => alpha(cE, l ? .35 : .9)), hoverBackgroundColor: cE, borderRadius: 4, maxBarThickness: 26, categoryPercentage: 0.72, barPercentage: 0.9 },
      { label: 'Ausgaben', data: aus.map((v, i) => (leer[i] ? null : v)), backgroundColor: lauf.map((l) => alpha(cA, l ? .35 : .9)), hoverBackgroundColor: cA, borderRadius: 4, maxBarThickness: 26, categoryPercentage: 0.72, barPercentage: 0.9 },
    ] },
    options: o, plugins: [saeulenWerteMit({ groesse: 9.5 }), ergebnisZeile],
  });
}

// Die größten Ausgaben-Kategorien mit Anteil und Veränderung zum Vorjahr
function ueKategorien(Z, A, V0, n = 8) {
  const l = [...A.kat].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const top = l.slice(0, n), rest = l.slice(n).reduce((t, [, v]) => t + v, 0);
  const max = top.length ? top[0][1] : 1;
  const zeile = (k, v, klick) => {
    const vj = V0.kat.get(k) || 0, p = vj > 0 ? Math.round(((v - vj) / vj) * 100) : null;
    return `<${klick ? `button class="ue-kz" data-uekat="${esc(k)}" title="${esc(schoen(k))}: Einzelheiten im Reiter Kategorien"` : 'div class="ue-kz rest"'}>
      <span class="ue-kz-n">${esc(klick ? schoen(k) : k)}</span>
      <span class="ue-kz-b"><i style="width:${Math.max(1.5, (v / max) * 100)}%"></i></span>
      <span class="ue-kz-w">${eur0(v)}</span><span class="ue-kz-p">${A.aus ? Math.round((v / A.aus) * 100) : 0} %</span>
      <span class="ue-kz-d ${p == null || Math.abs(p) < 3 ? 'muted' : p > 0 ? 'schlecht' : 'gut'}">${p == null ? '–' : Math.abs(p) < 3 ? '=' : `${p > 0 ? '▲' : '▼'} ${Math.abs(p)} %`}</span></${klick ? 'button' : 'div'}>`;
  };
  $('#ue-kat').innerHTML = !top.length ? '<div class="leer">Keine Ausgaben im Zeitraum.</div>'
    : `<div class="ue-kz kopf"><span></span><span></span><span>Betrag</span><span>Anteil</span><span title="Veränderung gegenüber dem gleichen Zeitraum ein Jahr früher">Vorjahr</span></div>`
      + top.map(([k, v]) => zeile(k, v, true)).join('') + (rest > 0 ? zeile(`Übrige (${l.length - n})`, rest, false) : '');
  // so viele Kategorien, wie in die Karte passen – der Rest steht unter „Übrige“
  const box = $('#ue-kat');
  if (n > 3 && box.scrollHeight > box.clientHeight + 2 && getComputedStyle($('#ue')).height !== 'auto') return ueKategorien(Z, A, V0, n - 1);
  $('#ue-kat').querySelectorAll('[data-uekat]').forEach((b) => b.onclick = () => setze({ tab: 'uebersicht', kat: b.dataset.uekat, ukat: '', art: 'alle' }));
}

// Monatsbudget: was vom Gehalt nach Fixkosten und Lebenshaltung bleibt
function ueBudget(pm, L, B, ek) {
  const rest = B - pm - L, max = Math.max(B, pm + L), w = (c) => (Math.max(0, c) / max) * 100;
  const p = (c) => `${B ? Math.round((c / B) * 100) : 0} %`;
  $('#ue-budget').innerHTML = `<div class="ue-h"><h2>Monatsbudget</h2><button class="link klein" data-uezu="fix">Fixkosten und Rechner →</button></div>
    <div class="ue-budget">
      <p class="ue-satz">Von <b>${eur0(B)}</b> Ø Nettogehalt bleiben nach Fixkosten und Lebenshaltung ${rest >= 0 ? `<b class="pos">${eur0(rest)}</b> übrig.` : `<b class="neg">−${eur0(-rest)}</b> – du lebst gerade von Rücklagen.`}</p>
      <div class="ue-bb">
        <i class="bb-fix" style="width:${w(pm)}%" title="Fixkosten ${eur0(pm)} · ${p(pm)}"></i><i class="bb-leben" style="width:${w(L)}%" title="Lebenshaltung ${eur0(L)} · ${p(L)}"></i>${rest > 0 ? `<i class="bb-rest" style="width:${w(rest)}%" title="bleibt ${eur0(rest)}"></i>` : ''}
        ${rest < 0 ? `<b class="ue-bb-minus" style="left:${w(B)}%;width:${w(-rest)}%"></b><b class="ue-bb-linie" style="left:${w(B)}%" title="100 % = ${eur0(B)}"></b>` : ''}
      </div>
      <div class="ue-bb-leg">
        <span><i class="bb-fix"></i><span>Fixkosten</span><b>${eur0(pm)} <small>${p(pm)}</small></b></span>
        <span><i class="bb-leben"></i><span>Lebenshaltung</span><b>${eur0(L)} <small>${p(L)}</small></b></span>
        <span><i class="${rest >= 0 ? 'bb-rest' : 'ue-minus-i'}"></i><span>${rest >= 0 ? 'bleibt' : 'fehlt'}</span><b class="${rest >= 0 ? 'pos' : 'neg'}">${eur0(Math.abs(rest))} <small>${p(Math.abs(rest))}</small></b></span>
      </div>
    </div>`;
  $('#ue-budget').querySelector('[data-uezu]').onclick = () => setze({ tab: 'fix' });
}

// Abbuchungen der nächsten 30 Tage aus den erkannten Verträgen
function ueTermine(fixV, n = 6, ziel = '#ue-termine') {
  const heute = D.bis, bis = plusTage(heute, 30);
  const liste = [];
  for (const f of fixV) {
    let am;
    if (f.rh.proJahr === 12) {
      const tag = zahltag(f);
      const imMonat = (y, m) => { const letzter = new Date(Date.UTC(y, m, 0)).getUTCDate(); return `${mkey(y, m)}-${String(Math.min(tag, letzter)).padStart(2, '0')}`; };
      let [y, m] = heute.slice(0, 7).split('-').map(Number);
      am = imMonat(y, m);
      // schon gebucht oder schon vorbei → nächster Monat
      if (am <= heute || f.zuletzt.slice(0, 7) === heute.slice(0, 7)) { if (++m > 12) { m = 1; y++; } am = imMonat(y, m); }
    } else am = naechsteZahlung(f);
    if (am > heute && am <= bis) liste.push({ f, am });
  }
  liste.sort((a, b) => (a.am < b.am ? -1 : a.am > b.am ? 1 : b.f.betrag - a.f.betrag));
  const summe = liste.reduce((t, x) => t + x.f.betrag, 0), zeigen = liste.slice(0, n);
  const tagText = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return `${WTAG[d.getUTCDay()]} ${+iso.slice(8)}.${+iso.slice(5, 7)}.`; };
  $(ziel).innerHTML = `<div class="ue-h"><h2>Nächste 30 Tage</h2><span class="ue-h-wert">${eur0(summe)} feste Abbuchungen</span></div>
    <div class="ue-termine">${zeigen.length ? zeigen.map(({ f, am }) => `<button class="ue-t" data-fix="${esc(f.name)}" data-sig="${esc(f.sig)}" title="Alle Zahlungen anzeigen">
      <span class="ue-t-d">${tagText(am)}</span><span class="ue-t-n">${esc(vertragName(f))}</span><b>${eur0(f.betrag)}</b></button>`).join('')
      + (liste.length > zeigen.length ? `<div class="ue-t-mehr muted">+ ${liste.length - zeigen.length} weitere (${eur0(liste.slice(n).reduce((t, x) => t + x.f.betrag, 0))})</div>` : '')
      : '<div class="leer">Keine festen Abbuchungen in den nächsten 30 Tagen.</div>'}</div>`;
  const tb = $(`${ziel} .ue-termine`);
  if (n > 2 && tb && tb.scrollHeight > tb.clientHeight + 2) return ueTermine(fixV, n - 1, ziel);
  $(ziel).querySelectorAll('[data-fix]').forEach((b) => b.onclick = () => setze({ q: `"${b.dataset.fix}"${b.dataset.sig ? ' ' + b.dataset.sig : ''}`, tab: 'buchungen', jahr: '', monat: '' }));
}

// Gut zu wissen: laufender Monat, auffälligste Veränderung, größte Ausgabe, Steuer
function ueBlick(Z, A, V0, laufend) {
  const punkte = [];
  if (laufend && Z.monate.includes(laufend)) {
    const x = A.mon.get(laufend) || { ein: 0, aus: 0 };
    const tag = +D.bis.slice(8), tage = new Date(Date.UTC(+laufend.slice(0, 4), +laufend.slice(5), 0)).getUTCDate();
    punkte.push(['kal', `<b>${MONAT[+laufend.slice(5) - 1]} bisher</b> (Tag ${tag} von ${tage}): ${eur0(x.aus)} ausgegeben, ${eur0(x.ein)} eingenommen`, () => setze({ tab: 'buchungen', jahr: laufend.slice(0, 4), monat: String(+laufend.slice(5)) })]);
  }
  const d = [...A.kat].map(([k, v]) => ({ k, d: v - (V0.kat.get(k) || 0) })).filter((x) => V0.kat.has(x.k));
  const hoch = d.sort((a, b) => b.d - a.d)[0], runter = [...d].sort((a, b) => a.d - b.d)[0];
  if (hoch && hoch.d >= 10000) punkte.push(['hoch', `<b>${esc(schoen(hoch.k))}</b> kostet ${eur0(hoch.d)} mehr als im Vorjahreszeitraum`, () => setze({ tab: 'uebersicht', kat: hoch.k, ukat: '' })]);
  const runterP = runter && runter.d <= -10000 && ['runter', `<b>${esc(schoen(runter.k))}</b>: ${eur0(-runter.d)} weniger als im Vorjahreszeitraum`, () => setze({ tab: 'uebersicht', kat: runter.k, ukat: '' })];
  if (A.groesste) punkte.push(['gross', `Größte Einzelausgabe: <b>${eur0(-A.groesste.c)}</b> an ${esc((A.groesste.g || A.groesste.z || '–').slice(0, 34))} (${dde(A.groesste.d)})`, () => setze({ tab: 'buchungen', q: `"${A.groesste.g || ''}"`, jahr: A.groesste.d.slice(0, 4), monat: '' })]);
  if (runterP) punkte.push(runterP);
  const st = steuerStand();
  if (st) punkte.splice(laufend && Z.monate.includes(laufend) ? 1 : 0, 0, ['steuer', st.offen ? `<b>Steuer ${st.jahr}:</b> ${st.offen} Entscheidungen offen` : `<b>Steuer ${st.jahr}:</b> alles entschieden – bereit für die Steuerberaterin`, () => setze({ tab: 'steuer' })]);
  const IC = { kal: '<path d="M4 6.5h16v13H4zM4 10.5h16M8.5 4v4M15.5 4v4"/>', hoch: '<path d="M4 17l6-6 4 4 6-7M14 8h6v6"/>', runter: '<path d="M4 7l6 6 4-4 6 7M14 16h6v-6"/>', gross: '<path d="M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2 2.7 5 3.3 5 1.6 5 3.6-2.2 3.1-5 3.1-5-1.2-5-3.1"/>', steuer: '<path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2zM9 14l6-6"/>' };
  $('#ue-blick').innerHTML = `<div class="ue-h"><h2>Gut zu wissen</h2></div><div class="ue-blick">${punkte.slice(0, 4).map(([ic, t], i) => `<button class="ue-b ue-b-${ic}" data-ueb="${i}"><span class="ue-ic klein ${ic}"><svg viewBox="0 0 24 24">${IC[ic]}</svg></span><span>${t}</span></button>`).join('')}</div>`;
  const bx = $('#ue-blick .ue-blick');
  while (bx.children.length > 2 && bx.scrollHeight > bx.clientHeight + 2) bx.lastElementChild.remove();   // nur, was hineinpasst
  $('#ue-blick').querySelectorAll('[data-ueb]').forEach((b) => b.onclick = () => punkte[+b.dataset.ueb][2]());
}

// ======================================================================= Übersicht „Monate“: aktueller Stand
// Sieben Monate nebeneinander: drei abgeschlossene, der laufende (bisher + erwartet bis Monatsende) und drei Prognosen.
// Prognose: typische Einnahmen (Median der letzten 12 Monate) und typische variable Ausgaben plus die festen Abbuchungen,
// die in dem Monat fällig sind. Daneben der erwartete Kontostand am Monatsende. Ein Klick wählt Monate aus.
let ueModus = (() => { try { return localStorage.getItem('fd.uemodus') || 'monat'; } catch { return 'monat'; } })();
let ueAuswahl = null;   // gewählte Monate 'JJJJ-MM'
const mVor = (k, n) => { let [y, m] = k.split('-').map(Number); m += n; while (m <= 0) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return mkey(y, m); };
const monatName = (k, lang = false) => `${(lang ? MONAT : MON)[+k.slice(5) - 1]} ${lang ? k.slice(0, 4) : k.slice(2, 4)}`;

// Zahlungen eines laufenden Vertrags zwischen von und bis (ISO, beide inklusive)
function faellig(f, von, bis) {
  if (f.rh.proJahr === 12) {
    let n = 0;
    for (let k = von.slice(0, 7); k <= bis.slice(0, 7); k = mVor(k, 1)) {
      const letzter = +monatsletzter(`${k}-01`).slice(8), tag = `${k}-${String(Math.min(zahltag(f), letzter)).padStart(2, '0')}`;
      if (f.zuletzt.slice(0, 7) === k) continue;   // in diesem Monat schon bezahlt
      if (tag >= von && tag <= bis) n++;
      else if (k === D.bis.slice(0, 7) && tag <= D.bis && von > D.bis) n++;   // diesen Monat noch nicht abgebucht: kommt noch
    }
    return n * f.betrag;
  }
  let t = Date.parse(f.zuletzt), n = 0;
  const a = Date.parse(von), b = Date.parse(bis) + 864e5 - 1;
  for (let i = 0; i < 40 && t <= b; i++) { t += f.rh.tage * 864e5; if (t >= a && t <= b) n++; }
  return n * f.betrag;
}

function ueMonatsDaten() {
  if (D.ueM) return D.ueM;
  const heute = D.bis, jetzt = heute.slice(0, 7), laeuft = heute !== monatsletzter(heute);
  const fx = fixIds(), leer = () => ({ ein: 0, aus: 0, var: 0, lohn: 0, spar: 0, kat: new Map() });
  const ist = new Map();
  for (const r of D.rows) {
    if (!['Einnahme', 'Ausgabe', 'Sparen'].includes(r.art) || (r.art === 'Sparen' && istGemeinsam(r.k))) continue;
    const k = r.d.slice(0, 7);
    let x = ist.get(k); if (!x) ist.set(k, (x = leer()));
    if (r.art === 'Einnahme') { x.ein += r.c; if (r.ukat === 'Lohn / Gehalt') x.lohn += r.c; }
    else if (r.art === 'Ausgabe') { x.aus -= r.c; if (!fx.has(r.i)) x.var -= r.c; x.kat.set(r.kat, (x.kat.get(r.kat) || 0) - r.c); }
    else x.spar += r.c;
  }
  // Vergleich: die 12 abgeschlossenen Monate vor dem laufenden
  const ref = []; for (let i = laeuft ? 1 : 0; ref.length < 12; i++) { const k = mVor(jetzt, -i); if (k < D.von.slice(0, 7)) break; ref.unshift(k); }
  const w = (k) => ist.get(k) || leer();
  const med = (f) => (ref.length ? median(ref.map((k) => f(w(k)))) : 0), avg = (f) => (ref.length ? ref.reduce((t, k) => t + f(w(k)), 0) / ref.length : 0);
  const typ = { ein: med((x) => x.ein), var: med((x) => x.var), lohn: med((x) => x.lohn), spar: med((x) => x.spar) };
  const schnitt = { ein: avg((x) => x.ein), aus: avg((x) => x.aus), kat: new Map() };
  for (const k of ref) for (const [kat, v] of w(k).kat) schnitt.kat.set(kat, (schnitt.kat.get(kat) || 0) + v / ref.length);
  // feste Abbuchungen, auch deine festen Einzahlungen aufs Gemeinschaftskonto (Verträge, die von dort abgehen, nicht)
  const vertraege = fixkostenErkennen().filter((f) => f.aktiv && !f.gemeinsam);
  const fest = (von, bis) => vertraege.reduce((t, f) => t + faellig(f, von, bis), 0);
  const gt = gehaltstag();
  // die sieben Monate
  const monate = [];
  let stand = kontenSumme(heute);
  for (let i = -3; i <= 3; i++) {
    const k = mVor(jetzt, i), x = w(k), ende = monatsletzter(`${k}-01`);
    if (i < 0 || (i === 0 && !laeuft)) {
      monate.push({ k, art: 'ist', ein: x.ein, aus: x.aus, erg: x.ein - x.aus, x, stand: kontenSumme(ende > heute ? heute : ende) });
    } else if (i === 0) {
      const offenFest = fest(plusTage(heute, 1), ende);
      const gehaltKommt = x.lohn > 0 ? 0 : typ.lohn;
      // Einnahmen: mindestens ein typischer Monat (das Gehalt fehlt oft noch); was schon mehr ist, bleibt
      const einE = Math.max(x.ein + gehaltKommt, typ.ein), ausE = x.aus + offenFest + Math.max(0, typ.var - x.var);
      stand += einE - x.ein - (ausE - x.aus) + typ.spar * (1 - +heute.slice(8) / +ende.slice(8));
      const tag = +heute.slice(8), tage = +ende.slice(8);
      monate.push({ k, art: 'laeuft', ein: einE, aus: ausE, erg: einE - ausE, x, bisher: { ein: x.ein, aus: x.aus, erg: x.ein - x.aus }, offenFest, gehaltKommt, tag, tage, stand });
    } else {
      const f = fest(`${k}-01`, ende), einE = typ.ein, ausE = typ.var + f;
      stand += einE - ausE + typ.spar;
      monate.push({ k, art: 'prognose', ein: einE, aus: ausE, erg: einE - ausE, fest: f, stand });
    }
  }
  return (D.ueM = { monate, ref, typ, schnitt, vertraege, gt, jetzt, laeuft, ist, w });
}

function ueMonate() {
  const M = ueMonatsDaten(), heuteK = M.jetzt;
  const alle = M.monate.map((m) => m.k);
  if (!ueAuswahl || !ueAuswahl.every((k) => alle.includes(k))) ueAuswahl = [heuteK];
  $('#uem-titel').textContent = `Aktueller Stand · ${MONAT[+heuteK.slice(5) - 1]} ${heuteK.slice(0, 4)}`;
  $('#uem-zeit').textContent = `Daten bis ${dde(D.bis)}`;
  $('#uem-schnell').innerHTML = `<button class="link" data-uems="-3">letzte 3</button><button class="link" data-uems="0">dieser Monat</button><button class="link" data-uems="3">nächste 3</button><button class="link" data-uems="alle">alle 7</button>`;
  $('#uem-schnell').querySelectorAll('[data-uems]').forEach((b) => b.onclick = () => {
    const v = b.dataset.uems;
    ueAuswahl = v === 'alle' ? alle : v === '0' ? [heuteK] : v === '-3' ? alle.slice(0, 3) : alle.slice(4);
    ueMonate();
  });
  ueKacheln(M);
  ueMonatsGrafik(M);
  ueAuswahlKarte(M);
  ueAuswahlKategorien(M);
  ueTermine(fixkostenErkennen().filter((f) => !f.gemeinsam && f.aktiv), 6, '#uem-termine');
}

// Kacheln: heute, dieser Monat, wohin es läuft, Durchschnitt, Fixkosten
function ueKacheln(M) {
  const heute = kontenSumme(D.bis), anfang = kontenSumme(plusTage(`${M.jetzt}-01`, -1));
  const jetzt = M.monate[3], ende = M.monate[6];
  const sE = M.schnitt.ein, sA = M.schnitt.aus, sErg = sE - sA;
  const fixV = fixkostenErkennen().filter((f) => !f.gemeinsam && f.aktiv), pm = fixV.reduce((t, f) => t + f.proMonat, 0);
  const B = einkommen().schnitt.wert;
  const vz = (c) => `${c < 0 ? '−' : '+'}${eur0(Math.abs(c))}`;
  const kachel = (ziel, icon, titel, wert, cls_, zeile, extra = '') => `<button class="ue-kpi" data-uemz="${ziel}"><span class="ue-kpi-l"><span class="ue-ic ${icon}">${UE_ICON[icon]}</span>${titel}</span><b class="${cls_}">${wert}</b>${extra}<span class="ue-kpi-s">${zeile}</span></button>`;
  const lauf = jetzt.art === 'laeuft';
  const tempo = lauf ? `<span class="uem-k-tempo" title="Strich = heute (Tag ${jetzt.tag} von ${jetzt.tage})"><i style="width:${Math.min(100, (jetzt.bisher.aus / Math.max(1, jetzt.aus)) * 100)}%"></i><b style="left:${(jetzt.tag / jetzt.tage) * 100}%"></b></span>` : '';
  const monatJ = MONAT[+M.jetzt.slice(5) - 1], monatE = MONAT[+ende.k.slice(5) - 1];
  $('#uem-kpis').innerHTML = [
    kachel('konten', 'konto', 'Kontostand heute', heute == null ? '–' : eur0(heute), heute < 0 ? 'neg' : '',
      heute != null && anfang != null ? `<span class="ue-d ${heute - anfang >= 0 ? 'gut' : 'schlecht'}">${vz(heute - anfang)}</span> <span class="muted">seit 1. ${monatJ}</span>` : ''),
    kachel('monat', 'kal', lauf ? `${monatJ} bisher ausgegeben` : `${monatJ} ausgegeben`, eur0(lauf ? jetzt.bisher.aus : jetzt.aus), 'neg',
      lauf ? `<span class="muted">Tag ${jetzt.tag} von ${jetzt.tage} · erwartet ≈ ${eur0(jetzt.aus)}</span>` : '', tempo),
    kachel('monat', 'erg', `Erwartet Ende ${monatJ}`, `≈ ${vz(jetzt.erg)}`, jetzt.erg >= 0 ? 'pos' : 'neg', `<span class="muted">Konten ≈ ${jetzt.stand == null ? '–' : eur0(jetzt.stand)} am Monatsende</span>`),
    kachel('prognose', 'konto', `Prognose Ende ${monatE}`, ende.stand == null ? '–' : `≈ ${eur0(ende.stand)}`, ende.stand < 0 ? 'neg' : '',
      jetzt.stand != null && ende.stand != null ? `<span class="ue-d ${ende.stand - jetzt.stand >= 0 ? 'gut' : 'schlecht'}">${vz(ende.stand - jetzt.stand)}</span> <span class="muted">ggü. Ende ${monatJ} (≈ ${vz((ende.stand - jetzt.stand) / 3)} pro Monat)</span>` : ''),
    kachel('schnitt', 'fix', 'Ø pro Monat (12 Monate)', vz(sErg), sErg >= 0 ? 'pos' : 'neg',
      `<span class="muted">${eur0(sE)} rein · ${eur0(sA)} raus · Fixkosten ${eur0(pm)}</span> <span class="ue-d ${pm <= B * 0.5 ? 'gut' : 'schlecht'}">(${B ? Math.round((pm / B) * 100) : '–'} %)</span>`),
  ].join('');
  $('#uem-kpis').querySelectorAll('[data-uemz]').forEach((b) => b.onclick = () => ({
    konten: () => setze({ tab: 'konten' }), monat: () => { ueAuswahl = [M.jetzt]; ueMonate(); },
    prognose: () => { ueAuswahl = M.monate.slice(4).map((m) => m.k); ueMonate(); },
    schnitt: () => setze({ tab: 'kennzahlen', jahr: '', monat: '' }),
  })[b.dataset.uemz]());
}

// Eine Grafik für die sieben Monate: Einnahmen und Ausgaben als Säulen, Kontostand am Monatsende als Linie,
// Prognose schraffiert und gestrichelt, „heute“ als Marke. Klick: Monat wählen (Strg/Umschalt: mehrere).
function ueMonatsGrafik(M) {
  const ms = M.monate, keys = ms.map((m) => m.k), ij = 3;
  const cE = css('--ein'), cA = css('--aus'), cK = css('--accent');
  const muster = (farbe) => {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const x = c.getContext('2d'); x.fillStyle = alpha(farbe, 0.28); x.fillRect(0, 0, 8, 8);
    x.strokeStyle = alpha(farbe, 0.75); x.lineWidth = 2; x.beginPath(); x.moveTo(-2, 10); x.lineTo(10, -2); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke();
    return x.createPattern(c, 'repeat');
  };
  const pE = muster(cE), pA = muster(cA);
  const fuell = (farbe, p) => ms.map((m) => (m.art === 'prognose' ? p : m.art === 'laeuft' ? alpha(farbe, 0.55) : alpha(farbe, 0.9)));
  const erg = ms.map((m) => m.erg / 100);
  const o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.layout = { padding: { top: 18, bottom: 2 } };
  o.plugins.tooltip.callbacks = {
    title: (it) => { const m = ms[it[0].dataIndex]; return `${MONAT[+m.k.slice(5) - 1]} ${m.k.slice(0, 4)}${m.art === 'prognose' ? ' – Prognose' : m.art === 'laeuft' ? ' – erwartet bis Monatsende' : ''}`; },
    label: (it) => ` ${it.dataset.label}: ${it.raw == null ? '–' : EUR0.format(it.raw)}`,
    footer: (it) => { const m = ms[it[0].dataIndex]; return [`${m.erg >= 0 ? 'Überschuss' : 'Fehlbetrag'}: ${EUR0.format(m.erg / 100)}`, m.art === 'laeuft' ? `bisher: ${EUR0.format(m.bisher.ein / 100)} rein, ${EUR0.format(m.bisher.aus / 100)} raus` : '', 'Klick: Monat wählen · Strg/Umschalt: mehrere'].filter(Boolean); },
  };
  o.scales = {
    x: { ...achsenStil(), grid: { display: false }, ticks: { ...achsenStil().ticks, padding: 20, font: { size: 12, weight: '600' }, color: css('--text-2') } },
    y: { ...achsenStil(), beginAtZero: true, ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 5 } },
  };
  o.onClick = (e, el, ch) => {
    const i = el.length ? el[0].index : ch.scales.x.getValueForPixel(e.x);
    if (i == null || i < 0 || i >= keys.length) return;
    const k = keys[i], n = e.native;
    if (n?.shiftKey) { const a = keys.indexOf(ueAuswahl[ueAuswahl.length - 1]); ueAuswahl = keys.slice(Math.min(a, i), Math.max(a, i) + 1); }
    else if (n?.ctrlKey || n?.metaKey) ueAuswahl = ueAuswahl.includes(k) ? (ueAuswahl.length > 1 ? ueAuswahl.filter((x) => x !== k) : ueAuswahl) : [...ueAuswahl, k].sort();
    else ueAuswahl = [k];
    ueMonate();
  };
  o.onHover = (e) => { e.native.target.style.cursor = 'pointer'; };
  const gewaehlt = new Set(ueAuswahl.map((k) => keys.indexOf(k)));
  // Hintergrund: Auswahl, Prognosebereich, „heute“
  const hintergrund = {
    id: 'ueHintergrund',
    beforeDatasetsDraw(ch) {
      const c = ch.ctx, x = ch.scales.x, a = ch.chartArea, breite = x.width / keys.length;
      c.save();
      c.fillStyle = 'rgba(128, 128, 128, 0.07)';
      c.fillRect(x.getPixelForValue(ij + 1) - breite / 2, a.top, breite * 3, a.bottom - a.top);
      c.fillStyle = alpha(cK, 0.1);
      for (const i of gewaehlt) c.fillRect(x.getPixelForValue(i) - breite / 2 + 2, a.top - 14, breite - 4, a.bottom - a.top + 14 + 40);
      const hx = x.getPixelForValue(ij - 0.5 + (ms[ij].tag || ms[ij].tage || 1) / (ms[ij].tage || 1));
      c.strokeStyle = css('--text-2'); c.setLineDash([4, 3]); c.lineWidth = 1;
      c.beginPath(); c.moveTo(hx, a.top - 6); c.lineTo(hx, a.bottom); c.stroke();
      c.setLineDash([]); c.fillStyle = css('--text-2'); c.font = `600 10.5px ${css('--font')}`; c.textAlign = 'center';
      c.fillText('heute', hx, a.top - 9);
      c.fillStyle = css('--muted'); c.textAlign = 'left';
      c.fillText('PROGNOSE', x.getPixelForValue(ij + 1) - breite / 2 + 6, a.top + 10);
      c.restore();
    },
    afterDraw(ch) {   // Ergebnis je Monat zwischen Achse und Monatsnamen
      const c = ch.ctx, x = ch.scales.x, y = ch.chartArea.bottom + 11;
      c.save(); c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `700 11px ${css('--font')}`;
      erg.forEach((v, i) => { c.fillStyle = css(v >= 0 ? '--ein-text' : '--aus-text'); c.fillText(`${ms[i].art === 'ist' ? '' : '≈ '}${v >= 0 ? '+' : '−'}${kurzWert(Math.abs(v))}`, x.getPixelForValue(i), y); });
      c.restore();
    },
  };
  zeichne('c-uem', {
    type: 'bar',
    data: { labels: ms.map((m) => `${MON[+m.k.slice(5) - 1]} ${m.k.slice(2, 4)}`), datasets: [
      { label: 'Einnahmen', data: ms.map((m) => m.ein / 100), backgroundColor: fuell(cE, pE), hoverBackgroundColor: cE, borderRadius: 4, maxBarThickness: 40, categoryPercentage: 0.7, barPercentage: 0.88, order: 2 },
      { label: 'Ausgaben', data: ms.map((m) => m.aus / 100), backgroundColor: fuell(cA, pA), hoverBackgroundColor: cA, borderRadius: 4, maxBarThickness: 40, categoryPercentage: 0.7, barPercentage: 0.88, order: 2 },
      { type: 'line', label: 'Kontostand Monatsende', data: ms.map((m) => (m.stand == null ? null : m.stand / 100)), borderColor: cK, backgroundColor: cK, borderWidth: 2.5, tension: 0.3,
        pointRadius: ms.map((_, i) => (gewaehlt.has(i) ? 5 : 3.5)), pointBackgroundColor: ms.map((m) => (m.art === 'ist' ? cK : css('--surface'))), pointBorderColor: cK, pointBorderWidth: 2,
        segment: { borderDash: (s) => (s.p1DataIndex > ij - 1 ? [6, 4] : undefined) }, order: 1 },
    ] },
    options: o, plugins: [hintergrund, saeulenWerteMit({ groesse: 9.5, linie: (v) => kurzWert(v) })],
  });
}

// Die Auswahl im Vergleich zum Durchschnitt: Einnahmen, Ausgaben, Ergebnis (bei mehreren Monaten je Monat)
function ueAuswahlKarte(M) {
  const sel = M.monate.filter((m) => ueAuswahl.includes(m.k)), n = sel.length;
  const sum = (f) => sel.reduce((t, m) => t + f(m), 0);
  const ein = sum((m) => m.ein) / n, aus = sum((m) => m.aus) / n, erg = ein - aus;
  const nurIst = sel.every((m) => m.art === 'ist'), lauf = sel.length === 1 && sel[0].art === 'laeuft' ? sel[0] : null;
  const prog = sel.some((m) => m.art !== 'ist');
  const titel = n === 1 ? `${MONAT[+sel[0].k.slice(5) - 1]} ${sel[0].k.slice(0, 4)}` : `${monatName(sel[0].k)} – ${monatName(sel[n - 1].k)} · ${n} Monate`;
  const sE = M.schnitt.ein, sA = M.schnitt.aus, sErg = sE - sA;
  const pz = (a, b) => (b ? Math.round(((a - b) / Math.abs(b)) * 100) : 0);
  const max = Math.max(ein, aus, sE, sA, 1);
  const zeile = (l, v, s, cls_, mehrGut, extra = '') => {
    const p = pz(v, s);
    return `<div class="uem-v"><span class="uem-v-l">${l}</span>
      <span class="uem-v-bar"><i class="${cls_}" style="width:${(v / max) * 100}%"></i>${extra}<b class="uem-v-s" style="left:${(s / max) * 100}%" title="Ø ${eur0(s)}"></b></span>
      <span class="uem-v-w">${prog ? '≈ ' : ''}${eur0(v)}</span>
      <span class="uem-v-d ${Math.abs(p) < 3 ? '' : (p > 0) === mehrGut ? 'gut' : 'schlecht'}">${Math.abs(p) < 3 ? '≈ Ø' : `${p > 0 ? '+' : '−'}${Math.abs(p)} % ggü. Ø`}</span></div>`;
  };
  let h = `<div class="ue-h"><h2>${esc(titel)}${n > 1 ? ' <span class="muted">· je Monat</span>' : ''}</h2>${nurIst || lauf ? `<button class="link klein" id="uem-buchungen">Buchungen →</button>` : ''}</div><div class="uem-auswahl">`;
  if (lauf) {
    const b = lauf.bisher, anteil = Math.round((lauf.tag / lauf.tage) * 100);
    h += `<div class="uem-tempo"><div class="uem-tempo-z"><span>Monat zu <b>${anteil} %</b> vorbei</span><span>${eur0(b.aus)} von ≈ ${eur0(lauf.aus)} ausgegeben</span></div>
      <div class="uem-tempo-bar"><i style="width:${Math.min(100, (b.aus / Math.max(lauf.aus, 1)) * 100)}%"></i><b style="left:${anteil}%" title="heute"></b></div></div>`;
  }
  h += zeile('Einnahmen', ein, sE, 'ein', true, lauf ? `<i class="ein bisher" style="width:${(lauf.bisher.ein / max) * 100}%"></i>` : '')
    + zeile('Ausgaben', aus, sA, 'aus', false, lauf ? `<i class="aus bisher" style="width:${(lauf.bisher.aus / max) * 100}%"></i>` : '');
  const pE = pz(erg, sErg);
  h += `<div class="uem-erg-zeile"><span>Ergebnis${n > 1 ? ' je Monat' : ''}</span><b class="${erg >= 0 ? 'pos' : 'neg'}">${prog ? '≈ ' : ''}${erg < 0 ? '−' : '+'}${eur0(Math.abs(erg))}</b>
    <span class="muted">Ø ${sErg < 0 ? '−' : '+'}${eur0(Math.abs(sErg))}${ein > 0 ? ` · Sparquote ${erg < 0 ? '−' : ''}${Math.abs(Math.round((erg / ein) * 100))} %` : ''}</span></div>`;
  // Hinweise zum Monat
  const punkte = [];
  if (lauf) {
    punkte.push(`Noch fällig bis Monatsende: <b>${eur0(lauf.offenFest)}</b> feste Abbuchungen`);
    punkte.push(lauf.gehaltKommt ? `Gehalt erwartet: <b>≈ ${eur0(lauf.gehaltKommt)}</b>${M.gt ? ` um den ${M.gt}.` : ''}` : `Gehalt ist da: <b>${eur0(lauf.x.lohn)}</b>`);
  } else if (sel.every((m) => m.art === 'prognose')) {
    punkte.push(`Davon fest: <b>${eur0(sum((m) => m.fest) / n)}</b>${n > 1 ? ' je Monat' : ''} (Verträge, Unterhalt, Versicherungen)`);
    punkte.push(`Variabel erwartet: <b>≈ ${eur0(M.typ.var)}</b> – so viel gibst du in einem typischen Monat zusätzlich aus`);
    punkte.push('Sonderzahlungen (z. B. Weihnachtsgeld) sind nicht eingerechnet – die Prognose ist eher vorsichtig.');
  } else if (nurIst) {
    const lohn = sel.reduce((t, m) => t + m.x.lohn, 0) / n;
    if (lohn) punkte.push(`Gehalt: <b>${eur0(lohn)}</b>${n > 1 ? ' je Monat' : ''} · Ø ${eur0(M.typ.lohn)}`);
    const letzteM = sel[n - 1];
    if (letzteM.stand != null) punkte.push(`Konten am Monatsende: <b>${eur0(letzteM.stand)}</b>`);
  }
  const ende = M.monate[M.monate.length - 1];
  if (ende.stand != null) punkte.push(`Erwarteter Kontostand Ende ${MONAT[+ende.k.slice(5) - 1]}: <b class="${ende.stand < 0 ? 'neg' : ''}">≈ ${eur0(ende.stand)}</b>`);
  h += `<ul class="uem-punkte">${punkte.map((p) => `<li>${p}</li>`).join('')}</ul></div>`;
  $('#uem-stand').innerHTML = h;
  $('#uem-buchungen')?.addEventListener('click', () => setze(ueFilterFuer(sel.filter((m) => m.art !== 'prognose').map((m) => m.k))));
}

// Monate → Filter für die anderen Reiter (gleiches Jahr: Jahr + Monate; über den Jahreswechsel: beide Jahre, nur diese Monate)
function ueFilterFuer(keys, extra = {}) {
  const jahre = [...new Set(keys.map((k) => k.slice(0, 4)))];
  return { tab: 'buchungen', jahr: jahre.length === 1 ? jahre[0] : jahre[jahre.length - 1], monat: keys.filter((k) => k.slice(0, 4) === jahre[jahre.length - 1]).map((k) => String(+k.slice(5))).join(','), q: '', ...extra };
}

// Kategorien der gewählten Monate (je Monat) mit dem Durchschnitt als Marke
function ueAuswahlKategorien(M, nMax = 8) {
  const sel = M.monate.filter((m) => ueAuswahl.includes(m.k) && m.art !== 'prognose');
  const box = $('#uem-kat');
  if (!sel.length) {
    // nur Prognose: die festen Abbuchungen im Zeitraum
    const von = `${ueAuswahl[0]}-01`, bis = monatsletzter(`${ueAuswahl[ueAuswahl.length - 1]}-01`);
    const l = M.vertraege.map((f) => ({ f, c: faellig(f, von, bis) })).filter((x) => x.c > 0).sort((a, b) => b.c - a.c);
    $('#uem-kat-t').textContent = 'Feste Abbuchungen im Zeitraum';
    $('#uem-kat-leg').innerHTML = `<span class="muted">${eur0(l.reduce((t, x) => t + x.c, 0))} insgesamt</span>`;
    box.innerHTML = l.slice(0, nMax).map(({ f, c }) => `<div class="ue-kz uem-kz"><span class="ue-kz-n">${esc(vertragName(f))}</span><span class="ue-kz-b"><i style="width:${(c / l[0].c) * 100}%"></i></span><span class="ue-kz-w">${eur0(c)}</span><span class="ue-kz-d muted">${esc(f.rh.name)}</span></div>`).join('') || '<div class="leer">Keine festen Abbuchungen.</div>';
    if (nMax > 3 && box.scrollHeight > box.clientHeight + 2) return ueAuswahlKategorien(M, nMax - 1);
    return;
  }
  const n = sel.length, kat = new Map();
  for (const m of sel) for (const [k, v] of m.x.kat) kat.set(k, (kat.get(k) || 0) + v / n);
  const l = [...kat].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const lauf = sel.length === 1 && sel[0].art === 'laeuft';
  $('#uem-kat-t').textContent = `Ausgaben nach Kategorie${n > 1 ? ' · je Monat' : lauf ? ' · bisher' : ''}`;
  $('#uem-kat-leg').innerHTML = '<span><i class="uem-marke"></i>Ø 12 Monate</span>';
  const top = l.slice(0, nMax), rest = l.slice(nMax).reduce((t, [, v]) => t + v, 0);
  const max = Math.max(1, ...top.map(([k, v]) => Math.max(v, M.schnitt.kat.get(k) || 0)));
  box.innerHTML = `<div class="ue-kz uem-kz kopf"><span></span><span></span><span>Betrag</span><span>ggü. Ø</span></div>` + top.map(([k, v]) => {
    const s = M.schnitt.kat.get(k) || 0, d = v - s;
    return `<button class="ue-kz uem-kz" data-uemkat="${esc(k)}" title="${esc(schoen(k))}: ${eur0(v)} · Ø ${eur0(s)} – Klick: Buchungen">
      <span class="ue-kz-n">${esc(schoen(k))}</span>
      <span class="ue-kz-b uem-kz-b"><i style="width:${(v / max) * 100}%"></i>${s ? `<b class="uem-marke-b" style="left:${(s / max) * 100}%"></b>` : ''}</span>
      <span class="ue-kz-w">${eur0(v)}</span>
      <span class="ue-kz-d ${lauf || Math.abs(d) < Math.max(2000, s * 0.05) ? 'muted' : d > 0 ? 'schlecht' : 'gut'}">${!s ? 'neu' : Math.abs(d) < Math.max(2000, s * 0.05) ? '≈ Ø' : `${d > 0 ? '+' : '−'}${eur0(Math.abs(d))}`}</span></button>`;
  }).join('') + (rest > 0 ? `<div class="ue-kz uem-kz rest"><span class="ue-kz-n">Übrige (${l.length - nMax})</span><span class="ue-kz-b"><i style="width:${(rest / max) * 100}%"></i></span><span class="ue-kz-w">${eur0(rest)}</span><span></span></div>` : '');
  if (nMax > 3 && box.scrollHeight > box.clientHeight + 2) return ueAuswahlKategorien(M, nMax - 1);
  box.querySelectorAll('[data-uemkat]').forEach((b) => b.onclick = () => setze(ueFilterFuer(sel.map((m) => m.k), { kat: b.dataset.uemkat, ukat: '' })));
}

// ======================================================================= Durchschnitte und Quoten
// Grundlage sind nur abgeschlossene Monate: Der laufende Monat (Gehalt oft noch nicht da) würde jeden Durchschnitt verfälschen.
const mkey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const tageImMonat = (k) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)).getUTCDate();
function zeitraumMonate(jahre) {
  const mw = monateWahl();
  const k = S.konto ? D.konten[D.kontoIdx.get(S.konto)] : null;
  const lo = (k?.von || D.von).slice(0, 7), hi = (k?.bis || D.bis).slice(0, 7);
  const laufend = D.bis !== monatsletzter(D.bis) ? D.bis.slice(0, 7) : '';
  const out = [];
  let [y, m] = lo.split('-').map(Number);
  for (let key = mkey(y, m); key <= hi; key = mkey(y, m)) {
    if ((!jahre.length || jahre.includes(y)) && (!mw.length || mw.includes(m)) && key !== laufend) out.push(key);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
// Buchungen, die zu einem erkannten Fixkosten-Vertrag gehören (auch deine festen Einzahlungen aufs Gemeinschaftskonto)
function fixIds() {
  if (!D.fixIds) D.fixIds = new Set(fixkostenErkennen().filter((f) => !f.gemeinsam).flatMap((f) => f.rows.map((r) => r.i)));
  return D.fixIds;
}
// Summen über bestimmte Monate; t = Prüffunktion (Konto, Kategorie, Suche, Umbuchungen – ohne Jahr und ohne „nur Ausgaben“)
function schnittWerte(monate, t) {
  const set = new Set(monate), fx = fixIds();
  let ein = 0, aus = 0, fix = 0, spar = 0;
  for (const r of D.rows) {
    if (!set.has(r.d.slice(0, 7)) || !t(r)) continue;
    if (r.art === 'Einnahme') ein += r.c;
    else if (r.art === 'Ausgabe') { aus += r.c; if (fx.has(r.i)) fix += r.c; }
    else if (r.art === 'Sparen') spar += r.c;
  }
  return { n: monate.length, tage: monate.reduce((s, k) => s + tageImMonat(k), 0), ein, aus, erg: ein + aus, fix, spar, monate };
}
const monatsText = (ms) => {
  if (!ms.length) return '';
  const t = (k) => `${MON[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
  return ms.length === 1 ? t(ms[0]) : `${t(ms[0])} – ${t(ms[ms.length - 1])}`;
};
// Vergleichszeiträume: Vorjahr (dieselben Monate ein Jahr früher) und Schnitt der drei Vorjahre – nur bei einem Jahr
function vergleichsMonate(monate, versatz) {
  const v = monate.map((k) => mkey(+k.slice(0, 4) - versatz, +k.slice(5, 7))).filter((k) => k >= D.von.slice(0, 7));
  return v.length === monate.length ? v : [];
}

function durchschnitte() {
  const jw = jahreWahl();
  const conds = parse(S.q);
  const t = pruefer(conds, false, false);
  const monate = zeitraumMonate(jw);
  const box = $('#schnitt');
  if (!monate.length) { box.innerHTML = '<div class="leer">Noch kein abgeschlossener Monat im gewählten Zeitraum.</div>'; $('#h-schnitt').textContent = ''; return null; }
  const a = schnittWerte(monate, t);
  const einJ = new Set(monate.map((k) => k.slice(0, 4))).size === 1;
  const vjM = einJ ? vergleichsMonate(monate, 1) : [];
  const v1 = vjM.length ? schnittWerte(vjM, t) : null;
  const v3m = einJ ? [1, 2, 3].map((x) => vergleichsMonate(monate, x)) : [];
  const v3 = v3m.length && v3m.every((m) => m.length) ? schnittWerte(v3m.flat(), t) : null;
  // ohne einzelnes Jahr: Vergleich mit den letzten 12 abgeschlossenen Monaten
  const l12m = einJ ? [] : zeitraumMonate([]).slice(-12);
  const l12 = l12m.length ? schnittWerte(l12m, t) : null;
  const laufend = D.bis !== monatsletzter(D.bis);
  $('#h-schnitt').textContent = `Ø aus ${a.n} abgeschlossenen ${a.n === 1 ? 'Monat' : 'Monaten'} (${monatsText(monate)})${laufend ? ` · ${MON[+D.bis.slice(5, 7) - 1]} läuft noch und zählt nicht mit` : ''}`;
  const pm = (x, f) => (x && x.n ? f(x) / x.n : null);
  const proz = (z, n) => (n ? (z / n) * 100 : null);
  const pf = (v) => (v == null ? '–' : `${NUM.format(Math.round(v))} %`);
  const diff = (jetzt, vorher, mehrGut, inProzentpunkten) => {
    if (jetzt == null || vorher == null) return '';
    if (inProzentpunkten === 'eur') { const d = jetzt - vorher; return Math.abs(d) >= 100 ? `<span class="${(d > 0) === mehrGut ? 'pos' : 'neg'}">${d > 0 ? '▲ +' : '▼ −'}${eur0(Math.abs(d))}</span>` : '<span class="muted">=</span>'; }
    if (inProzentpunkten) { const d = Math.round(jetzt - vorher); return d ? `<span class="${(d > 0) === mehrGut ? 'pos' : 'neg'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)} Pkt.</span>` : '<span class="muted">=</span>'; }
    if (!vorher) return '';
    const d = Math.round(((Math.abs(jetzt) - Math.abs(vorher)) / Math.abs(vorher)) * 100);
    return d ? `<span class="${(d > 0) === mehrGut ? 'pos' : 'neg'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)} %</span>` : '<span class="muted">=</span>';
  };
  const vgl = (f, mehrGut, fmt, pp = false) => {
    const jetzt = f(a);
    const zeilen = [];
    if (v1) zeilen.push(`<span class="muted">Vorjahr</span> ${fmt(f(v1))} ${diff(jetzt, f(v1), mehrGut, pp)}`);
    if (v3 && !v1) zeilen.push(`<span class="muted">Ø 3 Vorjahre</span> ${fmt(f(v3))}`);   // knapp halten: eine Vergleichszeile
    if (l12) zeilen.push(`<span class="muted">letzte 12 Mon.</span> ${fmt(f(l12))} ${diff(jetzt, f(l12), mehrGut, pp)}`);
    return zeilen.map((z) => `<div class="sv">${z}</div>`).join('');
  };
  const e0 = (c) => (c == null ? '–' : eur0(c));
  const ea = (c) => (c == null ? '–' : eur0(Math.abs(c)));   // Ausgaben als Betrag ohne Minus
  const kachel = (titel, wert, cls_, unter, vergleich, tip) => `<div class="sk" title="${esc(tip)}"><div class="sl">${titel}</div><div class="sw ${cls_}">${wert}</div>${unter ? `<div class="su">${unter}</div>` : ''}${vergleich}</div>`;
  const quote = (x) => proz(x.erg, x.ein), fixq = (x) => proz(-x.fix, -x.aus);
  box.innerHTML = [
    kachel('Ø Einnahmen / Monat', e0(pm(a, (x) => x.ein)), 'pos', '', vgl((x) => pm(x, (y) => y.ein), true, e0), 'Einnahmen geteilt durch die Zahl der abgeschlossenen Monate'),
    kachel('Ø Ausgaben / Monat', ea(pm(a, (x) => x.aus)), 'neg', '', vgl((x) => pm(x, (y) => y.aus), false, ea), 'Ausgaben (ohne Umbuchungen und Sparen) je Monat'),
    kachel('Ø Überschuss / Monat', e0(pm(a, (x) => x.erg)), cls(a.erg), a.erg < 0 ? 'Fehlbetrag – mehr ausgegeben als eingenommen' : 'bleibt im Schnitt jeden Monat übrig', vgl((x) => pm(x, (y) => y.erg), true, e0, 'eur'), 'Einnahmen minus Ausgaben je Monat'),
    kachel('Sparquote', pf(quote(a)), cls(a.erg), 'Anteil der Einnahmen, der übrig bleibt', vgl(quote, true, pf, true), 'Überschuss geteilt durch Einnahmen. Faustregel: mindestens 20 %.'),
    kachel('Ø Ausgaben / Tag', ea(a.tage ? a.aus / a.tage : null), 'neg', `aus ${NUM.format(a.tage)} Tagen`, vgl((x) => (x.tage ? x.aus / x.tage : null), false, ea), 'Ausgaben geteilt durch die Kalendertage der abgeschlossenen Monate'),
    kachel('Fixkosten-Anteil', pf(fixq(a)), '', `der Ausgaben · Ø ${e0(pm(a, (x) => -x.fix))} / Monat${a.ein ? ` · ${pf(proz(-a.fix, a.ein))} der Einnahmen` : ''}`, vgl(fixq, false, pf, true),
      'Regelmäßige Zahlungen (Miete, Unterhalt, Versicherungen, Verträge, Abos) als Anteil an allen Ausgaben im Zeitraum. Deine Überweisungen aufs Gemeinschaftskonto sind Umbuchungen – was von dort ausgegeben wird, zählt hier als Ausgabe.'),
  ].join('');
  return { a, v1, monate, t };
}

// Einnahmen = 100 %: Fixkosten, variable Ausgaben und was übrig bleibt – mit der Faustregel 50-30-20
function wohinDasGeldGeht(x) {
  const box = $('#wohin');
  if (!x || !x.a.ein) { box.innerHTML = '<div class="leer">Keine Einnahmen im gewählten Zeitraum – für diese Aufteilung bitte ohne Filter „nur Ausgaben“ bzw. mit Einnahmen wählen.</div>'; $('#h-wohin').textContent = ''; return; }
  const { a } = x;
  const ein = a.ein, fix = -a.fix, varia = -(a.aus - a.fix), rest = a.erg;
  const p = (c) => (c / ein) * 100;
  const teile = [
    { n: 'Fixkosten', c: fix, farbe: '#2a78d6', ziel: 50, hin: 'höchstens 50 %', ok: p(fix) <= 50, info: 'Miete, Unterhalt, Versicherungen, Verträge, Abos' },
    { n: 'Variable Ausgaben', c: varia, farbe: '#e0602e', ziel: 30, hin: 'höchstens 30 %', ok: p(varia) <= 30, info: 'Einkäufe, Freizeit, Mobilität, Sonstiges' },
    { n: rest >= 0 ? 'Übrig (Überschuss)' : 'Fehlbetrag', c: Math.abs(rest), farbe: rest >= 0 ? '#1a9e6e' : '#b3401a', ziel: 20, hin: 'mindestens 20 %', ok: p(rest) >= 20, info: rest >= 0 ? 'zum Sparen oder als Reserve' : 'mehr ausgegeben als eingenommen' },
  ];
  const breite = Math.max(100, p(fix + varia) + (rest > 0 ? p(rest) : 0));
  $('#h-wohin').textContent = `Einnahmen = 100 % (Ø ${eur0(ein / a.n)} / Monat)`;
  box.innerHTML = `
    <div class="wohin-balken">${teile.filter((t) => t.c > 0 && !(t.n === 'Fehlbetrag')).map((t) => `<i style="width:${(p(t.c) / breite) * 100}%;background:${t.farbe}" title="${esc(t.n)}: ${NUM.format(Math.round(p(t.c)))} %"></i>`).join('')}
      ${rest < 0 ? `<span class="wohin-linie" style="left:${(100 / breite) * 100}%" title="100 % der Einnahmen"></span>` : ''}</div>
    <div class="wohin-skala"><span>0 %</span>${[50, 80, 100].map((v) => { const x = (v / breite) * 100; return `<span style="${x > 94 ? 'right:0;transform:none' : `left:${x}%`}">${v} %</span>`; }).join('')}</div>
    <table class="wohin-tab"><thead><tr><th></th><th class="r">Ø / Monat</th><th class="r">Anteil</th><th>Faustregel 50-30-20</th></tr></thead><tbody>
    ${teile.map((t) => `<tr><td><span class="punkt" style="background:${t.farbe}"></span><b>${esc(t.n)}</b><div class="klein muted">${esc(t.info)}</div></td>
      <td class="r">${eur0(t.c / a.n)}</td><td class="r"><b>${NUM.format(Math.round(p(t.c)))} %</b></td>
      <td class="${t.ok ? 'pos' : 'neg'}">${t.ok ? '✓' : '✗'} ${esc(t.hin)}</td></tr>`).join('')}
    </tbody></table>
    ${a.spar < 0 ? `<p class="klein muted">Zusätzlich auf Spar- und Depotkonten außerhalb der Liste überwiesen: Ø ${eur0(-a.spar / a.n)} / Monat (${NUM.format(Math.round(p(-a.spar)))} % der Einnahmen).</p>` : ''}
    <p class="klein muted">Faustregel: höchstens 50 % für feste Kosten, 30 % für Wünsche und Alltag, mindestens 20 % zum Sparen. Grundlage: ${a.n} abgeschlossene Monate.</p>`;
}

// Ø Einnahmen und Ausgaben je Monat für jedes Jahr, dazu die Sparquote
function jahresschnitt() {
  const conds = parse(S.q);
  const t = pruefer(conds, false, false);
  const alle = zeitraumMonate([]);
  const jahre = [...new Set(alle.map((k) => +k.slice(0, 4)))].slice(-10);
  const w = jahre.map((y) => schnittWerte(alle.filter((k) => +k.slice(0, 4) === y), t));
  const jw = jahreWahl();
  const cE = css('--ein'), cA = css('--aus'), cL = css('--accent');
  const an = (i) => !jw.length || jw.includes(jahre[i]);
  $('#h-jahre').textContent = 'Säule anklicken: Jahr wählen · Linie: Sparquote';
  const o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.plugins.legend = { display: true, position: 'top', align: 'end', labels: { color: css('--text-2'), usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, font: { size: 12 } } };
  o.plugins.tooltip.callbacks = {
    title: (it) => `${jahre[it[0].dataIndex]} – Ø je Monat (${w[it[0].dataIndex].n} Monate)`,
    label: (it) => (it.dataset.yAxisID === 'q' ? ` Sparquote: ${it.raw == null ? '–' : NUM.format(Math.round(it.raw)) + ' %'}` : ` ${it.dataset.label}: ${EUR0.format(it.raw)}`),
    afterBody: (it) => { const x = w[it[0].dataIndex]; return x.n ? [`Überschuss Ø ${eur0(x.erg / x.n)} / Monat`] : []; },
  };
  o.scales = {
    x: { ...achsenStil(), grid: { display: false } },
    y: { ...achsenStil(), beginAtZero: true, ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 5 } },
    q: { position: 'right', grid: { display: false }, border: { display: false }, ticks: { color: cL, font: { size: 11 }, callback: (v) => `${v} %`, maxTicksLimit: 5 } },
  };
  o.onClick = (_, el) => { if (el.length) setze({ jahr: String(jahre[el[0].index]), monat: '' }); };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; };
  o.layout = { padding: { top: 16 } };
  zeichne('c-jahre', { plugins: [saeulenWerteMit({ groesse: 10, linie: (v) => `${NUM.format(Math.round(v))} %` })], type: 'bar', data: { labels: jahre.map(String), datasets: [
    { label: 'Ø Einnahmen', data: w.map((x) => (x.n ? x.ein / x.n / 100 : 0)), backgroundColor: jahre.map((_, i) => alpha(cE, an(i) ? .9 : .45)), hoverBackgroundColor: cE, borderRadius: 4, maxBarThickness: 26, order: 2 },
    { label: 'Ø Ausgaben', data: w.map((x) => (x.n ? -x.aus / x.n / 100 : 0)), backgroundColor: jahre.map((_, i) => alpha(cA, an(i) ? .9 : .45)), hoverBackgroundColor: cA, borderRadius: 4, maxBarThickness: 26, order: 2 },
    { type: 'line', label: 'Sparquote', yAxisID: 'q', data: w.map((x) => (x.ein ? Math.round((x.erg / x.ein) * 1000) / 10 : null)), borderColor: cL, backgroundColor: cL, borderWidth: 2, pointRadius: 3, tension: 0.3, order: 1 },
  ] }, options: o });
}

// Tabelle: je Kategorie Ø pro Monat, Anteil, Summe und Vergleich mit dem Vorjahr
function katSchnitt(x) {
  const box = $('#kat-schnitt');
  if (!x) { box.innerHTML = ''; return; }
  const einMode = S.art === 'ein' || S.kat === 'Einnahmen', unter = !!S.kat;
  const sammeln = (monate) => {
    const set = new Set(monate), m = new Map();
    for (const r of D.rows) {
      if (!set.has(r.d.slice(0, 7)) || !x.t(r) || (einMode ? r.art !== 'Einnahme' : r.art !== 'Ausgabe')) continue;
      const k = unter ? r.ukat || '(ohne Unterkategorie)' : r.kat;
      m.set(k, (m.get(k) || 0) + (einMode ? r.c : -r.c));
    }
    return m;
  };
  const jetzt = sammeln(x.monate), vor = x.v1 ? sammeln(x.v1.monate) : null;
  const n = x.monate.length, nv = x.v1?.n || 0;
  const liste = [...jetzt].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  const summe = liste.reduce((s, [, c]) => s + c, 0);
  $('#t-katschnitt').textContent = `${unter ? `${schoen(S.kat)}: Unterkategorien` : 'Kategorien'} – Anteil und Durchschnitt`;
  $('#h-katschnitt').textContent = `${einMode ? 'Einnahmen' : 'Ausgaben'} · Ø aus ${n} abgeschlossenen Monaten · Zeile anklicken: ${unter ? 'Unterkategorie' : 'Kategorie'} filtern`;
  if (!liste.length) { box.innerHTML = '<div class="leer">Keine Buchungen im gewählten Zeitraum.</div>'; return; }
  const max = liste[0][1];
  if (vor) vor.set('__summe__', [...vor.values()].filter((c) => c > 0).reduce((s, c) => s + c, 0));
  const veraend = (k, c) => {
    if (!vor) return '';
    const alt = (vor.get(k) || 0) / nv, neu = c / n;
    if (!alt) return '<td class="r muted sp-m">neu</td>';
    const d = Math.round(((neu - alt) / alt) * 100);
    const gut = einMode ? d > 0 : d < 0;
    return `<td class="r sp-m ${d ? (gut ? 'pos' : 'neg') : 'muted'}">${d > 0 ? '+' : ''}${d} %</td>`;
  };
  box.innerHTML = `<div class="tab-scroll"><table class="t fix kat-schnitt-t"><thead><tr><th class="erste">${unter ? 'Unterkategorie' : 'Kategorie'}</th>
    <th class="r" style="width:120px">Ø / Monat</th><th style="width:30%">Anteil</th><th class="r sp-m" style="width:120px">Summe</th>
    ${vor ? `<th class="r sp-m" style="width:120px" title="dieselben Monate ein Jahr früher">Ø Vorjahr</th><th class="r sp-m" style="width:100px">Veränderung</th>` : ''}</tr></thead><tbody>
    ${liste.map(([k, c]) => `<tr class="klick" data-kschnitt="${esc(k)}"><td class="erste" title="${esc(schoen(k))}">${esc(schoen(k))}</td><td class="r"><b>${eur0(c / n)}</b></td>
      <td><div class="anteil-zelle"><span class="anteil-balken"><i style="width:${(c / max) * 100}%;background:${css(einMode ? '--ein' : '--aus')}"></i></span><span>${NUM.format(Math.round((c / summe) * 1000) / 10)} %</span></div></td>
      <td class="r sp-m">${eur0(c)}</td>${vor ? `<td class="r sp-m muted">${eur0((vor.get(k) || 0) / nv)}</td>${veraend(k, c)}` : ''}</tr>`).join('')}
    </tbody><tfoot><tr><td class="erste">Summe</td><td class="r">${eur0(summe / n)}</td><td>100 %</td><td class="r sp-m">${eur0(summe)}</td>
    ${vor ? (() => { const altS = vor.get('__summe__'); return `<td class="r sp-m muted">${eur0(altS / nv)}</td>${veraend('__summe__', summe).replace('neu', '–')}`; })() : ''}</tr></tfoot></table></div>`;
  box.querySelectorAll('[data-kschnitt]').forEach((tr) => tr.onclick = () => {
    const k = tr.dataset.kschnitt;
    if (!unter) setze({ kat: k, ukat: '' }); else if (k !== '(ohne Unterkategorie)') setze({ ukat: S.ukat === k ? '' : k });
  });
}

// ======================================================================= Tabellen
function sortiert() {
  const f = S.sort === 'betrag' ? (a, b) => a.c - b.c : S.sort === 'wer' ? (a, b) => (a.g || a.z).localeCompare(b.g || b.z, 'de') : (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.i - b.i);
  const out = F.slice().sort(f);
  if (S.dir < 0) out.reverse();
  return out;
}

function tabBuchungen(conds) {
  const rows = sortiert();
  if (!rows.length) return '<div class="leer">Keine Buchungen gefunden. Suche oder Filter ändern?</div>';
  const w = highlightWords(conds);
  const re = w.length ? new RegExp('(' + w.map(escRe).join('|') + ')', 'gi') : null;
  const mk = (s) => (re ? esc(s).replace(re, '<mark>$1</mark>') : esc(s));
  const pf = (k) => (S.sort === k ? `<span class="pfeil">${S.dir < 0 ? '↓' : '↑'}</span>` : '');
  const kn = (r) => D.konten[r.k].name;
  let h = `<div class="tab-scroll"><table class="t fix"><thead><tr>
    <th class="sort" data-sort="datum" style="width:96px">Datum ${pf('datum')}</th><th class="sort" data-sort="wer">Empfänger / Zweck ${pf('wer')}</th>
    <th class="kat-sp" style="width:190px">Kategorie</th><th class="konto-sp" style="width:180px">Konto</th><th class="sort r" data-sort="betrag" style="width:118px">Betrag ${pf('betrag')}</th></tr></thead><tbody>`;
  for (const r of rows.slice(0, limit)) {
    const auf = offen.has(r.i);
    h += `<tr class="klick${auf ? ' offen' : ''}" data-i="${r.i}"><td class="datum">${dde(r.d)}</td>
      <td><div class="wer">${mk(r.g || r.z || '–')}</div>${r.g && r.z ? `<div class="zweck">${mk(r.z)}</div>` : ''}</td>
      <td class="kat kat-sp">${esc(schoen(r.kat))}<small>${esc(schoen(r.ukat))}</small></td><td class="konto konto-sp">${esc(kn(r))}</td>
      <td class="r betrag ${cls(r.c)}">${eur(r.c)}</td></tr>`;
    if (auf) {
      const dd = [['Verwendungszweck', r.z], ['Kategorie', `${r.kat}${r.ukat ? ' · ' + r.ukat : ''}`], ['Konto', kn(r)], ['Art', r.art],
        ['Vertrag', r.v], ['Tags', r.t], ['Notiz', r.n], ['Steuerkategorie (Buhl)', r.st]].filter(([, v]) => v);
      h += `<tr class="detail"><td colspan="5"><dl>${dd.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        ${r.g ? `<button class="btn sm" data-alle="${esc(r.g)}">Alle Buchungen von „${esc(r.g.length > 40 ? r.g.slice(0, 40) + '…' : r.g)}“</button>` : ''}
        <button class="btn sm" data-nurkat="${esc(r.kat)}">Nur ${esc(r.kat)}</button>
        <label class="st-zuordnen klein">Steuer: <select data-steuer-i="${r.i}">${postenOptionen(steuerPosten(r), true)}</select></label></td></tr>`;
    }
  }
  // Summenzeile über alle Treffer (nicht nur die angezeigten)
  let ein = 0, aus = 0;
  for (const r of rows) { if (r.c > 0) ein += r.c; else aus += r.c; }
  h += `</tbody><tfoot><tr class="summe-zeile"><td class="datum"></td>
    <td><div class="wer">Summe ${rows.length === 1 ? 'der Buchung' : `aller ${NUM.format(rows.length)} Buchungen`}</div>
      <div class="zweck">Eingänge ${eur(ein)} · Ausgänge ${eur(aus)}</div></td>
    <td class="kat-sp"></td><td class="konto-sp"></td><td class="r betrag ${cls(ein + aus)}">${eur(ein + aus)}</td></tr></tfoot></table></div>`;
  if (rows.length > limit) h += `<div class="mehr">${NUM.format(limit)} von ${NUM.format(rows.length)} angezeigt <button class="btn sm" id="mehr">Weitere ${NUM.format(Math.min(500, rows.length - limit))} anzeigen</button></div>`;
  else if (rows.length > 20) h += `<div class="mehr">Alle ${NUM.format(rows.length)} Buchungen angezeigt</div>`;
  return h;
}

// maxSpalten: passen nicht alle Jahre (Monate) auf den Bildschirm, werden die ältesten zu einer Spalte zusammengefasst
function pivotDaten(maxSpalten = Infinity) {
  const jahr = proMonat(), unter = !!S.kat;
  let cols;
  const jw = jahreWahl();
  if (jahr) cols = MON.map((_, i) => i + 1);
  else if (jw.length > 1) cols = [...jw];
  else { cols = []; const a = F.length ? F[0].y : D.jahre[0], b = F.length ? F[F.length - 1].y : a; for (let y = a; y <= b; y++) cols.push(y); }
  const anzahl = cols.length;
  let diff = !jahr && jw.length > 1;  // Vergleich: erstes → letztes gewähltes Jahr
  const pos = new Map(cols.map((c, i) => [c, i]));
  if (cols.length > maxSpalten) {
    const k = cols.length - Math.max(1, maxSpalten - 1);
    const zus = cols.slice(0, k);
    zus.forEach((c) => pos.set(c, 0));
    cols.slice(k).forEach((c, i) => pos.set(c, i + 1));
    cols = [jahr ? `${MON[zus[0] - 1]}–${MON[zus[zus.length - 1] - 1]}` : `bis ${zus[zus.length - 1]}`, ...cols.slice(k)];
  }
  diff = diff ? [0, cols.length - 1] : null;
  const m = new Map();
  for (const r of F) {
    const k = unter ? r.ukat || '(ohne Unterkategorie)' : r.kat;
    let row = m.get(k);
    if (!row) m.set(k, (row = { key: k, v: cols.map(() => 0), sum: 0 }));
    const i = pos.get(jahr ? r.m : r.y);
    row.v[i] += r.c; row.sum += r.c;
  }
  const order = (k) => (k === 'Einnahmen' ? 0 : k === 'Sparen' ? 2 : k === 'Umbuchung' ? 3 : 1);
  const rows = [...m.values()].sort((a, b) => order(a.key) - order(b.key) || a.sum - b.sum);
  const sums = cols.map((_, i) => rows.reduce((s, r) => s + r.v[i], 0));
  const label = (c) => (typeof c === 'string' ? c : jahr ? MON[c - 1] : String(c));
  // Vorjahr (gleicher Zeitraum) je Zeile, nur in der Monatsansicht eines Jahres
  const vj = jahr && V ? new Map() : null;
  if (vj) {
    for (const r of V.rows) { const k = unter ? r.ukat || '(ohne Unterkategorie)' : r.kat; vj.set(k, (vj.get(k) || 0) + r.c); }
    for (const k of vj.keys()) if (!m.has(k)) rows.push({ key: k, v: cols.map(() => 0), sum: 0 });
    rows.sort((a, b) => order(a.key) - order(b.key) || a.sum - b.sum);
  }
  return { jahr, unter, cols, label, rows, sums, vj, anzahl, diff, vjTotal: vj ? [...vj.values()].reduce((a, b) => a + b, 0) : 0, total: rows.reduce((s, r) => s + r.sum, 0) };
}

// Passt immer in die Breite: erst normale Beträge, sonst in Tsd. €, sonst ältere Spalten zusammengefasst.
// Auf dem Handy nur die Summe als Zusatzspalte (Ø und Vorjahr stehen im Excel-Download).
function tabUebersicht() {
  const breite = $('#tab-inhalt').clientWidth || 1200;
  const schmal = breite < 700;
  const erste = schmal ? 88 : 170;
  let p = pivotDaten();
  if (!p.rows.length) return '<div class="leer">Keine Buchungen gefunden.</div>';
  // Im Jahresvergleich auf dem Handy: gewählte Jahre + Veränderung, ohne Summe
  const ohneSumme = schmal && !!p.diff;
  const extra = schmal ? 1 : 2 + (p.vj ? 2 : 0) + (p.diff ? 1 : 0);
  const platz = (w) => Math.floor((breite - erste - 16 - extra * w * 1.3) / w);
  // Stufen: „-15.760 €“ → „-15.760“ (in €) → „-15,8“ (in Tsd. €) → ältere Spalten zusammenfassen
  let stufe = 0;
  if (p.cols.length > platz(86)) stufe = 1;
  if (stufe && p.cols.length > platz(62)) stufe = 2;
  if (stufe === 2 && p.cols.length > platz(50) && !p.diff) p = pivotDaten(Math.max(1, platz(50)));
  const ew = `style="width:${Math.round([86, 62, 50][stufe] * 1.3)}px"`;  // Summe, Ø, Vorjahr etwas breiter
  const kompakt = stufe > 0;
  const n = p.anzahl;
  const GANZ = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
  const f = stufe === 2 ? (c) => (c / 100000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : stufe === 1 ? (c) => GANZ.format(Math.round(c / 100)) : eur0;
  const z = (c, extraCls = '') => (c ? `<td class="r ${cls(c)} ${extraCls}" title="${eur(c)}">${f(c)}</td>` : `<td class="r muted ${extraCls}">–</td>`);
  // Wärmekarte: Ausgaben orange, Einnahmen grün – je kräftiger, desto größer
  const NEUTRAL = new Set(['Einnahmen', 'Umbuchung', 'Sparen']);
  const maxNeg = Math.max(1, ...p.rows.filter((r) => !NEUTRAL.has(r.key)).flatMap((r) => r.v.filter((c) => c < 0).map((c) => -c)));
  const maxPos = Math.max(1, ...p.rows.flatMap((r) => r.v.filter((c) => c > 0)));
  const zw = (c) => {
    if (!c) return z(c);
    const a = c < 0 ? Math.min(1, -c / maxNeg) : Math.min(1, c / maxPos);
    return `<td class="r ${cls(c)} warm" style="--w:${(0.04 + a * 0.36).toFixed(3)}" title="${eur(c)}">${f(c)}</td>`;
  };
  const vjZellen = (jetzt, vorher) => (p.vj && !schmal ? `${z(vorher, 'vj')}<td class="r ${cls(jetzt - vorher)}" title="${eur(jetzt - vorher)}">${jetzt - vorher ? (jetzt - vorher > 0 ? '+' : '') + f(jetzt - vorher) : '–'}</td>` : '');
  const avg = (c) => (schmal ? '' : z(c / n));
  const dz = (v) => (p.diff ? (() => { const d = v[p.diff[1]] - v[p.diff[0]]; return `<td class="r ${cls(d)} vj" title="${eur(d)}">${d ? (d > 0 ? '+' : '') + f(d) : '–'}</td>`; })() : '');
  let h = katEinsicht(p) + `<div class="tab-scroll"><table class="t klein fix pivot" style="width:${Math.min(breite, erste + (p.cols.length + extra) * 130)}px"><thead><tr>
    <th class="erste" style="width:${erste}px">${p.unter ? 'Unterkategorie' : 'Kategorie'}${kompakt ? `<small class="muted"> in ${stufe === 2 ? 'Tsd. ' : ''}€</small>` : ''}</th>
    ${p.cols.map((c) => `<th class="r${typeof c === 'number' ? ' sort' : ''}"${typeof c === 'number' ? ` data-spalte="${c}" title="${p.jahr ? 'Monat' : 'Jahr'} filtern"` : ' title="zusammengefasst"'}>${p.label(c)}</th>`).join('')}
    ${ohneSumme ? '' : `<th class="r" ${ew}>Summe</th>`}${schmal ? '' : `<th class="r" ${ew} title="Durchschnitt je ${p.jahr ? 'Monat' : 'Jahr'}">Ø ${p.jahr ? 'Mon.' : 'Jahr'}</th>`}
    ${p.diff ? `<th class="r vj" ${ew} title="Veränderung ${p.cols[p.diff[1]]} gegenüber ${p.cols[p.diff[0]]}">± ${String(p.cols[p.diff[0]]).slice(2)}→${String(p.cols[p.diff[1]]).slice(2)}</th>` : ''}
    ${p.vj && !schmal ? `<th class="r vj" ${ew} title="Gleicher Zeitraum ein Jahr früher">${esc(V.label)}</th><th class="r" ${ew} title="Veränderung gegenüber ${esc(V.label)}">± Vorj.</th>` : ''}</tr></thead><tbody>`;
  for (const r of p.rows) {
    h += `<tr class="klick" data-zeile="${esc(r.key)}"><td class="erste" title="${esc(schoen(r.key))}">${esc(schoen(r.key))}</td>${r.v.map((c) => zw(c)).join('')}
      ${ohneSumme ? '' : z(r.sum, 'fett')}${avg(r.sum)}${dz(r.v)}${vjZellen(r.sum, p.vj?.get(r.key) || 0)}</tr>`;
  }
  h += `</tbody><tfoot><tr><td class="erste">Ergebnis</td>${p.sums.map((c) => z(c)).join('')}${ohneSumme ? '' : z(p.total)}${avg(p.total)}${dz(p.sums)}${vjZellen(p.total, p.vjTotal)}</tr></tfoot></table></div>`;
  return h;
}

// Ein Satz über der Tabelle: größter Posten, stärkster Anstieg und Rückgang gegenüber dem Vorjahr
function katEinsicht(p) {
  const aus = p.rows.filter((r) => !['Einnahmen', 'Umbuchung', 'Sparen'].includes(r.key) && r.sum < 0);
  if (!aus.length) return '';
  const ges = aus.reduce((t, r) => t + r.sum, 0);
  const gross = [...aus].sort((a, b) => a.sum - b.sum)[0];
  const teile = [`Größter Posten: <b>${esc(schoen(gross.key))}</b> mit ${eur0(-gross.sum)} (${Math.round((gross.sum / ges) * 100)} % der Ausgaben)`];
  if (p.vj) {
    const d = aus.map((r) => ({ r, d: -r.sum + (p.vj.get(r.key) || 0) })).filter((x) => Math.abs(x.d) >= 10000);
    const hoch = [...d].sort((a, b) => b.d - a.d)[0], runter = [...d].sort((a, b) => a.d - b.d)[0];
    if (hoch?.d > 0) teile.push(`am stärksten gestiegen: <b>${esc(schoen(hoch.r.key))}</b> <span class="neg">+${eur0(hoch.d)}</span>`);
    if (runter?.d < 0) teile.push(`am stärksten gesunken: <b>${esc(schoen(runter.r.key))}</b> <span class="pos">−${eur0(-runter.d)}</span> ggü. ${esc(V.label)}`);
  }
  return `<div class="kat-einsicht">${teile.join(' · ')}<span class="kat-skala muted"><i></i>klein → groß</span></div>`;
}

// Stichtag: selbst gewählt, sonst Ende des gewählten Jahres/Monats, sonst der letzte Datenstand
function stichtag() {
  if (S.stichtag) return S.stichtag;
  let d = D.bis;
  const jw = jahreWahl();
  const mw = monateWahl();
  if (jw.length) { const y = jw[jw.length - 1]; d = mw.length ? new Date(Date.UTC(y, mw[mw.length - 1], 0)).toISOString().slice(0, 10) : `${y}-12-31`; }
  return d > D.bis ? D.bis : d;
}

// Je Konto: Buchungen/Einnahmen/Ausgaben im Filter und Kontostand am Stichtag
function kontenDaten() {
  const tag = stichtag();
  const stand = kontostaende(D, tag);
  const m = D.konten.map((k, i) => ({ k, n: 0, ein: 0, aus: 0, st: stand[i] }));
  for (const r of F) { const x = m[r.k]; x.n++; if (r.art === 'Einnahme') x.ein += r.c; else if (r.art === 'Ausgabe') x.aus += r.c; }
  const konto = S.konto ? D.kontoIdx.get(S.konto) : -1;
  // Alle Konten, die es am Stichtag gab; ein geschlossenes Konto ohne Geld und ohne Buchungen im Filter fällt weg
  return m.filter((x, i) => (konto === -1 ? !fremd(x.k) : i === konto) && !['nicht_eroeffnet', 'geschlossen'].includes(x.st.status));
}

// Gemeinsame Konten mit Kathrin: nur zur Information – bei dir zählen nur deine Einzahlungen
function gemeinsamKontenHtml(tag) {
  if (S.konto) return '';
  const k = kontostaende(D, tag).filter((x) => x.k.gemeinsam && !['nicht_eroeffnet', 'geschlossen'].includes(x.status));
  if (!k.length) return '';
  const summe = k.reduce((t, x) => t + (x.c || 0), 0);
  return `<details class="eingang kinder-konten"><summary><b>Gemeinsame Konten mit Kathrin</b> <span class="muted">· ${k.length} Konten · zusammen ${eur(summe)} · zählen nicht zu deinen Finanzen</span></summary>
    <p class="muted klein">Bei dir zählen nur deine Einzahlungen dorthin – als Ausgabe in der Kategorie „Gemeinschaftskonto“. Was von dort bezahlt wird (Einkäufe, akf Bank …) und was Kathrin einzahlt, steht nicht in deinen Summen. Zeile anklicken: Buchungen des Kontos.</p>
    <div class="tab-scroll"><table class="t fix"><thead><tr><th class="erste">Konto</th><th class="r" style="width:150px">Stand ${dde(tag)}</th><th class="sp-m" style="width:230px">Daten</th></tr></thead><tbody>
    ${k.map((x) => `<tr class="klick" data-konto="${esc(x.k.name)}"><td class="erste">${esc(x.k.name)}</td><td class="r">${x.c == null ? '<span class="muted">unbekannt</span>' : eur(x.c)}</td><td class="klein sp-m">ab ${dde(x.k.von)}</td></tr>`).join('')}
    </tbody></table></div></details>`;
}

// Konten der Kinder: nur zur Information, zählen in keiner Summe
function kinderKontenHtml(tag) {
  if (S.konto) return '';
  const stand = kontostaende(D, tag);
  const k = stand.filter((x) => x.k.kind && !['nicht_eroeffnet', 'geschlossen'].includes(x.status));
  if (!k.length) return '';
  return `<details class="eingang kinder-konten"><summary><b>Konten der Kinder</b> <span class="muted">· ${k.length} Konten · zählen nicht zu deinen Finanzen (nicht in Summen, Durchschnitten und Grafiken)</span></summary>
    <p class="muted klein">Was du den Kindern überweist (Taschengeld, „Sparen Leo/Mara“, Geschenke), ist bei dir eine Ausgabe in der Kategorie Kinder; Erstattungen von Auslagen sind Einnahmen; Darlehen bleiben neutral. Zeile anklicken: Buchungen des Kontos.</p>
    <div class="tab-scroll"><table class="t fix"><thead><tr><th class="erste">Konto</th><th class="r" style="width:150px">Stand ${dde(tag)}</th><th class="sp-m" style="width:230px">Daten</th></tr></thead><tbody>
    ${k.map((x) => `<tr class="klick" data-konto="${esc(x.k.name)}"><td class="erste">${esc(x.k.name)}</td><td class="r">${x.c == null ? '<span class="muted">unbekannt</span>' : eur(x.c)}</td><td class="klein sp-m">ab ${dde(x.k.von)}</td></tr>`).join('')}
    </tbody></table></div></details>`;
}

function tabKonten() {
  const tag = stichtag();
  const alle = kontenDaten();
  const unbekannt = alle.filter((x) => x.st.status === 'unbekannt');
  const m = alle.filter((x) => x.st.status !== 'unbekannt');
  const vj = +D.bis.slice(0, 4) - 1;
  const monatsende = (() => { const d = new Date(Date.UTC(+D.bis.slice(0, 4), +D.bis.slice(5, 7) - 1, 0)); return d.toISOString().slice(0, 10); })();
  const schnell = [[D.bis, `Aktuell · ${dde(D.bis).slice(0, 6)}`], [monatsende, 'Ende Vormonat'], [`${vj}-12-31`, `31.12.${vj}`], [`${vj - 1}-12-31`, `31.12.${vj - 1}`]];
  const bekannt = m.filter((x) => x.st.c != null);
  const saldo = bekannt.reduce((s, x) => s + x.st.c, 0);
  const ohne = m.length - bekannt.length;
  let h = `<div class="konten-kopf"><div class="stichtag"><label for="stichtag">Kontostände am</label>
      <input type="date" id="stichtag" value="${tag}" min="${D.von}" max="${D.bis}">
      <div class="seg">${schnell.map(([d, t]) => `<button class="${d === tag ? 'an' : ''}" data-st="${d}">${t}</button>`).join('')}</div></div>
    <div class="muted klein">Stand am Ende des Tages, vom Bank-Kontostand zurückgerechnet.${S.stichtag ? '' : S.jahr ? ' Ohne eigene Wahl: Ende des gewählten Zeitraums.' : ''}
      Buchungen, Einnahmen und Ausgaben in der Tabelle folgen den Filtern oben.</div></div>`;
  const ohneDaten = unbekannt.length ? `<div class="muted klein st-hinweis">Für diesen Tag noch ohne Daten: ${unbekannt.map((x) => `${esc(x.k.name)} (ab ${dde(x.k.von)})`).join(', ')}.</div>` : '';
  if (!m.length) { kontenGrafik = null; return h + '<div class="leer">Am Stichtag gab es keine passenden Konten.</div>' + ohneDaten + eingangHtml(); }
  // Verteilung: die größten Guthaben, Rest zusammengefasst (gleiche Farben in Ring und Legende)
  let vert = bekannt.filter((x) => x.st.c > 0).sort((a, b) => b.st.c - a.st.c).map((x) => ({ name: x.k.name, c: x.st.c }));
  if (vert.length > 7) vert = [...vert.slice(0, 6), { name: `Übrige (${vert.length - 6})`, c: vert.slice(6).reduce((t, x) => t + x.c, 0) }];
  const vSumme = vert.reduce((t, x) => t + x.c, 0);
  kontenGrafik = { tag, vert };
  const nurK = S.konto ? D.kontoIdx.get(S.konto) : -1;
  const summeAm = (d) => (d < D.von ? null : kontostaende(D, d).filter((x) => (nurK === -1 ? !fremd(x.k) : x.i === nurK) && x.c != null && x.status !== 'unbekannt').reduce((t, x) => t + x.c, 0));
  const jb = `${+tag.slice(0, 4) - 1}-12-31`, vor = `${+tag.slice(0, 4) - 1}${tag.slice(4)}`;
  const delta = (d, t) => { const v = summeAm(d); if (v == null) return ''; const x = saldo - v; return `<div class="kh-d"><span class="muted">${t}</span> <b class="${cls(x)}">${x >= 0 ? '+' : '−'}${eur0(Math.abs(x))}</b></div>`; };
  h += `<div class="konten-held"><div class="kh-haupt"><span class="muted">${nurK === -1 ? 'Auf deinen Konten' : esc(S.konto)} am ${dde(tag)}</span><b class="${saldo < 0 ? 'neg' : ''}">${eur0(saldo)}</b></div>
    ${tag.slice(5) !== '12-31' ? delta(jb, `seit 31.12.${jb.slice(0, 4)}`) : ''}${delta(vor, `ggü. ${dde(vor)}`)}
    <div class="kh-d muted klein">ohne Depot${nurK === -1 ? ', ohne die gemeinsamen Konten und die Konten der Kinder' : ''}</div></div>`;
  h += `<div class="konten-grafiken">
      <div class="kg"><div class="fix-grafik-t">Summe der Kontostände je Monatsende <span class="muted">· Punkt anklicken = Stichtag</span></div><div class="kg-c"><canvas id="c-konten-verlauf"></canvas></div></div>
      <div class="kg kg-vert"><div class="fix-grafik-t">Verteilung der Guthaben am ${dde(tag)}</div>
        <div class="kg-vert-inhalt"><div class="kg-ring"><canvas id="c-konten-vert"></canvas><div class="fix-ring-mitte"><b>${eur0(vSumme)}</b><span>Guthaben</span></div></div>
          <div class="kg-leg">${vert.map((x, i) => `<button class="kg-leg-z" ${x.name.startsWith('Übrige') ? 'disabled' : `data-konto="${esc(x.name)}"`} title="${esc(x.name)}"><span class="punkt" style="background:${ART_FARBEN[i % ART_FARBEN.length]}"></span><span class="name">${esc(x.name)}</span><span class="betrag">${eur0(x.c)}</span><span class="anteil">${vSumme ? Math.round((x.c * 100) / vSumme) : 0} %</span></button>`).join('')}</div></div></div>
    </div>`;
  h += `<div class="tab-scroll"><table class="t fix"><thead><tr><th class="erste">Konto</th><th class="r sp-m" style="width:95px">Buchungen</th><th class="r sp-m" style="width:118px">Einnahmen</th><th class="r sp-m" style="width:118px">Ausgaben</th>
    <th class="r" style="width:150px">Stand ${dde(tag)}</th><th class="sp-m" style="width:230px">Daten</th></tr></thead><tbody>`;
  for (const x of m) {
    const k = x.k, st = x.st;
    const daten = k.vollstaendig ? `<span class="ok" title="Alle Buchungen seit Kontoeröffnung vorhanden – bewiesen mit dem Kontostand der Bank">✓ lückenlos</span> seit ${dde(k.von)}`
      : `ab ${dde(k.von)}${k.saldo == null ? ` bis ${dde(k.bis)}` : ''}`;
    const zusatz = { geschaetzt: 'geschätzt', ungefaehr: `± ${eur(Math.round((st.abw || 0) * 100))}` }[st.status];
    const wert = st.status === 'unbekannt' ? `<span class="muted" title="${STATUS_TEXT.unbekannt}">unbekannt</span><br><small class="muted">Daten erst ab ${dde(k.von)}</small>`
      : st.status === 'unsicher' ? `<span class="muted" title="${STATUS_TEXT.unsicher}">nicht berechenbar</span><br><small class="muted">Stand heute: ${eur(Math.round(k.saldo * 100))}</small>`
        : `${zusatz ? '≈ ' : ''}${eur(st.c)}${zusatz ? `<br><small class="muted" title="${STATUS_TEXT[st.status]}">${zusatz}</small>` : ''}`;
    h += `<tr class="klick" data-konto="${esc(k.name)}"><td class="erste">${esc(k.name)}</td><td class="r sp-m">${NUM.format(x.n)}</td>
      <td class="r pos sp-m">${x.ein ? eur0(x.ein) : '–'}</td><td class="r neg sp-m">${x.aus ? eur0(x.aus) : '–'}</td>
      <td class="r ${st.c < 0 ? 'neg' : ''}"><b>${wert}</b></td><td class="klein sp-m">${daten}</td></tr>`;
  }
  h += `</tbody><tfoot><tr><td class="erste">Summe</td><td class="r sp-m">${NUM.format(m.reduce((s, x) => s + x.n, 0))}</td>
    <td class="r pos sp-m">${eur0(m.reduce((s, x) => s + x.ein, 0))}</td><td class="r neg sp-m">${eur0(m.reduce((s, x) => s + x.aus, 0))}</td>
    <td class="r">${eur(saldo)}</td><td class="klein muted sp-m">ohne Depot${ohne ? `, ohne ${m.filter((x) => x.st.c == null).map((x) => esc(x.k.name)).join(', ')}` : ''}</td></tr></tfoot></table></div>${ohneDaten}`;
  return h + gemeinsamKontenHtml(tag) + kinderKontenHtml(tag) + eingangHtml();
}

// Grafiken im Reiter Konten: Summe der Kontostände je Monatsende (36 Monate) und Verteilung am Stichtag
let kontenGrafik = null;
function kontenGrafikZeichnen() {
  if (!kontenGrafik || !$('#c-konten-verlauf')) return;
  const nur = S.konto ? D.kontoIdx.get(S.konto) : -1;
  const tage = [];
  let [y, mo] = D.bis.slice(0, 7).split('-').map(Number);
  for (let i = 0; i < 36; i++) {
    const d = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    tage.unshift(d > D.bis ? D.bis : d);
    if (--mo === 0) { mo = 12; y--; }
  }
  const werte = tage.map((d) => kontostaende(D, d).filter((x) => (nur === -1 ? !fremd(x.k) : x.i === nur) && x.c != null && x.status !== 'unbekannt').reduce((t, x) => t + x.c, 0) / 100);
  const c = css('--accent');
  const o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.plugins.tooltip.callbacks = { title: (it) => `Stand ${dde(tage[it[0].dataIndex])}`, label: (it) => ` ${nur === -1 ? 'Summe aller Konten' : S.konto}: ${EUR0.format(it.raw)}` };
  o.scales = {
    x: { ...achsenStil(), grid: { display: false }, ticks: { ...achsenStil().ticks, maxRotation: 0, autoSkip: false, callback: (_, i) => { const m = tage[i].slice(5, 7); return m === '01' ? tage[i].slice(0, 4) : m === '07' ? MON[6] : ''; } } },
    y: { ...achsenStil(), ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 5 } },
  };
  o.onClick = (_, el) => { if (el.length) setze({ stichtag: tage[el[0].index] }); };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; };
  zeichne('c-konten-verlauf', { type: 'line', data: { labels: tage, datasets: [{ data: werte, borderColor: c, backgroundColor: alpha(c, .12), fill: 'origin', tension: 0.25, borderWidth: 2,
    pointRadius: tage.map((d) => (d === kontenGrafik.tag ? 5 : 0)), pointBackgroundColor: c, pointHoverRadius: 5 }] }, options: o });
  const l = kontenGrafik.vert;
  const summe = l.reduce((t, x) => t + x.c, 0);
  zeichne('c-konten-vert', {
    type: 'doughnut',
    data: { labels: l.map((x) => x.name), datasets: [{ data: l.map((x) => x.c / 100), backgroundColor: l.map((_, i) => ART_FARBEN[i % ART_FARBEN.length]), borderWidth: 0, spacing: 2, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '68%', animation: { duration: 250 },
      plugins: { legend: { display: false }, tooltip: { ...basis().plugins.tooltip, callbacks: { label: (it) => ` ${it.label}: ${EUR0.format(it.raw)} · ${summe ? Math.round((it.raw * 10000) / summe) : 0} %` } } },
      onClick: (_, el) => { if (el.length && !l[el[0].index].name.startsWith('Übrige')) setze({ konto: l[el[0].index].name, tab: 'buchungen' }); },
      onHover: (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; } },
  });
}

// Dateien im Eingang: was erkannt, übernommen und als doppelt erkannt wurde (je Datei zusammengefasst)
function eingangHtml() {
  const e = D.j.eingang;
  const hilfe = `Neue Kontodaten – Finanzguru-Export, WISO/Buhl-Buchungsliste, Umsätze der Bank als CSV oder PDF, andere Excel-/CSV-Tabellen –
    einfach in Google Drive in <b>10 Finanzen › Eingang</b> legen, auch vom Handy. Der PC prüft alle 30 Minuten, rechnet Doppeltes heraus
    (auch wenn du denselben Zeitraum mehrmals schickst, z. B. Mitte und Ende des Monats) und aktualisiert die App. Übernommene Dateien wandern nach <i>Eingang › verarbeitet</i>.`;
  if (!e?.dateien?.length) return `<details class="eingang"><summary><b>Dateien im Eingang</b> <span class="muted">· so kommen neue Daten in die App</span></summary><p class="muted klein">${hilfe}</p></details>`;
  const je = new Map();
  for (const b of e.dateien) {
    if (!je.has(b.datei)) je.set(b.datei, { ...b, konten: new Set(), stati: new Set(), ok: true, gelesen: 0, neu: 0, doppelt: 0, von: b.von, bis: b.bis });
    const x = je.get(b.datei);
    if (b.konto) x.konten.add(b.konto);
    x.stati.add(b.status); x.ok = x.ok && b.ok !== false;
    x.gelesen += b.gelesen || 0; x.neu += b.neu || 0; x.doppelt += b.doppelt || 0;
    const iso = (t) => (t ? t.split('.').reverse().join('-') : '');
    if (b.von && (!x.von || iso(b.von) < iso(x.von))) x.von = b.von;
    if (b.bis && (!x.bis || iso(b.bis) > iso(x.bis))) x.bis = b.bis;
  }
  const liste = [...je.values()].sort((a, b) => (a.ok - b.ok) || (/verarbeitet/.test(a.datei) - /verarbeitet/.test(b.datei)) || a.datei.localeCompare(b.datei, 'de'));
  const offen = liste.filter((x) => !x.ok).length;
  const name = (d) => d.replace(/^Eingang[\\/](verarbeitet[\\/])?/, '');
  const status = (x) => (x.stati.size > 2 ? [...x.stati].filter((t) => !/schon in der Liste/.test(t)).join(' · ') || 'alles schon in der Liste' : [...x.stati].join(' · '));
  return `<details class="eingang"${offen ? ' open' : ''}><summary><b>Dateien im Eingang</b> <span class="muted">· ${liste.length} Dateien · zuletzt verarbeitet ${dde(e.erstellt.slice(0, 10))}, ${e.erstellt.slice(11, 16)} Uhr</span>${offen ? ` · <span class="neg">${offen} nicht übernommen</span>` : ''}</summary>
    <p class="muted klein">${hilfe}</p>
    <div class="tab-scroll"><table class="t fix eingang-t"><thead><tr><th class="erste">Datei</th><th class="sp-m" style="width:150px">erkannt als</th><th class="sp-m" style="width:170px">Konto</th>
      <th class="sp-m" style="width:170px">Zeitraum</th><th class="r" style="width:72px" title="Buchungen in der Datei">gelesen</th><th class="r" style="width:60px" title="neu in die Liste übernommen">neu</th>
      <th class="r sp-m" style="width:72px" title="schon in der Liste – nicht doppelt gezählt">doppelt</th></tr></thead><tbody>
    ${liste.map((x) => `<tr class="${x.ok ? '' : 'eingang-fehler'}"><td class="erste" title="${esc(x.datei)}"><div class="ell">${esc(name(x.datei))}</div><div class="klein ${x.ok ? 'muted' : 'neg'} ell" title="${esc(status(x))}">${esc(status(x))}</div></td>
      <td class="sp-m klein">${esc(x.art)}</td><td class="sp-m klein ell" title="${esc([...x.konten].join(', '))}">${esc([...x.konten].join(', ') || '–')}</td>
      <td class="sp-m klein">${x.von ? `${esc(x.von)} – ${esc(x.bis)}` : '–'}</td><td class="r">${NUM.format(x.gelesen)}</td>
      <td class="r ${x.neu ? 'pos' : 'muted'}"><b>${NUM.format(x.neu)}</b></td><td class="r sp-m muted">${NUM.format(x.doppelt)}</td></tr>`).join('')}
    </tbody></table></div></details>`;
}

const TITEL = {
  buchungen: () => ['Buchungen', `${S.konto && D.konten[D.kontoIdx.get(S.konto)]?.kind ? 'Konto eines Kindes – zählt nicht zu deinen Finanzen (Summen 0 €) · ' : S.konto && D.konten[D.kontoIdx.get(S.konto)]?.gemeinsam ? 'Gemeinsames Konto – zählt nicht zu deinen Finanzen, nur deine Einzahlungen (Summen 0 €) · ' : ''}${NUM.format(F.length)} Treffer · Zeile anklicken für Details · Spaltenkopf: sortieren`],
  uebersicht: () => ['Kategorien', 'Zeile anklicken: Unterkategorien · Spaltenkopf: Monat bzw. Jahr filtern'],
  fix: () => ['Fixkosten und Abos', 'regelmäßige Zahlungen, automatisch erkannt'],
  konten: () => ['Konten', 'Zeile anklicken: Buchungen des Kontos'],
  steuer: () => ['Steuer', 'steuerlich relevante Buchungen je Steuerjahr'],
};
function tabelle(conds) {
  if (S.tab === 'start' || S.tab === 'kennzahlen') return;
  const el = $('#tab-inhalt');
  const [ti, hi] = (TITEL[S.tab] || TITEL.buchungen)();
  $('#t-tabelle').textContent = ti; $('#h-tabelle').textContent = hi;
  if (S.tab === 'steuer') {
    steuerZeigen(el, { einJahr, toast, setze: (p) => setze(p), neuZeichnen: () => tabelle(conds) });
    $('.dl').hidden = true;
    return;
  }
  $('.dl').hidden = false;
  el.innerHTML = S.tab === 'uebersicht' ? tabUebersicht() : S.tab === 'konten' ? tabKonten() : S.tab === 'fix' ? tabFixkosten(conds) : tabBuchungen(conds);
  el.querySelectorAll('th[data-sort]').forEach((th) => th.onclick = () => {
    const k = th.dataset.sort;
    S.dir = S.sort === k ? -S.dir : k === 'wer' ? 1 : -1; S.sort = k; tabelle(conds);
  });
  el.querySelectorAll('tr[data-i]').forEach((tr) => tr.onclick = () => {
    const i = +tr.dataset.i; offen.has(i) ? offen.delete(i) : offen.add(i); tabelle(conds);
  });
  el.querySelectorAll('[data-alle]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); setze({ q: `"${b.dataset.alle}"` }); });
  el.querySelectorAll('[data-nurkat]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); setze({ kat: b.dataset.nurkat, ukat: '' }); });
  el.querySelectorAll('[data-steuer-i]').forEach((s) => {
    s.onclick = (e) => e.stopPropagation();
    s.onchange = () => { steuerZuordnen(D.rows[+s.dataset.steuerI], s.value); toast('Für die Steuer gespeichert – zu sehen im Reiter „Steuer“.'); };
  });
  $('#mehr')?.addEventListener('click', () => { limit += 500; tabelle(conds); });
  el.querySelectorAll('tr[data-zeile]').forEach((tr) => tr.onclick = () => {
    const k = tr.dataset.zeile;
    if (!S.kat) setze({ kat: k, ukat: '' }); else if (k !== '(ohne Unterkategorie)') setze({ ukat: S.ukat === k ? '' : k });
  });
  el.querySelectorAll('th[data-spalte]').forEach((th) => th.onclick = () => {
    const c = th.dataset.spalte, j = proMonat();
    if (j) setze({ jahr: String(j), monat: S.monat === c ? '' : c }); else setze({ jahr: c });
  });
  el.querySelectorAll('[data-fixansicht]').forEach((b) => b.onclick = () => { fixAnsicht = b.dataset.fixansicht; tabelle(conds); });
  el.querySelectorAll('[data-fixbezug]').forEach((b) => b.onclick = () => { fixBezug = b.dataset.fixbezug; try { localStorage.setItem('fd.fixbezug', fixBezug); } catch {} tabelle(conds); });
  el.querySelectorAll('.fix-zeile[data-fix]').forEach((tr) => tr.onclick = () => setze({ q: `"${tr.dataset.fix}"${tr.dataset.sig ? ' ' + tr.dataset.sig : ''}`, tab: 'buchungen' }));
  el.querySelectorAll('.fix-kopfzeile[data-fixgruppe]').forEach((b) => b.onclick = () => fixGruppeUmschalten(b.dataset.fixgruppe));
  el.querySelectorAll('.fa-zeile[data-fixgruppe], .kb-fix[data-fixgruppe]').forEach((b) => b.onclick = () => fixGruppeUmschalten(b.dataset.fixgruppe, true));
  el.querySelector('.fix-vertraege')?.addEventListener('toggle', (e) => { fixListeAuf = e.target.open; });
  el.querySelector('.fix-grundlage')?.addEventListener('toggle', (e) => { fixGrundlageAuf = e.target.open; });
  el.querySelectorAll('.ks[data-fix]').forEach((b) => b.onclick = () => setze({ q: `"${b.dataset.fix}"${b.dataset.sig ? ' ' + b.dataset.sig : ''}`, tab: 'buchungen' }));
  el.querySelectorAll('[data-leben]').forEach((b) => b.onclick = () => {
    lebenWahl = b.dataset.leben;
    if (lebenWahl === 'eigen' && !lebenEigen) lebenEigen = Math.round(lebenshaltung().schnitt / 100) * 100;
    try { localStorage.setItem('fd.leben', lebenWahl); localStorage.setItem('fd.lebeneigen', String(lebenEigen)); } catch {}
    tabelle(conds);
    if (lebenWahl === 'eigen') $('#leben-eigen')?.select();
  });
  $('#leben-eigen')?.addEventListener('change', (e) => {
    lebenEigen = Math.max(0, Math.round((+e.target.value || 0) * 100));
    try { localStorage.setItem('fd.lebeneigen', String(lebenEigen)); } catch {}
    tabelle(conds);
  });
  if (S.tab === 'fix') planBinden();
  $('#fix-alle-auf')?.addEventListener('click', () => {
    const alleArten = [...el.querySelectorAll('.fix-kopfzeile')].map((b) => b.dataset.fixgruppe);
    fixOffen = alleArten.every((a) => fixOffen.has(a)) ? new Set() : new Set(alleArten);
    tabelle(conds);
  });
  if (S.tab === 'fix') fixGrafikZeichnen();
  if (S.tab === 'konten') kontenGrafikZeichnen();
  $('#stichtag')?.addEventListener('change', (e) => { const v = e.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setze({ stichtag: v }); });
  el.querySelectorAll('[data-st]').forEach((b) => b.onclick = () => setze({ stichtag: b.dataset.st === D.bis && !S.jahr ? '' : b.dataset.st }));
  el.querySelectorAll('tr[data-konto], .kg-leg-z[data-konto]').forEach((tr) => tr.onclick = () => setze({ konto: S.konto === tr.dataset.konto ? '' : tr.dataset.konto, tab: 'buchungen' }));
}

// ======================================================================= Fixkosten und Abos
// Erkennung in zwei Schritten:
// 1. Je Empfänger + Verwendungszweck (ohne Zahlen, Daten, Monatsnamen) entsteht ein Vertrag. Zwei Zahlungen im selben
//    Zeitraum (z. B. Kindesunterhalt für zwei Kinder am selben Tag) laufen als getrennte Verträge. Preisänderungen
//    bleiben im selben Vertrag und werden als Verlauf gezeigt (200 → 600 → 950 €).
// 2. Was so nicht regelmäßig ist, wird nur nach Empfänger und ähnlichem Betrag (±15 %) geprüft – für Verwendungszwecke,
//    die sich jedes Mal ändern.
// „Läuft“ = die letzte Zahlung liegt höchstens anderthalb Rhythmen vor dem Datenstand.
const RHYTHMEN = [
  { name: 'monatlich', tage: 30.4, proJahr: 12 },
  { name: 'alle 2 Monate', tage: 61, proJahr: 6 },
  { name: 'vierteljährlich', tage: 91.3, proJahr: 4 },
  { name: 'halbjährlich', tage: 182.6, proJahr: 2 },
  { name: 'jährlich', tage: 365.25, proJahr: 1 },
];
const VARIABEL_KAT = new Set(['Essen & Trinken', 'Lifestyle', 'Drogerie']);
const VARIABEL_UKAT = new Set(['Bargeld', 'Tanken', 'Parken', 'Taschengeld', 'Futter & Tierbedarf']);
const MONATSWORTE = /\b(januar|februar|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mar|apr|jun|jul|aug|sep|sept|okt|nov|dez)\b/g;
const tageZwischen = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const zweckSignatur = (z) => norm(z).replace(/[^a-z ]+/g, ' ').replace(MONATSWORTE, ' ').replace(/\b[a-z]{1,2}\b/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
const empfaengerKey = (g) => norm(g).replace(/\d{5,}/g, '').replace(/\s+/g, ' ').trim();

// Gemeinschaftskonto (mit Unterkonten/Pockets): Deine regelmäßigen Überweisungen dorthin (Haushaltsgeld, Sparen Urlaub, …)
// sind Fixkosten. Verträge, die vom Gemeinschaftskonto abgehen, werden nur informativ gezeigt – sonst zählte dasselbe
// Geld doppelt (erst als Beitrag, dann als Abbuchung).
const GEMEINSAM = /gemeinschaftskonto|pocket/i;
const istGemeinsam = (k) => GEMEINSAM.test(D.konten[k].name);

// Deine Einzahlungen auf die gemeinsamen Konten (Ausgaben der Kategorie „Gemeinschaftskonto“; Unterkategorie =
// Zielkonto). Ergebnis: Buchungs-Nr. → Zielkonto
function beitragsBuchungen() {
  const ziel = new Map();
  for (const r of D.rows) {
    if (r.art !== 'Ausgabe' || r.kat !== 'Gemeinschaftskonto' || r.c >= 0) continue;
    const k = D.kontoIdx.get(r.ukat);
    if (k != null) ziel.set(r.i, k);
  }
  return ziel;
}

// Zahlungen eines Empfängers in Ströme aufteilen: jede Zahlung geht an den Strom mit dem ähnlichsten letzten Betrag,
// aber nie an einen Strom, der im selben Zeitraum (< 20 Tage) schon eine Zahlung hat.
function stroeme(rows, maxAbw) {
  const st = [];
  for (const r of rows) {
    const a = -r.c;
    let best = null, bestAbw = Infinity;
    for (const s of st) {
      if (tageZwischen(s.last.d, r.d) < 20) continue;
      const abw = Math.abs(a + s.last.c) / Math.max(100, -s.last.c);
      if (abw <= maxAbw && abw < bestAbw) { best = s; bestAbw = abw; }
    }
    if (best) { best.rows.push(r); best.last = r; } else st.push({ rows: [r], last: r });
  }
  return st;
}

// Ist ein Strom ein Vertrag? Dann Vertrag mit Rhythmus und Preisverlauf zurückgeben.
function alsVertrag(rs, beitrag = false) {
  const vertrag = rs.some((r) => r.v) || beitrag;
  const z = rs[rs.length - 1];
  if (!vertrag && (VARIABEL_KAT.has(z.kat) || VARIABEL_UKAT.has(z.ukat))) return null;
  if (rs.length < (vertrag ? 2 : 3) || -z.c < 100) return null;   // Kleinstbeträge (Zinsabrechnungen u. ä.) sind keine Fixkosten
  const abst = [];
  for (let i = 1; i < rs.length; i++) abst.push(tageZwischen(rs[i - 1].d, rs[i].d));
  const rh = RHYTHMEN.find((x) => Math.abs(median(abst) - x.tage) <= x.tage * 0.16);
  if (!rh) return null;
  if (!vertrag && rh.tage < 90 && rs.length < 4) return null;   // monatlich/zweimonatlich erst ab 4 Zahlungen
  if (abst.filter((t) => Math.abs(t - rh.tage) <= rh.tage * 0.25).length / abst.length < 0.6) return null;
  // Beträge sollen überwiegend gleich bleiben (Preisänderungen sind erlaubt, dauerndes Schwanken nicht)
  const wechsel = [];
  for (let i = 1; i < rs.length; i++) wechsel.push(Math.abs(rs[i].c - rs[i - 1].c) / Math.max(100, -rs[i - 1].c));
  if (median(wechsel) > 0.1) return null;
  // Preisverlauf: neue Stufe bei mehr als 2 % Änderung
  const stufen = [];
  for (const r of rs) {
    const a = -r.c, s = stufen[stufen.length - 1];
    if (s && Math.abs(a - s.betrag) <= s.betrag * 0.02) { s.bis = r.d; s.n++; } else stufen.push({ betrag: a, von: r.d, bis: r.d, n: 1 });
  }
  const erste = rs[0], letzte = rs[rs.length - 1];
  const aktiv = tageZwischen(letzte.d, D.bis) <= rh.tage * 1.5 + 7 && tageZwischen(D.konten[letzte.k].bis, D.bis) <= 45;
  // beendete Verträge: letzte regelmäßige Rate statt einer einmaligen Schlusszahlung
  const regel = [...stufen].reverse().find((x) => x.n > 1);
  const betrag = !aktiv && regel && stufen[stufen.length - 1].n === 1 ? regel.betrag : -letzte.c;
  return {
    name: letzte.g, zweck: letzte.z, sig: zweckSignatur(letzte.z), kat: letzte.kat, ukat: letzte.ukat, k: letzte.k,
    v: rs.find((r) => r.v)?.v || '', rh, betrag, proMonat: (betrag * rh.proJahr) / 12, proJahr: betrag * rh.proJahr,
    seit: erste.d, zuletzt: letzte.d, n: rs.length, erster: -erste.c, stufen, aktiv, r: letzte, rows: rs,
  };
}

// Preisverlauf als kurzer Text: „200 → 600 → 950 €“, bei vielen kleinen Änderungen „schwankt 18–25 €“
function verlaufText(f) {
  // einmalige Ausreißer (Nachzahlung, Erstattung) zwischendurch nicht als Preisstufe zeigen
  let s = f.stufen.filter((x, i, a) => x.n > 1 || (i === a.length - 1 && f.aktiv));
  if (!s.length) s = f.stufen.slice(-1);
  if (s.length === 1) return '';
  const e = (c) => EUR.format(c / 100).replace(',00', '').replace(/\s*€/, '');
  if (s.length > 5) {
    const b = s.map((x) => x.betrag);
    const steigt = b.every((x, i) => !i || x >= b[i - 1]), faellt = b.every((x, i) => !i || x <= b[i - 1]);
    return steigt || faellt ? `${e(b[0])} → ${e(b[b.length - 1])} € (${s.length} Stufen)` : `schwankt ${e(Math.min(...b))}–${e(Math.max(...b))} €`;
  }
  return s.map((x) => e(x.betrag)).join(' → ') + ' €';
}

function fixkostenErkennen() {
  if (D.fix) return D.fix;
  const out = [], benutzt = new Set();
  const beitrag = beitragsBuchungen();
  // Schritt 1: Empfänger + Verwendungszweck; Beiträge zum Gemeinschaftskonto nach Verwendungszweck
  const gruppen = new Map();
  for (const r of D.rows) {
    const b = beitrag.has(r.i);
    const ab = r.art === 'Ausgabe' || (r.art === 'Gemeinschaftskonto' && r.c < 0);
    if ((!ab && !b) || (!r.g && !b)) continue;
    const key = b ? `gemeinsam|${zweckSignatur(r.z) || beitrag.get(r.i)}` : empfaengerKey(r.g) + '|' + zweckSignatur(r.z);
    if (!gruppen.has(key)) gruppen.set(key, []);
    gruppen.get(key).push(r);
  }
  for (const [key, rows] of gruppen) {
    if (rows.length < 2) continue;
    const b = key.startsWith('gemeinsam|');
    for (const s of stroeme(rows, Infinity)) {
      const f = alsVertrag(s.rows, b);
      if (!f) continue;
      if (b) {
        const zk = D.konten[beitrag.get(s.rows[s.rows.length - 1].i)].name;
        Object.assign(f, { beitrag: true, name: zk, kat: 'Gemeinschaftskonto', ukat: 'dein Beitrag' });
      } else f.gemeinsam = istGemeinsam(f.k);
      out.push(f); s.rows.forEach((r) => benutzt.add(r.i));
    }
  }
  // Schritt 2: übrige Zahlungen nur nach Empfänger und ähnlichem Betrag
  const rest = new Map();
  for (const r of D.rows) {
    if (!(r.art === 'Ausgabe' || (r.art === 'Gemeinschaftskonto' && r.c < 0)) || !r.g || benutzt.has(r.i)) continue;
    const key = empfaengerKey(r.g);
    if (!rest.has(key)) rest.set(key, []);
    rest.get(key).push(r);
  }
  for (const rows of rest.values()) {
    if (rows.length < 2) continue;
    for (const s of stroeme(rows, 0.15)) { const f = alsVertrag(s.rows); if (f) { f.gemeinsam = istGemeinsam(f.k); out.push(f); } }
  }
  out.sort((a, b) => b.proMonat - a.proMonat);
  return (D.fix = out);
}

let fixAnsicht = 'laufend';   // laufend | frueher (beendet seit 2020) | alle
const FRUEHER_AB = '2020-01-01';
function fixkostenGefiltert(conds) {
  const t = matcher(conds.filter((c) => c.kind !== 'zeit'));
  const konto = S.konto ? D.kontoIdx.get(S.konto) : -1;
  return fixkostenErkennen().filter((f) => (konto === -1 || f.k === konto) && (!S.kat || f.kat === S.kat) && (!S.ukat || f.ukat === S.ukat)
    && S.art !== 'ein' && t(f.r));
}
const fixSichtbar = (alle) => alle.filter((f) => f.aktiv || fixAnsicht === 'alle' || (fixAnsicht === 'frueher' && f.zuletzt >= FRUEHER_AB));

// Bezugsgröße für die Prozente: aktuelles Nettogehalt, Ø Gehalt der letzten 12 Monate oder Ø aller Einnahmen.
// Die 12 Monate enden mit dem letzten Monat, in dem Gehalt eingegangen ist.
let fixBezug = (() => { try { return localStorage.getItem('fd.fixbezug') || 'schnitt'; } catch { return 'schnitt'; } })();
function einkommen() {
  if (D.einkommen) return D.einkommen;
  const lohn = new Map(), ein = new Map();
  for (const r of D.rows) {
    if (r.art !== 'Einnahme' || r.c <= 0 || istGemeinsam(r.k)) continue;   // Einzahlungen anderer aufs Gemeinschaftskonto zählen nicht
    const m = r.d.slice(0, 7);
    ein.set(m, (ein.get(m) || 0) + r.c);
    if (r.ukat === 'Lohn / Gehalt') lohn.set(m, (lohn.get(m) || 0) + r.c);
  }
  const monTxt = (m) => `${MON[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
  const letzter = [...lohn.keys()].sort().pop() || [...ein.keys()].sort().pop() || D.bis.slice(0, 7);
  const m12 = [];
  let [y, mo] = letzter.split('-').map(Number);
  for (let i = 0; i < 12; i++) { m12.unshift(`${y}-${String(mo).padStart(2, '0')}`); if (--mo === 0) { mo = 12; y--; } }
  const summe = (mp) => m12.reduce((t, m) => t + (mp.get(m) || 0), 0);
  const spanne = `${monTxt(m12[0])} – ${monTxt(letzter)}`;
  return (D.einkommen = {
    lohn, ein, letzter,
    aktuell: { wert: lohn.get(letzter) || 0, knopf: 'aktuelles Gehalt', name: 'Nettogehalt', zeit: `im ${MONAT[+letzter.slice(5) - 1]} ${letzter.slice(0, 4)}`, vom: 'vom aktuellen Gehalt', am: 'am aktuellen Gehalt', spalte: 'vom Gehalt', reihe: 'lohn' },
    schnitt: { wert: summe(lohn) / 12, knopf: 'Ø Gehalt 12 Monate', name: 'Ø Nettogehalt', zeit: `${spanne}, mit Sonderzahlungen`, vom: 'vom Ø Gehalt', am: 'am Ø Gehalt', spalte: 'vom Gehalt', reihe: 'lohn' },
    einnahmen: { wert: summe(ein) / 12, knopf: 'Ø alle Einnahmen', name: 'Ø Einnahmen', zeit: `${spanne}, inkl. Zinsen und Erstattungen`, vom: 'von deinen Einnahmen', am: 'an deinen Einnahmen', spalte: 'der Einnahmen', reihe: 'ein' },
  });
}

// Fixkosten-Arten: wofür das Geld regelmäßig abgeht (statt der Finanzguru-Kategorie „Kinder“, „Wohnen“ …)
const FIX_ARTEN = [
  ['Kindesunterhalt', (f) => f.ukat === 'Kindesunterhalt'],
  ['Miete', (f) => f.ukat === 'Miete'],
  ['Haushalt (Gemeinschaftskonto)', (f) => f.beitrag],
  ['Trennungsunterhalt', (f) => f.ukat === 'Trennungsunterhalt'],
  ['Unterhalt', (f) => /unterhalt/i.test(f.ukat)],
  ['Versicherungen', (f) => f.kat === 'Versicherungen'],
  ['Energie', (f) => /strom|gas|wasser|heiz|fernwaerme/i.test(f.ukat)],
  ['Kredite', (f) => /kredit|darlehen|finanzierung/i.test(f.ukat)],
  ['Kinder & Betreuung', (f) => f.kat === 'Kinder'],
  ['Telefon & Internet', (f) => /telefon|internet|mobilfunk|handy/i.test(`${f.ukat} ${f.name}`)],
  ['Steuern & Gebühren', (f) => /steuer|gebuehr|rundfunk|abgabe/i.test(`${f.ukat} ${f.zweck}`)],
  ['Abos & Mitgliedschaften', () => true],
];
const ART_FARBEN = ['#2a78d6', '#e0602e', '#1a9e6e', '#9085e9', '#eda100', '#e87ba4', '#3fa7b8', '#b0762f', '#6c8f3a', '#8a8880', '#c25b8f'];
const SCHOENER = {
  Mobilitaet: 'Mobilität', 'Aerztliche Behandlung': 'Ärztliche Behandlung', Bankgebuehren: 'Bankgebühren', Berufsunfaehigkeitsversicherung: 'Berufsunfähigkeitsversicherung',
  'Buecher & Zeitungen': 'Bücher & Zeitungen', Getraenkehandel: 'Getränkehandel', 'In-App-Kaeufe': 'In-App-Käufe', Kapitalertraege: 'Kapitalerträge',
  'Reiseruecktritts-Versicherung': 'Reiserücktritts-Versicherung', Rundfunkgebuehren: 'Rundfunkgebühren', 'Schule & Foerderung': 'Schule & Förderung',
  'Tieraerztliche Behandlung': 'Tierärztliche Behandlung',
};
const schoen = (t) => SCHOENER[t] || t;
const fixArt = (f) => FIX_ARTEN.find(([, t]) => t(f))[0];

// Bezeichnung einer Zahlung: zuerst wofür (Kind, Versicherungsart, Zweck), der Empfänger steht darunter
function fixTitel(f, art) {
  const woerter = (s) => norm(s).replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean);
  const ohne = new Set([...woerter(f.beitrag ? f.r.g : f.name), ...(f.beitrag ? [] : woerter(art)), 'dr']);
  const rest = (f.zweck || '').replace(/[\d/.,:;#()+-]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !ohne.has(norm(w))).join(' ').trim();
  if (art === 'Kindesunterhalt') return rest || f.name;
  if (f.beitrag) return rest || f.name;
  if (art === 'Versicherungen') return schoen(f.ukat) || f.name;
  const steuer = (f.zweck || '').match(/[A-Za-zÄÖÜäöüß-]*steuer/i);
  if (art === 'Steuern & Gebühren' && steuer) return steuer[0];
  return f.name;
}

let fixOffen = new Set();   // aufgeklappte Gruppen
let fixListeAuf = false, fixGrundlageAuf = false;   // „Alle Verträge im Detail“ und „Rechengrundlage“ aufgeklappt
const FIX_BLAU = '#2a78d6';
const FIX_KURZ = { 'Haushalt (Gemeinschaftskonto)': 'Haushalt', 'Abos & Mitgliedschaften': 'Abos', 'Kinder & Betreuung': 'Kinder', 'Steuern & Gebühren': 'Steuern',
  'Telefon & Internet': 'Telefon', Trennungsunterhalt: 'Trennungs&shy;unterhalt', Kindesunterhalt: 'Kindes&shy;unterhalt', Versicherungen: 'Versiche&shy;rungen' };
let fixGrafik = null;       // Daten für den Verlauf (wird nach dem Rendern gezeichnet)
let fixKontext = null;      // Grundlage für den Rechner „Kann ich mir das leisten?“

// Lebenshaltung: alle Ausgaben der letzten 12 abgeschlossenen Monate, die zu keinem Fixkosten-Vertrag gehören (Einkauf,
// Tanken, Freizeit, Urlaub, Anschaffungen …). Ohne Gemeinschaftskonto und Pockets: Das bezahlt ihr aus euren Beiträgen,
// und dein Beitrag steht schon bei den Fixkosten.
function lebenshaltung() {
  if (D.leben) return D.leben;
  let [y, m] = D.bis.slice(0, 7).split('-').map(Number);
  if (D.bis !== monatsletzter(D.bis) && --m === 0) { m = 12; y--; }
  const monate = [];
  for (let i = 0; i < 12 && mkey(y, m) >= D.von.slice(0, 7); i++) { monate.unshift(mkey(y, m)); if (--m === 0) { m = 12; y--; } }
  const idx = new Map(monate.map((k, i) => [k, i])), werte = monate.map(() => 0), fx = fixIds();
  const kat = new Map();
  let spar = 0;
  for (const r of D.rows) {
    const i = idx.get(r.d.slice(0, 7));
    if (i == null || istGemeinsam(r.k)) continue;
    if (r.art === 'Ausgabe' && !fx.has(r.i)) { werte[i] -= r.c; const k = r.kat || 'Sonstiges'; kat.set(k, (kat.get(k) || 0) - r.c); }
    else if (r.art === 'Sparen') spar -= r.c;
  }
  const n = monate.length || 1;
  const kats = [...kat].map(([k, c]) => ({ kat: k, c: c / n })).filter((x) => x.c > 0).sort((a, b) => b.c - a.c);
  return (D.leben = { monate, werte, kats, schnitt: werte.reduce((s, x) => s + x, 0) / n, typisch: werte.length ? median(werte) : 0, spar: spar / n });
}
let lebenWahl = (() => { try { return localStorage.getItem('fd.leben') || 'schnitt'; } catch { return 'schnitt'; } })();
let lebenEigen = (() => { try { return +localStorage.getItem('fd.lebeneigen') || 0; } catch { return 0; } })();   // Cent

// Geld auf deinen eigenen Konten (ohne Gemeinschaftskonto und Pockets, Mietkaution und die Konten der Kinder)
function ruecklagen() {
  return kontostaende(D, D.bis).filter((x) => !x.k.kind && x.c != null && !istGemeinsam(x.i) && !/kaution/i.test(x.k.name)
    && !['geschlossen', 'nicht_eroeffnet'].includes(x.status)).reduce((s, x) => s + x.c, 0);
}

// Tag im Monat, an dem ein Vertrag abgebucht wird (Median der letzten Zahlungen), und der Tag, an dem das Gehalt kommt
const zahltag = (f) => Math.min(31, Math.max(1, Math.round(median(f.rows.slice(-4).map((r) => +r.d.slice(8, 10))))));
function gehaltstag() {
  const t = D.rows.filter((r) => r.art === 'Einnahme' && r.ukat === 'Lohn / Gehalt' && r.c >= 100000).slice(-6).map((r) => +r.d.slice(8, 10));
  return t.length ? Math.round(median(t)) : 0;
}
// nächste Fälligkeit eines nicht monatlichen Vertrags
function naechsteZahlung(f) {
  let t = Date.parse(f.zuletzt);
  const ab = Date.parse(D.bis) - 5 * 864e5;
  do t += f.rh.tage * 864e5; while (t < ab);
  return new Date(t).toISOString().slice(0, 10);
}
// Name eines Vertrags für Listen: „Miete Kathrin Kluge“, „Kindesunterhalt Leo“, „Lebensversicherung“ …
function vertragName(f) {
  const a = fixArt(f), t = fixTitel(f, a);
  if (a === 'Miete') return `Miete ${f.name}`;
  if (a === 'Kindesunterhalt') return `Kindesunterhalt ${t}`;
  if (a === 'Trennungsunterhalt') return 'Trennungsunterhalt';
  if (f.beitrag) return `${t} (${f.name})`;
  return t;
}
const vertragsKey = (f) => `${f.name}|${f.sig}|${f.seit}`;
const pzVon = (v, g) => (!g ? '–' : Math.abs(v / g) < 0.0005 ? '< 0,1 %' : `${NUM.format(Math.round((v / g) * 1000) / 10)} %`);

// Ein oder mehrere Balken „Einkommen = 100 %“: Fixkosten | Lebenshaltung | was bleibt (rot schraffiert: was fehlt)
function budgetBalken(zeilen, B) {
  const max = Math.max(B, ...zeilen.map((z) => z.fk + z.l));
  const w = (c) => `${(Math.max(0, c) / max) * 100}%`;
  const teil = (cls_, c, tip) => (c > 0 ? `<i class="${cls_}" style="width:${w(c)}" title="${esc(tip)}">${c / max >= 0.09 ? `<span>${eur0(c)}</span>` : ''}</i>` : '');
  return `<div class="bb">${zeilen.map((z) => {
    const rest = B - z.fk - z.l;
    return `<div class="bb-zeile">${z.titel ? `<div class="bb-t">${esc(z.titel)}</div>` : ''}
      <div class="bb-balken">${teil('bb-fix', z.fk, `Fixkosten ${eur0(z.fk)} · ${pzVon(z.fk, B)}`)}${teil('bb-leben', z.l, `Lebenshaltung ${eur0(z.l)} · ${pzVon(z.l, B)}`)}${teil('bb-rest', rest, `bleibt ${eur0(rest)} · ${pzVon(rest, B)}`)}
        ${rest < 0 ? `<b class="bb-minus" style="left:${w(B)};width:${w(-rest)}" title="fehlt ${eur0(-rest)}"></b>` : ''}
        ${max > B ? `<b class="bb-linie" style="left:${w(B)}" title="100 % = Einkommen"></b>` : ''}</div></div>`;
  }).join('')}</div>`;
}

function tabFixkosten(conds) {
  const gefiltert = fixkostenGefiltert(conds);
  const alle = gefiltert.filter((f) => !f.gemeinsam);
  const vomGemeinsamen = fixSichtbar(gefiltert.filter((f) => f.gemeinsam));
  const aktiv = alle.filter((f) => f.aktiv);
  const nFrueher = alle.filter((f) => !f.aktiv && f.zuletzt >= FRUEHER_AB).length, nAelter = alle.filter((f) => !f.aktiv && f.zuletzt < FRUEHER_AB).length;
  const liste = fixSichtbar(alle);
  const pmListe = aktiv.reduce((s, f) => s + f.proMonat, 0);
  // Überblick und Rechner rechnen immer mit allen laufenden Verträgen – mit Filter wäre die Rechnung unvollständig
  const alleV = fixkostenErkennen().filter((f) => !f.gemeinsam), lauf = alleV.filter((f) => f.aktiv);
  const pm = lauf.reduce((s, f) => s + f.proMonat, 0);
  const gefiltertAn = aktiv.length !== lauf.length || liste.length !== fixSichtbar(alleV).length;
  const ek = einkommen();
  if (!ek[fixBezug]?.wert) fixBezug = ek.schnitt.wert ? 'schnitt' : 'einnahmen';
  const bz = ek[fixBezug], B = bz.wert;
  const lh = lebenshaltung();
  if (lebenWahl === 'eigen' && !lebenEigen) lebenWahl = 'schnitt';
  const L = lebenWahl === 'eigen' ? lebenEigen : lebenWahl === 'typisch' ? lh.typisch : lh.schnitt;
  const rest = B - pm - L;
  const zeit = S.jahr || S.monat || conds.some((c) => c.kind === 'zeit') ? ' Der gewählte Zeitraum spielt hier keine Rolle, es zählt der aktuelle Stand.' : '';
  const pct = (v) => pzVon(v, B);
  const e2 = (c) => EUR.format(c / 100);

  // Gruppen je Art, sortiert nach laufender Summe; Farbe je Art bleibt stabil
  const nachArt = (vs) => {
    const g = new Map();
    for (const f of vs) {
      const a = fixArt(f);
      if (!g.has(a)) g.set(a, { art: a, fs: [], summe: 0, laufend: 0 });
      const x = g.get(a);
      x.fs.push(f);
      if (f.aktiv) { x.summe += f.proMonat; x.laufend++; }
    }
    return [...g.values()].sort((a, b) => b.summe - a.summe || a.art.localeCompare(b.art, 'de'));
  };
  const ueber = nachArt(lauf), arten = nachArt(liste);
  const farbe = new Map(alleV.map((f) => [fixArt(f), FIX_BLAU]));
  [...ueber, ...arten].forEach((g) => { g.farbe = farbe.get(g.art); });
  fixGrafik = { verlauf: fixVerlauf(alleV, farbe), B, bz, ek };
  fixKontext = { B, bz, pm, L, lauf, ruecklage: ruecklagen() };

  const knopf = (attr, k, an, t, wert) => `<button ${attr}="${k}" class="${an ? 'an' : ''}">${t}${wert != null ? ` <small>${eur0(wert)}</small>` : ''}</button>`;
  const lebenText = lebenWahl === 'eigen' ? 'dein eigener Wert' : lebenWahl === 'typisch' ? `typischer Monat (Median) ${monatsText(lh.monate)}` : `Ø ${monatsText(lh.monate)}`;
  const quoteOk = pm <= B * 0.5;
  const deinem = bz.reihe === 'lohn' ? `deinem ${esc(bz.name)}` : `deinen ${esc(bz.name)}`;
  const satz = `Von ${deinem} (${eur0(B)}) sind <b>${eur0(pm)}</b> fest verplant. ${rest >= 0
    ? `Nach der Lebenshaltung bleiben dir <b class="pos">${eur0(rest)}</b> im Monat.`
    : `Mit der Lebenshaltung fehlen dir <b class="neg">${eur0(-rest)}</b> im Monat.`}`;
  // Ein Balken für alles: Fixkosten je Art (blau) | Lebenshaltung | was bleibt – rot schraffiert, was fehlt
  const max = Math.max(B, pm + L), w = (c) => (Math.max(0, c) / max) * 100;
  const segs = ueber.filter((g) => g.summe > 0).map((g) => `<i class="kb-fix" data-fixgruppe="${esc(g.art)}" style="width:${w(g.summe)}%" title="${esc(g.art)}: ${eur0(g.summe)} pro Monat · ${pct(g.summe)} – anklicken: Verträge">${w(g.summe) >= 7 ? `<span>${FIX_KURZ[g.art] || esc(g.art)}</span><b>${eur0(g.summe)}</b>` : ''}</i>`).join('');
  const balken = `<div class="kb">
    <div class="kb-klammern"><div class="kb-k kb-k-fix" style="width:${w(pm)}%"><b>Fixkosten ${eur0(pm)}</b><span>${pct(pm)}${quoteOk ? '' : ' · Faustregel: höchstens 50&nbsp;%'}</span></div>
      <div class="kb-k kb-k-leben" style="width:${w(L)}%"><b>Lebenshaltung ${eur0(L)}</b><span>${pct(L)}</span></div>
      ${rest > 0 ? `<div class="kb-k kb-k-rest" style="width:${w(rest)}%"><b>bleibt ${eur0(rest)}</b><span>${pct(rest)}</span></div>` : ''}</div>
    <div class="kb-balken">${segs}<i class="kb-leben" style="width:${w(L)}%" title="Lebenshaltung ${eur0(L)} · ${pct(L)}">${w(L) >= 7 ? `<span>Lebens&shy;haltung</span><b>${eur0(L)}</b>` : ''}</i>${rest > 0 ? `<i class="kb-rest" style="width:${w(rest)}%" title="bleibt ${eur0(rest)} · ${pct(rest)}">${w(rest) >= 7 ? `<span>bleibt</span><b>${eur0(rest)}</b>` : ''}</i>` : ''}
      ${rest < 0 ? `<b class="kb-minus" style="left:${w(B)}%;width:${w(-rest)}%" title="fehlt ${eur0(-rest)}"></b>` : ''}${max > B ? `<b class="kb-linie" style="left:${w(B)}%"></b>` : ''}</div>
    <div class="kb-unten"><span class="kb-100" style="right:${100 - w(B)}%">100 % = ${eur0(B)}</span>${rest < 0 ? `<span class="kb-fehlt">fehlt ${eur0(-rest)}</span>` : ''}</div>
  </div>`;
  let h = `<div class="fix-kopf fix-held">
    <p class="fix-satz">${satz}</p>
    ${balken}
    <details class="fix-grundlage"${fixGrundlageAuf ? ' open' : ''}><summary>Gerechnet mit ${esc(bz.knopf)} (${eur0(B)}) und Lebenshaltung ${esc(lebenText)} (${eur0(L)}) · <span class="link">ändern</span></summary>
      <div class="fix-einst">
        <div class="fix-bezug-zeile"><span>Einkommen</span><div class="seg fix-bezug">${['aktuell', 'schnitt', 'einnahmen'].filter((k) => ek[k].wert).map((k) => `<button data-fixbezug="${k}" class="${fixBezug === k ? 'an' : ''}" title="${esc(ek[k].zeit)}">${esc(ek[k].knopf)} <small>${eur0(ek[k].wert)}</small></button>`).join('')}</div></div>
        <div class="fix-bezug-zeile"><span>Lebenshaltung</span><div class="seg fix-bezug">${knopf('data-leben', 'schnitt', lebenWahl === 'schnitt', 'Ø 12 Monate', lh.schnitt)}${knopf('data-leben', 'typisch', lebenWahl === 'typisch', 'typischer Monat', lh.typisch)}${knopf('data-leben', 'eigen', lebenWahl === 'eigen', 'eigener Wert')}</div>
          ${lebenWahl === 'eigen' ? `<label class="fix-eigen"><input type="number" id="leben-eigen" min="0" step="50" inputmode="numeric" value="${Math.round(L / 100)}"> € / Monat</label>` : ''}</div>
      </div>
      <p class="muted klein">Lebenshaltung = alle übrigen Ausgaben deiner Konten (Einkauf, Tanken, Freizeit, Urlaub, Anschaffungen) ohne Fixkosten und ohne Gemeinschaftskonto${lh.spar > 0 ? `. Aufs Sparkonto oder Depot gehen zusätzlich Ø ${eur0(lh.spar)} im Monat` : ''}.</p>
    </details>
  </div>`;

  // Wofür und wann
  h += `<div class="fix-raster">
    <div class="fix-feld"><div class="fix-feld-t">Wofür deine Fixkosten draufgehen <span class="muted">· anklicken: Verträge</span></div>${artenHtml(ueber, pct)}</div>
    <div class="fix-feld"><div class="fix-feld-t">Wann abgebucht wird <span class="muted">· monatliche Zahlungen nach Tag im Monat</span></div>${kalenderHtml(lauf)}</div>
  </div>`;

  // Rechner
  h += `<div class="fix-plan" id="fix-plan">${planHtml()}</div>`;

  h += `<div class="fix-verlauf"><div class="fix-grafik-t">${bz.reihe === 'lohn' ? 'Nettogehalt' : 'Einnahmen'} und Fixkosten im Verlauf</div><div class="fix-verlauf-c"><canvas id="c-fix-verlauf"></canvas></div>
    <div class="fix-leg-fuss">Je Monat: ${bz.reihe === 'lohn' ? 'eingegangenes Nettogehalt (Spitzen = Sonderzahlungen)' : 'alle Einnahmen'} und die Summe der damals laufenden Fixkosten (jährliche anteilig). Grün: was nach den Fixkosten bleibt; gestrichelt: ${esc(bz.name)}.</div></div>`;

  const seg = (v, t) => `<button data-fixansicht="${v}" class="${fixAnsicht === v ? 'an' : ''}">${t}</button>`;
  let v = `<div class="fix-leiste fix-leiste-innen"><div class="fix-leiste-r"><div class="seg fix-seg">${seg('laufend', `Laufend (${aktiv.length})`)}${nFrueher ? seg('frueher', `+ frühere seit 2020 (${nFrueher})`) : ''}${nFrueher + nAelter ? seg('alle', `alle (${alle.length})`) : ''}</div>
      ${arten.length ? `<button class="link" id="fix-alle-auf">${arten.every((g) => fixOffen.has(g.art)) ? 'Alle zuklappen' : 'Alle aufklappen'}</button>` : ''}</div></div>`;
  if (!liste.length) v += '<div class="leer">Keine regelmäßigen Zahlungen gefunden.</div>';

  const hl = highlightWords(conds);
  const re = hl.length ? new RegExp('(' + hl.map(escRe).join('|') + ')', 'gi') : null;
  const mk = (s) => (re ? esc(s).replace(re, '<mark>$1</mark>') : esc(s));
  const offen = (a) => fixOffen.has(a) || conds.some((c) => c.kind === 'text');   // bei einer Suche alles offen
  v += `<div class="fix-liste"><div class="fix-liste-kopf"><span>Beträge pro Monat</span><span>% = Anteil ${esc(bz.am)} (${eur0(B)} = 100 %)</span></div>`;
  if (liste.length) {
  for (const g of arten) {
    const auf = offen(g.art);
    const frueher = g.fs.length - g.laufend;
    v += `<div class="fix-gruppe${auf ? ' offen' : ''}">
      <button class="fix-kopfzeile" data-fixgruppe="${esc(g.art)}" aria-expanded="${auf}">
        <svg class="pfeil" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
        <span class="name">${esc(g.art)}</span>
        <span class="anzahl">${g.laufend ? `${g.laufend} ${g.laufend === 1 ? 'Zahlung' : 'Zahlungen'}` : ''}${frueher ? `${g.laufend ? ', ' : ''}${frueher} früher` : ''}</span>
        <span class="betrag">${g.summe ? eur0(g.summe) : '–'}</span>
        <span class="anteil">${g.summe ? pct(g.summe) : ''}</span>
      </button>`;
    if (auf) {
      const fs = g.fs.sort((a, b) => (b.aktiv - a.aktiv) || b.proMonat - a.proMonat || (b.zuletzt < a.zuletzt ? -1 : 1));
      for (const f of fs) {
        const titel = fixTitel(f, g.art), vt = verlaufText(f);
        const teile = [titel !== f.name ? `an ${f.name}` : '', f.rh.name, f.aktiv ? `seit ${dde(f.seit).slice(3)}` : `${dde(f.seit).slice(3)} – ${dde(f.zuletzt).slice(3)}, beendet`, vt].filter(Boolean);
        const vtip = f.stufen.map((x) => `${EUR.format(x.betrag / 100)} ${dde(x.von).slice(3)}–${dde(x.bis).slice(3)}`).join('\n');
        v += `<div class="fix-zeile${f.aktiv ? '' : ' beendet'}" data-fix="${esc(f.name)}" data-sig="${esc(f.sig)}" title="Alle Zahlungen anzeigen${vtip ? '\n' + esc(vtip) : ''}">
          <div class="text"><div class="titel">${mk(titel)}</div><div class="unter">${teile.map(esc).join(' · ')}</div>
            ${f.aktiv && B ? `<div class="anteilsbalken"><i style="width:${Math.min(100, Math.max(1, (f.proMonat / B) * 100))}%;background:${g.farbe}"></i></div>` : ''}</div>
          <div class="zahlen"><div class="betrag">${e2(f.betrag)}${f.rh.proJahr !== 12 ? `<small> ${f.rh.name}</small>` : ''}</div>
            <div class="unter">${f.rh.proJahr !== 12 ? `≈ ${eur0(f.proMonat)} / Monat · ` : ''}${f.aktiv ? pct(f.proMonat) : ''}</div></div>
        </div>`;
      }
    }
    v += '</div>';
  }
  v += `<div class="fix-summe"><span>Summe laufend${gefiltertAn ? ' (gefiltert)' : ''}</span><span class="betrag">${eur0(pmListe)} / Monat</span><span class="muted">${eur0(pmListe * 12)} im Jahr · ${pct(pmListe)} ${esc(bz.vom)}</span></div></div>`;
  if (vomGemeinsamen.length) {
    const gs = vomGemeinsamen.filter((f) => f.aktiv).reduce((s, f) => s + f.proMonat, 0);
    v += `<div class="fix-gemeinsam"><div class="fix-gemeinsam-t"><b>Vom Gemeinschaftskonto bezahlt</b> <span class="muted">– nicht mitgezählt, weil ihr sie aus euren Einzahlungen deckt${gs ? ` (laufend ${eur0(gs)} pro Monat)` : ''}</span></div>
      ${vomGemeinsamen.map((f) => `<div class="fix-zeile${f.aktiv ? '' : ' beendet'}" data-fix="${esc(f.name)}" data-sig="${esc(f.sig)}">
        <div class="text"><div class="titel">${esc(f.name)}</div><div class="unter">${esc(schoen(f.ukat))} · ${esc(D.konten[f.k].name)} · ${f.rh.name}${f.aktiv ? '' : ' · beendet'}</div></div>
        <div class="zahlen"><div class="betrag muted">${e2(f.betrag)}</div></div></div>`).join('')}</div>`;
  }
  }
  const suche = conds.some((c) => c.kind === 'text');
  h += `<details class="fix-vertraege"${fixListeAuf || suche ? ' open' : ''}><summary><b>Alle Verträge im Detail</b> <span class="muted">· ${aktiv.length} laufend · ${eur0(pmListe)} pro Monat${gefiltertAn ? ' · gefiltert' : ''}</span></summary>${v}</details>`;
  h += `<p class="muted klein fix-fuss">So wird gerechnet: Einkommen − Fixkosten − Lebenshaltung = Spielraum. Fixkosten: automatisch erkannte regelmäßige Zahlungen (gleicher Empfänger und Verwendungszweck, regelmäßiger Abstand; jährliche anteilig). Deine Überweisungen aufs Gemeinschaftskonto zählen mit, was von dort abgeht, nicht noch einmal. Lebenshaltung: alle übrigen Ausgaben deiner Konten (Einkauf, Tanken, Freizeit, Urlaub, Anschaffungen) der letzten 12 abgeschlossenen Monate. Die Überblicksgrafiken und der Rechner nutzen immer alle Verträge, auch wenn oben gefiltert ist. Stand ${dde(D.bis)}.${zeit}</p>`;
  return h;
}

// Fixkosten je Art als Balken mit Betrag und Anteil
function artenHtml(arten, pct) {
  const da = arten.filter((g) => g.summe > 0);
  if (!da.length) return '<div class="leer">Keine laufenden Fixkosten.</div>';
  const max = Math.max(...da.map((g) => g.summe));
  return `<div class="fa"><div class="fa-kopf"><span></span><span></span><span>pro Monat</span><span>${esc(fixKontext.bz.spalte)}</span></div>
    ${da.map((g) => `<button class="fa-zeile" data-fixgruppe="${esc(g.art)}" title="${esc(g.art)}: ${g.laufend} ${g.laufend === 1 ? 'Vertrag' : 'Verträge'} – anklicken zum Aufklappen">
      <span class="fa-name"><span>${esc(g.art)}</span></span>
      <span class="fa-balken"><i style="width:${Math.max(1.5, (g.summe / max) * 100)}%;background:${g.farbe}"></i></span>
      <span class="fa-betrag">${eur0(g.summe)}</span><span class="fa-anteil">${pct(g.summe)}</span></button>`).join('')}</div>`;
}

// Monatskalender: an welchem Tag wie viel abgeht, dazu der Gehaltstag und die Zahlungen außer der Reihe
function kalenderHtml(lauf) {
  const tage = Array.from({ length: 31 }, () => ({ c: 0, fs: [] }));
  for (const f of lauf) if (f.rh.proJahr === 12) { const t = tage[zahltag(f) - 1]; t.c += f.betrag; t.fs.push(f); }
  const max = Math.max(...tage.map((t) => t.c), 1), gt = gehaltstag();
  const top = new Set(tage.map((t, i) => [t.c, i]).filter((x) => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 5).map((x) => x[1]));
  const summe = (a, b) => tage.slice(a - 1, b).reduce((s, t) => s + t.c, 0);
  const spalten = tage.map((t, i) => {
    const tip = `${i + 1}. des Monats${i + 1 === gt ? ' – Gehalt kommt' : ''}${t.fs.length ? '\n' + t.fs.map((f) => `${fixTitel(f, fixArt(f))}: ${EUR.format(f.betrag / 100)}`).join('\n') : ''}`;
    return `<div class="kal-tag${i + 1 === gt ? ' gehalt' : ''}" title="${esc(tip)}"><div class="kal-saeule">${top.has(i) ? `<span class="kal-w">${NUM.format(Math.round(t.c / 100))}</span>` : ''}<i style="height:${t.c ? Math.max(3, (t.c / max) * 100) : 0}%"></i></div>
      <span class="kal-n">${[1, 5, 10, 15, 20, 25, 31].includes(i + 1) || i + 1 === gt ? i + 1 : ''}</span></div>`;
  }).join('');
  const selten = lauf.filter((f) => f.rh.proJahr < 12).map((f) => ({ f, am: naechsteZahlung(f) })).sort((a, b) => (a.am < b.am ? -1 : 1));
  const rueck = selten.reduce((s, x) => s + x.f.proMonat, 0);
  return `<div class="kal">${spalten}</div>
    <div class="kal-summen"><span>1.–10.: <b>${eur0(summe(1, 10))}</b></span><span>11.–20.: <b>${eur0(summe(11, 20))}</b></span><span>21.–31.: <b>${eur0(summe(21, 31))}</b></span>${gt ? `<span class="kal-g"><i></i>Gehalt um den ${gt}.</span>` : ''}</div>
    ${selten.length ? `<div class="fix-feld-t kal-selten-t">Außer der Reihe <span class="muted">· nächste Fälligkeit</span></div>
    <div class="kal-selten">${selten.slice(0, 8).map(({ f, am }) => `<div class="ks" data-fix="${esc(f.name)}" data-sig="${esc(f.sig)}" title="Alle Zahlungen anzeigen"><span class="ks-d">${MON[+am.slice(5, 7) - 1]} ${am.slice(2, 4)}</span><span class="ks-n">${esc(fixTitel(f, fixArt(f)))} <small>${esc(f.rh.name)}</small></span><b>${eur0(f.betrag)}</b></div>`).join('')}</div>
    <div class="klein muted kal-hinweis">Dafür jeden Monat ${eur0(rueck)} zurücklegen – sie stecken anteilig schon in den Fixkosten.</div>` : ''}`;
}

// ---------- Rechner „Kann ich mir das leisten?“
const PLAN_VORLAGEN = [
  { typ: 'wohnung', knopf: 'Neue Wohnung', name: 'Warmmiete neue Wohnung', ersetztArt: 'Miete' },
  { typ: 'auto', knopf: 'Auto / Leasing', name: 'Auto: Leasing- oder Kreditrate' },
  { typ: 'kredit', knopf: 'Kredit', name: 'Kreditrate' },
  { typ: 'vertrag', knopf: 'Versicherung / Abo', name: 'Neuer Vertrag' },
  { typ: 'weg', knopf: 'Vertrag fällt weg', name: 'Kündigung', weg: true },
  { typ: 'eigen', knopf: 'Eigene Position', name: '' },
];
let plan = (() => { try { const p = JSON.parse(localStorage.getItem('fd.plan')); if (p && Array.isArray(p.posten)) return p; } catch {} return { posten: [], einmalig: 0 }; })();
const planSpeichern = () => { try { localStorage.setItem('fd.plan', JSON.stringify(plan)); } catch {} };

function planHtml() {
  const { lauf } = fixKontext;
  // Verträge zur Auswahl, gruppiert nach Art (größte zuerst)
  const gr = new Map();
  for (const f of [...lauf].sort((a, b) => b.proMonat - a.proMonat)) { const a = fixArt(f); if (!gr.has(a)) gr.set(a, []); gr.get(a).push(f); }
  const posten = plan.posten.map((p, i) => {
    const opt = [...gr].map(([a, fs]) => `<optgroup label="${esc(a)}">${fs.map((f) => { const k = vertragsKey(f); return `<option value="${esc(k)}"${p.ersetzt === k ? ' selected' : ''}>${p.weg ? '' : 'ersetzt '}${esc(a === 'Miete' ? `Miete ${f.name}` : a === 'Kindesunterhalt' ? `Kindesunterhalt ${fixTitel(f, a)}` : a === 'Trennungsunterhalt' ? 'Trennungsunterhalt' : fixTitel(f, a))} (${eur0(f.proMonat)} / Monat)</option>`; }).join('')}</optgroup>`).join('');
    return `<div class="pp${p.weg ? ' pp-weg' : ''}" data-p="${i}">
      <input class="pp-name" data-feld="name" value="${esc(p.name)}" placeholder="Bezeichnung" aria-label="Bezeichnung">
      ${p.weg ? '' : `<label class="pp-betrag"><input type="number" data-feld="betrag" min="0" step="10" inputmode="decimal" value="${p.betrag === '' || p.betrag == null ? '' : esc(p.betrag)}" placeholder="0" aria-label="Betrag"><span>€</span></label>
      <select data-feld="rh" aria-label="Rhythmus"><option value="12"${+p.rh !== 1 ? ' selected' : ''}>pro Monat</option><option value="1"${+p.rh === 1 ? ' selected' : ''}>pro Jahr</option></select>`}
      <select class="pp-ersetzt" data-feld="ersetzt" aria-label="ersetzt einen Vertrag"><option value="">${p.weg ? 'Welcher Vertrag fällt weg?' : 'zusätzlich (ersetzt nichts)'}</option>${opt}</select>
      <button class="pp-x" data-entf="${i}" title="Position entfernen" aria-label="Position entfernen">×</button></div>`;
  }).join('');
  return `<div class="plan-kopf"><div><h3>Kann ich mir das leisten?</h3><p class="muted klein">Plane neue feste Kosten – etwa eine Wohnung mit neuer Miete – und sieh sofort, was danach im Monat bleibt. Der Plan wird nur in diesem Browser gemerkt.</p></div>
      ${plan.posten.length || plan.einmalig || plan.sparen ? '<button class="link" id="plan-leeren">Plan leeren</button>' : ''}</div>
    <div class="plan-vorlagen">${PLAN_VORLAGEN.map((v) => `<button class="chip-knopf" data-vorlage="${v.typ}">+ ${esc(v.knopf)}</button>`).join('')}</div>
    <div class="plan-inhalt">
      <div class="plan-eingabe">${posten || '<div class="plan-leer muted">Wähle oben, was du planst – zum Beispiel „Neue Wohnung“ – und trage den Betrag ein.</div>'}
        <label class="pp-einmal"><span>Einmalige Kosten <small class="muted">(Kaution, Umzug, Möbel, Anzahlung)</small></span><span class="pp-betrag"><input type="number" data-einmalig min="0" step="100" inputmode="decimal" value="${plan.einmalig || ''}" placeholder="0"><span>€</span></span></label>
        <div class="pp-sparen"><label for="plan-sparen">Und wenn du bei der Lebenshaltung sparst?</label>
          <div class="pp-sparen-z"><input type="range" id="plan-sparen" data-sparen min="0" max="40" step="5" value="${+plan.sparen || 0}"><span id="plan-sparen-t">${sparenText()}</span></div></div>
        ${lebenKatsHtml()}
      </div>
      <div class="plan-erg" id="plan-erg">${planErgebnisHtml()}</div>
    </div>`;
}

const sparenText = () => { const sp = +plan.sparen || 0; return sp ? `−${sp} % → ${eur0(fixKontext.L * (1 - sp / 100))} statt ${eur0(fixKontext.L)} (spart ${eur0((fixKontext.L * sp) / 100)})` : `nein – bleibt bei ${eur0(fixKontext.L)}`; };
// Wohin die Lebenshaltung geht (Ø je Monat), damit man sieht, wo sich sparen ließe
function lebenKatsHtml() {
  const lh = lebenshaltung(), ks = lh.kats.slice(0, 7);
  if (!ks.length) return '';
  const max = ks[0].c, rest = lh.schnitt - ks.reduce((s, x) => s + x.c, 0);
  return `<div class="pp-kats"><div class="fix-grafik-t">Wohin die Lebenshaltung geht <span class="muted">· Ø je Monat ${esc(monatsText(lh.monate))}</span></div>
    ${ks.map((k) => `<div class="pk"><span class="pk-n">${esc(schoen(k.kat))}</span><span class="pk-b"><i style="width:${(k.c / max) * 100}%"></i></span><b>${eur0(k.c)}</b></div>`).join('')}
    ${rest > 5000 ? `<div class="pk muted"><span class="pk-n">Übrige</span><span></span><b>${eur0(rest)}</b></div>` : ''}</div>`;
}

function planErgebnisHtml() {
  const { B, bz, pm, L, lauf, ruecklage } = fixKontext;
  const vk = new Map(lauf.map((f) => [vertragsKey(f), f]));
  let neu = 0, weg = 0, wohnNeu = 0, wohnAlt = 0, hatWohnung = false;
  const ersetzt = new Set();
  for (const p of plan.posten) {
    const c = p.weg ? 0 : Math.round(((+p.betrag || 0) * 100 * (+p.rh === 1 ? 1 : 12)) / 12);
    neu += c;
    const f = p.ersetzt && !ersetzt.has(p.ersetzt) ? vk.get(p.ersetzt) : null;
    if (f) { weg += f.proMonat; ersetzt.add(p.ersetzt); }
    if (p.typ === 'wohnung') { hatWohnung = true; wohnNeu += c; if (f) wohnAlt += f.proMonat; }
  }
  const einmal = Math.round((+plan.einmalig || 0) * 100);
  const sp = +plan.sparen || 0, L2 = L * (1 - sp / 100);
  const rest1 = B - pm - L, restL = B - pm - L2;   // restL: heutige Fixkosten mit der geplanten Lebenshaltung
  if (!plan.posten.length && !einmal && !sp) {
    return `<div class="plan-start"><div class="fix-grafik-t">Heute</div>${budgetBalken([{ fk: pm, l: L }], B)}
      <p class="klein">${rest1 >= 0 ? `Für neue feste Kosten hast du derzeit bis zu <b>${eur0(rest1)}</b> im Monat frei, mit 10 % Sparpuffer <b>${eur0(Math.max(0, rest1 - B * 0.1))}</b>.` : `Schon heute fehlen dir im Schnitt <b>${eur0(-rest1)}</b> im Monat – neue feste Kosten gehen nur, wenn anderes wegfällt oder die Lebenshaltung sinkt.`}</p></div>`;
  }
  const pm2 = pm + neu - weg, rest2 = B - pm2 - L2, puffer = B * 0.1;
  const urteil = rest2 >= puffer ? 'gut' : rest2 >= 0 ? 'knapp' : 'nein';
  const titel = { gut: 'Ja, das kannst du dir leisten', knapp: 'Knapp – das geht nur mit wenig Puffer', nein: 'So ist das nicht leistbar' }[urteil];
  const text = urteil === 'nein'
    ? `Dir würden jeden Monat <b>${eur0(-rest2)}</b> fehlen. Dafür müsstest du die Lebenshaltung ${sp ? 'um weitere' : 'um'} ${pzVon(-rest2, L2)} senken oder andere Verträge kündigen.`
    : urteil === 'knapp'
      ? `Es blieben <b>${eur0(rest2)}</b> im Monat (${pzVon(rest2, B)} ${esc(bz.vom)}). Empfohlen sind mindestens 10 % (${eur0(puffer)}) als Puffer zum Sparen und für Unvorhergesehenes.`
      : `Danach bleiben dir <b>${eur0(rest2)}</b> im Monat (${pzVon(rest2, B)} ${esc(bz.vom)}) zum Sparen und für Unvorhergesehenes.`;
  const d = neu - weg;
  const zeile = (l, a, b, gutWennKleiner = true, fmt = eur0) => {
    const diff = b - a;
    return `<tr><td>${l}</td><td class="r">${fmt(a)}</td><td class="r"><b>${fmt(b)}</b></td><td class="r ${!Math.round(diff / 100) ? 'muted' : (diff < 0) === gutWennKleiner ? 'pos' : 'neg'}">${!Math.round(diff / 100) ? '±0' : `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))}`}</td></tr>`;
  };
  const maxNull = weg + restL, maxPuffer = weg + restL - puffer;
  const andere = (neu - wohnNeu) - (weg - wohnAlt);
  let grenzen = maxNull > 0
    ? `<li>Neue Kosten alles zusammen höchstens <b>${eur0(Math.max(0, maxPuffer))}</b> pro Monat mit 10 % Sparpuffer, <b>${eur0(maxNull)}</b> bis zur Grenze (dann bleibt nichts mehr übrig)${weg ? ` – inklusive der ${eur0(weg)}, die wegfallen` : ''}.</li>`
    : `<li>Für neue Kosten ist derzeit nichts frei: ${weg ? `selbst mit den ${eur0(weg)}, die wegfallen, fehlen` : 'es fehlen'} noch ${eur0(-maxNull)} im Monat.</li>`;
  if (hatWohnung) {
    const netto = bz.reihe === 'lohn' ? B : einkommen().schnitt.wert;
    grenzen += `<li>Warmmiete höchstens <b>${eur0(Math.max(0, wohnAlt + restL - puffer - andere))}</b> mit Puffer bzw. <b>${eur0(Math.max(0, wohnAlt + restL - andere))}</b> bis zur Grenze.</li>
      <li class="muted">Faustregel von Vermietern und Banken: Warmmiete höchstens ein Drittel vom Netto – bei ${eur0(netto)} also ${eur0(netto / 3)}. Unterhalt und deine übrigen Fixkosten berücksichtigt sie nicht, deshalb zählt die Rechnung oben.</li>`;
  }
  let einmalHtml = '';
  if (einmal) {
    const danach = ruecklage - einmal, bedarf = pm2 + L2;
    einmalHtml = `<div class="plan-einmal ${danach >= 3 * bedarf ? 'gut' : danach >= 0 ? 'knapp' : 'nein'}"><div><b>Einmalig ${eur0(einmal)}</b> · auf deinen Konten liegen ${eur0(ruecklage)}
      → danach ${danach >= 0 ? `<b>${eur0(danach)}</b>, das reicht für ${NUM.format(Math.round((danach / bedarf) * 10) / 10)} Monate Ausgaben (empfohlen als Notgroschen: 3 Monate = ${eur0(3 * bedarf)}).` : `<b>fehlen ${eur0(-danach)}</b>${rest2 > 0 ? ` – mit deinem Spielraum in etwa ${Math.ceil(-danach / rest2)} Monaten angespart.` : '.'}`}</div>
      <div class="klein muted">Konten ohne Gemeinschaftskonto und Pockets, Mietkaution und die Konten der Kinder; Depot ist nicht enthalten.</div></div>`;
  }
  return `<div class="plan-urteil ${urteil}"><b>${titel}</b><div>${text}</div></div>
    ${budgetBalken([{ titel: 'Heute', fk: pm, l: L }, { titel: 'Mit Plan', fk: pm2, l: L2 }], B)}
    <table class="plan-tab"><thead><tr><th></th><th class="r">heute</th><th class="r">mit Plan</th><th class="r">Änderung</th></tr></thead><tbody>
      ${zeile('Fixkosten / Monat', pm, pm2)}
      ${zeile('Fixkostenquote', B ? (pm / B) * 10000 : 0, B ? (pm2 / B) * 10000 : 0, true, (v) => `${NUM.format(Math.round(v / 10) / 10)} %`).replace(/([+−][\d,]+) %<\/td><\/tr>$/, '$1 Pkt.</td></tr>')}
      ${sp ? zeile('Lebenshaltung / Monat', L, L2) : ''}
      ${zeile('Spielraum / Monat', rest1, rest2, false, (v) => (v < 0 ? `−${eur0(-v)}` : eur0(v)))}
      ${zeile('Fixkosten / Jahr', pm * 12, pm2 * 12)}
    </tbody></table>
    ${d || sp ? `<p class="klein muted">Dein Plan: ${d ? `${d > 0 ? '+' : '−'}${eur0(Math.abs(d))} feste Kosten pro Monat (${eur0(neu)} neu${weg ? `, ${eur0(weg)} fallen weg` : ''})` : 'feste Kosten unverändert'}. Lebenshaltung ${sp ? `sinkt um ${sp} % auf ${eur0(L2)}` : `bleibt bei ${eur0(L)}`}.</p>` : ''}
    <ul class="plan-grenzen">${grenzen}</ul>
    ${einmalHtml}`;
}

function planHinzu(typ) {
  const v = PLAN_VORLAGEN.find((x) => x.typ === typ);
  if (!v) return;
  let ersetzt = '';
  if (v.ersetztArt) {
    const f = fixKontext.lauf.filter((x) => fixArt(x) === v.ersetztArt && !plan.posten.some((p) => p.ersetzt === vertragsKey(x))).sort((a, b) => b.proMonat - a.proMonat)[0];
    if (f) ersetzt = vertragsKey(f);
  }
  plan.posten.push({ typ, name: v.name, betrag: '', rh: 12, ersetzt, weg: !!v.weg });
  planSpeichern();
  const box = $('#fix-plan');
  box.innerHTML = planHtml();
  const neu = box.querySelectorAll('.pp');
  neu[neu.length - 1]?.querySelector(v.weg ? 'select' : '[data-feld="betrag"]')?.focus();
}

function planBinden() {
  const box = $('#fix-plan');
  if (!box) return;
  box.addEventListener('click', (e) => {
    const v = e.target.closest('[data-vorlage]');
    if (v) { planHinzu(v.dataset.vorlage); return; }
    const x = e.target.closest('[data-entf]');
    if (x) { plan.posten.splice(+x.dataset.entf, 1); planSpeichern(); box.innerHTML = planHtml(); return; }
    if (e.target.closest('#plan-leeren')) { plan = { posten: [], einmalig: 0, sparen: 0 }; planSpeichern(); box.innerHTML = planHtml(); }
  });
  box.addEventListener('input', (e) => {
    const el = e.target, zeile = el.closest('[data-p]');
    if (zeile && el.dataset.feld) {
      const p = plan.posten[+zeile.dataset.p];
      p[el.dataset.feld] = el.type === 'number' ? (el.value === '' ? '' : +el.value) : el.value;
    } else if (el.matches('[data-einmalig]')) plan.einmalig = +el.value || 0;
    else if (el.matches('[data-sparen]')) { plan.sparen = +el.value || 0; $('#plan-sparen-t').textContent = sparenText(); }
    else return;
    planSpeichern();
    $('#plan-erg').innerHTML = planErgebnisHtml();
  });
}

// Verlauf Einkommen/Fixkosten (der Rest der Seite ist HTML)
function fixGrafikZeichnen() {
  if (!fixGrafik) return;
  const { B, bz, ek, verlauf: vl } = fixGrafik;
  const gruen = css('--ein'), rot = css('--aus');
  if (vl && $('#c-fix-verlauf')) {
    const reihe = ek[bz.reihe];
    const fix = vl.monate.map((_, i) => Math.round(vl.arten.reduce((t, a) => t + a.werte[i], 0)) / 100);
    const inc = vl.monate.map((m) => (m > ek.letzter ? null : Math.round((reihe.get(m) || 0) / 100)));
    const o = basis();
    o.interaction = { mode: 'index', intersect: false };
    o.plugins.legend = { display: true, position: 'top', align: 'end', labels: { color: css('--text-2'), boxWidth: 12, boxHeight: 3, font: { size: 12 } } };
    o.plugins.tooltip.callbacks = {
      title: (it) => { const [yy, mm] = vl.monate[it[0].dataIndex].split('-'); return `${MONAT[+mm - 1]} ${yy}`; },
      label: (it) => (it.raw == null ? null : ` ${it.dataset.label}: ${EUR0.format(it.raw)}`),
      footer: (it) => { const i = it[0].dataIndex; return inc[i] == null ? '' : `Bleibt: ${EUR0.format(inc[i] - fix[i])}`; },
    };
    o.scales = {
      x: { ...achsenStil(), grid: { display: false }, ticks: { ...achsenStil().ticks, maxRotation: 0, autoSkip: false,
        callback: (_, i) => { const [yy, mm] = vl.monate[i].split('-'); return mm === '01' ? yy : mm === '07' ? MON[6] : ''; } } },
      y: { ...achsenStil(), beginAtZero: true, ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 5 } },
    };
    zeichne('c-fix-verlauf', {
      type: 'line',
      data: { labels: vl.monate, datasets: [
        { label: bz.reihe === 'lohn' ? 'Nettogehalt' : 'Einnahmen', data: inc, borderColor: gruen, backgroundColor: alpha(gruen, 0.13), fill: { target: 1, above: alpha(gruen, 0.13), below: alpha(rot, 0.16) }, tension: 0.25, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2, spanGaps: false },
        { label: 'Fixkosten', data: fix, borderColor: rot, backgroundColor: rot, fill: false, tension: 0.25, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
        { label: bz.name, data: vl.monate.map(() => Math.round(B / 100)), borderColor: css('--muted'), borderDash: [5, 4], borderWidth: 1, pointRadius: 0, pointHoverRadius: 0, fill: false },
      ] },
      options: o,
    });
  }
}

// Fixkosten je Monat der letzten 36 Monate: je Vertrag die damals gültige Rate (einmalige Ausreißer ignoriert)
function fixVerlauf(vertraege, farbe) {
  const ende = D.bis.slice(0, 7), monate = [];
  let [y, m] = ende.split('-').map(Number);
  for (let i = 0; i < 36; i++) { monate.unshift(`${y}-${String(m).padStart(2, '0')}`); if (--m === 0) { m = 12; y--; } }
  const reihen = new Map();
  for (const f of vertraege) {
    const stufen = f.stufen.filter((x, i, a) => x.n > 1 || i === a.length - 1);
    const bis = f.aktiv ? ende : f.zuletzt.slice(0, 7);
    const art = fixArt(f);
    if (!reihen.has(art)) reihen.set(art, monate.map(() => 0));
    const werte = reihen.get(art);
    monate.forEach((mo, i) => {
      if (mo < f.seit.slice(0, 7) || mo > bis) return;
      const st = [...stufen].reverse().find((x) => x.von.slice(0, 7) <= mo) || stufen[0];
      werte[i] += (st.betrag * f.rh.proJahr) / 12;
    });
  }
  const arten = [...reihen].filter(([, w]) => w.some(Boolean)).sort((a, b) => b[1][b[1].length - 1] - a[1][a[1].length - 1] || b[1].reduce((s, x) => s + x, 0) - a[1].reduce((s, x) => s + x, 0));
  return { monate, arten: arten.map(([art, w]) => ({ art, werte: w, farbe: farbe.get(art) })) };
}

function fixGruppeUmschalten(art, nurAuf = false) {
  if (nurAuf) fixListeAuf = true;
  if (fixOffen.has(art) && !nurAuf) fixOffen.delete(art); else fixOffen.add(art);
  tabelle(parse(S.q));
  document.querySelector(`.fix-kopfzeile[data-fixgruppe="${CSS.escape(art)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ======================================================================= Herunterladen
function dateiname(teil) {
  const f = [S.jahr, monateWahl().map((m) => MON[m - 1]).join(' '), S.konto, S.kat, S.ukat, S.q && S.q.replace(/["|<>]/g, ' ')].filter(Boolean).join(' ');
  const heute = new Date().toISOString().slice(0, 10);
  return `Finanzen ${teil}${f ? ' – ' + f : ''} (${heute})`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function tabelleExport() {
  if (S.tab === 'uebersicht') {
    const p = pivotDaten();
    const spalten = [{ titel: p.unter ? 'Unterkategorie' : 'Kategorie', typ: 'text', breite: 28 }, ...p.cols.map((c) => ({ titel: p.label(c), typ: 'euro', breite: 12 })),
      { titel: 'Summe', typ: 'euro', breite: 14 }, { titel: `Ø ${p.jahr ? 'Monat' : 'Jahr'}`, typ: 'euro', breite: 12 },
      ...(p.diff ? [{ titel: `Veränderung ${p.cols[p.diff[0]]}→${p.cols[p.diff[1]]}`, typ: 'euro', breite: 18 }] : []),
      ...(p.vj ? [{ titel: V.label, typ: 'euro', breite: 16 }, { titel: 'Veränderung', typ: 'euro', breite: 13 }] : [])];
    const n = p.anzahl;
    const vjw = (jetzt, vorher) => (p.vj ? [vorher / 100, (jetzt - vorher) / 100] : []);
    const dw = (v) => (p.diff ? [(v[p.diff[1]] - v[p.diff[0]]) / 100] : []);
    const zeilen = [...p.rows.map((r) => [r.key, ...r.v.map((c) => c / 100), r.sum / 100, Math.round(r.sum / n) / 100, ...dw(r.v), ...vjw(r.sum, p.vj?.get(r.key) || 0)]),
      ['Ergebnis', ...p.sums.map((c) => c / 100), p.total / 100, Math.round(p.total / n) / 100, ...dw(p.sums), ...vjw(p.total, p.vjTotal)]];
    return { name: dateiname(p.jahr ? `Kategorien ${p.jahr}` : 'Kategorien'), blatt: 'Kategorien', spalten, zeilen };
  }
  if (S.tab === 'fix') {
    const alle = fixkostenGefiltert(parse(S.q));
    const liste = fixSichtbar(alle).sort((a, b) => (a.gemeinsam - b.gemeinsam) || fixArt(a).localeCompare(fixArt(b), 'de') || (b.aktiv - a.aktiv) || b.proMonat - a.proMonat);
    const pm = alle.filter((f) => f.aktiv && !f.gemeinsam).reduce((s, f) => s + f.proMonat, 0);
    const spalten = [{ titel: 'Art', typ: 'text', breite: 24 }, { titel: 'Bezeichnung', typ: 'text', breite: 26 }, { titel: 'Empfänger', typ: 'text', breite: 30 }, { titel: 'Verwendungszweck', typ: 'text', breite: 36 },
      { titel: 'Unterkategorie', typ: 'text', breite: 20 }, { titel: 'Konto', typ: 'text', breite: 20 }, { titel: 'Rhythmus', typ: 'text', breite: 14 }, { titel: 'Betrag', typ: 'euro' },
      { titel: 'pro Monat', typ: 'euro' }, { titel: 'pro Jahr', typ: 'euro' }, { titel: 'Anteil %', typ: 'zahl', breite: 9 }, { titel: 'Preisverlauf', typ: 'text', breite: 26 },
      { titel: 'seit', typ: 'datum' }, { titel: 'zuletzt', typ: 'datum' }, { titel: 'Zahlungen', typ: 'zahl', breite: 10 }, { titel: 'Status', typ: 'text', breite: 10 },
      { titel: 'Hinweis', typ: 'text', breite: 44 }];
    const r2 = (c) => Math.round(c) / 100;
    const zeilen = liste.map((f) => [fixArt(f), fixTitel(f, fixArt(f)), f.name, f.zweck, f.ukat, D.konten[f.k].name, f.rh.name, r2(-f.betrag), r2(-f.proMonat), r2(-f.proJahr),
      f.aktiv && pm && !f.gemeinsam ? Math.round((f.proMonat / pm) * 1000) / 10 : '', verlaufText(f), f.seit, f.zuletzt, f.n, f.aktiv ? 'läuft' : 'beendet',
      f.beitrag ? 'dein Beitrag aufs Gemeinschaftskonto' : f.gemeinsam ? 'vom Gemeinschaftskonto bezahlt – nicht in der Summe' : '']);
    zeilen.push(['Summe laufend', '', '', '', '', '', '', '', r2(-pm), r2(-pm * 12), 100, '', '', '', '', '', '']);
    return { name: dateiname('Fixkosten'), blatt: 'Fixkosten', spalten, zeilen };
  }
  if (S.tab === 'konten') {
    const tag = stichtag();
    const spalten = [{ titel: 'Konto', typ: 'text', breite: 28 }, { titel: 'Buchungen', typ: 'zahl', breite: 11 }, { titel: 'Einnahmen', typ: 'euro' }, { titel: 'Ausgaben', typ: 'euro' },
      { titel: `Kontostand ${dde(tag)}`, typ: 'euro', breite: 18 }, { titel: 'Genauigkeit', typ: 'text', breite: 40 }, { titel: 'Daten ab', typ: 'datum' }, { titel: 'Daten bis', typ: 'datum' },
      { titel: 'Lückenlos seit Eröffnung', typ: 'text', breite: 22 }];
    const zeilen = kontenDaten().map((x) => [x.k.name, x.n, x.ein / 100, x.aus / 100, x.st.c == null ? '' : x.st.c / 100, STATUS_TEXT[x.st.status], x.k.von, x.k.bis, x.k.vollstaendig ? 'ja' : 'nein']);
    return { name: dateiname(`Kontostände ${dde(tag)}`), blatt: 'Konten', spalten, zeilen };
  }
  const spalten = [{ titel: 'Datum', typ: 'datum', breite: 11 }, { titel: 'Konto', typ: 'text', breite: 20 }, { titel: 'Empfänger/Auftraggeber', typ: 'text', breite: 30 },
    { titel: 'Verwendungszweck', typ: 'text', breite: 50 }, { titel: 'Kategorie', typ: 'text', breite: 16 }, { titel: 'Unterkategorie', typ: 'text', breite: 20 },
    { titel: 'Art', typ: 'text', breite: 10 }, { titel: 'Betrag', typ: 'euro', breite: 13 }, { titel: 'Vertrag', typ: 'text' }, { titel: 'Tags', typ: 'text' }, { titel: 'Notiz', typ: 'text', breite: 24 }, { titel: 'Steuerkategorie (Buhl)', typ: 'text', breite: 26 }];
  const zeilen = sortiert().map((r) => [r.d, D.konten[r.k].name, r.g, r.z, r.kat, r.ukat, r.art, r.c / 100, r.v, r.t, r.n, r.st]);
  return { name: dateiname('Buchungen'), blatt: 'Buchungen', spalten, zeilen };
}

async function exportieren(format) {
  const x = tabelleExport();
  if (!x.zeilen.length) return toast('Nichts zum Herunterladen – keine Treffer.');
  try {
    if (format === 'csv') alsCsv(x.name, x.spalten, x.zeilen);
    else { toast('Excel-Datei wird erstellt …'); await alsExcel(x.name, x.blatt, x.spalten, x.zeilen); }
  } catch (e) { toast(e.message); }
}

function bildSpeichern(id) {
  const c = charts[id];
  if (!c) return;
  const canvas = c.canvas, out = document.createElement('canvas');
  out.width = canvas.width; out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = css('--surface'); ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  const titel = $({ 'c-verlauf': '#t-verlauf', 'c-kat': '#t-kat', 'c-ergebnis': '#t-ergebnis', 'c-top': '#t-top', 'c-jahre': '#t-jahre' }[id] || '#t-ergebnis').textContent;
  out.toBlob((b) => herunterladen(b, dateiname(titel) + '.png'));
}

// ======================================================================= Vorschläge beim Tippen
let vorschlagListe = [], vorschlagSel = -1;
function vorschlaege() {
  const inp = $('#q'), vor = inp.value.slice(0, inp.selectionStart ?? inp.value.length);
  const m = vor.match(/(?:^|\s)([^\s"]{2,})$/);
  const w = m ? norm(m[1].replace(/^-/, '')) : '';
  if (!m || m[1].startsWith('-') || /^[\d<>.,|€-]+$/.test(w) || w.includes('|')) return vorschlaegeZu();
  const out = [];
  for (const k of D.konten) if (norm(k.name).includes(w) && S.konto !== k.name) out.push({ typ: 'Konto', name: k.name, info: `${NUM.format(k.n)} Buchungen`, f: () => ({ konto: k.name }) });
  for (const k of D.kats) if (norm(k).includes(w) && S.kat !== k) out.push({ typ: 'Kategorie', name: k, info: '', f: () => ({ kat: k, ukat: '' }) });
  for (const [u, k] of D.ukatZu) if (norm(u).includes(w) && out.length < 5) out.push({ typ: 'Unterkat.', name: u, info: k, f: () => ({ kat: k, ukat: u }) });
  let n = 0;
  for (const e of D.emp) {
    if (n >= 6) break;
    if (e.key.includes(w)) { n++; out.push({ typ: 'Empfänger', name: e.name, info: `${NUM.format(e.n)}× · ${eur0(e.c)}`, q: `"${e.name}"` }); }
  }
  vorschlagListe = out.slice(0, 10);
  vorschlagSel = -1;
  if (!vorschlagListe.length) return vorschlaegeZu();
  const ul = $('#vorschlaege');
  ul.innerHTML = vorschlagListe.map((v, i) => `<li role="option" data-i="${i}"><span class="typ">${v.typ}</span><span class="name">${esc(v.name)}</span><span class="info">${esc(v.info)}</span></li>`).join('');
  ul.hidden = false;
  ul.querySelectorAll('li').forEach((li) => li.onmousedown = (e) => { e.preventDefault(); vorschlagNehmen(+li.dataset.i); });
  ul._wort = m[1];
}
function vorschlaegeZu() { $('#vorschlaege').hidden = true; vorschlagListe = []; vorschlagSel = -1; }
function vorschlagNehmen(i) {
  const v = vorschlagListe[i], wort = $('#vorschlaege')._wort;
  if (!v) return;
  const idx = S.q.lastIndexOf(wort);
  let q = idx >= 0 ? S.q.slice(0, idx) + (v.q || '') + S.q.slice(idx + wort.length) : S.q;
  q = q.replace(/\s+/g, ' ').trim();
  vorschlaegeZu();
  setze({ q: q && v.q ? q + ' ' : q, ...(v.f ? v.f() : {}) });
  $('#q').focus();
}

// ======================================================================= Ablauf
// Jede Änderung von Filter oder Bereich ist ein Schritt im Browser-Verlauf: Die Zurück-Taste der Maus, Alt + ← und der
// Knopf „Zurück“ führen zur vorherigen Ansicht. Beim Tippen zählt ein ganzes Suchwort als ein Schritt.
let tippt = false;
let stufe = 0;   // eigene Schritte im Browser-Verlauf
const ZUSTAND = ['q', 'jahr', 'monat', 'konto', 'kat', 'ukat', 'art', 'umb', 'tab', 'stichtag'];
const zustand = (x) => JSON.stringify(ZUSTAND.map((k) => x[k]));

function setze(p, { tippen = false } = {}) {
  const vorher = zustand(S), tabVorher = S.tab;
  Object.assign(S, p);
  if ('kat' in p && !('ukat' in p)) S.ukat = '';
  const neu = zustand(S) !== vorher && !(tippen && tippt);
  tippt = tippen;
  limit = 150; offen.clear();
  aktualisieren(neu ? 'neu' : 'ersetzen');
  if (S.tab !== tabVorher) window.scrollTo({ top: 0 });
}

function zurueck() {
  if (stufe > 0) history.back();
}

function aktualisieren(hist = 'ersetzen') {
  if (!D) return;
  const conds = filtern();
  hashSchreiben(hist);
  const t = S.tab;
  $('#tabs').hidden = false;
  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  $('#tab-n').textContent = NUM.format(F.length);
  $('#werkzeug').hidden = t === 'steuer' || t === 'start';
  $('#kpis').hidden = !['kennzahlen', 'buchungen', 'uebersicht'].includes(t);
  $('#fuss').hidden = t === 'start';
  document.body.classList.toggle('ue-modus', t === 'start');
  $('#seite-start').hidden = t !== 'start';
  $('#seite-kennzahlen').hidden = t !== 'kennzahlen';
  $('#tabelle-card').hidden = t === 'start' || t === 'kennzahlen';
  filterZeigen(conds);
  // jede Grafik für sich: ein Fehler in einer soll die anderen nicht leer lassen
  const sicher = (f) => { try { return f(); } catch (e) { console.error(e); return null; } };
  if (!$('#kpis').hidden) sicher(() => kennzahlen(conds));
  if (t === 'start') sicher(uebersicht);
  else if (t === 'kennzahlen') { const x = sicher(durchschnitte); sicher(() => wohinDasGeldGeht(x)); sicher(jahresschnitt); sicher(ergebnis); sicher(topEmpfaenger); sicher(() => katSchnitt(x)); }
  else tabelle(conds);
}

function hashSchreiben(hist = 'ersetzen') {
  const p = new URLSearchParams();
  for (const k of ['q', 'jahr', 'monat', 'konto', 'kat', 'ukat', 'stichtag']) if (S[k]) p.set(k, S[k]);
  if (S.art !== 'alle') p.set('art', S.art);
  if (S.umb) p.set('umb', '1');
  if (S.tab !== 'start') p.set('tab', S.tab);
  const h = p.toString(), url = h ? '#' + h : location.pathname + location.search;
  if (hist === 'neu') { stufe++; history.pushState({ fd: stufe }, '', url); }
  else if (hist === 'ersetzen') history.replaceState({ fd: stufe }, '', url);
}
let ersterStart = true;
function hashLesen() {
  const p = new URLSearchParams(location.hash.slice(1));
  S = { ...S0, sort: S.sort, dir: S.dir };
  // Grundeinstellung beim Öffnen ohne Auswahl in der Adresse: das aktuelle Jahr (ohne Daten dafür: das letzte Jahr mit Daten)
  if (ersterStart && D && ![...p.keys()].length) {
    const jetzt = new Date().getFullYear();
    S.jahr = String(D.rows.some((r) => r.y === jetzt) ? jetzt : +D.bis.slice(0, 4));
  }
  if (D) ersterStart = false;
  for (const k of ['q', 'jahr', 'monat', 'konto', 'kat', 'ukat']) if (p.get(k)) S[k] = p.get(k);
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.get('stichtag') || '')) S.stichtag = p.get('stichtag');
  if (['aus', 'ein'].includes(p.get('art'))) S.art = p.get('art');
  S.umb = p.get('umb') === '1';
  if (['kennzahlen', 'buchungen', 'uebersicht', 'konten', 'fix', 'steuer'].includes(p.get('tab'))) S.tab = p.get('tab');
}

function standZeigen() {
  const j = D.j;
  $('#stand').textContent = `${NUM.format(D.rows.length)} Buchungen · ${dde(D.von)} – ${dde(D.bis)}`;
  const mail = Q.kontoEmail?.();
  const herkunft = { drive: `aus Google Drive${mail ? ` (${mail})` : ''}`, pc: `aus der verknüpften Datei ${quelle.name} auf diesem PC`, datei: `aus der Datei ${quelle.name}`, lokal: 'lokale Testdaten' }[quelle.quelle] || '';
  const erstellt = j.erstellt ? `${dde(j.erstellt.slice(0, 10))}, ${j.erstellt.slice(11, 16)} Uhr` : '';
  $('#fuss').textContent = `Daten ${herkunft}, erstellt am ${erstellt}. Neue Kontodaten einfach in Google Drive › 10 Finanzen › Eingang legen – der PC übernimmt sie automatisch; danach hier ↻.`;
  $('#menu-quelle').textContent = `Aktuell: ${NUM.format(D.rows.length)} Buchungen ${herkunft}, erstellt am ${erstellt}.`;
  $('#btn-neu').hidden = false;
  $('#btn-neu').title = 'Neue Dateien aus dem Eingang (Google Drive › 10 Finanzen › Eingang) einlesen und die neuesten Daten laden';
  if ($('#m-pc-tipp')) $('#m-pc-tipp').hidden = !Q.pcMoeglich() || quelle.quelle === 'pc';
  if (quelle.quelle === 'pc') Q.pcErlaubnis?.().then((z) => {
    const t = { granted: 'Zugriff dauerhaft erlaubt – die App lädt neue Daten beim Öffnen automatisch.', prompt: 'Der Browser fragt beim Öffnen nach Erlaubnis („Bei jedem Besuch zulassen“ wählen).', denied: 'Zugriff wurde verweigert – Datei neu verknüpfen.' }[z];
    if (t) $('#menu-quelle').textContent += ' ' + t;
  }).catch(() => {});
}

function anzeigen(v) {
  const j = Q.pruefen(v.text);
  quelle = v;
  D = aufbereiten(j);
  chatDaten(D);
  steuerDaten(D).then(() => { if (S.tab === 'steuer') tabelle(parse(S.q)); else if (S.tab === 'start') { try { uebersicht(); } catch (e) { console.error(e); } } });
  hashLesen();
  selectsFuellen();
  $('#start').hidden = true;
  $('#dash').hidden = false;
  standZeigen();
  aktualisieren();
}

let toastT;
function toast(t) {
  const el = $('#toast');
  el.textContent = t; el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 3800);
}

// Verknüpfte Datei auf diesem PC: beim Öffnen still prüfen, bei ↻ notfalls um Erlaubnis bitten
// Hinweisbalken oben: Der Browser möchte beim neuen Öffnen einmal bestätigt haben, dass die App die Datei lesen darf
function erlaubnisBalken(an) {
  let b = $('#erlaubnis');
  if (!an) { b?.remove(); return; }
  if (b) return;
  b = document.createElement('div');
  b.id = 'erlaubnis'; b.className = 'balken';
  b.innerHTML = `<div><b>Neueste Daten aus deiner verknüpften Datei laden?</b>
    <div class="klein">Ein Klick genügt. Der Browser fragt dann nach Erlaubnis – wähle <b>„Bei jedem Besuch zulassen“</b>, dann lädt die App künftig beim Öffnen automatisch und dieser Hinweis kommt nicht wieder.</div></div>
    <button class="btn primary">Daten laden</button>`;
  b.querySelector('button').onclick = () => pcHolen(true);
  $('#dash').prepend(b);
}

async function pcHolen(interaktiv) {
  const btn = $('#btn-neu');
  btn.classList.add('dreht');
  try {
    const neu = await Q.pcLaden(quelle, interaktiv);
    btn.classList.remove('hinweis');
    erlaubnisBalken(false);
    if (neu) { anzeigen(neu); toast('Neue Daten geladen.'); } else if (interaktiv) toast('Die Daten sind aktuell.');
  } catch (e) {
    if (e.erlaubnis) { btn.classList.add('hinweis'); btn.title = 'Zugriff auf die Datei erlauben und neueste Daten laden'; erlaubnisBalken(true); }
    else if (interaktiv) toast(e.message);
  } finally { btn.classList.remove('dreht'); }
}

// ======================================================================= Daten einlesen (Knopf oben)
// Am PC übernimmt der Einlese-Dienst (einlese_dienst.py, nur auf diesem PC erreichbar) sofort neue Dateien aus dem
// Eingang; danach lädt die App die neuen Daten. Ohne Dienst (Handy, anderer PC) werden nur die neuesten Daten geladen –
// den Eingang verarbeitet dann der PC automatisch alle 30 Minuten.
const DIENST = 'http://127.0.0.1:48233';
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
async function dienst(pfad, methode = 'GET') {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 3000);
  try {
    const r = await fetch(DIENST + pfad, { method: methode, headers: { 'X-Finanzen': '1' }, signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally { clearTimeout(t); }
}

// neueste Daten aus der jeweiligen Quelle laden (ohne eigene Meldungen); true = es gab neue Daten
async function datenNeuLaden(fragen) {
  try {
    if (quelle?.quelle === 'pc') { const neu = await Q.pcLaden(quelle, fragen); erlaubnisBalken(false); if (neu) anzeigen(neu); return !!neu; }
    if (quelle?.quelle === 'drive') {
      if (!Q.hatToken()) { if (!fragen) return false; await Q.anmelden(); }
      const neu = await Q.driveLaden(quelle); if (neu) anzeigen(neu); return !!neu;
    }
    if (quelle?.quelle === 'lokal') { const neu = await Q.lokalLaden(); if (neu && neu.text !== quelle.text) { anzeigen(neu); return true; } }
  } catch (e) { if (e.erlaubnis) erlaubnisBalken(true); else if (fragen) toast(e.message); }
  return false;
}

let einlesenLaeuft = false;
async function einlesen() {
  if (einlesenLaeuft) return;
  const btn = $('#btn-neu'), txt = btn.querySelector('span');
  einlesenLaeuft = true; btn.classList.add('dreht'); btn.disabled = true;
  try {
    // Zugriff auf die verknüpfte Datei jetzt erfragen, solange der Klick noch „frisch“ ist
    if (quelle?.quelle === 'pc') await datenNeuLaden(true);
    let st = null;
    try { st = await dienst('/einlesen', 'POST'); } catch { st = null; }
    if (!st) {
      if (quelle?.quelle !== 'pc') await datenNeuLaden(true);
      return einlesenMeldung({ ohneDienst: true });
    }
    const start = Date.now(), seit = st.gestartet;
    txt.textContent = 'Wird eingelesen …';
    while (st.laeuft && Date.now() - start < 20 * 60e3) {
      await warte(2500);
      try { st = await dienst('/status'); } catch { /* weiter warten */ }
    }
    const e = st.letztes && (!seit || st.letztes.zeit >= seit.slice(0, 19)) ? st.letztes : null;
    let neu = await datenNeuLaden(false);
    // Google Drive braucht nach dem Aufbau etwas, bis die neue Datei hochgeladen ist
    for (let i = 0; !neu && quelle?.quelle === 'drive' && e?.status === 'aufgebaut' && i < 4; i++) { await warte(8000); neu = await datenNeuLaden(false); }
    einlesenMeldung({ e, automatisch: st.automatisch });
  } finally {
    einlesenLaeuft = false; btn.classList.remove('dreht'); btn.disabled = false; txt.textContent = 'Daten einlesen';
  }
}

function einlesenMeldung({ e, ohneDienst, automatisch }) {
  let dlg = $('#dlg-einlesen');
  if (!dlg) { dlg = Object.assign(document.createElement('dialog'), { id: 'dlg-einlesen', className: 'dlg' }); document.body.append(dlg); }
  const stand = D?.j?.erstellt ? `${dde(D.j.erstellt.slice(0, 10))}, ${D.j.erstellt.slice(11, 16)} Uhr` : '';
  let h;
  if (ohneDienst) {
    const pc = matchMedia('(pointer: fine)').matches && !/android|iphone|ipad/i.test(navigator.userAgent);
    h = `<h2>Neueste Daten geladen</h2><p>Datenstand: <b>${stand}</b>.</p>
      <p class="muted">Neue Dateien im Eingang (Google Drive › 10 Finanzen › Eingang) übernimmt dein PC automatisch – bei der Anmeldung und alle 30 Minuten, solange er an ist. Am PC geht es mit diesem Knopf auch sofort.</p>
      ${pc ? '<p class="klein muted">Hinweis: Auf diesem PC antwortet der Einlese-Dienst gerade nicht. Er startet bei der nächsten Windows-Anmeldung automatisch. Fragt der Browser, ob die Seite auf Geräte im lokalen Netzwerk zugreifen darf, bitte „Zulassen“ wählen.</p>' : ''}`;
  } else if (!e) {
    h = `<h2>Eingang geprüft</h2><p>${automatisch ? 'Der automatische Durchgang lief gerade und ist fertig.' : 'Fertig.'} Datenstand: <b>${stand}</b>.</p>`;
  } else if (e.status === 'keine_aenderung') {
    h = `<h2>Keine neuen Dateien</h2><p>Im Eingang lag nichts Neues – die Daten sind aktuell (Stand <b>${stand}</b>).</p>
      <p class="muted">Neue Kontodaten einfach in Google Drive › 10 Finanzen › Eingang legen und dann noch einmal „Daten einlesen“.</p>`;
  } else if (e.status === 'fehler') {
    h = `<h2>Einlesen hat nicht geklappt</h2><p class="neg">${esc(e.fehler || 'Unbekannter Fehler')}</p><p class="muted">Die bisherigen Daten bleiben unverändert. Der PC versucht es in 30 Minuten noch einmal.</p>`;
  } else {
    // neue Buchungen insgesamt = Liste nachher − vorher (die Zahlen je Datei zählen, was nur diese Datei enthält)
    const neuGes = e.buchungen != null && e.vorher != null ? Math.max(0, e.buchungen - e.vorher) : e.uebernommen.reduce((t, x) => t + (x.neu || 0), 0);
    h = `<h2>Daten eingelesen</h2>
      <p>${e.uebernommen.length ? `<b>${NUM.format(e.uebernommen.length)} ${e.uebernommen.length === 1 ? 'Datei' : 'Dateien'}</b> übernommen, <b>${NUM.format(neuGes)} neue Buchungen</b> – Doppeltes herausgerechnet.` : 'Die Daten wurden neu aufgebaut.'}
        ${e.buchungen ? ` Jetzt ${NUM.format(e.buchungen)} Buchungen insgesamt.` : ''}</p>
      ${e.uebernommen.length ? `<table class="hilfe-tab">${e.uebernommen.map((x) => `<tr><td>${esc(x.datei)}<div class="klein muted">${esc(x.art)}</div></td><td class="r"><b class="${x.neu ? 'pos' : 'muted'}">${NUM.format(x.neu || 0)} neu</b><div class="klein muted">${NUM.format(x.doppelt || 0)} schon vorhanden</div></td></tr>`).join('')}</table>` : ''}
      ${e.nicht.length ? `<p class="neg"><b>Nicht übernommen:</b></p><table class="hilfe-tab">${e.nicht.map((x) => `<tr><td>${esc(x.datei)}</td><td class="klein">${esc(x.status)}</td></tr>`).join('')}</table>` : ''}
      <p class="klein muted">Übernommene Dateien liegen jetzt in Eingang › verarbeitet. Datenstand: ${stand}.</p>`;
  }
  dlg.innerHTML = `${h}<form method="dialog" class="dlg-knoepfe">${D ? '<button class="btn" value="details" id="einlesen-details">Alle Dateien im Eingang</button>' : ''}<button class="btn primary" value="ok">OK</button></form>`;
  dlg.querySelector('#einlesen-details')?.addEventListener('click', () => setTimeout(() => setze({ tab: 'konten' }), 0));
  if (!dlg.open) dlg.showModal();
}

async function driveHolen(interaktiv) {
  const btn = $('#btn-neu');
  btn.classList.add('dreht');
  try {
    if (!Q.hatToken()) { if (!interaktiv) return; await Q.anmelden(); }
    const neu = await Q.driveLaden(quelle);
    if (neu) { anzeigen(neu); if (interaktiv || quelle) toast('Neue Daten geladen.'); }
    else if (interaktiv) toast('Die Daten sind aktuell.');
    return true;
  } catch (e) {
    if (e.auth && interaktiv) { try { await Q.anmelden(); return driveHolen(false); } catch (e2) { toast(e2.message); } }
    else if (interaktiv) throw e;
  } finally { btn.classList.remove('dreht'); }
}

function startZeigen(fehler) {
  $('#dash').hidden = true;
  $('#start').hidden = false;
  $('#stand').textContent = '';
  $('#btn-neu').hidden = true;
  const f = $('#start-fehler');
  f.hidden = !fehler; f.textContent = fehler || '';
  // Hilfe für den Fall, dass der Browser beim Schließen alle Websitedaten löscht (dann erscheint diese Seite jedes Mal)
  if (!$('#start-hilfe')) {
    const d = document.createElement('details');
    d.id = 'start-hilfe'; d.className = 'start-hilfe';
    d.innerHTML = `<summary>Siehst du diese Seite bei jedem Öffnen?</summary>
      <p>Dann löscht dein Browser beim Schließen die gespeicherten Websitedaten (auf Firmenrechnern oft so eingestellt, auch im InPrivate- bzw. Inkognito-Fenster). Die App vergisst dann Verknüpfung, Daten und Anmeldung. Abhilfe: die App als Ausnahme eintragen.</p>
      <p><b>Edge:</b> in die Adresszeile <code>edge://settings/content/cookies</code> eingeben → bei „Zulassen“ auf „Hinzufügen“ → <code>mwenzelides-privat.github.io</code>. Steht die Seite unter „Cookies beim Schließen löschen“, dort entfernen.</p>
      <p><b>Chrome:</b> <code>chrome://settings/content/siteData</code> → bei „Dürfen immer Daten auf deinem Gerät speichern“ (sinngemäß) auf „Hinzufügen“ → <code>mwenzelides-privat.github.io</code>.</p>
      <p class="muted">Lässt die IT-Vorgabe keine Ausnahme zu, bleibt nur das erneute Verknüpfen oder die App auf dem Handy.</p>`;
    $('.start-card').append(d);
  }
}

function themeSetzen(t) {
  if (t) { try { localStorage.setItem('fd.theme', t); } catch {} }
  let cur = 'light';   // Standard: hell
  try { cur = localStorage.getItem('fd.theme') || 'light'; } catch {}
  if (cur === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = cur;
  document.querySelectorAll('#m-theme button').forEach((b) => b.classList.toggle('an', b.dataset.v === cur));
  if (D) aktualisieren('keins');
}

function events() {
  let t;
  $('#q').addEventListener('input', () => { clearTimeout(t); vorschlaege(); t = setTimeout(() => setze({ q: $('#q').value }, { tippen: true }), 140); });
  $('#q').addEventListener('keydown', (e) => {
    const ul = $('#vorschlaege');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (ul.hidden) return;
      e.preventDefault();
      vorschlagSel = (vorschlagSel + (e.key === 'ArrowDown' ? 1 : -1) + vorschlagListe.length) % vorschlagListe.length;
      ul.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', String(i === vorschlagSel)));
    } else if (e.key === 'Enter') {
      if (!ul.hidden && vorschlagSel >= 0) { e.preventDefault(); vorschlagNehmen(vorschlagSel); }
      else { vorschlaegeZu(); clearTimeout(t); setze({ q: $('#q').value }); }
    } else if (e.key === 'Escape') { if (!ul.hidden) { e.preventDefault(); vorschlaegeZu(); } }
  });
  $('#q').addEventListener('blur', () => setTimeout(vorschlaegeZu, 120));
  $('#q').addEventListener('search', () => { if (!$('#q').value) setze({ q: '' }); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#f-jahr-liste').hidden) { jahrMenu(false); $('#f-jahr').focus(); return; }
    if ((e.key === '/' || (e.key === 'k' && (e.ctrlKey || e.metaKey))) && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      e.preventDefault(); $('#q').focus(); $('#q').select();
    }
  });
  $('#q-hilfe').onclick = () => $('#dlg-hilfe').showModal();
  $('#beispiele').querySelectorAll('button').forEach((b) => b.onclick = () => { $('#dlg-hilfe').close(); setze({ q: b.textContent }); });
  $('#f-jahr').onclick = () => jahrMenu();
  document.addEventListener('click', (e) => { if (!$('#f-jahr-box').contains(e.target)) jahrMenu(false); });
  $('#f-mehr-knopf').onclick = () => { filterMehr = !filterMehr; try { localStorage.setItem('fd.filtermehr', filterMehr ? '1' : ''); } catch {} filterZeigen(parse(S.q)); };
  $('#f-konto').onchange = (e) => setze({ konto: e.target.value });
  $('#f-kat').onchange = (e) => setze({ kat: e.target.value, ukat: '' });
  $('#f-umb').onchange = (e) => setze({ umb: e.target.checked });
  document.querySelectorAll('#f-art button').forEach((b) => b.onclick = () => setze({ art: b.dataset.v }));
  $('#f-reset').onclick = () => setze({ ...S0, tab: S.tab, sort: S.sort, dir: S.dir });
  $('#f-zurueck').onclick = zurueck;
  document.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => setze({ tab: b.dataset.tab }));
  $('#ue-alle-kat').onclick = () => setze({ tab: 'uebersicht', kat: '', ukat: '' });
  $('#dl-xlsx').onclick = () => exportieren('xlsx');
  $('#dl-csv').onclick = () => exportieren('csv');
  document.querySelectorAll('[data-bild]').forEach((b) => b.onclick = () => bildSpeichern(b.dataset.bild));

  $('#btn-menu').onclick = () => $('#dlg-menu').showModal();
  $('#btn-neu').onclick = () => einlesen();
  const pcKnopf = async (dialog) => {
    try { anzeigen(await Q.pcVerknuepfen()); if (dialog) $('#dlg-menu').close(); toast('Datei verknüpft – die App lädt sie ab jetzt automatisch.'); }
    catch (e) { if (e.name !== 'AbortError') (dialog ? toast : startZeigen)(e.message); }
  };
  for (const [id, dialog] of [['#m-pc', true], ['#start-pc', false]]) {
    const b = $(id);
    if (b) { b.onclick = () => pcKnopf(dialog); b.hidden = !Q.pcMoeglich(); }
  }
  $('#m-drive').onclick = async () => {
    try { await Q.anmelden(); const ok = await driveHolen(false); if (ok) { $('#dlg-menu').close(); } } catch (e) { toast(e.message); }
  };
  $('#m-datei').onclick = async () => { try { anzeigen(await Q.dateiWaehlen()); $('#dlg-menu').close(); toast('Daten geladen.'); } catch (e) { toast(e.message); } };
  document.querySelectorAll('#m-theme button').forEach((b) => b.onclick = () => themeSetzen(b.dataset.v));
  $('#m-leeren').onclick = async () => {
    if (!confirm('Anmeldung und gespeicherte Daten auf diesem Gerät löschen?')) return;
    await Q.geraetLeeren();
    chatVergessen();
    D = null; quelle = null;
    $('#dlg-menu').close();
    history.replaceState(null, '', location.pathname);
    $('#tabs').hidden = true;
    startZeigen();
  };
  $('#start-drive').onclick = async () => {
    try { await Q.anmelden(); const v = await Q.driveLaden(null); anzeigen(v); }
    catch (e) { startZeigen(e.message); }
  };
  $('#start-datei').onclick = async () => { try { anzeigen(await Q.dateiWaehlen()); } catch (e) { startZeigen(e.message); } };
  // Zurück/Vor (Maustasten, Alt + ←/→, Browser-Knöpfe) und von Hand geänderte Adresse
  window.addEventListener('popstate', (e) => {
    if (!D) return;
    stufe = e.state?.fd ?? 0;
    hashLesen();
    limit = 150; offen.clear(); jahrMenu(false);
    aktualisieren('keins');
  });
  let breiteT, breiteAlt = 0;
  new ResizeObserver(() => {
    clearTimeout(breiteT);
    breiteT = setTimeout(() => { const w = $('#tab-inhalt').clientWidth; if (D && S.tab === 'uebersicht' && Math.abs(w - breiteAlt) > 20) { breiteAlt = w; tabelle(parse(S.q)); } }, 150);
  }).observe($('#tab-inhalt'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => themeSetzen());
}

async function start() {
  events();
  chatStart({ setze: (p) => setze(p), fixkosten: () => fixkostenErkennen() });
  themeSetzen();
  let v = null;
  if (LOKAL) v = await Q.lokalLaden().catch(() => null);
  if (!v) v = await Q.cacheLesen();
  Q.vorladen?.();
  // Gespeicherte Daten vor dem automatischen Aufräumen des Browsers schützen
  navigator.storage?.persist?.().catch(() => {});
  if (v) {
    try { anzeigen(v); } catch (e) { return startZeigen(e.message); }
    if (v.quelle === 'drive') driveHolen(false).catch(() => {});
    if (v.quelle === 'pc') pcHolen(false);
  } else startZeigen();
  if ('serviceWorker' in navigator && !LOKAL) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
