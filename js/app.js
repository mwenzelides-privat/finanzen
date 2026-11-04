// Finanzen – Dashboard: Übersicht, Kennzahlen, Buchungen, Kategorien, Fixkosten, Konten, Steuer. Jede Seite: ein Satz als Antwort,
// wenige erklärte Kennzahlen und Grafiken, ein Ausblick; Suche und Filter gibt es bei den Buchungen.
import { norm, parse, matcher, highlightWords } from './suche.js';
import * as Q from './quelle.js';
import { alsExcel, alsCsv, herunterladen } from './export.js';
import { chatStart, chatDaten, chatVergessen } from './chat.js';
import { kontostaende, summeKonten, STATUS_TEXT } from './salden.js';
import { steuerDaten, steuerZeigen, postenOptionen, steuerPosten, steuerZuordnen, steuerStand, abschnittSumme } from './steuer.js';
import { gehaltZeigen, gehaltUeberblick } from './gehalt.js';
import { entscheidungenAnwenden, entscheidungenLaden, pruefenSeite, pruefenBinden, pruefenGeoeffnet, det, gruppenSchluessel, offenZahl, ibanText } from './pruefen.js';
import { prognoseLaden, prognoseKarte, prognoseBinden, prognoseFristen, prognoseRechnen } from './steuerprognose.js';
import { unterhaltLaden, unterhaltSeite, unterhaltBinden, unterhaltFristen, kinder, ausgleichTags, unterhaltKurz } from './unterhalt.js';
import { fristenLaden, fristenKarte, fristenListe, fristenBinden, fristenAlle, icsText } from './fristen.js';
import { waechterLaden, istNeu, waechterKarte, neuLeiste, chip, waechterBinden, treffer } from './waechter.js';
import { planGehalt, prognoseText, rahmenKarte, freiZeile, rahmenBinden, rahmenStand } from './planung.js';
import { vermoegenLaden, depotKarte, vermoegenKarte, vermoegenBinden, reisenSeite, reisenBinden, vermoegen, reisen } from './vermoegen.js';

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
// Heutiges Datum in Ortszeit (JJJJ-MM-TT) – toISOString() wäre UTC, zwischen 0 und 2 Uhr also noch der Vortag
const heuteLokal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

let D = null;          // aufbereitete Daten
let H = null;          // Helfer für die Zusatzmodule (modulHelfer), gebaut beim ersten Anzeigen
// Zusatzmodule: ein Fehler darin soll die Seite nicht leeren – dann fehlt nur dieser Teil ('' = nichts anzeigen)
const sicher = (f) => { try { return f() ?? ''; } catch (e) { console.error(e); return ''; } };
let quelle = null;     // gespeicherte Fassung (Text + Herkunft)
const S0 = { q: '', jahr: '', monat: '', konto: '', kat: '', ukat: '', art: 'alle', umb: false, tab: 'start', sort: 'datum', dir: -1, stichtag: '', wahl: '', kart: 'aus', fixtab: 'vertraege', zr: '', nf: '', neu: '', vertrag: '', reise: '',
  // Auswahl in Steuer (Jahr, Filter, Abschnitt) und Gehalt (Monat, Vergleich, Tabellenjahr); leer = Grundeinstellung des Reiters
  sjahr: '', sfilter: '', sabf: '', gmonat: '', gbasis: '', gtjahr: '' };
let S = { ...S0 };
let F = [];            // gefilterte Buchungen (nach Datum aufsteigend)
let limit = 150;
const offen = new Set();
const charts = {};

// ======================================================================= Daten aufbereiten
const suchText = (r, konten) => norm(`${r.g} ${r.ga.join(' ')} ${r.z} ${r.kat} ${r.ukat} ${konten[r.k].name} ${r.v} ${r.t} ${r.n} ${r.st}`);
function aufbereiten(j) {
  const K = j.kategorien, U = j.unterkategorien, A = j.arten, konten = j.konten, ST = j.steuerkategorien || [];
  const rows = j.buchungen.map((b, i) => {
    const [d, k, c, g, z, kat, ukat, art, v, t, n, st, frueher] = b;
    const r = { i, d, y: +d.slice(0, 4), m: +d.slice(5, 7), k, c, g, z, kat: K[kat], ukat: U[ukat], art: A[art], v, t, n };
    r.ga = frueher || [];   // frühere Namen der Gegenseite (Finanzguru benennt Empfänger manchmal um)
    r.st = ST[st] || '';
    r.s = suchText(r, konten);
    return r;
  });
  // eigene Kategorie-Entscheidungen (Reiter Kategorien › Prüfen) wirken sofort, auch bevor der PC neu aufgebaut hat
  for (const r of entscheidungenAnwenden(rows, j)) r.s = suchText(r, konten);
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
    j, konten, rows, von: j.von, bis: j.bis > heuteLokal() ? heuteLokal() : j.bis,   // Valuta in der Zukunft verschiebt „heute“ nicht
    jahre: [...new Set(rows.map((r) => r.y))].sort((a, b) => a - b),
    kats: K.filter(Boolean).sort((a, b) => a.localeCompare(b, 'de')),
    ukatZu, emp: [...emp.values()].sort((a, b) => b.n - a.n),
    kontoIdx: new Map(konten.map((k, i) => [k.name, i])),
    proKonto: konten.map((_, i) => rows.filter((r) => r.k === i)),
  };
}

// ======================================================================= Filtern
// Gewählte Jahre: S.jahr ist „2025“ oder „2023,2025“ (mehrere = zusammen anzeigen)
const jahreWahl = () => (S.jahr ? String(S.jahr).split(',').map(Number).filter(Boolean).sort((a, b) => a - b) : []);
const einJahr = () => { const j = jahreWahl(); return j.length === 1 ? j[0] : 0; };
// Gewählte Monate: S.monat ist „3“ oder „1,2,3“
const monateWahl = () => (S.monat ? String(S.monat).split(',').map(Number).filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b) : []);

// Prüffunktion für alle Filter; mitJahr = false lässt Jahr und Zeitangaben der Suche weg (für den Vorjahresvergleich),
// mitArt = false den Filter „nur Einnahmen/Ausgaben“ (für die Kennzahlen, die immer beide Seiten zeigen)
function pruefer(conds, mitJahr = true, mitArt = true) {
  const test = matcher(mitJahr ? conds : conds.filter((c) => c.kind !== 'zeit'));
  const jahre = mitJahr ? jahreWahl() : [], monate = monateWahl();
  const ks = kontoSet(), zr = mitJahr && S.zr ? S.zr.split('_') : null;
  const fremdGewaehlt = !!ks && [...ks].some((i) => fremd(D.konten[i]));
  return (r) => (S.umb || r.art !== 'Umbuchung') && (!FREMD_ART.has(r.art) || fremdGewaehlt)
    && (!jahre.length || jahre.includes(r.y)) && (!monate.length || monate.includes(r.m)) && (!zr || (r.d.slice(0, 7) >= zr[0] && r.d.slice(0, 7) <= zr[1])) && (!S.nf || !fixIds().has(r.i)) && (!S.vertrag || vertragIds(S.vertrag).has(r.i)) && (!S.reise || reiseIds(S.reise).has(r.i)) && (!ks || ks.has(r.k))
    && (!S.kat || r.kat === S.kat) && (!S.ukat || r.ukat === S.ukat)
    && (!mitArt || S.art === 'alle' || (S.art === 'aus' ? r.art === 'Ausgabe' : r.art === 'Einnahme'))
    && test(r);
}

// Buchungen genau eines erkannten Vertrags (Schlüssel aus vertragsKey) – dieselben Zahlungen, die der Vertrag zählt
function vertragIds(key) {
  if (!D.vIds) D.vIds = new Map();
  if (!D.vIds.has(key)) D.vIds.set(key, new Set(fixkostenErkennen().find((f) => vertragsKey(f) === key)?.rows.map((r) => r.i) || []));
  return D.vIds.get(key);
}
// Buchungen genau einer ohne Tag erkannten Reise (Schlüssel = key der Reisekarte) – dieselben, die die Karte zählt
const reiseKarte = (key) => (sicher(() => reisen(H ??= modulHelfer()))?.karten || []).find((x) => x.key === key);
function reiseIds(key) {
  if (!D.rIds) D.rIds = new Map();
  if (!D.rIds.has(key)) D.rIds.set(key, new Set(reiseKarte(key)?.ids || []));
  return D.rIds.get(key);
}
const vertragText = (key) => { const f = fixkostenErkennen().find((x) => vertragsKey(x) === key); return f ? vertragName(f) : key.split('|')[0]; };

// Kontenauswahl: S.konto = Kontonamen, getrennt durch „|“; leer = alle eigenen Konten
function kontoSet() {
  if (!S.konto) return null;
  const s = new Set(S.konto.split('|').map((n) => D.kontoIdx.get(n)).filter((i) => i != null));
  return s.size ? s : null;
}
const kontoText = () => { const ks = kontoSet(); return !ks ? 'Alle Konten' : ks.size === 1 ? D.konten[[...ks][0]].name : `${ks.size} Konten`; };
function kontoWahlHtml() {
  return `<div class="kw"><button class="auswahl-knopf kw-knopf${kontoSet() ? ' aktiv' : ''}" data-kw-auf aria-expanded="false" title="Konten wählen, die in die Auswertung eingehen">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9.5 12 4l9 5.5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 20.5h18"/></svg><span>${esc(kontoText())}</span>
    <svg class="pfeil-unten" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><div class="kw-liste auswahl-liste" hidden></div></div>`;
}
function kontoWahlListe(box) {
  const ks = kontoSet(), seit = plusTage(D.bis, -400);
  const zuletzt = new Map();
  for (const r of D.rows) if (!zuletzt.has(r.k) || r.d > zuletzt.get(r.k)) zuletzt.set(r.k, r.d);
  const gruppen = [
    ['Deine Konten', (k, i) => !fremd(k) && (zuletzt.get(i) || '') >= seit],
    ['Frühere Konten', (k, i) => !fremd(k) && (zuletzt.get(i) || '') < seit],
    ['Gemeinsam mit Kathrin – zählen nicht mit', (k) => k.gemeinsam],
    ['Konten der Kinder – zählen nicht mit', (k) => k.kind],
  ];
  box.innerHTML = `<button class="auswahl-alle${ks ? '' : ' an'}" data-kw-alle>Alle eigenen Konten</button>`
    + gruppen.map(([t, f]) => { const l = D.konten.map((k, i) => [k, i]).filter(([k, i]) => f(k, i)); return l.length ? `<div class="kw-t">${t}</div>${l.map(([k, i]) => `<label class="kw-z"><input type="checkbox" data-kw="${esc(k.name)}"${ks?.has(i) ? ' checked' : ''}><span>${esc(k.name)}</span></label>`).join('')}` : ''; }).join('')
    + '<div class="auswahl-fuss">Anhaken = nur diese Konten. Gilt für Kennzahlen, Kategorien, Buchungen, Fixkosten und Konten.</div>';
}

// Zeitraum als Text: „Okt 25 – Sep 26“
const zrText = () => { const [a, b] = S.zr.split('_'); return `${MON[+a.slice(5) - 1]} ${a.slice(2, 4)} – ${MON[+b.slice(5) - 1]} ${b.slice(2, 4)}`; };

function filtern() {
  const conds = parse(S.q);
  F = D.rows.filter(pruefer(conds));
  if (S.neu) F = F.filter((r) => sicher(() => istNeu(r)) === true);   // „nur neue“ seit dem letzten Besuch (waechter.js)
  return conds;
}

// Alle Treffer in einem Jahr? Dann zeigen Grafik und Übersicht Monate statt Jahre.

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
  $('#f-kat').innerHTML = opt('', 'Alle Kategorien') + D.kats.map((k) => opt(k, schoen(k))).join('');
}

// Zeitraum-Menü: Kästchen = Jahr an/aus (mehrere = zusammen), Jahreszahl = nur dieses Jahr
function jahrListeBauen() {
  const n = new Map();
  for (const r of D.rows) n.set(r.y, (n.get(r.y) || 0) + 1);
  const liste = $('#f-jahr-liste');
  liste.innerHTML = `<button class="auswahl-alle" data-jalle>Alle Jahre <small>${NUM.format(D.rows.length)} Buchungen</small></button>
    <div class="auswahl-jahre">${[...D.jahre].reverse().map((y) => `<div class="auswahl-zeile"><input type="checkbox" id="jchk-${y}" data-jchk="${y}" aria-label="${y} dazunehmen"><button type="button" data-jnur="${y}" title="Nur ${y} zeigen">${y}</button><small>${NUM.format(n.get(y) || 0)}</small></div>`).join('')}</div>
    <div class="auswahl-fuss">Kästchen anhaken: mehrere Jahre zusammen anzeigen<br>Jahreszahl anklicken: nur dieses Jahr</div>`;
  liste.querySelector('[data-jalle]').onclick = () => { jahrMenu(false); setze({ jahr: '', zr: '' }); };
  liste.querySelectorAll('[data-jnur]').forEach((b) => b.onclick = () => { jahrMenu(false); setze({ jahr: b.dataset.jnur, zr: '' }); });
  liste.querySelectorAll('[data-jchk]').forEach((c) => c.onchange = () => {
    setze({ jahr: [...liste.querySelectorAll('[data-jchk]:checked')].map((x) => +x.dataset.jchk).sort((a, b) => a - b).join(','), zr: '' });
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
  $('#f-jahr-text').textContent = !jw.length ? 'Alle Jahre' : jw.length === 1 ? String(jw[0]) : jw.length <= 3 ? jw.join(', ') : `${jw.length} Jahre`;
  if (S.zr && !jw.length) $('#f-jahr-text').textContent = zrText();
  $('#f-jahr').classList.toggle('aktiv', jw.length > 0 || !!S.zr);
  $('#f-jahr-liste').querySelectorAll('[data-jchk]').forEach((c) => { c.checked = jw.includes(+c.dataset.jchk); });
  $('#f-jahr-liste').querySelector('[data-jalle]')?.classList.toggle('an', !jw.length);
  const mw = monateWahl();
  $('#monate').hidden = !einJahr() && !monateWahl().length;   // Monate nur zusammen mit einem Jahr (sonst: Januar aller Jahre)
  $('#monate')?.querySelectorAll('button').forEach((b) => { const an = b.dataset.m ? mw.includes(+b.dataset.m) : !mw.length; b.classList.toggle('an', an); b.setAttribute('aria-pressed', String(an)); });
  $('#f-kat').value = S.kat; $('#f-kat').classList.toggle('aktiv', !!S.kat);
  $('#f-konto-wahl').innerHTML = kontoWahlHtml();
  document.querySelectorAll('#f-art button').forEach((b) => b.classList.toggle('an', b.dataset.v === S.art));
  $('#f-umb').checked = S.umb;
  $('#f-umb').closest('.schalter').classList.toggle('an', S.umb);
  if ($('#q').value !== S.q) $('#q').value = S.q;
  const chips = conds.map((c, i) => `<button class="chip" data-cond="${i}" title="Aus der Suche entfernen">${esc(c.label)}<span class="x">×</span></button>`);
  // eingeklappte Filter als Chips, damit man sieht, was wirkt
  const mehrAktiv = [kontoSet() && ['konto', `Konten <b>${esc(kontoText())}</b>`], S.kat && ['kat', `Kategorie <b>${esc(schoen(S.kat))}</b>`],
    S.art !== 'alle' && ['art', S.art === 'aus' ? 'nur Ausgaben' : 'nur Einnahmen'], S.umb && ['umb', 'mit Umbuchungen']].filter(Boolean);
  $('#f-mehr').hidden = !filterMehr;
  $('#f-mehr-knopf').setAttribute('aria-expanded', String(filterMehr));
  $('#f-mehr-knopf').classList.toggle('aktiv', mehrAktiv.length > 0);
  $('#f-mehr-n').hidden = !mehrAktiv.length; $('#f-mehr-n').textContent = mehrAktiv.length;
  if (!filterMehr) for (const [k, t] of mehrAktiv) chips.push(`<button class="chip" data-mehr="${k}" title="Filter entfernen">${t}<span class="x">×</span></button>`);
  if (S.neu) chips.push('<button class="chip" data-neu="1" title="Wieder alle Buchungen zeigen">nur neue<span class="x">×</span></button>');
  if (S.nf) chips.push(`<button class="chip" data-nf="1" title="Auch feste Verträge zeigen">ohne feste Verträge<span class="x">×</span></button>`);
  if (S.reise) chips.push(`<button class="chip" data-reise="1" title="Reisefilter entfernen">Reise <b>${esc(reiseKarte(S.reise)?.tag || S.reise)}</b><span class="x">×</span></button>`);
  if (S.vertrag) chips.push(`<button class="chip" data-vertrag="1" title="Vertragsfilter entfernen">Vertrag <b>${esc(vertragText(S.vertrag))}</b><span class="x">×</span></button>`);
  if (S.zr) chips.push(`<button class="chip" data-zr="1" title="Zeitraum entfernen">Zeitraum <b>${esc(zrText())}</b><span class="x">×</span></button>`);
  if (S.ukat) chips.push(`<button class="chip" data-ukat="1" title="Unterkategorie-Filter entfernen">Unterkategorie <b>${esc(S.ukat)}</b><span class="x">×</span></button>`);
  $('#chips').innerHTML = chips.join('');
  $('#chips').querySelectorAll('[data-cond]').forEach((b) => b.onclick = () => {
    const raw = conds[+b.dataset.cond].raw;
    setze({ q: S.q.replace(raw, '').replace(/\s+/g, ' ').trim() });
  });
  $('#chips').querySelector('[data-ukat]')?.addEventListener('click', () => setze({ ukat: '' }));
  $('#chips').querySelector('[data-zr]')?.addEventListener('click', () => setze({ zr: '' }));
  $('#chips').querySelector('[data-nf]')?.addEventListener('click', () => setze({ nf: '' }));
  $('#chips').querySelector('[data-vertrag]')?.addEventListener('click', () => setze({ vertrag: '' }));
  $('#chips').querySelector('[data-reise]')?.addEventListener('click', () => setze({ reise: '' }));
  $('#chips').querySelector('[data-neu]')?.addEventListener('click', () => setze({ neu: '' }));
  $('#chips').querySelectorAll('[data-mehr]').forEach((b) => b.onclick = () => setze(({ konto: { konto: '' }, kat: { kat: '', ukat: '' }, art: { art: 'alle' }, umb: { umb: false } })[b.dataset.mehr]));
  const aktiv = S.q || S.jahr || S.monat || S.zr || S.nf || S.neu || S.vertrag || S.reise || S.konto || S.kat || S.ukat || S.art !== 'alle' || S.umb;
  $('#btn-reset').hidden = !abweichend();
  $('#btn-zurueck').hidden = stufe <= 0;
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
// negative Achsenwerte rot wie alle Minuswerte (bei Kategorie-Achsen ist value der Index, also nie negativ)
const achsenStil = () => { const grau = css('--muted'), rot = css('--aus-text'); return { grid: { color: css('--grid') }, border: { display: false }, ticks: { color: (c) => (c.tick?.value < 0 ? rot : grau), font: { size: 12 } } }; };

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
        ctx.fillStyle = neg ? css('--aus-text') : linie ? ds.borderColor : css('--text-2');   // Minuswerte rot
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

// ======================================================================= Seiten: einfach erklärt, mit Ausblick
// Alle Seiten folgen demselben Muster: Überschrift mit einem Satz als Antwort, drei bis vier Kennzahlen mit einer Zeile
// Erklärung, wenige beschriftete Grafiken (Durchschnitt als Linie, Prognose schraffiert) und Einzelheiten auf Klick.
// Grundlage ist immer das aktuelle Gehalt (letzter Monat mit Gehaltseingang); Durchschnitte stehen als Vergleich daneben.
const WTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const plusTage = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const mkey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const tageImMonat = (k) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)).getUTCDate();
const mVor = (k, n) => { let [y, m] = k.split('-').map(Number); m += n; while (m <= 0) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return mkey(y, m); };
const monKurz = (k) => `${MON[+k.slice(5) - 1]} ${k.slice(2, 4)}`;
const monLang = (k) => `${MONAT[+k.slice(5) - 1]} ${k.slice(0, 4)}`;
const plusMinus = (c) => `${c >= 0 ? '+' : '−'}${eur0(Math.abs(c))}`;
// dasselbe mitten im Satz: Minus rot (minusRot() erkennt nur Text am Anfang eines Elements)
const pmHtml = (c) => `<span class="${c < 0 ? 'neg' : ''}">${plusMinus(c)}</span>`;
const tagKurz = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return `${WTAG[d.getUTCDay()]} ${+iso.slice(8)}.${+iso.slice(5, 7)}.`; };
const monatsText = (ms) => (!ms.length ? '' : ms.length === 1 ? monKurz(ms[0]) : `${monKurz(ms[0])} – ${monKurz(ms[ms.length - 1])}`);
// Summe aller eigenen Konten an einem Tag (ohne Depot, gemeinsame und Kinderkonten; mit ks nur diese Konten):
// { c, voll, fehlt, abw, geschaetzt } – unvollständig, wenn sich der Stand eines Kontos an dem Tag nicht berechnen lässt
// oder der Tag vor Beginn seiner Daten liegt (ob es das Konto damals schon gab, ist dann nicht belegt)
const kontenSumme = (tag, ks = null) => (tag < D.von ? null : summeKonten(kontostaende(D, tag).filter((x) => !fremd(x.k) && (!ks || ks.has(x.i)))));
// Zum Weiterrechnen (Veränderungen, Grafiken, Prognose) nur eine vollständige Summe, sonst null („–“)
const vollSumme = (s) => (s?.voll ? s.c : null);
// Welche Konten fehlen und warum: nicht berechenbar (PayPal vor der letzten Abweichung) oder vor Beginn der Daten
const fehltText = (s) => {
  const n = s.fehlt.filter((x) => x.status !== 'unbekannt'), u = s.fehlt.filter((x) => x.status === 'unbekannt');
  return `ohne ${[n.length ? `${n.map((x) => x.k.name).join(', ')} (an dem Tag nicht berechenbar)` : '', ...u.map((x) => `${x.k.name} (Daten erst ab ${dde(x.k.von).slice(3)})`)].filter(Boolean).join(', ')}`;
};
// Summe als Text: unvollständig „1.234 € + ?“, ungefähr bzw. teils geschätzt „≈ 1.234 €“
const summeText = (s, fmt = eur0) => (!s ? '–' : !s.voll ? `${fmt(s.c)} + ?` : `${s.abw || s.geschaetzt ? '≈ ' : ''}${fmt(s.c)}`);
const summeHinweis = (s) => (!s ? '' : !s.voll ? fehltText(s) : s.abw ? `± ${eur0(s.abw)}` : s.geschaetzt ? 'teils geschätzt' : '');
// Veränderung zwischen zwei Summen – nur wenn beide vollständig sind
const diffSumme = (a, b) => (vollSumme(a) == null || vollSumme(b) == null ? null : b.c - a.c);
// Hinweis unter einer Kontostand-Grafik, wenn Monatsenden fehlen (Lücke statt einer zu niedrigen Summe)
const lueckenText = (summen) => {
  const l = summen.filter((s) => s && !s.voll);
  return l.length ? ` Lücke: ${l.length === 1 ? 'ein Monatsende' : `${l.length} Monatsenden`} nicht vollständig berechenbar (${esc([...new Set(l.flatMap((s) => s.fehlt.map((x) => x.k.name)))].join(', '))}).` : '';
};

// Buchungen, die zu einem erkannten Fixkosten-Vertrag gehören (auch deine festen Einzahlungen aufs Gemeinschaftskonto)
function fixIds() {
  if (!D.fixIds) D.fixIds = new Set(fixkostenErkennen().filter((f) => !f.gemeinsam).flatMap((f) => f.rows.map((r) => r.i)));
  return D.fixIds;
}

// Ausstehende Zahlung eines laufenden Vertrags: fällig, aber noch nicht gebucht (Datum, sonst ''). Monatlich: der Zahltag
// dieses Monats ist vorbei, gebucht ist in diesem Monat nichts. Sonst: der nächste Termin nach der letzten Zahlung liegt
// schon vor dem Datenstand. Für alle Anzeigen gilt dieselbe Regel: Sie kommt noch – in „Noch fällig“, in den nächsten
// Abbuchungen (als „noch nicht gebucht“) und in der Prognose; der Vertrag zählt ja auch in den Fixkosten weiter.
function ausstehend(f) {
  if (!f.aktiv) return '';
  if (f.rh.proJahr === 12) {
    const k = D.bis.slice(0, 7), tag = `${k}-${String(Math.min(zahltag(f), tageImMonat(k))).padStart(2, '0')}`;
    return f.zuletzt.slice(0, 7) !== k && tag <= D.bis ? tag : '';
  }
  const t = new Date(Date.parse(f.zuletzt) + f.rh.tage * 864e5).toISOString().slice(0, 10);
  return t <= D.bis ? t : '';
}

// Zahlungen eines laufenden Vertrags zwischen von und bis (ISO, beide inklusive); eine ausstehende Zahlung zählt im
// ersten Zeitraum nach dem Datenstand mit (Rest des laufenden Monats bzw. erster Prognosemonat)
function faellig(f, von, bis) {
  let n = von === plusTage(D.bis, 1) && ausstehend(f) ? 1 : 0;
  if (f.rh.proJahr === 12) {
    for (let k = von.slice(0, 7); k <= bis.slice(0, 7); k = mVor(k, 1)) {
      const letzter = +monatsletzter(`${k}-01`).slice(8), tag = `${k}-${String(Math.min(zahltag(f), letzter)).padStart(2, '0')}`;
      if (f.zuletzt.slice(0, 7) === k) continue;   // in diesem Monat schon bezahlt
      if (tag >= von && tag <= bis) n++;
    }
    return n * f.betrag;
  }
  let t = Date.parse(f.zuletzt);
  const a = Date.parse(von), b = Date.parse(bis) + 864e5 - 1;
  for (let i = 0; i < 40 && t <= b; i++) { t += f.rh.tage * 864e5; if (t >= a && t <= b) n++; }
  return n * f.betrag;
}

// Nächste Abbuchung eines laufenden Vertrags (monatlich: am üblichen Tag, sonst nach Rhythmus); eine ausstehende Zahlung
// kommt zuerst – ihr Datum liegt dann vor dem Datenstand
function naechsteAbbuchung(f) {
  return f.aktiv ? ausstehend(f) || naechsteRegulaer(f) : '';
}
// Nächster regulärer Termin nach dem Datenstand – ohne eine ausstehende Zahlung (die zählt zusätzlich, wie in faellig())
function naechsteRegulaer(f) {
  if (!f.aktiv) return '';
  if (f.rh.proJahr !== 12) return naechsteZahlung(f);
  const tag = zahltag(f), im = (y, m) => `${mkey(y, m)}-${String(Math.min(tag, tageImMonat(mkey(y, m)))).padStart(2, '0')}`;
  let [y, m] = D.bis.slice(0, 7).split('-').map(Number);
  let am = im(y, m);
  if (am <= D.bis || f.zuletzt.slice(0, 7) === D.bis.slice(0, 7)) { if (++m > 12) { m = 1; y++; } am = im(y, m); }
  return am;
}

// ---------------------------------------------------------------- Zeitraum der Seiten Kennzahlen und Kategorien
// „12 Monate“ (kein Jahr gewählt) = die letzten zwölf abgeschlossenen Monate, sonst die abgeschlossenen Monate des
// Jahres; dazu dieselben Monate ein Jahr früher zum Vergleich. Der laufende Monat zählt nie mit (Gehalt fehlt oft noch).
function abgeschlosseneMonate() {
  const laufend = D.bis !== monatsletzter(D.bis) ? D.bis.slice(0, 7) : '';
  const out = [];
  let [y, m] = D.von.slice(0, 7).split('-').map(Number);
  for (let k = mkey(y, m); k <= D.bis.slice(0, 7); k = mkey(y, m)) { if (k !== laufend) out.push(k); if (++m > 12) { m = 1; y++; } }
  return out;
}
// Hat das gewählte Jahr noch keinen abgeschlossenen Monat (Januar, sobald die erste Buchung des neuen Jahres da ist),
// gelten die letzten 12 Monate – mit Hinweis, statt einer leeren Seite.
function periode() {
  const alle = abgeschlosseneMonate(), gewaehlt = einJahr();
  const leer = !!gewaehlt && alle.length > 0 && !alle.some((k) => +k.slice(0, 4) === gewaehlt), j = leer ? 0 : gewaehlt;
  const monate = j ? alle.filter((k) => +k.slice(0, 4) === j) : alle.slice(-12);
  const vor = monate.map((k) => mkey(+k.slice(0, 4) - 1, +k.slice(5))).filter((k) => k >= D.von.slice(0, 7));
  const label = !monate.length ? '' : j ? (monate.length === 12 ? `im Jahr ${j}` : `${j} (${MON[+monate[0].slice(5) - 1]}–${MON[+monate.at(-1).slice(5) - 1]})`)
    : `in den letzten 12 Monaten (${monKurz(monate[0])} – ${monKurz(monate.at(-1))})`;
  const jw = jahreWahl();
  const hinweis = leer ? `<span class="muted">${gewaehlt} hat noch keinen abgeschlossenen Monat – deshalb die letzten 12 Monate.</span> `
    : jw.length > 1 ? `<span class="muted">Mehrere Jahre (${jw.join(', ')}) zeigt nur die Seite Buchungen zusammen – hier deshalb die letzten 12 Monate.</span> ` : '';
  return { monate, vor: vor.length === monate.length ? vor : [], label, jahr: j, hinweis };
}
// Zeitraum-Knöpfe; markiert ist der Zeitraum, der wirklich gezeigt wird (P aus periode())
function zeitSeg(P = null) {
  const j = P ? P.jahr : einJahr();
  return `<div class="seg s5-zeit" role="group" aria-label="Zeitraum">${[['', '12 Monate'], ...D.jahre.slice(-4).reverse().map((y) => [String(y), String(y)])]
    .map(([v, t]) => `<button data-zeit="${v}" class="${(v ? +v === j : !j) ? 'an' : ''}">${t}</button>`).join('')}</div>`;
}

// Einnahmen und Ausgaben in bestimmten Monaten (gewählte Konten): Summen, je Monat und gruppiert
// (Ausgaben nach Kategorie, Einnahmen nach Unterkategorie) mit Unterkategorien, Empfängern und Monaten
function sammle(monate, art = 'aus') {
  const set = new Set(monate), fx = fixIds(), ks = kontoSet(), g = new Map(), mon = new Map(monate.map((k) => [k, { ein: 0, lohn: 0, aus: 0, fix: 0, spar: 0, n: 0 }]));
  let ein = 0, aus = 0, fix = 0, spar = 0, sparRein = 0, sparRaus = 0, lohn = 0, n = 0, groesste = null;
  for (const r of D.rows) {
    const k = r.d.slice(0, 7), m = mon.get(k);
    if (!m || !set.has(k) || (ks && !ks.has(r.k))) continue;
    // Sparen/Depot: spar = netto eingezahlt (negativ = mehr entnommen, z. B. Wertpapierverkäufe), dazu beide Richtungen einzeln
    if (r.art === 'Sparen') { spar -= r.c; m.spar -= r.c; if (r.c < 0) sparRein -= r.c; else sparRaus += r.c; continue; }
    if (r.art !== 'Einnahme' && r.art !== 'Ausgabe') continue;
    n++; m.n++;
    if (r.art === 'Einnahme') { ein += r.c; m.ein += r.c; if (r.ukat === 'Lohn / Gehalt') { m.lohn += r.c; lohn += r.c; } }
    else { aus -= r.c; m.aus -= r.c; if (fx.has(r.i)) { fix -= r.c; m.fix -= r.c; } if (!groesste || r.c < groesste.c) groesste = r; }
    if ((art === 'aus') !== (r.art === 'Ausgabe')) continue;
    const key = art === 'aus' ? r.kat || 'Sonstiges' : einSchluessel(r);
    const c = art === 'aus' ? -r.c : r.c;
    let x = g.get(key);
    if (!x) g.set(key, (x = { k: key, c: 0, unter: new Map(), empf: new Map(), mon: new Map(), rows: [] }));
    x.c += c; x.rows.push(r);
    if (art === 'aus') { const u = r.ukat || 'ohne Unterkategorie'; x.unter.set(u, (x.unter.get(u) || 0) + c); }
    const e = r.g || r.z || '–', ee = x.empf.get(e) || { c: 0, n: 0 };
    ee.c += c; ee.n++; x.empf.set(e, ee);
    x.mon.set(k, (x.mon.get(k) || 0) + c);
  }
  return { n: monate.length, ein, aus, fix, spar, sparRein, sparRaus, lohn, erg: ein - aus, g, mon, buchungen: n, groesste, monate };
}

// Einnahmen werden nach Unterkategorie gruppiert, egal unter welcher Hauptkategorie sie stehen (Steuererstattung unter
// „Finanzen“, Urlaubserstattung unter „Freizeit“ …); ohne Unterkategorie nach der Hauptkategorie („Nicht zugeordnet“).
// einFilter: der passende Buchungsfilter zu einer solchen Gruppe – nie mit fester Hauptkategorie „Einnahmen“.
const einSchluessel = (r) => r.ukat || r.kat || 'Sonstige Einnahmen';
const einFilter = (k) => (D.ukatZu.has(k) ? { kat: '', ukat: k } : { kat: D.kats.includes(k) ? k : '', ukat: '' });

// ---------------------------------------------------------------- Bausteine
const kopf5 = (titel, satz, rechts = '') => `<div class="s5-kopf"><div class="s5-kopf-t"><h1>${titel}</h1>${satz ? `<p class="s5-satz">${satz}</p>` : ''}</div>${rechts ? `<div class="s5-kopf-r">${rechts}</div>` : ''}</div>`;
const karte5 = (titel, erkl, inhalt, cls_ = '', rechts = '', id = '') => `<section${id ? ` id="${id}"` : ''} class="card s5-karte ${cls_}"><div class="s5-kt"><div class="s5-kt-t"><h2>${titel}</h2>${erkl ? `<p class="s5-erkl">${erkl}</p>` : ''}</div>${rechts ? `<div class="s5-kt-r">${rechts}</div>` : ''}</div>${inhalt}</section>`;
const geh = (z) => ` data-geh="${esc(JSON.stringify(z))}"`;
// Kennzahl: Titel, Wert, eine Zeile Erklärung; mit Ziel anklickbar
const zahl5 = (t, w, u, { cls: c = '', ziel = null, springe = '' } = {}) => `<${ziel || springe ? 'button' : 'div'} class="s5-z${ziel || springe ? ' klick' : ''}"${ziel ? geh(ziel) : ''}${springe ? ` data-springe="${springe}"` : ''}><span class="s5-z-t">${t}</span><b class="s5-z-w ${c}">${w}</b><span class="s5-z-u">${u}</span></${ziel || springe ? 'button' : 'div'}>`;
// Balkenliste: Name | Balken | Betrag | Anteil (optional Marke, z. B. der Durchschnitt)
function balkenListe(items, { max, kopf = null } = {}) {
  const m = max ?? Math.max(1, ...items.map((x) => Math.abs(x.c)));
  const pct = (c) => Math.max(0, Math.min(100, (Math.abs(c) / m) * 100));
  return `<div class="bl">${kopf ? `<div class="bl-z bl-kopf"><span>${kopf[0] || ''}</span><span></span><span>${kopf[1] || ''}</span><span>${kopf[2] || ''}</span></div>` : ''}${items.map((x) => {
    const tag = x.ziel || x.springe ? 'button' : 'div';
    return `<${tag} class="bl-z${x.cls ? ` ${x.cls}` : ''}"${x.ziel ? geh(x.ziel) : ''}${x.springe ? ` data-springe="${x.springe}"` : ''}${x.tip ? ` title="${esc(x.tip)}"` : ''}>
      <span class="bl-n">${x.n}${x.sub ? `<small>${x.sub}</small>` : ''}</span>
      <span class="bl-b">${x.c ? `<i style="width:${Math.max(1, pct(x.c))}%;${x.farbe ? `background:${x.farbe}` : ''}"></i>` : ''}${x.marke != null ? `<b class="bl-m" style="left:${pct(x.marke)}%"></b>` : ''}</span>
      <b class="bl-w">${x.w ?? eur0(x.c)}</b><span class="bl-p">${x.p ?? ''}</span></${tag}>`;
  }).join('')}</div>`;
}
// Klicks: data-geh = Ziel als JSON (Reiter, Filter), data-fix = alle Zahlungen eines Vertrags
// data-springe = Ziel auf derselben Seite (aufklappen, hinscrollen, kurz hervorheben)
// Freie Fläche nutzen: Elemente mit [data-fuell] sind zunächst verborgen und werden der Reihe nach (Zahl in data-fuell)
// gezeigt, solange ihr Kasten dadurch nicht höher wird – so entsteht neben einem höheren Nachbarn keine Leerfläche.
// data-stopp: fortlaufende Zeilen – passt eine nicht, folgen keine weiteren dieser Reihe.
function freiFuellen(root) {
  const karten = new Set([...root.querySelectorAll('[data-fuell]')].map((e) => e.closest('.s5-karte')).filter(Boolean));
  for (const k of karten) {
    const els = [...k.querySelectorAll('[data-fuell]')].sort((a, b) => a.dataset.fuell - b.dataset.fuell);
    let reiheVoll = false;   // fortlaufende Zeilen (data-stopp): nach der ersten, die nicht passt, keine weitere
    for (const el of els) {
      if (reiheVoll && 'stopp' in el.dataset) continue;
      if (el.parentElement.closest('.fuell-aus')) { el.classList.add('fuell-aus'); continue; }   // liegt in einem Zusatz, der nicht passt
      const vorher = k.getBoundingClientRect().height;
      el.classList.remove('fuell-aus');
      if (k.getBoundingClientRect().height > vorher + 0.5) { el.classList.add('fuell-aus'); if ('stopp' in el.dataset) reiheVoll = true; }
    }
  }
}
function gehBinden(el) {
  el.querySelectorAll('[data-geh]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const z = JSON.parse(b.dataset.geh), sp = z._springe;
    delete z._springe;
    setze(z);
    if (sp) setTimeout(() => springe(sp, false), 60);   // nach dem Seitenwechsel direkt hinspringen
  });
  // data-fix = Schlüssel des Vertrags: genau seine Zahlungen, alle anderen Filter (auch „ohne feste Verträge“) zurückgesetzt
  el.querySelectorAll('[data-fix]').forEach((b) => b.onclick = () => setze(zuBuchungen({ vertrag: b.dataset.fix, konto: '' })));
  el.querySelectorAll('[data-springe]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); springe(b.dataset.springe); });  el.querySelectorAll('.zl[role="button"]').forEach((b) => b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); } });
}
function springe(sel, sanft = true) {
  const z = document.querySelector(sel);
  if (!z) return;
  if (z.tagName === 'DETAILS') z.open = true;
  z.scrollIntoView({ behavior: sanft ? 'smooth' : 'auto', block: 'start' });
  z.classList.remove('blink'); void z.offsetWidth; z.classList.add('blink');
}
// Ziele für Klicks: Buchungen mit genau dem passenden Zeitraum (die gewählten Konten bleiben), das Gehalt, einzelne Monate
const zuBuchungen = (x = {}) => ({ tab: 'buchungen', q: '', jahr: '', monat: '', zr: '', nf: '', neu: '', vertrag: '', reise: '', kat: '', ukat: '', art: 'alle', ...x });
function zeitZiel(ms) {
  if (!ms.length) return {};
  const jahre = [...new Set(ms.map((k) => k.slice(0, 4)))];
  if (jahre.length === 1) return { jahr: jahre[0], monat: ms.length === 12 ? '' : ms.map((k) => String(+k.slice(5))).join(','), zr: '' };
  return { jahr: '', monat: '', zr: `${ms[0]}_${ms[ms.length - 1]}` };
}
const monatZiel = (k) => ({ jahr: k.slice(0, 4), monat: String(+k.slice(5)), zr: '' });
// alle Gehaltseingänge der letzten 24 Monate, neueste zuerst
const zuGehalt = () => zuBuchungen({ konto: '', kat: 'Einnahmen', ukat: 'Lohn / Gehalt', art: 'ein', zr: `${mVor(D.bis.slice(0, 7), -23)}_${D.bis.slice(0, 7)}` });
// Zahl im Fließtext als Verweis
// (span statt button, damit lange Verweise wie normaler Text umbrechen)
const zl = (inhalt, ziel) => `<span class="zl" role="button" tabindex="0"${geh(ziel)} title="Anklicken: Einzelheiten">${inhalt}</span>`;
const zs = (inhalt, sel) => `<span class="zl" role="button" tabindex="0" data-springe="${sel}" title="Anklicken: Einzelheiten">${inhalt}</span>`;

// ---------------------------------------------------------------- Grafik-Bausteine
// Schraffur für erwartete Werte (Prognose)
function schraffur(farbe) {
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const x = c.getContext('2d'); x.fillStyle = alpha(farbe, 0.22); x.fillRect(0, 0, 8, 8);
  x.strokeStyle = alpha(farbe, 0.8); x.lineWidth = 2; x.beginPath(); x.moveTo(-2, 10); x.lineTo(10, -2); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke();
  return x.createPattern(c, 'repeat');
}
// Waagrechte Linie mit Beschriftung (Durchschnitt, Gehalt)
// Die Beschriftung steht rechts NEBEN der Grafik (dafür reserviert beforeInit Platz) – so überdeckt sie keine Säulenwerte
const linieMit = (id, wert, text, farbe, oben = true) => ({
  id,
  beforeInit(ch) {
    const L = (ch.options.layout ??= {}), p = typeof L.padding === 'object' ? L.padding : { top: +L.padding || 0 };
    L.padding = { ...p, right: Math.max(p.right || 0, Math.round(text.length * 6.2) + 10) };
  },
  afterDatasetsDraw(ch) {
    const y = ch.scales.y.getPixelForValue(wert), a = ch.chartArea, c = ch.ctx;
    if (y < a.top - 1 || y > a.bottom + 1) return;
    c.save(); c.strokeStyle = farbe; c.lineWidth = 1.5; c.setLineDash([5, 4]);
    c.beginPath(); c.moveTo(a.left, y); c.lineTo(a.right, y); c.stroke(); c.setLineDash([]);
    c.font = `700 11px ${css('--font')}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillStyle = farbe; c.fillText(text, a.right + 5, y);
    c.restore();
  },
});
// Prognosebereich ab Index: grau hinterlegt, oben beschriftet
const PROGNOSE = 'Prognose (berechnet: Plan-Gehalt, Lebenshaltung wie im normalen Monat)';
const prognoseMit = (ab, text = 'Prognose') => ({
  id: 'prognose',
  beforeDatasetsDraw(ch) {
    if (ab < 0) return;
    const x = ch.scales.x, a = ch.chartArea, c = ch.ctx, n = ch.data.labels.length, b = x.width / n;
    const links = x.getPixelForValue(ab) - b / 2;
    c.save(); c.fillStyle = 'rgba(128, 128, 128, 0.08)'; c.fillRect(links, a.top, a.right - links, a.bottom - a.top);
    c.fillStyle = css('--muted'); c.font = `700 10px ${css('--font')}`; c.textAlign = 'left'; c.textBaseline = 'top';
    let t = text;   // normal geschrieben, keine Großbuchstaben (Wunsch des Nutzers)
    if (c.measureText(t).width > a.right - links - 8) t = text.split(' (')[0];   // schmal (Handy): nur „Prognose“
    c.fillText(t, links + 5, a.top + 3);
    c.restore();
  },
});
// Ergebnis je Säulengruppe zwischen Achse und Beschriftung (grün +, rot −; erwartete Werte mit ≈)
const ergebnisZeileMit = (werte, erwartet = () => false) => ({
  id: 'ergebnisZeile',
  afterDraw(ch) {
    const c = ch.ctx, x = ch.scales.x, y = ch.chartArea.bottom + 11;
    c.save(); c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `700 11px ${css('--font')}`;
    werte.forEach((v, i) => { if (v == null) return; c.fillStyle = css(v >= 0 ? '--ein-text' : '--aus-text'); c.fillText(`${erwartet(i) ? '≈' : ''}${v >= 0 ? '+' : '−'}${kurzWert(Math.abs(v))}`, x.getPixelForValue(i), y); });
    c.restore();
  },
});
// Werte an ausgewählten Punkten einer Linie
const punktWerteMit = (indizes, fmt) => ({
  id: 'punktWerte',
  afterDatasetsDraw(ch) {
    const c = ch.ctx, meta = ch.getDatasetMeta(0), ds = ch.data.datasets[0];
    c.save(); c.font = `700 11px ${css('--font')}`; c.textBaseline = 'bottom'; c.lineJoin = 'round'; c.lineWidth = 3; c.strokeStyle = css('--surface');
    for (const i of indizes) {
      const p = meta.data[i]; if (!p || ds.data[i] == null) continue;
      const t = fmt(ds.data[i], i);
      c.textAlign = i === 0 ? 'left' : i >= ds.data.length - 1 ? 'right' : 'center';
      c.fillStyle = ds.borderColor; c.strokeText(t, p.x, p.y - 7); c.fillText(t, p.x, p.y - 7);
    }
    c.restore();
  },
});
const vorzeichenKurz = (v) => `${v >= 0 ? '+' : '−'}${kurzWert(Math.abs(v))}`;

// ---------------------------------------------------------------- Der normale Monat und die Prognose
// Ein normaler Monat mit dem heutigen Gehalt: Gehalt + typische sonstige Einnahmen (Median der letzten 12 Monate:
// Erstattungen, Zinsen …) − laufende Fixkosten − Lebenshaltung (wie im Reiter Fixkosten gewählt, Standard Ø 12 Monate).
function monatsRechnung() {
  if (D.mr) return D.mr;
  const ek = einkommen(), gehalt = ek.aktuell.wert || ek.schnitt.wert;
  const ref = abgeschlosseneMonate().slice(-12);
  const sonst = ref.length ? Math.max(0, median(ref.map((k) => (ek.ein.get(k) || 0) - (ek.lohn.get(k) || 0)))) : 0;
  const vertraege = fixkostenErkennen().filter((f) => f.aktiv && !f.gemeinsam);
  const fix = vertraege.reduce((t, f) => t + f.proMonat, 0);
  const leben = lebenGewaehlt();
  const lebenProg = leben;   // laufender Monat und Prognose rechnen mit derselben Lebenshaltung wie der normale Monat
  return (D.mr = { gehalt, gehaltMonat: ek.letzter, sonst, fix, leben, lebenProg, ein: gehalt + sonst, aus: fix + leben, erg: gehalt + sonst - fix - leben, vertraege, ref, gt: gehaltstag(), lh: lebenshaltung() });
}
const lebenName = () => (lebenWahl === 'eigen' && lebenEigen ? 'dein eigener Wert' : lebenWahl === 'typisch' ? 'typischer Monat' : lebenWahl === 'vormonat' && lebenshaltung().monate.length ? `Vormonat ${MONAT[+lebenshaltung().monate.at(-1).slice(5) - 1]}` : 'Ø 12 Monate');

// Prognose ehrlicher (planung.js): Plan-Gehalt eines Monats aus den Abrechnungen (null = aktuelles Gehalt).
// Die Lebenshaltung bleibt ohne Saisonfaktor: normaler Monat, laufender Monat und Prognose rechnen mit demselben Wert.
const planG = (k) => { try { return planGehalt(H, k); } catch (e) { console.error(e); return null; } };
// Die letzten 12 abgeschlossenen Monate, der laufende Monat (bisher + erwartet) und 3 Monate Prognose,
// je mit Ergebnis und Kontostand am Monatsende. Prognose: normaler Monat, feste Abbuchungen im jeweiligen Monat.
// alt = true: dieselbe Rechnung mit Ø 12 Monate (zum Vergleich, wenn der Vormonat die Grundlage ist)
function verlauf5(alt = false) {
  const key = alt ? 'v5s' : 'v5';
  if (D[key]) return D[key];
  const R0 = monatsRechnung(), R = alt ? { ...R0, lebenProg: R0.lh.schnitt } : R0;
  const heute = D.bis, jetzt = heute.slice(0, 7), laeuft = heute !== monatsletzter(heute);
  const fx = fixIds(), leer = () => ({ ein: 0, lohn: 0, aus: 0, var: 0, spar: 0 });
  const ist = new Map();
  for (const r of D.rows) {
    if (!['Einnahme', 'Ausgabe', 'Sparen'].includes(r.art) || istGemeinsam(r.k) || fremd(D.konten[r.k])) continue;
    const k = r.d.slice(0, 7);
    let x = ist.get(k); if (!x) ist.set(k, (x = leer()));
    if (r.art === 'Einnahme') { x.ein += r.c; if (r.ukat === 'Lohn / Gehalt') x.lohn += r.c; }
    else if (r.art === 'Ausgabe') { x.aus -= r.c; if (!fx.has(r.i)) x.var -= r.c; }
    else x.spar += r.c;
  }
  const w = (k) => ist.get(k) || leer();
  const spar = R.ref.length ? Math.min(0, median(R.ref.map((k) => w(k).spar))) : 0;   // was üblicherweise aufs Depot geht
  // Kontostand je Monatsende nur, wenn die Summe vollständig ist (sonst null: Lücke in der Grafik, Hinweis in fehlt)
  const monate = R.ref.map((k) => { const x = w(k), s = kontenSumme(monatsletzter(`${k}-01`)); return { k, art: 'ist', ein: x.ein, aus: x.aus, erg: x.ein - x.aus, fest: x.aus - x.var, lohn: x.lohn, stand: vollSumme(s), summe: s }; });
  const heuteSumme = kontenSumme(heute), heuteStand = vollSumme(heuteSumme);
  // Prognose ab dem heutigen Stand – ist er unvollständig, gibt es auch keine Prognose des Kontostands
  let stand = heuteStand, lauf = null;
  const weiter = (d) => (stand == null ? null : (stand += d));
  if (laeuft) {
    const x = w(jetzt), ende = monatsletzter(`${jetzt}-01`);
    const offenFest = R.vertraege.reduce((t, f) => t + faellig(f, plusTage(heute, 1), ende), 0);
    const gehaltKommt = x.lohn > 0 ? 0 : (planG(jetzt) ?? R.gehalt), sonstKommt = Math.max(0, R.sonst - (x.ein - x.lohn)), varKommt = Math.max(0, Math.round(R.lebenProg) - x.var);
    const ein = x.ein + gehaltKommt + sonstKommt, aus = x.aus + offenFest + varKommt;
    weiter(gehaltKommt + sonstKommt - offenFest - varKommt + Math.min(0, spar - x.spar));
    lauf = { k: jetzt, art: 'laeuft', ein, aus, erg: ein - aus, x, offenFest, gehaltKommt, varKommt, tag: +heute.slice(8), tage: +ende.slice(8), stand };
    monate.push(lauf);
  }
  for (let i = 1; i <= 3; i++) {
    const k = mVor(jetzt, i), ende = monatsletzter(`${k}-01`);
    const fest = R.vertraege.reduce((t, f) => t + faellig(f, `${k}-01`, ende), 0);
    const pg = planG(k);
    const ein = (pg ?? R.gehalt) + R.sonst, aus = Math.round(R.lebenProg) + fest;
    weiter(ein - aus + spar);
    monate.push({ k, art: 'prognose', ein, aus, erg: ein - aus, fest, stand, plan: pg != null });
  }
  const n = R.ref.length || 1, summe = (f) => monate.filter((m) => m.art === 'ist').reduce((t, m) => t + f(m), 0);
  const schnitt = { ein: summe((m) => m.ein) / n, aus: summe((m) => m.aus) / n, erg: summe((m) => m.erg) / n, lohn: summe((m) => m.lohn) / n };
  // Sonderzahlungen der 12 Monate: Gehalt deutlich über dem üblichen, größere sonstige Einnahmen (ab 1.000 €)
  const refSet = new Set(R.ref), eigen = (r) => r.art === 'Einnahme' && refSet.has(r.d.slice(0, 7)) && !istGemeinsam(r.k) && !fremd(D.konten[r.k]);
  const lohnRows = D.rows.filter((r) => eigen(r) && r.ukat === 'Lohn / Gehalt' && r.c >= 100000);
  const lohnMed = lohnRows.length ? median(lohnRows.map((r) => r.c)) : 0;
  const sonder = D.rows.filter((r) => eigen(r) && (r.ukat === 'Lohn / Gehalt' ? lohnMed && r.c > lohnMed * 1.3 : r.c >= 100000))
    .map((r) => ({ r, extra: r.ukat === 'Lohn / Gehalt' ? r.c - lohnMed : r.c })).sort((a, b) => b.extra - a.extra);
  return (D[key] = { monate, R, lauf, heuteStand, heuteSumme, spar, schnitt, sonder, jetzt });
}
const sonderText = (l) => l.map(({ r }) => zl(`${r.ukat === 'Lohn / Gehalt' ? 'dem hohen Gehalt' : esc(schoen(r.ukat || 'Einnahme'))} im ${MONAT[+r.d.slice(5, 7) - 1]} ${r.d.slice(0, 4)} (${eur0(r.c)})`, zuBuchungen({ konto: '', art: 'ein', kat: r.kat, ukat: r.ukat, ...monatZiel(r.d.slice(0, 7)) }))).join(' und ');

// Ein Balken für den normalen Monat: Linie = Einkommen (Gehalt + sonstige Einnahmen), Flächen = Fixkosten (auf Wunsch
// je Art) und Lebenshaltung, grün = was bleibt, rot schraffiert = was fehlt
function geldBalken(R, teile = null) {
  const E = R.ein, aus = R.fix + R.leben, max = Math.max(E, aus, 1), w = (c) => (Math.max(0, c) / max) * 100, rest = E - aus;
  const t = (cls_, x) => (x.c > 0 ? `<i class="gb-t ${cls_}${w(x.c) >= 7.5 ? ' lbl' : ''}${w(x.c) >= 20 ? ' gross' : ''}" style="width:${w(x.c)}%"${x.ziel ? geh(x.ziel) : ''}${x.springe ? ` data-springe="${x.springe}"` : ''}${x.ziel || x.springe ? ' role="button" tabindex="0"' : ''} title="${esc(x.tip || `${x.n}: ${eur0(x.c)}`)}">${w(x.c) >= 7.5 ? `<span>${x.n}</span><b>${eur0(x.c)}</b>` : ''}</i>` : '');
  const fest = (teile || [{ n: 'Fixkosten', c: R.fix, ziel: { tab: 'fix', fixtab: 'vertraege' } }]).map((x) => t('gb-fest', x)).join('');
  return `<div class="gb">
    <div class="gb-balken">${fest}${t('gb-leben', { n: 'Lebenshaltung', c: R.leben, ziel: { tab: 'fix', fixtab: 'vertraege', _springe: '#fix-leben' }, tip: `Lebenshaltung ${eur0(R.leben)} im Monat – anklicken: wofür` })}${rest > 0 ? t('gb-rest', { n: 'bleibt', c: rest }) : ''}
      ${rest < 0 ? `<b class="gb-minus" style="left:${w(E)}%;width:${w(-rest)}%" title="fehlt ${eur0(-rest)} im Monat"></b>` : ''}<b class="gb-linie" style="left:${w(E)}%"></b></div>
    <div class="gb-skala"><span><i class="gb-sym"></i>Einkommen ${eur0(E)}</span><span>Ausgaben ${eur0(aus)}</span>${rest < 0 ? `<span class="gb-f"><i class="gb-sym-f"></i>fehlt ${eur0(-rest)}</span>` : `<span class="gb-b">bleibt ${eur0(rest)}</span>`}</div>
  </div>`;
}

// Feste Abbuchungen der nächsten Tage, vorneweg die ausstehenden (fällig, noch nicht gebucht); ein Vertrag mit
// ausstehender Zahlung steht zusätzlich an seinem regulären Termin, wenn der in den Zeitraum fällt (wie in faellig())
function naechsteTermine(vs, tage = 30) {
  const bis = plusTage(D.bis, tage), l = [];
  for (const f of vs) {
    for (const am of [ausstehend(f), naechsteRegulaer(f)]) if (am && am <= bis) l.push({ f, am });
  }
  return l.sort((a, b) => (a.am < b.am ? -1 : a.am > b.am ? 1 : b.f.betrag - a.f.betrag));
}
// Wann das nächste Gehalt erwartet wird (in den nächsten 30 Tagen), damit man sieht, was davor und danach abgeht
function naechstesGehalt() {
  const R = monatsRechnung(), V = verlauf5();
  if (!R.gt || !R.gehalt) return null;
  let k = D.bis.slice(0, 7);
  if (!(V.lauf && V.lauf.gehaltKommt)) k = mVor(k, 1);
  let am = `${k}-${String(Math.min(R.gt, tageImMonat(k))).padStart(2, '0')}`;
  // üblicher Gehaltstag vorbei, Gehalt aber noch nicht gebucht: überfällig, zum nächsten Tag erwartet (wie in der Prognose)
  if (V.lauf?.gehaltKommt > 0 && am <= D.bis) return { am: plusTage(D.bis, 1), c: V.lauf.gehaltKommt, ueberfaellig: true };
  return am > D.bis && am <= plusTage(D.bis, 30) ? { am, c: planG(k) ?? R.gehalt } : null;
}
// Abbuchungen je Tag: Tag mit Summe als Kopf, die Verträge eingerückt darunter; n = höchstens so viele Verträge
function termineHtml(l, n = 99) {
  if (!l.length) return '<div class="leer klein">Keine festen Abbuchungen in den nächsten 30 Tagen.</div>';
  const g = naechstesGehalt(), tage = new Map();
  for (const x of l) (tage.get(x.am) || tage.set(x.am, []).get(x.am)).push(x.f);
  if (g && !tage.has(g.am)) tage.set(g.am, []);
  let frei = n, h = '';
  const weg = [];
  for (const [am, fs] of [...tage].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const lohn = g && g.am === am;
    if (frei <= 0 && !lohn) { weg.push(...fs); continue; }
    const zeig = fs.slice(0, Math.max(0, frei)), summe = fs.reduce((t, f) => t + f.betrag, 0);
    weg.push(...fs.slice(zeig.length)); frei -= zeig.length;
    const offen = am <= D.bis;   // ausstehend: fällig, aber bis zum Datenstand nicht gebucht
    h += `<div class="nt-tag"><div class="nt-k"${offen ? ' title="Fällig, aber bis zum Datenstand nicht gebucht – zählt als „kommt noch“"' : ''}><span class="nt-d">${offen ? 'seit ' : ''}${tagKurz(am)}</span><span class="nt-a">${fs.length ? `${fs.length} ${fs.length === 1 ? 'Abbuchung' : 'Abbuchungen'}${offen ? ' · noch nicht gebucht' : ''}` : ''}</span><b class="${fs.length ? 'neg' : ''}">${fs.length ? `−${eur0(summe)}` : ''}</b></div>
      ${lohn ? `<button class="nt-z nt-lohn"${geh(zuGehalt())} title="Anklicken: alle Gehälter"><span class="nt-n">Gehalt erwartet</span><b>+${eur0(g.c)}</b></button>` : ''}
      ${zeig.map((f) => `<button class="nt-z" data-fix="${esc(vertragsKey(f))}" title="${esc(vertragName(f))} · ${esc(f.rh.name)} – alle Zahlungen anzeigen"><span class="nt-n">${esc(vertragName(f))}${f.rh.proJahr < 12 ? ` <small>${esc(f.rh.name)}</small>` : ''}</span><b>${eur0(f.betrag)}</b></button>`).join('')}</div>`;
  }
  if (weg.length) h += `<div class="nt-mehr">+ ${weg.length} weitere Abbuchungen · ${eur0(weg.reduce((t, f) => t + f.betrag, 0))}</div>`;
  return `<div class="nt">${h}</div>`;
}

// ---------------------------------------------------------------- Navigation: 5 Bereiche
// Jeder Bereich öffnet mit seinem Überblick (S.tab = Name des Bereichs); die Einzelheiten sind die bisherigen Seiten
// (S.tab bleibt dort gleich, damit alle Verweise weiter gelten). Familie › Unterhalt ist intern fix/unterhalt.
const SEGMENTE = {
  geldfluss: [['geldfluss', 'Überblick'], ['uebersicht', 'Kategorien'], ['fix', 'Verträge']],
  vermoegen: [['vermoegen', 'Überblick'], ['konten', 'Konten & Depot']],
  einkommen: [['einkommen', 'Überblick'], ['gehalt', 'Gehalt'], ['steuer', 'Steuer']],
  familie: [['familie', 'Überblick'], ['unterhalt', 'Unterhalt & Rechner']],
};
function bereichVon(x = S) {
  if (x.tab === 'start') return 'cockpit';
  if (UEBERBLICK[x.tab]) return x.tab;
  if (x.tab === 'fix') return x.fixtab === 'unterhalt' ? 'familie' : 'geldfluss';
  if (x.tab === 'uebersicht' || x.tab === 'kennzahlen') return 'geldfluss';
  if (x.tab === 'konten') return 'vermoegen';
  if (x.tab === 'gehalt' || x.tab === 'steuer') return 'einkommen';
  return x.tab === 'buchungen' ? 'buchungen' : '';
}
const segVon = () => (S.tab === 'fix' && S.fixtab === 'unterhalt' ? 'unterhalt' : S.tab);
const segZiel = (t) => (t === 'fix' ? { tab: 'fix', fixtab: 'vertraege' } : t === 'unterhalt' ? { tab: 'fix', fixtab: 'unterhalt' } : { tab: t });
function bereichOeffnen(b) {
  setze(b === 'cockpit' ? { tab: 'start' } : b === 'buchungen' ? { tab: 'buchungen' } : { tab: b });
}
function navZeigen() {
  const b = bereichVon(), lupe = S.tab === 'buchungen';
  document.querySelectorAll('#tabs button').forEach((x) => { const an = x.dataset.bereich === b; x.classList.toggle('an', an); if (an) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); });
  // Buchungssuche: Lupe als aktiver Knopf mit Beschriftung, damit klar ist, wo man gerade ist
  $('#btn-lupe').classList.toggle('an', lupe);
  if (lupe) $('#btn-lupe').setAttribute('aria-current', 'page'); else $('#btn-lupe').removeAttribute('aria-current');
  const box = $('#bereich-seg'), l = SEGMENTE[b], jetzt = segVon();
  box.hidden = !l;
  if (!l) return;
  box.innerHTML = `<div class="seg" role="group" aria-label="Ansicht">${l.map(([t, n]) => `<button data-bseg="${t}"${jetzt === t ? ' class="an" aria-pressed="true"' : ' aria-pressed="false"'}>${n}</button>`).join('')}</div>`;
  box.querySelectorAll('[data-bseg]').forEach((x) => x.onclick = () => setze(segZiel(x.dataset.bseg)));
}
// Menü „Mehr“ (⋯): Chat, Planer, Kalender-Datei, Daten einlesen, Einstellungen
function mehrMenuBinden() {
  const mm = $('#mm'), knopf = $('#btn-menu');
  const zu = () => { mm.hidden = true; knopf.setAttribute('aria-expanded', 'false'); };
  knopf.onclick = (e) => { e.stopPropagation(); mm.hidden = !mm.hidden; knopf.setAttribute('aria-expanded', String(!mm.hidden)); if (!mm.hidden) mm.querySelector('button:not([hidden])')?.focus(); };
  document.addEventListener('click', (e) => { if (!mm.hidden && !mm.contains(e.target)) zu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !mm.hidden) { zu(); knopf.focus(); } });
  mm.addEventListener('click', (e) => { if (e.target.closest('button')) zu(); });
  const mitDaten = (f) => () => (D ? f() : toast('Lade zuerst deine Daten.'));
  $('#mm-chat').onclick = mitDaten(() => { if ($('#chat').hidden) $('#chat-knopf').click(); });
  $('#mm-plan').onclick = mitDaten(() => setze({ tab: 'fix', fixtab: 'plan' }));
  $('#mm-ics').onclick = mitDaten(() => {
    try {
      herunterladen(new Blob([icsText(H)], { type: 'text/calendar;charset=utf-8' }), 'Finanzen-Termine.ics');
      toast('Kalender-Datei erstellt – öffne sie, um die Termine zu übernehmen.');
    } catch (e) { console.error(e); toast('Die Kalender-Datei konnte nicht erstellt werden.'); }
  });
  $('#mm-einst').onclick = () => $('#dlg-menu').showModal();
}

// ---------------------------------------------------------------- Cockpit
// Aussage zuerst, vier Kennzahlen, Handlungsbedarf, eine Grafik, „Diesen Monat“. Alle Zahlen kommen aus den vorhandenen
// Rechnungen (verlauf5, monatsRechnung, kontenSumme, vermoegen) – hier wird nichts neu gerechnet.
// Kleine Verlaufslinie (SVG): werte = Zahlen oder null (Lücke); ab = erster Prognose-Index (gestrichelt)
function sparkline(werte, ab = -1) {
  const da = werte.filter((x) => x != null);
  if (da.length < 2) return '';
  const W = 120, HH = 34, min = Math.min(...da), max = Math.max(...da), sp = max - min || 1;
  const y = (v) => (HH - 3 - ((v - min) / sp) * (HH - 6)).toFixed(1), x = (i) => ((i / (werte.length - 1)) * W).toFixed(1);
  const pfad = (von, bis) => { let d = '', auf = false; for (let i = von; i <= bis; i++) { if (werte[i] == null) { auf = false; continue; } d += `${auf ? 'L' : 'M'}${x(i)} ${y(werte[i])}`; auf = true; } return d; };
  const ende = ab > 0 ? ab - 1 : werte.length - 1;
  const null0 = min < 0 && max > 0 ? `<path class="sp-0" d="M0 ${y(0)}H${W}"/>` : '';
  return `<svg class="sp" viewBox="0 0 ${W} ${HH}" preserveAspectRatio="none" aria-hidden="true">${null0}<path class="sp-l" d="${pfad(0, ende)}"/>${ab > 0 ? `<path class="sp-l sp-p" d="${pfad(ab - 1, werte.length - 1)}"/>` : ''}</svg>`;
}
// Kleine Säulen (Vorzeichen: grün = Plus, rot = Minus)
function sparSaeulen(werte) {
  if (werte.length < 2) return '';
  const W = 120, HH = 34, m = Math.max(1, ...werte.map(Math.abs)), b = W / werte.length, null0 = HH / 2;
  return `<svg class="sp" viewBox="0 0 ${W} ${HH}" preserveAspectRatio="none" aria-hidden="true"><path class="sp-0" d="M0 ${null0}H${W}"/>${werte.map((v, i) => {
    const h = Math.max(1, (Math.abs(v) / m) * (null0 - 2));
    return `<rect class="${v < 0 ? 'sp-neg' : 'sp-pos'}" x="${(i * b + b * 0.18).toFixed(1)}" width="${(b * 0.64).toFixed(1)}" y="${(v < 0 ? null0 : null0 - h).toFixed(1)}" height="${h.toFixed(1)}" rx="1"/>`;
  }).join('')}</svg>`;
}
const kachel = ({ titel, wert, cls_ = '', aend = '', unter = '', spark = '', ziel = null, marke = '' }) => `<button class="kz"${ziel ? geh(ziel) : ''} title="${esc(unter ? `${unter.replace(/<[^>]+>/g, '')} – anklicken: Einzelheiten` : 'Anklicken: Einzelheiten')}">
  <span class="kz-t">${titel}${marke ? ` <span class="marke">${marke}</span>` : ''}</span><b class="kz-w ${cls_}">${wert}</b>${aend ? `<span class="kz-a">${aend}</span>` : ''}${spark ? `<span class="kz-sp">${spark}</span>` : ''}${unter ? `<span class="kz-u">${unter}</span>` : ''}</button>`;

// Handlungsbedarf: Fristen, Wächter, offene Prüfen-Buchungen, offene Steuer-Entscheidungen – priorisiert, höchstens 3
const WA_ART = { doppelt: 'doppelte Abbuchung', gid: 'neue Lastschrift', preis: 'Preiserhöhung' };
let cpWaechterAuf = false;
function handlungsbedarf() {
  const l = [], heute = heuteLokal(), tage = (am) => Math.round((Date.parse(`${am}T00:00:00Z`) - Date.parse(`${heute}T00:00:00Z`)) / 864e5);
  for (const x of (sicher(() => fristenAlle(H)) || []).filter((f) => !f.erledigt)) {
    const n = tage(x.am);
    l.push({ prio: n < 0 ? 0 : n <= 14 ? 3 : 6, am: x.am, ampel: n < 0 ? 'rot' : n <= 14 ? 'gelb' : '', text: esc(x.titel),
      sub: `${n < 0 ? `seit ${-n} ${n === -1 ? 'Tag' : 'Tagen'} überfällig` : n === 0 ? 'heute' : n === 1 ? 'morgen' : `in ${n} Tagen`} · ${tagKurz(x.am)}${x.orientierung ? ' · Orientierung' : ''}`,
      typ: 'frist', ziel: x.ziel || { tab: 'fix', fixtab: 'kalender', _springe: '#fr-liste' } });
  }
  const wt = (sicher(() => treffer(H)) || []).filter((t) => t.offen && !t.s);
  if (wt.length) {
    const arten = [...new Set(wt.map((t) => WA_ART[t.art]).filter(Boolean))];
    l.push({ prio: 1, ampel: 'gelb', text: `${wt.length} ${wt.length === 1 ? 'Auffälligkeit' : 'Auffälligkeiten'} ansehen`, sub: arten.join(', ') || 'Wächter', typ: 'waechter', waechter: true });
  }
  const np = sicher(() => offenZahl(D)) || 0;
  if (np) l.push({ prio: 2, ampel: 'gelb', text: `${NUM.format(np)} ${np === 1 ? 'Buchung' : 'Buchungen'} prüfen`, sub: 'Kategorie bestätigen oder ändern', typ: 'pruefen', ziel: { tab: 'uebersicht', kart: 'pruefen', wahl: '' } });
  const st = steuerStand();
  startOhneSteuer = !st;   // nach dem Laden der Steuer-Entscheidungen neu zeichnen
  if (st?.offen) l.push({ prio: 4, ampel: '', text: `Steuer ${st.jahr}: ${st.offen} ${st.offen === 1 ? 'Entscheidung' : 'Entscheidungen'} offen`, sub: 'Belege zuordnen', typ: 'steuer', ziel: { tab: 'steuer' } });
  return l.sort((a, b) => a.prio - b.prio || String(a.am || '').localeCompare(String(b.am || '')));
}
// Symbole für „Zu tun“ (gleicher Strich wie die Navigation)
const TD_ICON = {
  frist: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  waechter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.3"/></svg>',
  pruefen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h9M4 12h9M4 17.5h6"/><path d="m15 16.5 2.2 2.2 4-4.4"/></svg>',
  steuer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
};
function handlungHtml(l) {
  if (!l.length) return '<p class="cp-ruhig"><i class="ampel ok" aria-hidden="true"></i>Nichts zu tun – keine offenen Fristen, Auffälligkeiten oder Prüfungen.</p>';
  return `<div class="cp-td-l">${l.slice(0, 4).map((x) => `<button class="cp-td ${x.ampel || 'neutral'}" title="${esc(`${x.text} · ${x.sub}`.replace(/<[^>]+>/g, ''))}"${x.waechter ? ` data-cp-waechter aria-expanded="${cpWaechterAuf}"` : geh(x.ziel)}>
      <span class="cp-td-i">${TD_ICON[x.typ] || TD_ICON.frist}</span><span class="cp-td-t">${x.text}<small>${x.sub}</small></span><span class="cp-td-p" aria-hidden="true">${x.waechter ? (cpWaechterAuf ? '▴' : '▾') : '›'}</span></button>`).join('')}</div>
`;
}

// Kontostand: die letzten 24 abgeschlossenen Monate (wie in verlauf5 je Monatsende, nur vollständige Summen), dann die Prognose aus verlauf5
function cockpitVerlauf(V) {
  const ist = abgeschlosseneMonate().slice(-24).map((k) => { const s = kontenSumme(monatsletzter(`${k}-01`)); return { k, art: 'ist', stand: vollSumme(s), summe: s }; });
  return [...ist, ...V.monate.filter((m) => m.art !== 'ist').map((m) => ({ k: m.k, art: m.art, stand: m.stand, summe: null }))];
}

// Ring (SVG): Anteil p (0–1) als Bogen, optional ein Strich bei t (0–1)
function ring(p, t = null, mitte = '') {
  const r = 40, U = 2 * Math.PI * r, w = (x) => (Math.max(0, Math.min(1, x)) * U).toFixed(1);
  const strich = t == null ? '' : (() => { const a = t * 2 * Math.PI - Math.PI / 2; return `<path class="rg-t" d="M${(50 + 31 * Math.cos(a)).toFixed(1)} ${(50 + 31 * Math.sin(a)).toFixed(1)}L${(50 + 49 * Math.cos(a)).toFixed(1)} ${(50 + 49 * Math.sin(a)).toFixed(1)}"/>`; })();
  return `<svg class="rg" viewBox="0 0 100 100" aria-hidden="true"><circle class="rg-h" cx="50" cy="50" r="${r}"/><circle class="rg-v" cx="50" cy="50" r="${r}" stroke-dasharray="${w(p)} ${U.toFixed(1)}" transform="rotate(-90 50 50)"/>${strich}<text x="50" y="55" text-anchor="middle">${mitte}</text></svg>`;
}
// Ring mit Teilen (Vermögen): teile = [[Name, Cent], …]
function ringTeile(teile) {
  const r = 40, U = 2 * Math.PI * r, sum = teile.reduce((t, [, c]) => t + c, 0) || 1;
  let ab = 0;
  return `<svg class="rg" viewBox="0 0 100 100" aria-hidden="true"><circle class="rg-h" cx="50" cy="50" r="${r}"/>${teile.map(([n, c], i) => {
    const len = (c / sum) * U, h = `<circle class="rg-s" style="--i:${i}" cx="50" cy="50" r="${r}" stroke-dasharray="${Math.max(0, len - 1.5).toFixed(1)} ${U.toFixed(1)}" stroke-dashoffset="${(-ab).toFixed(1)}" transform="rotate(-90 50 50)"><title>${n}: ${eur0(c)}</title></circle>`;
    ab += len; return h;
  }).join('')}</svg>`;
}
// Nächste 30 Tage (Prognose): frei verfügbares Geld heute (ohne Mietkaution, gemeinsame und Kinderkonten), dann Tag für Tag
// die festen Abbuchungen aus den Verträgen (ausstehende sofort), das erwartete Gehalt und die Lebenshaltung gleichmäßig verteilt
function vorschau30(R) {
  const start = ruecklagen();
  if (start == null) return null;
  const l = naechsteTermine(R.vertraege), g = naechstesGehalt(), proTag = R.leben / tageImMonat(D.bis.slice(0, 7));
  const am = (d) => l.filter((x) => x.am === d).reduce((t, x) => t + x.f.betrag, 0);
  let s = start - l.filter((x) => x.am <= D.bis).reduce((t, x) => t + x.f.betrag, 0);
  const tage = [{ am: D.bis, s }];
  for (let i = 1; i <= 30; i++) { const d = plusTage(D.bis, i); s += -am(d) - proTag + (g && g.am === d ? g.c : 0); tage.push({ am: d, s }); }
  const tief = tage.reduce((m, x) => (x.s < m.s ? x : m), tage[0]);
  return { start, tage, tief, ende: tage.at(-1), n: l.length, fest: l.reduce((t, x) => t + x.f.betrag, 0), g, leben: proTag * 30 };
}
// Stufenlinie (SVG) für die 30 Tage, Tiefpunkt markiert, Nulllinie wenn es darunter geht
function stufenSvg(werte, tiefI) {
  const W = 220, HH = 64, min = Math.min(0, ...werte), max = Math.max(...werte), sp = max - min || 1;
  const x = (i) => ((i / (werte.length - 1)) * W).toFixed(1), y = (v) => (HH - 4 - ((v - min) / sp) * (HH - 10)).toFixed(1);
  let d = `M0 ${y(werte[0])}`;
  for (let i = 1; i < werte.length; i++) d += `H${x(i)}V${y(werte[i])}`;
  return `<svg class="st30" viewBox="0 0 ${W} ${HH}" preserveAspectRatio="none" aria-hidden="true">${min < 0 ? `<path class="sp-0" d="M0 ${y(0)}H${W}"/>` : ''}<path class="st30-f" d="${d}V${HH}H0Z"/><path class="sp-l" d="${d}"/><circle class="st30-t" cx="${x(tiefI)}" cy="${y(werte[tiefI])}" r="3.5"/></svg>`;
}
const cvKarte = ({ titel, wert, cls_ = '', unter = '', vis = '', ziel, marke = '', tip = '' }) => `<button class="card cv"${geh(ziel)} title="${esc(tip ? `${tip} – anklicken: Einzelheiten` : 'Anklicken: Einzelheiten')}">
  <span class="cv-k"><span class="kz-t">${titel}${marke ? ` <span class="marke">${marke}</span>` : ''}</span><b class="cv-w ${cls_}">${wert}</b><span class="cv-u">${unter}</span></span><span class="cv-vis">${vis}</span></button>`;

function cockpitSeite() {
  const box = $('#s5'), V = verlauf5(), R = V.R, ms = V.monate, lauf = V.lauf, letzte = ms[ms.length - 1];
  const hs = V.heuteSumme, heute = hs?.c ?? 0, s = V.schnitt, prog = letzte.stand;
  const anfang = kontenSumme(plusTage(`${V.jetzt}-01`, -1)), seitAnfang = diffSumme(anfang, hs);
  const monatJ = MONAT[+V.jetzt.slice(5) - 1], monatE = `${MONAT[+letzte.k.slice(5) - 1]}${letzte.k.slice(0, 4) !== V.jetzt.slice(0, 4) ? ` ${letzte.k.slice(0, 4)}` : ''}`;
  const zuKonten = { tab: 'konten', stichtag: '', konto: '' };
  const ist = ms.filter((m) => m.art === 'ist');

  // Prognose mit ausdrücklichem Vergleich: Monatsende gegen Monatsende (letztes abgeschlossenes → Prognose), nicht gegen heute
  const basis = ist.length ? ist[ist.length - 1] : null, bStand = basis?.stand ?? null;
  const diff = prog != null && bStand != null ? prog - bStand : null;
  const stabil = diff != null && Math.abs(diff) < Math.max(20000, Math.abs(bStand) * 0.03);
  const bMonat = basis ? MONAT[+basis.k.slice(5) - 1] : '';
  const dZ = diff == null ? null : dGezeigt(bStand, prog);
  const vergleich = diff == null ? '' : stabil ? `etwa so viel wie Ende ${bMonat}` : `${eur0(Math.abs(dZ))} ${dZ > 0 ? 'mehr' : 'weniger'} als Ende ${bMonat} (${eur0(bStand)})`;
  const seitText = anfang ? `${seitAnfang == null ? '–' : pmHtml(dGezeigt(anfang.c, hs.c))} seit 1. ${monatJ}` : '';
  // Vergleich: dieselbe Prognose mit Ø 12 Monate (nur wenn die Grundlage der Vormonat ist)
  const progAlt = lebenWahl === 'vormonat' ? sicher(() => verlauf5(true).monate.at(-1).stand) : '';
  const progGrund = `Plan-Gehalt, feste Abbuchungen je Monat, Lebenshaltung wie im normalen Monat: ${esc(lebenName())} (${eur0(R.leben)})`;

  const hero = `<section class="card cp-hero">
    <div class="cp-hero-k">
      <div class="cp-hero-l"><p class="cp-ueber">Cockpit · Daten bis ${dde(D.bis)}</p><p class="cp-hero-t">Auf deinen Konten heute</p>
        <h1 class="cp-hero-w ${heute < 0 ? 'neg' : ''}">${zl(summeText(hs), zuKonten)}</h1>
        <p class="cp-hero-u">${seitText}${lauf?.gehaltKommt ? ' · das Gehalt kommt noch' : ''}${hs && !hs.voll ? ` · ${esc(fehltText(hs))}` : ''}</p></div>
      <div class="cp-hero-p"><span class="marke">Prognose</span>
        ${prog == null ? '<p>Eine Prognose geht nicht: der Stand heute ist unvollständig.</p>'
          : `<p>Ende ${monatE} auf deinen Konten</p><b class="${prog < 0 ? 'neg' : ''}">≈ ${eur0(prog)}</b>${vergleich ? `<small>${vergleich}</small>` : ''}${progAlt !== '' && progAlt != null ? `<small class="cp-alt">mit Ø 12 Monate gerechnet: ≈ ${eur0(progAlt)}</small>` : ''}`}</div>
    </div>
    <div class="cp-hero-g"><div class="cp-kt"><h2>Einnahmen und Ausgaben je Monat</h2></div>
      <p class="cp-leg"><i class="cp-leg-e"></i>Einnahmen <i class="cp-leg-a"></i>Ausgaben <span>· Zahl darunter: Ergebnis · schraffiert: erwartet</span></p>
      <div class="cp-chart cp-hero-chart"><canvas id="c-cp-monate" aria-label="Einnahmen und Ausgaben je Monat mit Ergebnis"></canvas></div>
      <p class="cp-fuss">Ohne Kinder- und gemeinsame Konten<span class="cp-nur-breit"> · Prognose: ${progGrund}</span> · Säule anklicken: Buchungen des Monats</p></div>
  </section>`;

  // Drei Kacheln mit Bild: normaler Monat (Einkommen gegen Ausgaben), Vermögen (Ring), laufender Monat (Ring mit Tag)
  const maxB = Math.max(R.ein, R.aus, 1), bw = (c) => ((Math.max(0, c) / maxB) * 100).toFixed(1);
  // gezeigte Euro-Teile: Einkommen, Ausgaben und Ergebnis aus den gerundeten Teilen, damit die Zahlen aufgehen
  const gZ = r0(R.gehalt), soZ = r0(R.sonst), fZ = r0(R.fix), lZ = r0(R.leben), einZ = gZ + soZ, ausZ = fZ + lZ, ergZ = einZ - ausZ;
  const monatVis = `<span class="cv-bal"><span class="cv-bz"><span>Einkommen</span><span class="cv-b"><i class="cv-ein" style="width:${bw(R.ein)}%"></i></span><b>${eur0(einZ)}</b></span>
    <span class="cv-bz"><span>Ausgaben</span><span class="cv-b"><i class="cv-fest" style="width:${bw(R.fix)}%"></i><i class="cv-leben" style="width:${bw(R.leben)}%"></i>${R.erg > 0 ? `<i class="cv-bleibt" style="width:${bw(R.erg)}%"></i>` : ''}</span><b>${eur0(ausZ)}</b></span>
    <span class="cv-leg"><span><i class="cv-ein"></i>Einkommen</span><span><i class="cv-fest"></i>Fixkosten</span><span><i class="cv-leben"></i>Lebenshaltung</span>${ergZ > 0 ? `<span><i class="cv-bleibt"></i>bleibt ${eur0(ergZ)}</span>` : ergZ < 0 ? `<span><i class="cv-fehlt"></i>fehlt ${eur0(-ergZ)}</span>` : ''}</span></span>`;
  const vm = sicher(() => vermoegen(H)) || null;
  const vmTeile = vm ? [['Konten', vm.ks?.c || 0], ['Depot', vm.dp?.wert || 0], ['Kaution', vm.kaution?.c || 0], ['Vorsorge', vm.vorsorge]].filter(([, c]) => c > 0) : [];
  const vmSum = vmTeile.reduce((t, [, c]) => t + c, 0) || 1;
  const vmVis = vmTeile.length ? `<span class="cv-ring">${ringTeile(vmTeile)}<span class="cv-rleg">${vmTeile.map(([n, c], i) => `<span><i style="--i:${i}"></i>${n}<b>${Math.round((c / vmSum) * 100)} %</b></span>`).join('')}</span></span>` : '';
  const monatTeil = lauf ? Math.min(1, lauf.x.aus / Math.max(1, lauf.aus)) : 1;
  // Ring: ausgegeben ÷ erwartet; Legende: fest gebucht + Lebenshaltung = ausgegeben, dazu noch erwartet (aus gezeigten Werten)
  const laufVis = lauf ? `<span class="cv-ring">${ring(monatTeil, lauf.tag / lauf.tage, `${Math.round(monatTeil * 100)} %`)}<span class="cv-rleg">
      <span><i class="cv-ein"></i>fest abgebucht<b>${eur0(lauf.x.aus - lauf.x.var)}</b></span>
      <span><i class="cv-ein"></i>Lebenshaltung<b>${eur0(dGezeigt(lauf.x.aus - lauf.x.var, lauf.x.aus))}</b></span>
      <span><i class="cv-offen"></i>kommt noch<b>≈ ${eur0(dGezeigt(lauf.x.aus, lauf.aus))}</b></span>
      <span><i class="cv-strich"></i>heute<b>Tag ${lauf.tag} von ${lauf.tage}</b></span></span></span>` : '';
  const kacheln = [
    cvKarte({ titel: 'Normaler Monat', wert: plusMinus(ergZ), cls_: ergZ < 0 ? 'neg' : 'pos', ziel: { tab: 'geldfluss' }, unter: `Lebenshaltung ${esc(lebenName())} · Ø 12 Monate ${eur0(R.lh.schnitt)}`, vis: monatVis,
      tip: `Gehalt ${eur0(gZ)} + Sonstiges ${eur0(soZ)} − Fixkosten ${eur0(fZ)} (${R.vertraege.length} Verträge) − Lebenshaltung ${eur0(lZ)} (${lebenName()})` }),
    cvKarte({ titel: 'Vermögen', wert: vm ? vmText(vm) : '–', cls_: vm?.c < 0 ? 'neg' : '', ziel: { tab: 'vermoegen' },
      unter: `ohne gesetzliche Rente${vm?.depotBerechnet ? ` · ${VM_DEPOT_BERECHNET}` : ''}`, vis: vmVis, tip: 'Konten, Depot, Vorsorge – jeder Teil mit eigenem Stichtag' }),
    cvKarte({ titel: lauf ? `${monatJ} bisher` : 'Dieser Monat', wert: lauf ? eur0(lauf.x.aus) : '–', ziel: zuBuchungen({ konto: '', ...monatZiel(V.jetzt), art: 'aus' }),
      unter: lauf ? `ausgegeben von ≈ ${eur0(lauf.aus)}, die im ${monatJ} erwartet sind. Miete und Unterhalt gehen am Monatsanfang ab – deshalb ist früh schon viel weg.` : 'Der Monat ist abgeschlossen.', vis: laufVis,
      tip: lauf ? `Ausgegeben ${eur0(lauf.x.aus)} von erwarteten ${eur0(lauf.aus)}: feste Abbuchungen im ${monatJ} ${eur0(lauf.x.aus - lauf.x.var + lauf.offenFest)} und Lebenshaltung ${eur0(lauf.x.var + lauf.varKommt)} (${lebenName()})` : '' }),
    (() => {
      const W = sicher(() => vorschau30(R)) || null;
      if (!W) return cvKarte({ titel: 'Nächste 30 Tage', wert: '–', ziel: { tab: 'fix', fixtab: 'kalender', konto: '' }, unter: 'Der Stand heute ist nicht vollständig berechenbar.' });
      const ti = W.tage.indexOf(W.tief);
      return cvKarte({ titel: 'Tiefster Stand in 30 Tagen', marke: 'Prognose', wert: `≈ ${eur0(W.tief.s)}`, cls_: W.tief.s < 0 ? 'neg' : '', ziel: { tab: 'fix', fixtab: 'kalender', konto: '' },
        unter: `Mindestens so viel Geld bleibt frei – ${ti === 0 ? 'heute' : `am ${tagKurz(W.tief.am)}`}${W.g && W.g.am > W.tief.am ? ', kurz vor dem Gehalt' : ''}. Heute frei minus feste Abbuchungen und Lebenshaltung (≈ ${eur0(W.leben / 30)} am Tag).`,
        tip: `Heute frei verfügbar ${eur0(W.start)} (ohne Mietkaution, gemeinsame und Kinderkonten) · ${W.n} feste Abbuchungen ${eur0(W.fest)}${W.g ? ` · Gehalt ${eur0(W.g.c)} am ${tagKurz(W.g.am)}${W.g.ueberfaellig ? ' (überfällig, noch nicht gebucht)' : ''}` : ''} · Lebenshaltung ${eur0(W.leben)} gleichmäßig verteilt`,
        vis: `<span class="st30-box">${stufenSvg(W.tage.map((t) => t.s), ti)}<span class="st30-ax"><span${W.tage[0].s !== W.start ? ' title="nach fälligen, noch nicht gebuchten Abbuchungen"' : ''}>heute<b>${eur0(W.tage[0].s)}</b></span><span class="st30-tief">${tagKurz(W.tief.am).slice(3)}<b>≈ ${eur0(W.tief.s)}</b></span><span>${tagKurz(W.ende.am).slice(3)}<b>≈ ${eur0(W.ende.s)}</b></span></span></span>` });
    })(),
  ].join('');

  // Wofür das Geld ausgeht: der Vormonat als Grundlage, Strich = Ø 12 Monate
  const K = katVormonat(), kTop = K.l.slice(0, 8), kRest = K.l.slice(8), kR = K.teil(kRest);
  const kZeile = (x) => ({ n: esc(schoen(x.k)), c: x.c, w: x.c > 0 ? eur0(x.c) : '–', marke: x.o > 0 ? x.o : null, p: x.o > 0 ? `Ø ${eur0(x.o)}` : '–', farbe: 'var(--accent-2)', ziel: katZielVm(x.k, K.vm),
    tip: `${schoen(x.k)}: ${K.kurz} ${eur0(x.c)} · Ø 12 Monate ${eur0(x.o)}` });
  const kats = K.l.length ? `<div class="bl-vm">${balkenListe([...kTop.map(kZeile),
    ...(kRest.length ? [{ n: `${kRest.length} übrige Kategorien`, sub: kRest.slice(0, 3).map((x) => esc(schoen(x.k))).join(', ') + (kRest.length > 3 ? ' …' : ''), c: kR.c, marke: kR.o, p: `Ø ${eur0(kR.o)}`, farbe: 'var(--variabel)', ziel: katZielVm('', K.vm) }] : []),
    { n: '<b>Summe</b>', c: 0, w: `<b>${eur0(K.sum.c)}</b>`, p: `<b>Ø ${eur0(K.sum.o)}</b>`, cls: 'bl-summe' }], { max: Math.max(1, ...K.l.map((x) => Math.max(x.c, x.o)), kR.c, kR.o), kopf: ['Kategorie', K.kurz, 'Ø 12 Mon.'] })}</div>`
    : '<p class="leer klein">Keine Ausgaben in den letzten 12 Monaten.</p>';

  // Auffällig im Vormonat: die größten Abweichungen zum Ø 12 Monate (ab 50 €), bei Mehrausgaben die größte Buchung dazu
  const abw = K.l.map((x) => ({ ...x, d: x.c - x.o })).filter((x) => Math.abs(x.d) >= 5000).sort((a1, b1) => Math.abs(b1.d) - Math.abs(a1.d)).slice(0, 4);
  const groesste = (k) => (K.m.g.get(k)?.rows || []).filter((r) => r.c < 0).sort((a1, b1) => a1.c - b1.c)[0];
  const auffaellig = abw.length ? `<div class="cp-auff"><p class="cp-auff-t">Auffällig im ${esc(K.kurz)} – Abweichung zum Ø 12 Monate</p>${abw.map((x) => { const g1 = x.d > 0 ? groesste(x.k) : null;
      return `<button class="cp-auff-z"${geh(katZielVm(x.k, K.vm))}><span>${esc(schoen(x.k))}<small>${x.d > 0 ? (g1 ? `größte Buchung: ${esc(g1.g || g1.z || '–')} ${eur0(-g1.c)}` : '') : 'weniger als üblich'}</small></span>${bxDelta(dGezeigt(x.o, x.c))}</button>`; }).join('')}</div>` : '';

  const hb = handlungsbedarf(), hbRot = hb.some((x) => x.ampel === 'rot');

  // Reihe D: feste Abbuchungen der nächsten 30 Tage (Tag für Tag, mit Gehalt), Fixkosten nach Art, Eckwerte der anderen Bereiche
  const T30 = naechsteTermine(R.vertraege), T30s = T30.reduce((t, x) => t + x.f.betrag, 0), gK = naechstesGehalt(), zuKal = { tab: 'fix', fixtab: 'kalender', konto: '' };
  const vorG = T30.filter((x) => !gK || x.am < gK.am), abVor = vorG.reduce((t, x) => t + x.f.betrag, 0), nVor = vorG.length;
  const arten = new Map();
  for (const f of R.vertraege) { const art = fixArt(f), x = arten.get(art) || arten.set(art, { art, c: 0, n: 0 }).get(art); x.c += f.proMonat; x.n++; }
  const al = [...arten.values()].sort((a1, b1) => b1.c - a1.c), alR = al.length > 6 ? al.slice(5) : [], alRc = alR.reduce((t, x) => t + x.c, 0), zuFix = { tab: 'fix', fixtab: 'vertraege', konto: '' };
  const pzG = (c) => (R.gehalt ? `${((c / R.gehalt) * 100).toLocaleString('de-DE', { maximumFractionDigits: 0 })} %` : '');
  const fixL = balkenListe([...al.slice(0, alR.length ? 5 : 6).map((x) => ({ n: FIX_KURZ[x.art] || esc(x.art), c: x.c, p: pzG(x.c), ziel: zuFix, farbe: 'var(--fest)', tip: `${x.art}: ${eur0(x.c)} im Monat · ${x.n} ${x.n === 1 ? 'Vertrag' : 'Verträge'}` })),
    ...(alR.length ? [{ n: `${alR.length} weitere Arten`, tip: alR.map((x) => `${x.art} ${eur0(x.c)}`).join(', '), c: alRc, p: pzG(alRc), ziel: zuFix, farbe: 'var(--fest)' }] : []),
    { n: '<b>Summe</b>', c: 0, w: `<b>${eur0(R.fix)}</b>`, p: `<b>${pzG(R.fix)}</b>`, cls: 'bl-summe' }], { max: Math.max(1, ...al.map((x) => x.c), alRc), kopf: ['Art', 'im Monat', 'vom Gehalt'] });
  const ber = [];
  const gU = sicher(() => gehaltUeberblick(gehaltHelfer())) || null;
  if (gU?.z) ber.push({ t: `Gehalt aufs Konto ${MONAT[+gU.z.m.slice(5) - 1]}`, sub: `Grundgehalt ${eurE0(gU.stufe)} brutto${gU.auto ? ` · Dienstwagen kostet ${eurE0(gU.auto.netto)} netto` : ''}`, w: eurE0(gU.z.auszahlung), ziel: { tab: 'einkommen' } });
  const sP = sicher(() => prognoseRechnen(H, +D.bis.slice(0, 4))) || null;
  if (sP) ber.push({ t: `Steuer ${sP.jahr}`, sub: `${sP.ohne.erg >= 0 ? 'Erstattung' : 'Nachzahlung'} ohne Anlage U · berechnet${sP.mit ? ` · mit Anlage U ${plusMinus(sP.mit.erg)}` : ''}`, w: plusMinus(sP.ohne.erg), cls_: sP.ohne.erg >= 0 ? 'pos' : 'neg', ziel: { tab: 'einkommen' } });
  const uK = sicher(() => unterhaltKurz(H)) || null, uL = uK?.K?.letzte;
  if (uL) { const ri = dGezeigt(Math.round(uL.summe * 100), Math.round(uK.K.X.summe * 100)); /* Differenz der gezeigten Euro-Beträge */ ber.push({ t: 'Unterhalt verbindlich', sub: `Berechnung vom ${dde(uL.datum)} · Risiko bei Neuberechnung ${ri >= 0 ? '+' : '−'}${eur0(Math.abs(ri))}`, w: eurE0(uL.summe), ziel: { tab: 'familie' } }); }
  const vm0 = sicher(() => vermoegen(H)) || null;
  if (vm0) ber.push({ t: 'Vermögen', sub: `Konten, Depot, Vorsorge · ohne gesetzliche Rente${vm0.depotBerechnet ? ` · ${VM_DEPOT_BERECHNET}` : ''}`, w: vmText(vm0), cls_: vm0.c < 0 ? 'neg' : '', ziel: { tab: 'vermoegen' } });
  if (uK && uK.A?.rows?.length) ber.push({ t: `Ausgleich mit ${esc(uK.A.name || 'der Gegenseite')}`, sub: uK.offen.length ? `${uK.offen.length} Posten offen` : 'keine offenen Steueranteile · plus = an dich', w: `${uK.saldo > 0 ? '+' : uK.saldo < 0 ? '−' : ''}${eur0(Math.abs(uK.saldo))}`, cls_: uK.saldo < 0 ? 'neg' : uK.saldo > 0 ? 'pos' : '', ziel: { tab: 'familie' } });
  const st0 = steuerStand();
  if (st0?.offen) ber.push({ t: `Belege ${st0.jahr}`, sub: st0.offen ? 'Steuer-Entscheidungen offen' : 'alle Steuer-Entscheidungen getroffen', w: st0.offen ? `${st0.offen} offen` : 'erledigt', ziel: { tab: 'steuer' } });
  const bereiche = ber.length ? `<div class="cp-ber">${ber.map((x) => `<button class="cp-ber-z"${geh(x.ziel)}><span>${x.t}<small>${x.sub}</small></span><b class="${x.cls_ || ''}">${x.w}</b></button>`).join('')}</div>` : '<p class="leer klein">Noch keine Angaben.</p>';
  const reiheD = `<div class="cp-reihe-d">
      <section class="card cp-karte cp-ab"><div class="cp-kt"><h2>Die nächsten 30 Tage</h2>${zl('ganzer Kalender', zuKal)}</div>
        <div class="cp-ab-k">
          <div><span>vor dem Gehalt</span><b>${eur0(abVor)}</b><small>${nVor} Abbuchungen</small></div>
          ${gK ? `<div class="cp-ab-g"><span>Gehalt ${tagKurz(gK.am)}</span><b>+${eur0(gK.c)}</b><small>${gK.ueberfaellig ? 'überfällig, noch nicht gebucht' : 'erwartet'}</small></div>` : ''}
          <div><span>${gK ? 'nach dem Gehalt' : 'danach'}</span><b>${eur0(dGezeigt(abVor, T30s))}</b><small>${T30.length - nVor} Abbuchungen</small></div>
          <div class="cp-ab-s"><span>zusammen</span><b>${eur0(T30s)}</b><small>${T30.length} feste Abbuchungen</small></div>
        </div>
        <div class="cp-agenda">${termineHtml(T30, 24)}</div></section>
      <section class="card cp-karte cp-fx"><div class="cp-kt"><h2>Fixkosten nach Art</h2><span class="klein muted">${R.vertraege.length} laufende Verträge</span></div>${fixL}</section>
      <section class="card cp-karte cp-bk"><div class="cp-kt"><h2>Aus den anderen Bereichen</h2></div>${bereiche}</section>
    </div>`;
  box.innerHTML = `<div class="cp">
    <div class="cp-reihe-a">
      ${hero}
      <section class="card cp-karte cp-kat"><div class="cp-kt"><h2>Ausgaben im ${esc(K.kurz)}</h2><span class="klein muted">nach Kategorie</span></div>${kats}
        ${auffaellig}<p class="cp-fuss" title="Durchschnitt ${esc(monatsText(K.ms))} · ohne Kinder- und gemeinsame Konten · Beträge gerundet, Summen aus den genauen Werten">Balken: ${esc(K.kurz)} · Strich: Ø 12 Monate · ${zl('alle Kategorien', katAlle)}</p></section>
    </div>
    <div class="cp-drei cp-vier">${kacheln}</div>
    <section class="card cp-karte cp-td-karte"><div class="cp-kt"><h2>Zu tun ${hb.length ? `<span class="cp-zahl${hbRot ? ' neg' : ''}">${hb.length}</span>` : ''}</h2>${hb.length > 4 ? `<span class="klein muted">+ ${hb.length - 4} weitere · ${zl('alle Fristen', { tab: 'fix', fixtab: 'kalender', _springe: '#fr-liste' })}</span>` : ''}</div>${handlungHtml(hb)}
      <div id="cp-waechter"${cpWaechterAuf ? '' : ' hidden'}>${cpWaechterAuf ? sicher(() => waechterKarte(H)) : ''}</div></section>
    ${reiheD}
  </div>`;
  gehBinden(box);
  if (cpWaechterAuf) sicher(() => waechterBinden(box, H));
  box.querySelector('[data-cp-waechter]')?.addEventListener('click', () => { cpWaechterAuf = !cpWaechterAuf; cockpitSeite(); if (cpWaechterAuf) springe('#cp-waechter'); });
  sicher(() => cpMonateZeichnen(V.monate));
}

// Feste Abbuchungen je Tag (30 Tage ab dem Datenstand; fällige, noch nicht gebuchte am ersten Tag) und das erwartete Gehalt
function cpAbbZeichnen(l, g) {
  if (!$('#c-cp-abb')) return;
  const tage = Array.from({ length: 31 }, (_, i) => plusTage(D.bis, i)), je = tage.map(() => []);
  for (const x of l) je[Math.max(0, tage.indexOf(x.am) < 0 ? (x.am <= D.bis ? 0 : -1) : tage.indexOf(x.am))]?.push(x);
  const ab = je.map((xs) => xs.reduce((t, x) => t + x.f.betrag, 0) / 100), gh = tage.map((d) => (g && g.am === d ? g.c / 100 : 0));
  const o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.layout = { padding: { top: 6 } };
  o.scales = {
    x: { ...achsenStil(), stacked: true, grid: { display: false }, ticks: { ...achsenStil().ticks, font: { size: 10.5 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 8 } },
    y: { ...achsenStil(), stacked: true, beginAtZero: true, ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 4 } },
  };
  o.plugins.tooltip.callbacks = {
    title: (it) => `${tagKurz(tage[it[0].dataIndex])}${it[0].dataIndex === 0 ? ' (heute, mit fälligen noch nicht gebuchten)' : ''}`,
    label: (it) => (it.raw ? ` ${it.dataset.label}: ${EUR0.format(it.raw)}` : null),
    afterBody: (it) => je[it[0].dataIndex].slice(0, 8).map((x) => `${vertragName(x.f)}: ${eur0(x.f.betrag)}`),
  };
  o.onClick = () => setze({ tab: 'fix', fixtab: 'kalender', konto: '' });
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; };
  zeichne('c-cp-abb', {
    type: 'bar',
    data: { labels: tage.map((d) => `${+d.slice(8)}.${+d.slice(5, 7)}.`), datasets: [
      { label: 'Abbuchungen', data: ab, backgroundColor: css('--fest'), borderRadius: 3, maxBarThickness: 18 },
      { label: 'Gehalt', data: gh, backgroundColor: css('--akzent'), borderRadius: 3, maxBarThickness: 18 },
    ] },
    options: o,
  });
}

// Einnahmen und Ausgaben je Monat: die letzten Monate (Handy weniger), der laufende Monat und die Prognose (schraffiert),
// darunter das Ergebnis je Monat. Ausgaben in der Leitfarbe – Grün/Rot nur für das Vorzeichen des Ergebnisses.
function cpMonateZeichnen(alle) {
  if (!$('#c-cp-monate')) return;
  const schmal = matchMedia('(max-width: 640px)').matches, n = schmal ? 3 : 9, ist = alle.filter((m) => m.art === 'ist');
  const ms = [...ist.slice(-n), ...alle.filter((m) => m.art !== 'ist')], ab = ms.findIndex((m) => m.art !== 'ist');
  const cE = css('--akzent'), cA = css('--fest'), pE = schraffur(cE), pA = schraffur(cA);
  const o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.layout = { padding: { top: 18 } };
  o.scales = {
    x: { ...achsenStil(), grid: { display: false }, ticks: { ...achsenStil().ticks, padding: 20, font: { size: 11 }, maxRotation: 0, autoSkip: false } },
    y: { ...achsenStil(), beginAtZero: true, ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 5 } },
  };
  o.plugins.tooltip.callbacks = {
    title: (it) => { const m = ms[it[0].dataIndex]; return `${monLang(m.k)}${m.art === 'laeuft' ? ' – bisher + erwartet' : m.art === 'prognose' ? ' – Prognose' : ''}`; },
    label: (it) => ` ${it.dataset.label}: ${EUR0.format(it.raw)}`,
    footer: (it) => { const m = ms[it[0].dataIndex]; return `${m.erg >= 0 ? 'Überschuss' : 'Fehlbetrag'}: ${eur0(m.erg)}`; },
  };
  o.onClick = (_, el) => { const m = el.length && ms[el[0].index]; if (m && m.art !== 'prognose') setze(zuBuchungen({ konto: '', ...monatZiel(m.k) })); };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length && ms[el[0].index].art !== 'prognose' ? 'pointer' : 'default'; };
  const satz = (c, p) => ms.map((m) => (m.art === 'ist' ? c : p));
  zeichne('c-cp-monate', {
    type: 'bar',
    data: { labels: ms.map((m) => (schmal ? MON[+m.k.slice(5) - 1] : monKurz(m.k))), datasets: [
      { label: 'Einnahmen', data: ms.map((m) => m.ein / 100), backgroundColor: satz(cE, pE), hoverBackgroundColor: cE, borderRadius: 4, maxBarThickness: 22, categoryPercentage: 0.74, barPercentage: 0.92 },
      { label: 'Ausgaben', data: ms.map((m) => m.aus / 100), backgroundColor: satz(cA, pA), hoverBackgroundColor: cA, borderRadius: 4, maxBarThickness: 22, categoryPercentage: 0.74, barPercentage: 0.92 },
    ] },
    options: o,
    plugins: [prognoseMit(ab, 'Prognose'), ergebnisZeileMit(ms.map((m) => m.erg / 100), (i) => ms[i].art !== 'ist')],
  });
}

function cpStandZeichnen(ms, id = 'c-cp-stand') {
  if (!$(`#${id}`)) return;
  const ab = ms.findIndex((m) => m.art !== 'ist'), c = css('--accent');
  const letzteIst = ab < 0 ? ms.length - 1 : ab - 1;
  const o = basis();
  o.layout = { padding: { top: 22, left: 4, right: 10 } };
  o.interaction = { mode: 'index', intersect: false };
  o.scales = {
    x: { ...achsenStil(), grid: { display: false }, ticks: { ...achsenStil().ticks, font: { size: 11 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 10 } },
    y: { ...achsenStil(), ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 5 } },
  };
  o.plugins.tooltip.callbacks = { title: (it) => `Ende ${monLang(ms[it[0].dataIndex].k)}${ms[it[0].dataIndex].art !== 'ist' ? ' – Prognose' : ''}`, label: (it) => (it.raw == null ? ' nicht vollständig berechenbar' : ` Konten: ${EUR0.format(it.raw)}`) };
  o.onClick = (_, el) => { if (!el.length) return; const m = ms[el[0].index]; setze({ tab: 'konten', konto: '', stichtag: m.art === 'ist' ? monatsletzter(`${m.k}-01`) : '' }); };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; };
  zeichne(id, {
    type: 'line',
    data: { labels: ms.map((m) => monKurz(m.k)), datasets: [{ data: ms.map((m) => (m.stand == null ? null : m.stand / 100)), borderColor: c, backgroundColor: alpha(c, 0.07), fill: 'origin', cubicInterpolationMode: 'monotone', borderWidth: 2,
      pointRadius: ms.map((m, i) => (i === letzteIst || i === ms.length - 1 ? 3.5 : 0)), pointHoverRadius: 4, pointBackgroundColor: ms.map((m) => (m.art === 'ist' ? c : css('--surface'))), pointBorderColor: c, pointBorderWidth: 2,
      segment: { borderDash: (sg) => (ab >= 0 && sg.p1DataIndex >= ab ? [5, 4] : undefined) } }] },
    options: o,
    plugins: [prognoseMit(ab, PROGNOSE), punktWerteMit([0, letzteIst, ms.length - 1].filter((i, j, a) => i >= 0 && a.indexOf(i) === j && ms[i]?.stand != null), (v, i) => `${i > letzteIst ? '≈ ' : ''}${kurzWert(v)}`)],
  });
}

// ---------------------------------------------------------------- Bereiche 2–5: der Überblick je Bereich
// Wie das Cockpit: ein Satz als Aussage, vier Kennzahlen, wenige Karten mit je einer Botschaft. Einzelheiten stehen auf
// den bisherigen Seiten (Umschalter oben, Klick auf eine Zahl). Alle Zahlen kommen aus den vorhandenen Rechnungen
// (monatsRechnung, verlauf5, sammle, vermoegen, gehalt.js, steuerprognose.js, unterhalt.js) – hier wird nichts neu gerechnet.
// Kinder- und gemeinsame Konten zählen in keiner Summe. Ausgaben stehen ohne Vorzeichen; Rot/Grün nur für Vorzeichen und Abweichungen.
const UEBERBLICK = { geldfluss: () => geldflussSeite(), vermoegen: () => vermoegenSeite(), einkommen: () => einkommenSeite(), familie: () => familieSeite() };
// Ausgaben je Kategorie: der letzte abgeschlossene Monat als Grundlage, daneben der Ø der letzten 12 Monate (alle eigenen Konten).
// Wie im Reiter Kategorien zählt eine Kategorie nur mit Ausgaben über 0 (Erstattungen überwiegen sonst) – Zeilen und Summen gehen so auf.
function katVormonat() {
  const ms = abgeschlosseneMonate().slice(-12), vm = ms.at(-1);
  const m = alleKonten(() => sammle([vm], 'aus')), j = alleKonten(() => sammle(ms, 'aus'));
  const l = [...new Set([...m.g.keys(), ...j.g.keys()])].map((k) => ({ k, c: Math.max(0, m.g.get(k)?.c || 0), o: Math.max(0, (j.g.get(k)?.c || 0) / j.n), mon: j.g.get(k)?.mon || new Map() }))
    .filter((x) => x.c > 0 || x.o > 0).sort((x, y) => y.c - x.c || y.o - x.o);
  const teil = (xs) => ({ c: xs.reduce((t, x) => t + x.c, 0), o: xs.reduce((t, x) => t + x.o, 0) });
  return { vm, ms, l, teil, sum: teil(l), name: monLang(vm), kurz: MONAT[+vm.slice(5) - 1], m };
}
// Klick: die Buchungen dieser Kategorie im Vormonat (dort steht dieselbe Summe); die Kategorien-Seite kennt nur ganze Jahre
const katZielVm = (k, vm) => zuBuchungen({ konto: '', art: 'aus', kat: k, ...monatZiel(vm) });
const katAlle = { tab: 'uebersicht', kart: 'aus', wahl: '', jahr: '', monat: '', zr: '', konto: '' };
const dGezeigt = (von, bis) => Math.round(bis / 100) * 100 - Math.round(von / 100) * 100;
// Auf volle Euro gerundet (in Cent): Summen aus solchen Teilen passen zu den gezeigten Teilen
const r0 = (c) => Math.round(c / 100) * 100;
// Vermögenssumme überall gleich geschrieben: ≈ bei ungefähren Konten, − bei Minus, „+ ?“ wenn ein Kontostand fehlt
const vmText = (vm) => `${vm.ungefaehr ? '≈ ' : ''}${vm.c < 0 ? '−' : ''}${eur0(Math.abs(vm.c))}${vm.ks && !vm.voll ? ' + ?' : ''}`;
const VM_DEPOT_BERECHNET = 'Depot zum Einstand, kein Kurswert (berechnet)';
// Teile auf volle Euro runden, sodass sie zusammen die gerundete Summe ergeben (Methode des größten Rests); Cent rein, Cent raus
function rundeTeile(cs) {
  const e = cs.map((c) => c / 100), ab = e.map(Math.floor);
  let fehlt = Math.round(e.reduce((t, x) => t + x, 0)) - ab.reduce((t, x) => t + x, 0);
  for (const i of e.map((x, i) => i).sort((a, b) => (e[b] - ab[b]) - (e[a] - ab[a]))) { if (fehlt <= 0) break; ab[i]++; fehlt--; }
  return ab.map((x) => x * 100);
}
const RUNDUNG = '<p class="cp-fuss bx-rundung">Beträge auf volle Euro gerundet. Summen und Anteile sind aus den genauen Cent-Beträgen gerechnet – addierst du die gerundeten Teile selbst, kann die letzte Stelle um 1 € abweichen.</p>';
const bxKopf = (ueber, kern, unter = '') => `<header class="cp-kopf"><p class="cp-ueber">${ueber} · Daten bis ${dde(D.bis)}</p><h1 class="cp-kern">${kern}</h1>${unter ? `<p class="cp-kern-u">${unter}${/gerundet/.test(unter) ? '' : '<span class="bx-rund-k"> · Beträge gerundet, Summen aus den genauen Werten</span>'}</p>` : ''}</header>`;
const bxKarte = (titel, inhalt, { rechts = '', cls_ = '', fuss = '', id = '' } = {}) => `<section${id ? ` id="${id}"` : ''} class="card cp-karte bx-karte ${cls_}"><div class="cp-kt"><h2>${titel}</h2>${rechts}</div>${inhalt}${fuss ? `<p class="cp-fuss" title="${esc(fuss.replace(/<[^>]+>/g, ''))}">${fuss}</p>` : ''}</section>`;
const bxLink = (text, ziel) => `<button class="bx-link"${geh(ziel)}>${text}<span aria-hidden="true"> ›</span></button>`;
// Veränderung als Abweichung: ▲/▼ und Farbe (schlecht = rot); ohne Minuszeichen vorn, damit minusRot() nicht eingreift
const bxDelta = (c, schlechtWennMehr = true, als = 'als im Ø 12 Monate') => (Math.abs(c) < 100 ? '<span class="bx-d">±0 €</span>'
  : `<span class="bx-d ${(c > 0) === schlechtWennMehr ? 'neg' : 'pos'}" title="${c > 0 ? 'mehr' : 'weniger'} ${als}">${c > 0 ? '▲' : '▼'} ${eur0(Math.abs(c))}</span>`);
// Rechnungen über alle eigenen Konten – unabhängig von der Kontoauswahl auf den Detailseiten
function alleKonten(f) { const k = S.konto; S.konto = ''; try { return f(); } finally { S.konto = k; } }
const eurE = (v) => eur0(Math.round(v * 100)), eurE0 = (v) => eur0(Math.round(v * 100));   // Beträge in Euro (Gehalt, Unterhalt)
const gehaltHelfer = () => ({ D, S, setze: (p) => setze(p), kopf5, karte5, zahl5, zl, zs, geh, gehBinden, freiFuellen, springe, zeichne, basis, achsenStil, css, alpha, achse, kurzWert, schraffur,
  zuBuchungen, monatZiel, mVor, monKurz, monLang, MON, MONAT, NUM, dde, eur, eur0, esc });

// Wasserfall: Säulen schweben vom laufenden Stand aus; summe = Säule von 0 bis zum Stand. w = Beschriftung
function wasserfall(teile) {
  let lauf = 0;
  const st = teile.map((x) => { const von = x.summe ? 0 : lauf, bis = x.summe ? lauf : lauf + x.c; if (!x.summe) lauf += x.c; return { ...x, von, bis }; });
  const hoch = Math.max(1, ...st.map((x) => Math.max(x.von, x.bis))), tief = Math.min(0, ...st.map((x) => Math.min(x.von, x.bis))), sp = hoch - tief;
  const y = (v) => ((v - tief) / sp) * 100;
  return `<div class="wf" role="list">${st.map((x, i) => {
    const u = Math.min(x.von, x.bis), o = Math.max(x.von, x.bis);
    return `<button class="wf-s" role="listitem"${geh(x.ziel)} title="${esc(x.tip || x.n)} – anklicken: Einzelheiten">
      <span class="wf-f"><span class="wf-w" style="bottom:${y(o).toFixed(1)}%">${x.w}</span><i class="wf-b ${x.cls_}" style="bottom:${y(u).toFixed(1)}%;height:${Math.max(0.8, y(o) - y(u)).toFixed(1)}%"></i>${i < st.length - 1 ? `<b class="wf-v" style="bottom:${y(x.bis).toFixed(1)}%"></b>` : ''}${tief < 0 ? `<b class="wf-0" style="bottom:${y(0).toFixed(1)}%"></b>` : ''}</span>
      <span class="wf-n">${x.n}</span></button>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------- Geldfluss
function geldflussSeite() {
  const box = $('#s5'), V = verlauf5(), R = V.R, ist = V.monate.filter((m) => m.art === 'ist'), s = V.schnitt, L = lebenshaltung();
  const zuFix = { tab: 'fix', fixtab: 'vertraege', konto: '' }, zuLeben = { ...zuFix, _springe: '#fix-leben' }, zuKz = { tab: 'kennzahlen', jahr: '', monat: '', zr: '', konto: '' };
  const pzG = (c) => (R.gehalt ? `${((c / R.gehalt) * 100).toLocaleString('de-DE', { maximumFractionDigits: 0 })} %` : '');
  // nur für die Anzeige: gerundete Euro-Teile, Einkommen und Ergebnis daraus (R selbst bleibt genau)
  const gA = r0(R.gehalt), sA = r0(R.sonst), fA = r0(R.fix), lA = r0(R.leben), einA = gA + sA, ergA = einA - fA - lA;
  const kern = ergA < 0 ? `Ein normaler Monat endet bei <b class="neg">${plusMinus(ergA)}</b> – die Ausgaben liegen über dem Einkommen.`
    : `Ein normaler Monat lässt <b class="pos">${plusMinus(ergA)}</b> übrig.`;
  const unter = `Gehalt ${eur0(R.gehalt)} + Sonstiges ${eur0(R.sonst)} − Fixkosten ${eur0(R.fix)} − Lebenshaltung ${eur0(R.leben)} (${lebenName()})<span class="cp-nur-breit"> · in den letzten 12 Monaten im Schnitt ${pmHtml(Math.round(s.erg))}</span>`;
  const kacheln = [
    kachel({ titel: 'Einkommen', wert: eur0(einA), ziel: zuGehalt(), aend: `Gehalt ${eur0(R.gehalt)} + Sonstiges ${eur0(R.sonst)}`, spark: sparkline(ist.map((m) => m.ein)), unter: 'normaler Monat · Linie: Einnahmen je Monat' }),
    kachel({ titel: 'Fixkosten', wert: eur0(R.fix), ziel: zuFix, aend: `${R.vertraege.length} laufende Verträge · ${pzG(R.fix)} vom Gehalt`, spark: sparkline(ist.map((m) => m.fest)), unter: 'jährliche anteilig · Linie: feste Abbuchungen je Monat' }),
    kachel({ titel: 'Lebenshaltung', wert: eur0(R.leben), ziel: zuLeben, aend: `${lebenName()} · Ø 12 Monate ${eur0(L.schnitt)}`, spark: sparkline(L.werte), unter: 'alles außer Verträgen · Linie: je Monat' }),
    ...(() => { const v = ist.at(-1); return v ? [kachel({ titel: `Ergebnis ${MONAT[+v.k.slice(5) - 1]}`, wert: plusMinus(v.erg), cls_: v.erg < 0 ? 'neg' : 'pos', ziel: zuBuchungen({ konto: '', ...monatZiel(v.k) }),
      aend: `Einnahmen ${eur0(v.ein)} · Ausgaben ${eur0(v.aus)} · Ø 12 Monate ${pmHtml(Math.round(s.erg))}`, spark: sparSaeulen(ist.map((m) => m.erg)), unter: 'Säulen: Ergebnis je Monat, rechts der letzte' })] : []; })(),
  ].join('');

  const wf = wasserfall([
    { n: 'Gehalt', c: R.gehalt, w: eur0(R.gehalt), cls_: 'wf-ein', ziel: zuGehalt(), tip: `Gehaltseingang aufs Konto (${monLang(R.gehaltMonat)})` },
    { n: 'Sonstiges', c: R.sonst, w: eur0(R.sonst), cls_: 'wf-ein2', ziel: { tab: 'uebersicht', kart: 'ein', wahl: '', jahr: '', monat: '', zr: '', konto: '' }, tip: 'Typische sonstige Einnahmen: Erstattungen, Zinsen …' },
    { n: 'Fixkosten', c: -R.fix, w: eur0(R.fix), cls_: 'wf-fest', ziel: zuFix, tip: `${R.vertraege.length} laufende Verträge` },
    { n: 'Lebens&shy;haltung', c: -R.leben, w: eur0(R.leben), cls_: 'wf-leben', ziel: zuLeben, tip: `Lebenshaltung (${lebenName()})` },
    { n: ergA < 0 ? 'fehlt' : 'bleibt', summe: true, w: plusMinus(ergA), cls_: ergA < 0 ? 'wf-neg' : 'wf-pos', ziel: zuFix, tip: ergA < 0 ? 'Was im Monat fehlt' : 'Was im Monat übrig bleibt' },
  ]);

  // Ausgaben nach Kategorie: der Vormonat als Grundlage, daneben der Ø der letzten 12 Monate (wie Kategorien › Monat bzw. › 12 Monate)
  const K = katVormonat(), ms = K.ms, katZiel = (k) => katZielVm(k, K.vm);
  const wert = (c) => (c > 0 ? eur0(c) : '–');
  const katZeile = (x) => `<button class="bx-kz"${geh(katZiel(x.k))} title="${esc(schoen(x.k))}: ${K.kurz} ${eur0(x.c)} · Ø 12 Monate ${eur0(x.o)} – anklicken: Einzelheiten">
      <span class="bx-kz-n">${esc(schoen(x.k))}</span><span class="bx-kz-sp">${sparkline(ms.map((k) => x.mon.get(k) || 0))}</span>
      <b class="bx-kz-w">${wert(x.c)}</b><span class="bx-kz-o">${wert(x.o)}</span></button>`;
  const rest = K.l.slice(5), kR = K.teil(rest);
  const kats = !K.l.length ? '<p class="leer klein">Keine Ausgaben in den letzten 12 Monaten.</p>'
    : `<div class="bx-kl"><div class="bx-kz bx-kopfz"><span>Kategorie</span><span>Verlauf</span><span>${K.kurz}</span><span>Ø 12 Mon.</span></div>${K.l.slice(0, 5).map(katZeile).join('')}
      ${rest.length ? `<button class="bx-kz bx-rest"${geh(katZiel(''))}><span class="bx-kz-n">${rest.length} weitere</span><span></span><b class="bx-kz-w">${wert(kR.c)}</b><span class="bx-kz-o">${wert(kR.o)}</span></button>` : ''}
      <div class="bx-kz bx-summe"><span class="bx-kz-n">Summe</span><span></span><b class="bx-kz-w">${eur0(K.sum.c)}</b><span class="bx-kz-o"><b>${eur0(K.sum.o)}</b></span></div></div>`;

  // Verträge kompakt: je Art die laufende Summe im Monat
  const arten = new Map();
  for (const f of R.vertraege) { const art = fixArt(f), x = arten.get(art) || arten.set(art, { art, c: 0, n: 0 }).get(art); x.c += f.proMonat; x.n++; }
  const al = [...arten.values()].sort((x, y) => y.c - x.c), termine = naechsteTermine(R.vertraege), tSumme = termine.reduce((t, x) => t + x.f.betrag, 0);
  const vertraege = balkenListe(al.slice(0, 6).map((x) => ({ n: FIX_KURZ[x.art] || esc(x.art), c: x.c, p: pzG(x.c), ziel: zuFix, farbe: 'var(--fest)', tip: `${x.art}: ${eur0(x.c)} im Monat · ${x.n} ${x.n === 1 ? 'Vertrag' : 'Verträge'}` }))
    .concat(al.length > 6 ? [{ n: `${al.length - 6} weitere Arten`, c: al.slice(6).reduce((t, x) => t + x.c, 0), p: pzG(al.slice(6).reduce((t, x) => t + x.c, 0)), ziel: zuFix, farbe: 'var(--fest)' }] : []));

  // Ausgabenrahmen des laufenden Monats
  const rs = sicher(() => rahmenStand(H)) || null;
  let rahmen = '<p class="leer klein">Der Ausgabenrahmen konnte nicht berechnet werden.</p>', rahmenTitel = 'Ausgabenrahmen';
  if (rs) {
    const { R: RR, sum } = rs, heuteP = (RR.tag / RR.tage) * 100;
    rahmenTitel = `Ausgabenrahmen · ${MONAT[+RR.k.slice(5) - 1]}`;
    rahmen = sum.n ? `<p class="bx-gross ${sum.rahmen - sum.aus < 0 ? 'neg' : ''}">${eur0(dGezeigt(sum.aus, sum.rahmen))}<small>noch frei</small></p>
      <span class="bx-tempo${sum.aus > sum.rahmen ? ' ueber' : ''}" title="${Math.round((sum.aus / sum.rahmen) * 100)} % des Rahmens ausgegeben · Tag ${RR.tag} von ${RR.tage}"><i style="width:${Math.min(100, (sum.aus / sum.rahmen) * 100).toFixed(1)}%"></i><b style="left:${heuteP.toFixed(1)}%"></b></span>
      <p class="bx-u">${eur0(sum.aus)} von ${eur0(sum.rahmen)} ausgegeben · Tag ${RR.tag} von ${RR.tage} · ${sum.n} ${sum.n === 1 ? 'Kategorie' : 'Kategorien'}</p>`
      : '';
    // mit Rahmen: nur die Kategorien mit Rahmen (dieselben wie in der Zahl oben), Rest in einer Zeile, Summe = Kopfzahl;
    // ohne Rahmen: die ersten 4 frei gestaltbaren Kategorien mit Vorschlag
    const mitR = sum.n ? rs.z.filter((x) => x.frei && x.rahmen) : [], zr = sum.n ? mitR.slice(0, 4) : rs.z.filter((x) => x.frei).slice(0, 4), zrRest = mitR.slice(4);
    const zrRS = zrRest.reduce((t, x) => t + x.aus, 0), zrRG = zrRest.reduce((t, x) => t + x.rahmen, 0);
    const zrS = sum.n ? sum.aus : zr.reduce((t, x) => t + x.aus, 0), zrG = sum.n ? sum.rahmen : zr.reduce((t, x) => t + (x.rahmen || x.vorschlag), 0);
    if (zr.length) rahmen += `<p class="cp-auff-t">${sum.n ? 'Je Kategorie mit Rahmen – Strich: dein Rahmen' : `Noch kein Rahmen festgelegt · bisher im ${MONAT[+RR.k.slice(5) - 1]} je Kategorie, Strich: Vorschlag (Ø ohne Verträge)`}</p>`
      + balkenListe([...zr.map((x) => ({ n: esc(schoen(x.kat)), c: Math.max(0, x.aus), marke: x.rahmen || x.vorschlag || null, w: eur0(x.aus), p: `von ${eur0(x.rahmen || x.vorschlag)}`, farbe: x.aus > (x.rahmen || x.vorschlag) ? 'var(--aus)' : 'var(--variabel)',
          ziel: zuBuchungen({ konto: '', art: 'aus', kat: x.kat, nf: '1', ...monatZiel(RR.k) }) })),
        ...(zrRest.length ? [{ n: `${zrRest.length} weitere mit Rahmen`, c: Math.max(0, zrRS), marke: zrRG || null, w: eur0(zrRS), p: `von ${eur0(zrRG)}`, farbe: zrRS > zrRG ? 'var(--aus)' : 'var(--variabel)', ziel: { tab: 'uebersicht', kart: 'aus', wahl: '', _springe: '#pl-rahmen' } }] : []),
        { n: '<b>Summe</b>', c: 0, w: `<b>${eur0(zrS)}</b>`, p: `von ${eur0(zrG)}`, cls: 'bl-summe' }], { max: Math.max(1, ...zr.map((x) => Math.max(x.aus, x.rahmen || x.vorschlag)), zrRS, zrRG) });
    rahmen += bxLink(sum.n ? 'Rahmen je Kategorie' : 'Rahmen festlegen', { tab: 'uebersicht', kart: 'aus', wahl: '', _springe: '#pl-rahmen' });
  }

  // Reisen aus den Finanzguru-Tags: die letzten vier
  const RS = sicher(() => reisen(H)) || null, zuReisen = { tab: 'uebersicht', kart: 'tags' };
  const rSort = (() => { try { return localStorage.getItem('fd.reisensort') || 'groesse'; } catch { return 'groesse'; } })();
  const rListe = (RS?.karten || []).slice().sort((a1, b1) => (rSort === 'datum' ? (a1.erste < b1.erste ? 1 : -1) : b1.c - a1.c)).slice(0, 4);
  const reiseInhalt = !RS?.karten?.length ? '<p class="bx-u">Vergib in Finanzguru Tags, dann erscheinen hier deine Reisen.</p>'
    : `<div class="seg bx-mini" role="group" aria-label="Sortierung"><button data-rsort="groesse" class="${rSort !== 'datum' ? 'an' : ''}">nach Betrag</button><button data-rsort="datum" class="${rSort === 'datum' ? 'an' : ''}">neueste zuerst</button></div>`
      + balkenListe(rListe.map((x) => ({ n: esc(x.tag), sub: `ab ${MONAT[+x.erste.slice(5, 7) - 1]} ${x.erste.slice(0, 4)} · ${x.n} ${x.n === 1 ? 'Buchung' : 'Buchungen'}`, c: x.c, ziel: zuReisen, farbe: 'var(--accent-2)' }))) + bxLink(`Alle ${RS.gesamt} Reisen und Projekte`, zuReisen);

  box.innerHTML = `<div class="cp bx">
    ${bxKopf('Geldfluss', kern, unter)}
    <div class="cp-kz">${kacheln}</div>
    <div class="bx-raster bx-sechs">
      ${bxKarte('Vom Gehalt zum Ergebnis', wf, { rechts: '<span class="klein muted">ein normaler Monat</span>', cls_: 'bx-wf', fuss: 'Säule anklicken: Einzelheiten · mehr unter Kennzahlen' })}
      ${bxKarte('Wofür das Geld ausgeht', kats, { rechts: `<span class="klein muted">${esc(K.name)} · daneben Ø 12 Monate</span>`, fuss: `${zl('alle Kategorien (12 Monate)', katAlle)} · sortiert nach ${esc(K.name)} · Ø ${esc(monatsText(ms))} · ohne Kinder- und gemeinsame Konten · Linie: je Monat` })}
      ${bxKarte('Verträge', vertraege, { rechts: zl(`<b class="bx-wert">${eur0(R.fix)}</b>`, zuFix), fuss: `Nächste 30 Tage: ${termine.length} feste Abbuchungen · ${zl(eur0(tSumme), { tab: 'fix', fixtab: 'kalender', konto: '' })}` })}
      ${bxKarte(rahmenTitel, rahmen, { fuss: `Ausgaben ohne Verträge in den frei gestaltbaren Kategorien${rs ? (rs.sum.n ? ' · Strich im oberen Balken = heute' : ' · Strich = Vorschlag') : ''}` })}
      ${bxKarte('Reisen', reiseInhalt)}
      ${L.monate.length ? bxKarte('Lebenshaltung je Monat', `<div class="cp-chart bx-chart"><canvas id="c-gf-leben" aria-label="Lebenshaltung je Monat"></canvas></div>`, { cls_: 'bx-flex',
        rechts: `<b class="bx-wert">${eur0(L.werte.at(-1))}</b>`, fuss: `Alle Ausgaben ohne Verträge, ohne gemeinsame und Kinderkonten · dunkel: ${esc(monLang(L.monate.at(-1)))} · gestrichelt: Ø ${eur0(L.schnitt)} · Säule anklicken: Buchungen` }) : ''}
    </div>
    ${RUNDUNG}
  </div>`;
  gehBinden(box);
  box.querySelectorAll('[data-rsort]').forEach((b) => b.onclick = () => { try { localStorage.setItem('fd.reisensort', b.dataset.rsort); } catch {} geldflussSeite(); });
  sicher(() => gfLebenZeichnen(L));
}

function gfLebenZeichnen(L) {
  if (!$('#c-gf-leben')) return;
  const n = L.monate.length, cA = css('--accent'), cV = css('--variabel');
  const o = basis();
  o.layout = { padding: { top: 16 } };
  o.scales = { x: { ...achsenStil(), grid: { display: false }, ticks: { ...achsenStil().ticks, font: { size: 10.5 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 6 } },
    y: { ...achsenStil(), beginAtZero: true, ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 4 } } };
  o.plugins.tooltip.callbacks = { title: (it) => monLang(L.monate[it[0].dataIndex]), label: (it) => ` Lebenshaltung: ${EUR0.format(it.raw)}` };
  o.onClick = (_, el) => { if (el.length) setze(zuBuchungen({ konto: '', art: 'aus', nf: '1', ...monatZiel(L.monate[el[0].index]) })); };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; };
  zeichne('c-gf-leben', { type: 'bar',
    data: { labels: L.monate.map(monKurz), datasets: [{ data: L.werte.map((w) => w / 100), backgroundColor: L.werte.map((_, i) => (i === n - 1 ? cA : cV)), borderRadius: 3, maxBarThickness: 26 }] },
    options: o, plugins: [linieMit('schnitt', L.schnitt / 100, `Ø ${eur0(L.schnitt)}`, css('--text-2'))] });
}

// ---------------------------------------------------------------- Vermögen
function vermoegenSeite() {
  const box = $('#s5'), vm = sicher(() => vermoegen(H)) || null, zuKonten = { tab: 'konten', stichtag: '', konto: '' };
  if (!vm) { box.innerHTML = `<div class="cp bx">${bxKopf('Vermögen', 'Das Vermögen konnte nicht berechnet werden.')}</div>`; return; }
  const dp = vm.dp, kautionC = vm.kautionKonto ? null : vm.kaution?.c || 0;
  // dieselben Teile wie die Kachel im Cockpit
  const teile = [['Konten', vm.ks?.c || 0, 'auf deinen Konten'], ['Depot', dp?.wert || 0, 'im Depot'], ['Kaution', kautionC, 'in der Mietkaution'], ['Vorsorge', vm.vorsorge, 'in der Vorsorge']].filter(([, c]) => c > 0);
  const tsum = teile.reduce((t, [, c]) => t + c, 0) || 1, groesst = [...teile].sort((x, y) => y[1] - x[1])[0];
  const kern = `Dein Vermögen: <b class="${vm.c < 0 ? 'neg' : ''}">${vmText(vm)}</b>${groesst ? ` – ${Math.round((groesst[1] / tsum) * 100)} % davon ${groesst[2]}` : ''}`;
  const unter = `Jeder Teil mit eigenem Stichtag · ohne gesetzliche Rente (Anwartschaft) · Kinder- und gemeinsame Konten zählen nicht mit${vm.depotBerechnet ? ` · ${VM_DEPOT_BERECHNET}` : ''}`;

  // Konten: 24 Monatsenden (nur vollständige Summen) und heute
  const ks24 = abgeschlosseneMonate().slice(-24).map((k) => { const s = kontenSumme(monatsletzter(`${k}-01`)); return { k, art: 'ist', stand: vollSumme(s), summe: s }; });
  const jb = `${+D.bis.slice(0, 4) - 1}-12-31`, jbS = kontenSumme(jb < D.von ? D.von : jb), seitJahr = diffSumme(jbS, vm.ks) == null ? null : dGezeigt(jbS.c, vm.ks.c);
  // Depot: netto eingezahlt, aufsummiert über alle Monate (Käufe − Verkäufe laut Buchungen)
  let kum = 0;
  const dpKum = (dp?.monate || []).map((m) => (kum += (m.kauf || 0) - (m.verkauf || 0)));
  const daten = vm.vertraege.map((x) => x.am).sort();
  const kacheln = [
    kachel({ titel: 'Konten', wert: summeText(vm.ks), cls_: vm.ks?.c < 0 ? 'neg' : '', ziel: zuKonten, aend: `${seitJahr == null ? '' : `${pmHtml(seitJahr)} seit 1. Januar`}`, spark: sparkline([...ks24.map((m) => m.stand), vollSumme(vm.ks)]), unter: 'heute · Linie: 24 Monatsenden' }),
    kachel({ titel: 'Depot', marke: dp && (!dp.kurse || dp.berechnet) ? 'berechnet' : '', wert: dp ? eur0(dp.wert) : '–', ziel: { ...zuKonten, _springe: '#dp-karte' },
      aend: !dp ? 'Depot-Daten kommen mit dem nächsten Aufbau' : dp.kurse ? (dp.berechnet ? `teils Kurswert laut Depot-Datei vom ${dde(dp.kurse.stichtag)}, ${dp.berechnet} ${dp.berechnet === 1 ? 'Papier' : 'Papiere'} berechnet (Einstand)` : `Kurswert laut Depot-Datei vom ${dde(dp.kurse.stichtag)}`) : `Einstand der Papiere im Bestand, kein Kurswert · Stand ${dde(dp.stand)}`,
      spark: sparkline(dpKum.slice(-36)), unter: 'Linie: netto eingezahlt, aufsummiert (36 Monate)' }),
    kachel({ titel: 'Vorsorge', wert: vm.vertraege.length ? eur0(vm.vorsorge) : '–', ziel: { ...zuKonten, _springe: '#vm-karte' }, marke: vm.vertraege.some((x) => x.alt) ? 'alter Stand' : '',
      aend: vm.vertraege.length ? `${vm.vertraege.length} ${vm.vertraege.length === 1 ? 'Vertrag' : 'Verträge'} · Stand ${daten[0] === daten.at(-1) ? dde(daten[0]) : `${dde(daten[0])} – ${dde(daten.at(-1))}`}` : 'kein Vertrag mit belegtem Wert',
      unter: 'Werte laut Unterlagen der Anbieter' }),
    kachel({ titel: 'Mietkaution', wert: vm.kautionKonto ? eur0(vm.kautionKonto.c) : vm.kaution ? eur0(vm.kaution.c) : '–', ziel: { ...zuKonten, _springe: '#vm-karte' },
      aend: vm.kautionKonto ? 'steckt schon in „Konten“ – zählt nicht doppelt' : vm.kaution ? `eigene Eingabe · Stand ${dde(vm.kaution.am)}` : 'noch nicht eingetragen', unter: 'gehört dir, ist aber nicht frei verfügbar' }),
  ].join('');

  const anteil = teile.length ? `<div class="bx-anteil" role="img" aria-label="Zusammensetzung des Vermögens">${teile.map(([n, c], i) => `<i style="width:${((c / tsum) * 100).toFixed(1)}%;--i:${i}" title="${n}: ${eur0(c)}"></i>`).join('')}</div>
    <ul class="bx-leg">${teile.map(([n, c], i) => `<li><i style="--i:${i}"></i><span>${n}</span><b>${eur0(c)}</b><small>${Math.round((c / tsum) * 100)} %</small></li>`).join('')}</ul>` : '';

  // Wo das Geld liegt: Konten nach Zweck (wie im Reiter Konten), gemeinsame und Kinderkonten nur zur Information
  const amTag = kontostaende(D, D.bis).filter((x) => !['nicht_eroeffnet', 'geschlossen'].includes(x.status));
  const gruppen = KONTO_GRUPPEN.map((g) => { const l = amTag.filter((x) => g.test(x.k)); return { g, n: l.length, c: l.filter((x) => x.c != null && x.status !== 'unbekannt').reduce((t, x) => t + x.c, 0) }; }).filter((x) => x.n);
  const wo = `<div class="bx-wo">${gruppen.map(({ g, n, c }) => `<button class="bx-wo-z${g.fremd ? ' fremd' : ''}"${geh(zuKonten)} title="${esc(g.erkl)}"><span>${esc(g.titel)}<small>${n} ${n === 1 ? 'Konto' : 'Konten'}${g.fremd ? ' · zählt nicht mit' : ''}</small></span><b>${eur0(c)}</b></button>`).join('')}</div>`;

  const dpTop = dp ? [...dp.papiere.map((p) => ({ n: p.name, isin: p.isin, w: p.kurs ? p.kurs.kurswert : p.basis })), ...dp.nurKurs.map((w) => ({ n: w.isin, isin: w.isin, w: w.kurswert }))].filter((x) => x.w > 0).sort((a1, b1) => b1.w - a1.w) : [];
  const dpRest = dpTop.slice(5).reduce((t, x) => t + x.w, 0);
  const depotInhalt = !dp ? '<p class="bx-u">Depot-Daten kommen mit dem nächsten Aufbau am PC.</p>'
    : `<dl class="bx-dl"><div><dt>eingezahlt</dt><dd>${eur0(dp.eingezahlt)}</dd></div><div><dt>entnommen</dt><dd>${eur0(dp.entnommen)}</dd></div>
      <div><dt>${dp.kurse ? (dp.berechnet ? 'Kurswert / berechnet' : 'Kurswert') : 'Wert (Einstand)'}</dt><dd>${eur0(dp.wert)}</dd></div></dl>
      <p class="cp-auff-t">Größte Positionen · ${dpTop.length} Papiere</p>
      ${balkenListe([...dpTop.slice(0, 5).map((x) => ({ n: esc(x.n), c: x.w, p: `${Math.round((x.w / dp.wert) * 100)} %`, farbe: 'var(--accent-2)', ziel: zuBuchungen({ q: x.isin, konto: '' }) })),
        ...(dpRest ? [{ n: `${dpTop.length - 5} weitere`, c: dpRest, p: `${Math.round((dpRest / dp.wert) * 100)} %`, farbe: 'var(--variabel)', ziel: { ...zuKonten, _springe: '#dp-karte' } }] : []),
        { n: '<b>Summe</b>', c: 0, w: `<b>${eur0(dp.wert)}</b>`, p: '100 %', cls: 'bl-summe' }], { max: Math.max(1, ...dpTop.map((x) => x.w)) })}
      ${dp.spar ? `<p class="bx-u">Seit ${monKurz(dp.spar.seit)} nur noch <b>${eur0(dp.spar.jetzt)}</b> im Monat in Sparplänen (vorher Ø ${eur0(dp.spar.vorher)}).</p>` : ''}${bxLink('Depot und Sparpläne', { ...zuKonten, _springe: '#dp-karte' })}`;
  const vorsorgeInhalt = vm.vertraege.length ? balkenListe(vm.vertraege.slice(0, 5).map((x) => ({ n: esc(x.name), sub: `Stand ${dde(x.am)}${x.alt ? ' · alter Stand' : ''}`, c: x.c, ziel: { ...zuKonten, _springe: '#vm-karte' }, farbe: 'var(--accent-2)' })))
    : '<p class="bx-u">Kein Vorsorgevertrag mit belegtem Wert in den Unterlagen.</p>';

  // Depot je Monat (letzte 24) und die eigenen Konten einzeln (Summe = Konten oben)
  const dpMon = (dp?.monate || []).slice(-24);
  const kl0 = kontostaende(D, D.bis).filter((x) => !fremd(x.k) && !['nicht_eroeffnet', 'geschlossen'].includes(x.status) && x.c != null).sort((a1, b1) => b1.c - a1.c);
  const kontenL = balkenListe([...kl0.filter((x) => x.c !== 0).map((x) => ({ n: esc(x.k.name), sub: x.status === 'unbekannt' ? 'ohne gesicherten Stand' : x.status === 'ruhend' ? `ruht · Stand ${dde(x.seit)}` : '', c: x.c, w: `<span class="${x.c < 0 ? 'neg' : ''}">${x.c < 0 ? '−' : ''}${eur0(Math.abs(x.c))}</span>`, farbe: 'var(--accent-2)', ziel: { tab: 'buchungen', konto: x.k.name, q: '', jahr: '', monat: '', zr: '', kat: '', ukat: '', art: 'alle' } })),
    { n: '<b>Summe</b>', c: 0, w: `<b>${summeText(vm.ks)}</b>`, cls: 'bl-summe' }], { max: Math.max(1, ...kl0.map((x) => Math.abs(x.c))) });
  box.innerHTML = `<div class="cp bx">
    ${bxKopf('Vermögen', kern, unter)}
    <div class="cp-kz">${kacheln}</div>
    <div class="bx-raster bx-sechs">
      ${bxKarte('Zusammensetzung', anteil + wo, { fuss: 'Oben: woraus das Vermögen besteht · unten: Kontostände heute nach Zweck' })}
      ${bxKarte('Konten im Verlauf', `<div class="cp-chart"><canvas id="c-vm-stand" aria-label="Kontostand der letzten 24 Monate"></canvas></div>`, { rechts: '<span class="klein muted">24 Monatsenden</span>', fuss: `Summe deiner Konten am Monatsende, ohne Depot, gemeinsame und Kinderkonten.${lueckenText(ks24.map((m) => m.summe))} Punkt anklicken: Kontostände an diesem Tag.` })}
      ${bxKarte('Depot', depotInhalt, { fuss: dp ? `Aus deinen Buchungen bis ${dde(dp.stand)}${dp.kurse ? '' : ' · ohne Kurswerte: Wert = Einstand der Papiere im Bestand (Durchschnittsmethode, berechnet); er weicht von „eingezahlt − entnommen“ ab, weil Verkäufe nicht genau so viel einbrachten, wie die Anteile gekostet hatten'}` : '' })}
      ${bxKarte('Vorsorge', vorsorgeInhalt, { rechts: vm.vertraege.length ? `<b class="bx-wert">${eur0(vm.vorsorge)}</b>` : '', fuss: `Gesetzliche Rente nicht enthalten.${vm.ohneWert ? ` ${vm.ohneWert} ${vm.ohneWert === 1 ? 'Vertrag hat' : 'Verträge haben'} keinen Wert in den Unterlagen.` : ''}` })}
      ${dpMon.length ? bxKarte('Depot: Käufe und Verkäufe', `<p class="cp-leg"><i class="cp-leg-a"></i>Käufe <i class="cp-leg-e"></i>Verkäufe <span>· je Monat, ${dpMon.length} Monate</span></p><div class="cp-chart bx-chart"><canvas id="c-vm-depot" aria-label="Depot: Käufe und Verkäufe je Monat"></canvas></div>`,
        { cls_: 'bx-flex', fuss: `Laut Buchungen bis ${dde(dp.stand)} · Verkäufe nach unten · Sparplan-Überträge zählen nicht` }) : ''}
      ${bxKarte('Konten einzeln', kontenL, { rechts: `<b class="bx-wert">${summeText(vm.ks)}</b>`, fuss: `Stand ${dde(D.bis)} · ohne gemeinsame und Kinderkonten · anklicken: Buchungen des Kontos` })}
    </div>
    ${RUNDUNG}
  </div>`;
  gehBinden(box);
  cpStandZeichnen(ks24, 'c-vm-stand');
  if (dpMon.length) sicher(() => vmDepotZeichnen(dpMon));
}

function vmDepotZeichnen(ms) {
  if (!$('#c-vm-depot')) return;
  const o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.layout = { padding: { top: 6 } };
  o.scales = { x: { ...achsenStil(), stacked: true, grid: { display: false }, ticks: { ...achsenStil().ticks, font: { size: 10.5 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 8 } },
    y: { ...achsenStil(), stacked: true, ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 5 } } };
  o.plugins.tooltip.callbacks = { title: (it) => monLang(ms[it[0].dataIndex].m), label: (it) => ` ${it.dataset.label}: ${EUR0.format(Math.abs(it.raw))}`,
    footer: (it) => { const m = ms[it[0].dataIndex], n = (m.kauf || 0) - (m.verkauf || 0); return `netto ${n < 0 ? '−' : ''}${eur0(Math.abs(n))}`; } };
  zeichne('c-vm-depot', { type: 'bar',
    data: { labels: ms.map((m) => monKurz(m.m)), datasets: [
      { label: 'Käufe', data: ms.map((m) => (m.kauf || 0) / 100), backgroundColor: css('--fest'), borderRadius: 3, maxBarThickness: 18 },
      { label: 'Verkäufe', data: ms.map((m) => -(m.verkauf || 0) / 100), backgroundColor: css('--akzent'), borderRadius: 3, maxBarThickness: 18 }] },
    options: o });
}

// ---------------------------------------------------------------- Einkommen & Steuer
function einkommenSeite() {
  const box = $('#s5'), g = sicher(() => gehaltUeberblick(gehaltHelfer())) || null, jetztJ = +D.bis.slice(0, 4);
  const P = sicher(() => prognoseRechnen(H, jetztJ)) || null, st = steuerStand();
  const zuG = { tab: 'gehalt', gmonat: '' }, zuSt = { tab: 'steuer', sjahr: String(jetztJ), _springe: '#stp-karte' };
  const z = g?.z;
  const pm = (c) => `${c >= 0 ? '+' : '−'}${eur0(Math.abs(c))}`;
  const kern = !z ? 'Noch keine Gehaltsdaten in der Datei.'
    : `${MONAT[+z.m.slice(5) - 1]}: <b>${eurE0(z.auszahlung)}</b> aufs Konto${P ? ` · Steuer ${P.jahr}: voraussichtlich <b class="${P.ohne.erg >= 0 ? 'pos' : 'neg'}">${P.ohne.erg >= 0 ? '+' : '−'}${eur0(Math.abs(P.ohne.erg))} ${P.ohne.erg >= 0 ? 'Erstattung' : 'Nachzahlung'}</b>` : ''}`;
  const unter = z ? `Abrechnung ${monLang(z.m)}: brutto ${eurE0(z.brutto)}, Grundgehalt ${eurE0(g.stufe)}${g.auto ? `, Dienstwagen ${eurE0(g.auto.vorteil)} geldwerter Vorteil` : ''}${P ? ' · Steuer: Einzelveranlagung, ohne Anlage U, Orientierung' : ''} · Beträge gerundet` : '';
  const kacheln = !z ? '' : [
    kachel({ titel: `Auszahlung ${MON[+z.m.slice(5) - 1]}`, wert: eurE0(z.auszahlung), ziel: zuG, aend: g.vm ? `${pmHtml(Math.round((z.auszahlung - g.vm.auszahlung) * 100))} ggü. ${MON[+g.vm.m.slice(5) - 1]}` : 'erste Abrechnung',
      spark: sparkline(g.verlauf.map((x) => Math.round((x.netto || 0) * 100))), unter: 'aufs Konto · Linie: 24 Abrechnungen' }),
    kachel({ titel: 'Grundgehalt', wert: eurE0(g.stufe), ziel: { ...zuG, _springe: '#ge-verlauf' }, aend: g.seit > 0 ? `<span class="pos">+${Math.round(g.seit * 100)} %</span> seit ${monKurz(g.erste.m)} (${eurE0(g.erste.gehalt)})` : 'monatlich, ohne Zulagen',
      spark: sparkline(g.verlauf.map((x) => Math.round((x.gehalt || 0) * 100))), unter: 'brutto im Monat · Linie: 24 Abrechnungen' }),
    kachel({ titel: 'Dienstwagen', marke: g.auto ? 'berechnet' : '', wert: g.auto ? eurE0(g.auto.netto) : '–', ziel: { ...zuG, _springe: '.ge-autok' },
      aend: g.auto ? `kostet dich netto im Monat · ${eurE0(Math.round(g.auto.netto) * 12)} im Jahr` : 'in dieser Abrechnung kein Dienstwagen',
      unter: g.auto ? `laut Abrechnung ${MON[+g.auto.m.slice(5) - 1]}: ${eurE0(g.auto.vorteil)} geldwerter Vorteil × ${Math.round(g.auto.gs * 100)} % Grenzsteuersatz${(() => { const w = (D.j.gehalt?.dienstwagen?.wagen || []).filter((x) => x.ab > g.auto.m && x.ab <= D.bis.slice(0, 7)).at(-1); return w ? ` · seit ${monKurz(w.ab)} ${esc(w.modell || 'neuer Wagen')}, Abrechnung folgt` : ''; })()}` : '' }),
    kachel({ titel: `Steuer ${P?.jahr || jetztJ}`, marke: 'Prognose', wert: P ? pm(P.ohne.erg) : '–', cls_: P ? (P.ohne.erg >= 0 ? 'pos' : 'neg') : '', ziel: zuSt,
      aend: P ? `${P.ohne.erg >= 0 ? 'Erstattung' : 'Nachzahlung'} ohne Anlage U${P.mit ? ` · mit Anlage U ${pm(P.mit.erg)}` : ''}` : 'nicht berechenbar', unter: 'Einzelveranlagung · berechnet aus Abrechnungen und Buchungen' }),
  ].join('');

  // Gehalt im Jahr
  const jahrInhalt = !z ? '' : `<dl class="bx-dl">
      <div><dt>aufs Konto ${g.jahr}</dt><dd>${g.jahrPlan ? '≈ ' : ''}${eurE0(g.jahrNetto)}</dd></div>
      <div><dt>brutto ${g.jahr}</dt><dd>${g.jahrPlan ? '≈ ' : ''}${eurE0(g.jahrBrutto)}</dd></div>
      ${g.abgaben != null ? `<div><dt>Abgaben ${MON[+z.m.slice(5) - 1]}</dt><dd>${((g.abgaben / z.brutto) * 100).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} %<small>${eurE0(g.abgaben)} Steuern und Sozialabgaben</small></dd></div>` : ''}</dl>
    <p class="bx-u">${g.jahrPlan ? `${g.nIst} von 12 Monaten abgerechnet, der Rest laut Gehaltsplan` : 'alle Monate abgerechnet'}${g.fehlt.length ? ` · <b class="neg">Abrechnung fehlt:</b> ${g.fehlt.map(monKurz).join(', ')}` : ''}.</p>${bxLink('Gehaltsentwicklung', zuG)}`;

  // Steuer-Prognose kompakt: ohne / mit Anlage U, möglicher Freibetrag
  const F = P?.freibetrag;
  const progInhalt = !P ? '<p class="bx-u">Für dieses Jahr gibt es noch keine Abrechnungen.</p>' : `<dl class="bx-dl">
      <div><dt>ohne Anlage U</dt><dd class="${P.ohne.erg >= 0 ? 'pos' : 'neg'}">${pm(P.ohne.erg)}<small>${P.ohne.erg >= 0 ? 'Erstattung' : 'Nachzahlung'}</small></dd></div>
      ${P.mit ? `<div><dt>mit Anlage U</dt><dd class="${P.mit.erg >= 0 ? 'pos' : 'neg'}">${pm(P.mit.erg)}<small>${P.mitU && !P.eingaben?.anlageU?.unterschrieben ? 'Zustimmung fehlt noch' : 'Realsplitting'}</small></dd></div>` : ''}
      <div><dt>Freibetrag je Monat</dt><dd>${F?.monat != null ? eur0(F.monat) : '–'}<small>${F?.monat != null ? `Antrag bis ${dde(F.frist)}` : F && !F.ueber ? 'unter der Antragsgrenze' : 'Antrag nicht mehr möglich'}</small></dd></div></dl>
    <p class="bx-u">${P.ist} ${P.ist === 1 ? 'Monat' : 'Monate'} abgerechnet${P.plan ? `, ${P.plan} laut Plan (${esc(P.planMon)})` : ''}.</p>${bxLink('Rechenweg und deine Angaben', zuSt)}`;

  // Steuerjahr: letzter Bescheid und offene Entscheidungen
  const so = D.j.steuer_offiziell?.jahre || {}, bj = Object.keys(so).filter((k) => /bescheid/i.test(so[k]?.art || '')).sort().at(-1), b = bj ? so[bj] : null;
  const fr = (sicher(() => fristenAlle(H)) || []).filter((x) => !x.erledigt && x.art === 'steuer').slice(0, 2);
  const tage = (am) => Math.round((Date.parse(`${am}T00:00:00Z`) - Date.parse(`${heuteLokal()}T00:00:00Z`)) / 864e5);
  const stInhalt = `${b ? `<dl class="bx-dl"><div><dt>Bescheid ${bj}</dt><dd>${dde(b.datum)}<small>${esc(b.veranlagung || '')}</small></dd></div>
      ${b.ergebnis?.erstattung != null ? `<div><dt>${b.ergebnis.erstattung >= 0 ? 'Erstattung' : 'Nachzahlung'}</dt><dd class="${b.ergebnis.erstattung >= 0 ? 'pos' : 'neg'}">${pm(Math.round(b.ergebnis.erstattung * 100))}<small>laut Bescheid</small></dd></div>` : ''}
      ${b.ergebnis?.est != null ? `<div><dt>Einkommensteuer</dt><dd>${eurE0(b.ergebnis.est)}<small>laut Bescheid</small></dd></div>` : ''}</dl>` : '<p class="bx-u">Noch kein Steuerbescheid in den Daten.</p>'}
    ${st ? `<p class="bx-zeile"><i class="ampel ${st.offen ? 'gelb' : 'ok'}" aria-hidden="true"></i>Belege ${st.jahr}: ${st.offen ? `<b>${st.offen} ${st.offen === 1 ? 'Entscheidung' : 'Entscheidungen'} offen</b>` : 'alles entschieden'}</p>` : ''}
    ${fr.map((x) => { const n = tage(x.am); return `<p class="bx-zeile"><i class="ampel ${n < 0 ? 'rot' : n <= 14 ? 'gelb' : 'neutral'}" aria-hidden="true"></i>${x.ziel ? zl(esc(x.titel), x.ziel) : esc(x.titel)} · ${n < 0 ? `seit ${-n} Tagen überfällig` : n === 0 ? 'heute' : `in ${n} Tagen`}</p>`; }).join('')}
    ${bxLink('Belege und Steuerjahr', { tab: 'steuer', sjahr: '' })}`;

  // Vom Brutto zur Auszahlung (letzte Abrechnung mit allen Einzelheiten): gedruckte Werte, „übrige“ = Differenz nach fester Regel
  let brutto = '<p class="bx-u">Die letzte Abrechnung hat keine Einzelheiten.</p>';
  const T = g?.teile;
  if (T) {
    const c = (v) => Math.round(v) * 100;   // auf volle Euro, damit die gezeigten Zeilen genau aufgehen
    const B = c(T.brutto), St = c(T.steuer), So = c(T.sozial), N = B - St - So, Au = c(T.auto), Bv = c(T.bav), Az = c(T.auszahlung), Ue = N - Au - Bv - Az;
    // Rechenzeichen beim Namen, Betrag ohne Vorzeichen (Abzüge sind normale Ausgaben, nicht rot)
    const z1 = (n, sub, v, cls_ = '', summe = false) => `<div class="bx-rz${summe ? ' bx-gilt' : ''}"><span>${summe ? '' : v > 0 ? '− ' : '+ '}${n}<small>${sub}</small></span><b class="${cls_}">${eur0(Math.abs(v))}</b></div>`;
    brutto = `<div class="ek-wf">
      ${z1('Brutto', `Abrechnung ${monLang(z.m)}`, B, '', true)}
      ${z1('Steuern', 'Lohnsteuer, Soli, Kirche', St)}
      ${z1('Sozialversicherung', 'Rente, Arbeitslosen-, Kranken-, Pflege-', So)}
      ${z1('= nach Abgaben', 'Brutto minus Steuern und Sozialversicherung, berechnet', N, '', true)}
      ${Au ? z1('Dienstwagen', 'versteuert, nicht ausgezahlt', Au) : ''}
      ${Bv ? z1('Betriebsrente', 'Entgeltumwandlung', Bv) : ''}
      ${Math.abs(Ue) >= 100 ? z1(Ue > 0 ? 'übrige Abzüge' : 'übrige Zuschläge', 'Differenz, berechnet', Ue) : ''}
      ${z1('= Auszahlung', 'aufs Konto', Az, 'pos', true)}</div>`;
  }

  // Steuer laut Bescheid je Jahr
  const soJ = D.j.steuer_offiziell?.jahre || {}, bJ = Object.keys(soJ).filter((k) => /bescheid/i.test(soJ[k]?.art || '') && soJ[k]?.ergebnis?.est != null).sort();
  const bescheide = bJ.length ? `${balkenListe(bJ.map((j) => { const e = soJ[j].ergebnis; return { n: j, sub: `zu versteuern ${eurE0(e.zve || 0)}`, c: Math.round(e.est * 100), w: eurE0(e.est),
      p: e.erstattung != null ? `<span class="${e.erstattung >= 0 ? 'pos' : 'neg'}">${e.erstattung >= 0 ? '+' : '−'}${eurE0(Math.abs(e.erstattung))}</span>` : '', farbe: 'var(--fest)', ziel: { tab: 'steuer', sjahr: j } }; }), { kopf: ['Jahr', 'Einkommensteuer', 'Erstattung'] })}`
    : '<p class="bx-u">Noch kein Steuerbescheid in den Daten.</p>';

  const reihe2 = z ? `<div class="bx-raster ek-reihe2">
      ${bxKarte('Grundgehalt und Erhöhungen', `<div class="ek-gg"><div><span>seit ${monKurz(g.erste.m)}</span><b class="pos">+${Math.round(g.seit * 100)} %</b></div><div><span>in Euro brutto im Monat</span><b>${eurE0(g.erste.gehalt)} → ${eurE0(g.stufe)}</b><small>+${eurE0(g.stufe - g.erste.gehalt)} · ${g.erh.length} Erhöhungen</small></div>
        <div><span>Arbeitgeber</span>${g.arbeitgeber.map((a) => `<b class="ek-ag">${esc(a.name)}</b><small>${monKurz(a.von)} – ${a.bis === g.alle.at(-1).m ? 'heute' : monKurz(a.bis)}</small>`).join('')}</div></div><p class="cp-leg"><i class="cp-leg-a"></i>Grundgehalt brutto im Monat <span>· Punkte: Erhöhungen mit Prozent</span></p><div class="cp-chart ek-chart"><canvas id="c-ek-verlauf" aria-label="Grundgehalt und Erhöhungen"></canvas></div>`, { cls_: 'ek-verlauf', fuss: `Von ${eurE0(g.erste.gehalt)} (${monKurz(g.erste.m)}) auf ${eurE0(g.stufe)} – laut Abrechnungen` })}
      ${bxKarte(`Vom Brutto zur Auszahlung · ${MON[+z.m.slice(5) - 1]}`, brutto)}
      ${bxKarte('Steuer laut Bescheid', bescheide)}
    </div>` : '';

  box.innerHTML = `<div class="cp bx">
    ${bxKopf('Einkommen & Steuer', kern, unter)}
    ${kacheln ? `<div class="cp-kz">${kacheln}</div>` : ''}
    <div class="bx-raster bx-drei">
      ${z ? bxKarte(`Gehalt ${g.jahr}`, jahrInhalt) : ''}
      ${bxKarte(`Steuer-Prognose ${P?.jahr || jetztJ}`, progInhalt, { rechts: '<span class="marke" title="Einzelveranlagung · Orientierung, keine Steuerberatung – mit deiner Steuerberaterin klären">berechnet</span>' })}
      ${bxKarte('Steuerjahr', stInhalt)}
    </div>
    ${reihe2}
  </div>`;
  gehBinden(box);
  if (g?.alle?.length) sicher(() => ekVerlaufZeichnen(g));
}

// Grundgehalt je Abrechnung als Stufenlinie, Erhöhungen als Punkte mit Prozent (Euro aus gehalt.js)
function ekVerlaufZeichnen(g) {
  if (!$('#c-ek-verlauf')) return;
  const ms = g.alle, erh = new Map(g.erh.map((x) => [x.m, x])), c = css('--accent');
  const o = basis();
  o.layout = { padding: { top: 22, right: 8 } };
  o.scales = { x: { ...achsenStil(), grid: { display: false }, ticks: { ...achsenStil().ticks, font: { size: 10.5 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 12 } },
    y: { ...achsenStil(), ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 5 } } };
  o.plugins.tooltip.callbacks = { title: (it) => `Abrechnung ${monLang(ms[it[0].dataIndex].m)}`, label: (it) => { const x = ms[it.dataIndex], e = erh.get(x.m), roh = x.gehalt || 0;
    return ` Grundgehalt: ${EUR0.format(it.raw)}${e ? ` (+${Math.round(e.p * 100)} %)` : ''}${x.stufe != null && Math.abs(roh - x.stufe) > 0.5 ? ` · Monat mit Nachzahlung: ${EUR0.format(Math.round(roh))}` : ''}`; } };
  o.onClick = (_, el) => { if (el.length) setze({ tab: 'gehalt', gmonat: ms[el[0].index].m }); };
  zeichne('c-ek-verlauf', { type: 'line',
    data: { labels: ms.map((x) => monKurz(x.m)), datasets: [{ data: ms.map((x) => Math.round(x.stufe ?? x.gehalt ?? 0)), borderColor: c, backgroundColor: alpha(c, 0.08), fill: 'origin', stepped: true, borderWidth: 2,
      pointRadius: ms.map((x) => (erh.has(x.m) ? 4 : 0)), pointBackgroundColor: c }] },
    options: o, plugins: [punktWerteMit(ms.map((x, i) => (erh.has(x.m) ? i : -1)).filter((i) => i >= 0), (v, i) => `+${Math.round(erh.get(ms[i].m).p * 100)} %`)] });
}

// ---------------------------------------------------------------- Familie
function familieSeite() {
  const box = $('#s5'), U = sicher(() => unterhaltKurz(H)) || null, K = U?.K, l = K?.letzte, zuU = { tab: 'fix', fixtab: 'unterhalt' };
  const gez = K?.gez, abw = gez != null && l ? Math.round((gez - l.summe) * 100) : null;
  // Differenzen aus den gezeigten (auf Euro gerundeten) Beträgen, damit „verbindlich + Risiko = Neuberechnung“ aufgeht
  const dU = (neu, alt) => dGezeigt(Math.round(alt * 100), Math.round(neu * 100));
  const risiko = K && l ? dU(K.X.summe, l.summe) : null, risikoN = K && l ? dU(K.N.summe, l.summe) : null;
  const kern = !l ? 'Unterhalt: keine verbindliche Berechnung in den Daten.'
    : `Verbindlich sind <b>${eurE0(l.summe)}</b> Unterhalt im Monat – laut Berechnung vom ${dde(l.datum)}.`;
  const lTeile = l ? rundeTeile([...(l.ku || []), l.tu].map((v) => Math.round(v * 100))) : [];   // gerundet so, dass die Teile die Summe ergeben
  const unter = l ? `${lTeile.slice(0, -1).map(eur0).join(' + ')} Kinder + ${eur0(lTeile.at(-1))} Trennung · gilt, bis die Gegenseite Auskunft verlangt<span class="cp-nur-breit"> (§ 1605 BGB) · mehr erst ab Aufforderung (§ 1613 BGB) · Orientierung, keine Rechtsberatung</span>` : '';
  const ms = (U?.R?.monate || []).filter((m) => !U.R.laeuft || m.k < U.R.bisM).slice(-12);
  const kacheln = !U ? '' : [
    kachel({ titel: 'Verbindlich', wert: l ? eurE0(l.summe) : '–', ziel: { ...zuU, _springe: '#uh-rechner' }, aend: l ? `Berechnung vom ${dde(l.datum)}` : '', spark: sparkline(ms.map((m) => m.soll)), unter: 'im Monat · Linie: Soll je Monat' }),
    kachel({ titel: K?.jetzt ? `Überwiesen ${MON[+K.jetzt.k.slice(5) - 1]}` : 'Überwiesen', wert: gez != null ? eurE0(gez) : '–', ziel: { ...zuU, _springe: '#uh-a' },
      aend: abw == null ? '' : Math.abs(abw) <= 100 ? 'passt zur Berechnung' : `<span class="neg">${eur0(Math.abs(abw))} ${abw < 0 ? 'weniger' : 'mehr'}</span> als berechnet${K.laeuftNoch ? ' · Monat läuft noch' : ''}`,
      spark: sparkline(ms.map((m) => m.sum)), unter: 'laut Buchungen · Linie: 12 Monate' }),
    kachel({ titel: 'Risiko Neuberechnung', marke: 'berechnet', wert: risiko == null ? '–' : `${risiko >= 0 ? '+' : '−'}${eur0(Math.abs(risiko))}`, cls_: risiko > 0 ? 'neg' : risiko < 0 ? 'pos' : '', ziel: { ...zuU, _springe: '#uh-rechner' },
      aend: risiko == null ? '' : `im Monat, ${K.pro ? 'für dich gerechnet' : 'neutral'}${K.pro && risikoN != null ? ` · neutral ${risikoN >= 0 ? '+' : '−'}${eur0(Math.abs(risikoN))}` : ''}`, unter: 'nur falls die Gegenseite Auskunft verlangt' }),
    kachel({ titel: 'Ausgleich', wert: `${U.saldo > 0 ? '+' : U.saldo < 0 ? '−' : ''}${eur0(Math.abs(U.saldo))}`, cls_: U.saldo < 0 ? 'neg' : U.saldo > 0 ? 'pos' : '', ziel: { ...zuU, _springe: '#uh-b' },
      aend: U.offen.length ? `<span class="neg">${U.offen.length} ${U.offen.length === 1 ? 'Posten' : 'Posten'} offen</span>` : 'keine offenen Steueranteile', unter: `Saldo mit ${esc(U.A.name || 'der Gegenseite')} seit ${U.A.seit ? monLang(U.A.seit.slice(0, 7)) : '–'} · plus = an dich` }),
  ].join('');

  // Monat für Monat: die letzten 6 abgeschlossenen Monate mit Abweichung zum Soll
  // Warum weicht die Zahlung ab? Letzter abgeschlossener Monat je Art gegen die verbindliche Berechnung
  const mL = ms.at(-1), grund = !mL || !l || mL.abw == null || Math.abs(mL.abw) < 100 ? ''
    : [Math.round(mL.tu) !== Math.round(l.tu * 100) ? `Trennungsunterhalt: überwiesen ${eur0(mL.tu)}, laut Berechnung ${eurE0(l.tu)}` : '',
      ...(l.ku || []).map((k, i) => (mL.kind[i] != null && Math.round(mL.kind[i]) !== Math.round(k * 100) ? `${esc(U.kinder[i]?.name || `Kind ${i + 1}`)}: überwiesen ${eur0(mL.kind[i])}, laut Berechnung ${eurE0(k)}` : ''))].filter(Boolean).join(' · ');
  const monate = ms.slice(-6).reverse().map((m) => `<button class="bx-mz"${geh(zuBuchungen({ konto: '', q: 'unterhalt', ...monatZiel(m.k) }))} title="Anklicken: Buchungen des Monats">
      <span>${monLang(m.k)}</span><b>${eur0(m.sum)}</b>${m.abw == null ? '<span class="muted">kein Soll</span>' : Math.abs(m.abw) < 100 ? '<span class="bx-ok">passt</span>' : `<span class="bx-d neg">${m.abw < 0 ? 'fehlt' : 'mehr'} ${eur0(Math.abs(m.abw))}</span>`}</button>`).join('');

  // Risiko bei Neuberechnung: verbindlich gegen die Rechnungen des Rechners
  const rz = (t, c, sub, cls_ = '') => `<div class="bx-rz ${cls_}"><span>${t}<small>${sub}</small></span><b>${eurE0(c)}</b></div>`;
  const dz = (neu) => { const c = dU(neu, l.summe); return `${c >= 0 ? '+' : '−'}${eur0(Math.abs(c))} ggü. verbindlich`; };
  const risikoInhalt = !K || !l ? '<p class="bx-u">Der Unterhaltsrechner braucht Abrechnungen und die Angaben zu den Kindern.</p>'
    : `${rz('verbindlich', l.summe, `Berechnung vom ${dde(l.datum)}`, 'bx-gilt')}
      ${rz('bei Neuberechnung, für dich gerechnet', K.P.summe, dz(K.P.summe), K.P.summe > l.summe ? 'bx-r' : '')}
      ${rz('bei Neuberechnung, neutral', K.N.summe, `${dz(K.N.summe)} · so könnte die Gegenseite rechnen`, K.N.summe > l.summe ? 'bx-r' : '')}
      ${K.nurLeo ? rz('nur Leo volljährig, Rest wie bisher', K.nurLeo.summe, `${dz(K.nurLeo.summe)} – öffnet aber die Neuberechnung`) : ''}
      <p class="bx-u">Eine Gehaltserhöhung musst du nicht von dir aus melden. Gefragt wahr antworten (§ 235 FamFG); ein volljähriges Kind kann selbst Auskunft verlangen.</p>
      ${bxLink('Rechenweg und Argumente für dich', { ...zuU, _springe: '#uh-rechner' })}`;

  // Ausgleich: Gruppen mit Saldo
  const GR = [['steuer', 'Steueranteile'], ['kinder', 'Sonderbedarf Kinder'], ['auslagen', 'Auslagen/Erstattungen'], ['sonst', 'Sonstiges']];
  const grL = !U ? [] : GR.map(([k, t]) => { const r = U.A.rows.filter((x) => U.A.gruppe(x) === k); return { t, r, c: r.reduce((s, x) => s + x.c, 0) }; }).filter((x) => x.r.length);
  const grZ = rundeTeile(grL.map((x) => x.c));   // gezeigte Gruppen ergeben den gezeigten Saldo
  const ausgleich = !U ? '' : `${grL.map(({ t, r }, i) => { const c = grZ[i];
      return `<div class="bx-rz"><span>${t}<small>${r.length} ${r.length === 1 ? 'Buchung' : 'Buchungen'}</small></span><b class="${c < 0 ? 'neg' : c > 0 ? 'pos' : ''}">${c > 0 ? '+' : c < 0 ? '−' : ''}${eur0(Math.abs(c))}</b></div>`; }).join('')}
    ${U.offen.map((p) => `<p class="bx-zeile"><i class="ampel gelb" aria-hidden="true"></i>offen: Anteil an der Steuererstattung ${p.J}</p>`).join('')}
    ${bxLink('Alle Buchungen und offenen Posten', { ...zuU, _springe: '#uh-b' })}`;

  // Kinder: Alter, volljährig ab, Fristen
  const heute = heuteLokal();
  const alter = (geb) => { const [y, m, d] = geb.split('-').map(Number), [hy, hm, hd] = heute.split('-').map(Number); return hy - y - (hm < m || (hm === m && hd < d) ? 1 : 0); };
  const kinderL = (U?.kinder?.length ? U.kinder : K?.kinder || []).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k.geb || ''));
  const fr = (sicher(() => fristenAlle(H)) || []).filter((x) => !x.erledigt && (x.art === 'kind' || x.ziel?.fixtab === 'unterhalt'));
  const hinweise = D.j.familie?.hinweise || [];
  const kinderInhalt = `${kinderL.map((k) => { const a = alter(k.geb), v = `${+k.geb.slice(0, 4) + 18}${k.geb.slice(4)}`;
      return `<div class="bx-rz"><span>${esc(k.name || 'Kind')}<small>geboren ${dde(k.geb)} · ${v <= heute ? `volljährig seit ${dde(v)}` : `volljährig ab ${dde(v)}`}</small></span><b>${a} Jahre</b></div>`; }).join('') || '<p class="bx-u">Ohne Geburtsdaten fehlt, wann deine Kinder volljährig werden.</p>'}
    ${fr.slice(0, 3).map((x) => `<p class="bx-zeile"><i class="ampel ${x.am < heute ? 'rot' : 'neutral'}" aria-hidden="true"></i>${esc(x.titel)} · ${dde(x.am)}</p>`).join('')}
    ${hinweise.length ? `<details class="bx-hinw"><summary>${hinweise.length === 1 ? 'Hinweis' : `${hinweise.length} Hinweise`} aus den Unterlagen</summary>${hinweise.map((t) => `<p>${esc(t)}</p>`).join('')}</details>` : ''}`;

  // Unterhalt je Monat nach Art und die Summen seit der ersten Zahlung (Cent, wie in unterhalt.js)
  const uhM = U?.R?.monate || [], uhKi = U?.kinder || [];
  const farbenK = ['var(--accent)', 'var(--accent-2)', 'var(--akzent)', 'var(--variabel)'];
  const uhArten = [{ n: 'Trennungsunterhalt', f: 'var(--fest)', w: (m) => m.tu }, ...uhKi.map((k, i) => ({ n: k.name || `Kind ${i + 1}`, f: farbenK[(i + 1) % farbenK.length], w: (m) => m.kind[i] || 0 })),
    { n: 'nicht aufgeteilt', f: 'var(--surface-3)', w: (m) => m.na }].filter((a1) => uhM.some((m) => a1.w(m)));
  const uhSum = uhM.reduce((t, m) => t + m.sum, 0);
  // Soll und Abweichung nur über abgeschlossene Monate und den laufenden, wenn seine Zahlung schon da ist
  const fertig = (m) => !U.R.laeuft || m.k < U.R.bisM || (m.sum > 0 && !K?.laeuftNoch), uhF = uhM.filter(fertig), ohneLfd = uhF.length < uhM.length;
  const uhSoll = uhF.every((m) => m.soll != null) ? uhF.reduce((t, m) => t + m.soll, 0) : null, uhSumF = uhF.reduce((t, m) => t + m.sum, 0);
  const uhAbw = uhSoll == null ? null : dGezeigt(uhSoll, uhSumF);
  const uhTeile = rundeTeile(uhArten.map((a1) => uhM.reduce((t, m) => t + a1.w(m), 0)));   // gezeigte Teile ergeben die gezeigte Summe
  const gezahlt = `${uhArten.map((a1, i) => `<div class="bx-rz"><span>${esc(a1.n)}</span><b>${eur0(uhTeile[i])}</b></div>`).join('')}
    <div class="bx-rz bx-gilt"><span>Summe gezahlt</span><b>${eur0(uhSum)}</b></div>
    ${uhSoll != null ? `<div class="bx-rz"><span>Soll laut deinen Angaben${ohneLfd ? ` bis ${esc(monLang(uhF.at(-1)?.k || uhM[0].k))}` : ''}<small>Abweichung ${uhAbw >= 0 ? '+' : '−'}${eur0(Math.abs(uhAbw))}${ohneLfd ? ' · laufender Monat noch nicht enthalten' : ''}</small></span><b>${eur0(uhSoll)}</b></div>` : ''}`;
  box.innerHTML = `<div class="cp bx">
    ${bxKopf('Familie', kern, unter)}
    ${kacheln ? `<div class="cp-kz">${kacheln}</div>` : ''}
    <div class="bx-raster bx-sechs">
      ${bxKarte('Risiko bei Neuberechnung', risikoInhalt, { rechts: '<span class="marke">berechnet</span>', fuss: 'Nichts selbst anstoßen – neu gerechnet wird erst, wenn die Gegenseite Auskunft verlangt. Mit RA Vitti abstimmen.' })}
      ${bxKarte('Monat für Monat', `<div class="bx-ml">${monate || '<p class="bx-u">Keine Unterhaltszahlungen auf deinen Konten.</p>'}</div>${grund ? `<p class="bx-hinw-z">Warum: ${grund}. Die Zahlung liegt also ${mL.abw < 0 ? 'unter' : 'über'} der verbindlichen Berechnung.</p>` : ''}${bxLink('Alle Monate', { ...zuU, _springe: '#uh-a' })}`, { rechts: '<span class="klein muted">gezahlt · Abweichung zum Soll</span>' })}
      ${bxKarte(U?.A?.name ? `Ausgleich mit ${esc(U.A.name)}` : 'Ausgleich', ausgleich, { rechts: U ? `<b class="bx-wert ${U.saldo < 0 ? 'neg' : ''}">${U.saldo > 0 ? '+' : U.saldo < 0 ? '−' : ''}${eur0(Math.abs(U.saldo))}</b>` : '', fuss: 'Plus = an dich, minus = von dir · ohne die Unterhaltsraten' })}
      ${bxKarte('Kinder und Fristen', kinderInhalt, { fuss: 'Kinderkonten zählen nicht zu deinen Finanzen' })}
      ${uhM.length ? bxKarte('Unterhalt je Monat', `<p class="cp-leg">${uhArten.map((a1, i) => `<i style="background:${a1.f}"></i>${esc(a1.n)}`).join(' ')} <span>· Linie: Soll</span></p><div class="cp-chart bx-chart"><canvas id="c-fam-uh" aria-label="Unterhalt je Monat nach Art"></canvas></div>`,
        { cls_: 'bx-flex', fuss: 'Gezahlt laut Buchungen deiner Konten · ein Kind bekommt einen Betrag nur, wenn der Verwendungszweck es nennt' }) : ''}
      ${uhM.length ? bxKarte(`Gezahlt seit ${esc(monLang(uhM[0].k))}`, gezahlt, { rechts: `<b class="bx-wert">${eur0(uhSum)}</b>`, fuss: `${uhM.length} Monate · Soll laut deinen Angaben${uhSoll != null ? '' : ' (nicht für alle Monate hinterlegt)'}` }) : ''}
    </div>
    ${RUNDUNG}
  </div>`;
  gehBinden(box);
  if (uhM.length) sicher(() => famUhZeichnen(uhM, uhArten));
}

function famUhZeichnen(ms, arten) {
  if (!$('#c-fam-uh')) return;
  const farbe = (f) => (f.startsWith('var(') ? css(f.slice(4, -1)) : f);
  const o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.layout = { padding: { top: 6 } };
  o.scales = { x: { ...achsenStil(), stacked: true, grid: { display: false }, ticks: { ...achsenStil().ticks, font: { size: 10.5 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 8 } },
    y: { ...achsenStil(), stacked: true, beginAtZero: true, ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 4 } } };
  o.plugins.tooltip.callbacks = { title: (it) => monLang(ms[it[0].dataIndex].k), label: (it) => (it.raw ? ` ${it.dataset.label}: ${EUR0.format(it.raw)}` : null),
    footer: (it) => { const m = ms[it[0].dataIndex]; return `gezahlt ${eur0(m.sum)}${m.soll != null ? ` · Soll ${eur0(m.soll)}` : ''}`; } };
  zeichne('c-fam-uh', { type: 'bar',
    data: { labels: ms.map((m) => monKurz(m.k)), datasets: [
      ...arten.map((a1) => ({ label: a1.n, data: ms.map((m) => a1.w(m) / 100), backgroundColor: farbe(a1.f), maxBarThickness: 24, stack: 'g' })),
      { type: 'line', label: 'Soll', data: ms.map((m) => (m.soll == null ? null : m.soll / 100)), borderColor: css('--aus-text'), borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, stepped: 'middle', stack: 's' }] },
    options: o });
}

// ---------------------------------------------------------------- Übersicht: Wie stehe ich da – und wohin läuft es?
let startOhneSteuer = false;   // Startseite wurde gezeichnet, bevor die Steuer-Entscheidungen geladen waren
function startSeite() {
  startOhneSteuer = true;
  const box = $('#s5'), V = verlauf5(), R = V.R, ms = V.monate, lauf = V.lauf, letzte = ms[ms.length - 1];
  const gMon = monLang(R.gehaltMonat), hs = V.heuteSumme, heute = hs?.c ?? 0, s = V.schnitt;
  const anfang = kontenSumme(plusTage(`${V.jetzt}-01`, -1)), seitAnfang = diffSumme(anfang, hs), prog = letzte.stand;
  const monatJ = MONAT[+V.jetzt.slice(5) - 1], monatE = MONAT[+letzte.k.slice(5) - 1];
  const ref = V.monate.filter((m) => m.art === 'ist').map((m) => m.k);
  const zuB = (x) => zuBuchungen({ konto: '', ...x });   // die Übersicht rechnet immer mit allen Konten
  const lk = R.lh.kats[0];
  // Antwort in zwei, drei Sätzen: normaler Monat heute, warum es bisher anders aussah, wohin es läuft – jede Zahl anklickbar
  let satz = `Mit deinem aktuellen Gehalt von ${zl(`<b>${eur0(R.gehalt)}</b>`, zuGehalt())} ${R.erg >= 0 ? 'bleiben' : 'fehlen'} in einem normalen Monat rund ${zl(`<b class="${R.erg >= 0 ? 'pos' : 'neg'}">${eur0(Math.abs(R.erg))}</b>`, { tab: 'fix', fixtab: 'vertraege' })}${R.erg >= 0 ? ' übrig' : ''}.`;
  const schnittZ = zl(`<b class="${s.erg >= 0 ? 'pos' : 'neg'}">${plusMinus(s.erg)}</b>`, { tab: 'kennzahlen', jahr: '', monat: '', zr: '', konto: '' });
  if (s.erg - R.erg > 20000 && V.sonder.length) satz += ` In den letzten 12 Monaten waren es im Schnitt ${schnittZ} – dank Sonderzahlungen wie ${sonderText(V.sonder.slice(0, 2))}.`;
  else satz += ` In den letzten 12 Monaten waren es im Schnitt ${schnittZ} im Monat.`;
  if (prog != null) satz += ` Läuft alles so weiter, stehen Ende ${monatE} etwa ${zl(`<b class="${prog < 0 ? 'neg' : ''}">${eur0(prog)}</b>`, { tab: 'konten', stichtag: '', konto: '' })} auf deinen Konten.`;

  // Kontostand heute und seit Monatsanfang – bei einer unvollständigen Summe steht dabei, welches Konto fehlt
  const seitText = anfang ? `${seitAnfang == null ? '–' : `<span class="${seitAnfang < 0 ? 'neg' : ''}">${plusMinus(seitAnfang)}</span>`} seit 1. ${monatJ}` : '';
  const zahlen = [
    zahl5('Auf deinen Konten', summeText(hs), `heute · ${hs && !hs.voll ? `${esc(fehltText(hs))} · ` : ''}${seitText}${lauf?.gehaltKommt ? ' – das Gehalt kommt noch' : ''}`, { cls: heute < 0 ? 'neg' : '', ziel: { tab: 'konten', stichtag: '', konto: '' } }),
    zahl5('Gehalt aktuell', eur0(R.gehalt), `netto im ${gMon}${R.gt ? ` · kommt um den ${R.gt}.` : ''} · anklicken: alle Gehälter`, { ziel: zuGehalt() }),
    zahl5(R.erg >= 0 ? 'Normaler Monat: bleibt' : 'Normaler Monat: fehlt', plusMinus(R.erg), 'Gehalt + Sonstiges − Fixkosten − Lebenshaltung', { cls: R.erg >= 0 ? 'pos' : 'neg', ziel: { tab: 'fix', fixtab: 'vertraege', konto: '' } }),
    zahl5(`Prognose Ende ${monatE}`, prog == null ? '–' : `≈ ${eur0(prog)}`, prog == null ? 'nicht berechenbar: der Stand heute ist unvollständig' : `auf deinen Konten · <span class="${prog - heute < 0 ? 'neg' : ''}">${plusMinus(prog - heute)}</span> ggü. heute`, { cls: prog < 0 ? 'neg' : '', ziel: { tab: 'konten', stichtag: '', konto: '' } }),
  ].join('');

  // Ein normaler Monat ab jetzt – als Blöcke wie bei Kennzahlen und Fixkosten; jede Zeile führt zu den Einzelheiten
  const nmZeile = (n, sub, c, vz, ziel, kopf = false, cls_ = '') => `<button class="${kopf ? 'vg-k' : 'vg-z'} nm-z"${geh(ziel)} title="Anklicken: Einzelheiten">
      <span class="${kopf ? 'vg-n' : 'vg-zn'}">${kopf ? `<b>${n}</b>` : n}${sub ? `<small>${sub}</small>` : ''}</span><b class="nm-w ${cls_}">${vz}${eur0(Math.abs(c))}</b></button>`;
  const rechnung = `<div class="vgs nm">
    <section class="vg" style="--vg:var(--ein)">${nmZeile('Einnahmen', 'je Monat', R.ein, '+', zuGehalt(), true)}<div class="vg-l">
      ${nmZeile('Gehalt', `netto, ${gMon} · alle Gehälter →`, R.gehalt, '+', zuGehalt())}
      ${nmZeile('Sonstige Einnahmen', 'typisch: Erstattungen, Zinsen …', R.sonst, '+', { tab: 'uebersicht', kart: 'ein', wahl: '', jahr: '', konto: '' })}</div></section>
    <section class="vg" style="--vg:var(--aus)">${nmZeile('Ausgaben', 'je Monat', R.aus, '−', { tab: 'fix', fixtab: 'vertraege', konto: '' }, true)}<div class="vg-l">
      ${nmZeile('Fixkosten', `${R.vertraege.length} laufende Verträge`, R.fix, '−', { tab: 'fix', fixtab: 'vertraege', konto: '' })}
      ${nmZeile('Lebenshaltung', `${lebenName()}: Einkauf, Tanken, Freizeit …`, R.leben, '−', { tab: 'fix', fixtab: 'vertraege', konto: '', _springe: '#fix-leben' })}</div></section>
    <section class="vg" style="--vg:${R.erg >= 0 ? 'var(--ein-text)' : 'var(--aus-text)'}">${nmZeile(R.erg >= 0 ? '= bleibt im Monat' : '= fehlt im Monat', 'Einnahmen minus Ausgaben', R.erg, R.erg >= 0 ? '+' : '−', { tab: 'fix', fixtab: 'vertraege', konto: '' }, true, R.erg >= 0 ? 'pos' : 'neg')}</section>
  </div>`;
  const tipp = R.erg < 0 && R.leben > 0
    ? `<p class="s5-tipp">Für ±0 müsstest du ${eur0(-R.erg)} im Monat weniger ausgeben – ${Math.round((-R.erg / R.leben) * 100)} % der Lebenshaltung.${lk ? ` Größter Posten dort: ${zl(`<b>${esc(schoen(lk.kat))}</b>`, zuBuchungen({ konto: '', art: 'aus', kat: lk.kat, nf: '1', zr: `${R.lh.monate[0]}_${R.lh.monate[R.lh.monate.length - 1]}` }))} (Ø ${eur0(lk.c)}).` : ''}</p>`
    : R.erg > 0 ? `<p class="s5-tipp">Das sind ${Math.round((R.erg / R.ein) * 100)} % deines Einkommens, die du sparen könntest.</p>` : '';

  // Dieser Monat – Zeilen anklickbar
  let monat = '';
  if (lauf) {
    const anteilTag = Math.round((lauf.tag / lauf.tage) * 100), anteilAus = Math.min(100, Math.round((lauf.x.aus / Math.max(1, lauf.aus)) * 100));
    const zeile = (dt, dd, cls_, ziel) => `<div class="klick"${geh(ziel)} title="Anklicken: Einzelheiten"><dt>${dt}</dt><dd class="${cls_}">${dd}</dd></div>`;
    monat = `<button class="mb"${geh(zuB({ ...monatZiel(lauf.k), art: 'aus' }))} title="Anklicken: alle Ausgaben im ${monatJ}">
        <span class="mb-l"><span>${eur0(lauf.x.aus)} ausgegeben</span><span class="muted">von erwartet ≈ ${eur0(lauf.aus)}</span></span>
        <span class="mb-b"><i style="width:${anteilAus}%"></i><b style="left:${anteilTag}%"></b></span>
        <span class="mb-l muted klein"><span>Tag ${lauf.tag} von ${lauf.tage} · Strich = heute</span><span>${anteilAus} % der Ausgaben</span></span></button>`
      + `<dl class="s5-dl">
        ${zeile('Noch fällig (feste Abbuchungen)', eur0(lauf.offenFest), '', { tab: 'fix', fixtab: 'kalender', konto: '' })}
        ${zeile(lauf.gehaltKommt ? `Gehalt erwartet${R.gt ? ` um den ${R.gt}.` : ''}` : 'Gehalt ist da', `+${eur0(lauf.gehaltKommt || lauf.x.lohn)}`, 'pos', zuGehalt())}
        ${zeile('Erwartet zum Monatsende', `≈ ${plusMinus(lauf.erg)}`, lauf.erg >= 0 ? 'pos' : 'neg', zuB(monatZiel(lauf.k)))}
        ${sicher(() => freiZeile(H))}
      </dl>`;
  }
  const st = steuerStand();
  startOhneSteuer = !st;
  if (st) monat += `<button class="s5-hinweis"${geh({ tab: 'steuer' })}><b>Steuer ${st.jahr}</b> ${st.offen ? `· ${st.offen} Entscheidungen offen` : '· alles entschieden'} <span class="link">→</span></button>`;

  const termine = naechsteTermine(R.vertraege), tSumme = termine.reduce((t, x) => t + x.f.betrag, 0);
  box.innerHTML = kopf5(`Übersicht <span class="s5-stand">Daten bis ${dde(D.bis)}</span>`, satz)
    + `<div class="s5-zahlen">${zahlen}</div>
    <div class="s5-raster s5-start">
      ${karte5('Was am Monatsende übrig blieb', `Einnahmen minus Ausgaben je Monat. Grün = Plus, rot = Minus, schraffiert = erwartet (${esc(sicher(() => prognoseText(H)) || 'berechnet')}). Gestrichelt: Durchschnitt der letzten 12 Monate. Säule anklicken: Buchungen des Monats.`, '<div class="s5-chart fuell"><canvas id="c-s5-erg"></canvas></div>', 's5-b2', zl('alle 12 Monate →', zuB(zeitZiel(ref))))}
      ${karte5('Ein normaler Monat ab jetzt', 'Mit deinem aktuellen Gehalt, den laufenden Verträgen und deiner üblichen Lebenshaltung · Zeile anklicken: Einzelheiten', rechnung + tipp, 's5-mr')}
      ${karte5('Kontostand', `Summe deiner Konten am Monatsende (ohne Depot, gemeinsame und Kinderkonten). Gestrichelt: Prognose. Punkt anklicken: Kontostände an diesem Tag.${lueckenText(ms.map((m) => m.summe))}`, '<div class="s5-chart klein fuell"><canvas id="c-s5-stand"></canvas></div>')}
      ${karte5(lauf ? `${monatJ} bisher` : 'Dieser Monat', lauf ? 'Was schon gebucht ist und was bis Monatsende noch kommt' : '', monat || '<div class="leer klein">Der Monat ist abgeschlossen.</div>')}
      ${karte5('Nächste 30 Tage', 'Feste Abbuchungen aus deinen Verträgen · anklicken: alle Zahlungen des Vertrags', termineHtml(termine, 6), '', zl(`<span class="s5-wert">${eur0(tSumme)}</span>`, { tab: 'fix', fixtab: 'kalender', konto: '' }))}
      ${sicher(() => waechterKarte(H))}${sicher(() => fristenKarte(H))}
    </div>`;
  gehBinden(box);
  sicher(() => waechterBinden(box, H)); sicher(() => fristenBinden(box, H)); sicher(() => rahmenBinden(box, H));
  freiFuellen(box);
  s5ErgebnisZeichnen(V);
  s5StandZeichnen(V);
}

// Ergebnis je Monat als Säulen: 12 Monate, laufender Monat (erwartet) und 3 Monate Prognose
function s5ErgebnisZeichnen(V) {
  if (!$('#c-s5-erg')) return;
  const ms = V.monate, ab = ms.findIndex((m) => m.art !== 'ist');
  const cP = css('--ein'), cN = css('--aus'), pP = schraffur(cP), pN = schraffur(cN);
  const o = basis();
  o.layout = { padding: { top: 20 } };
  o.scales = {
    x: { ...achsenStil(), grid: { display: false }, ticks: { ...achsenStil().ticks, font: { size: 11.5 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 6 } },
    y: { ...achsenStil(), ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 5 } },
  };
  o.plugins.tooltip.callbacks = {
    title: (it) => { const m = ms[it[0].dataIndex]; return `${monLang(m.k)}${m.art === 'prognose' ? ` – Prognose (berechnet: ${m.plan ? 'Plan-Gehalt' : 'aktuelles Gehalt'} + Lebenshaltung wie im normalen Monat)` : m.art === 'laeuft' ? ' – erwartet bis Monatsende' : ''}`; },
    label: (it) => { const m = ms[it.dataIndex]; return ` ${m.erg >= 0 ? 'Überschuss' : 'Fehlbetrag'}: ${EUR0.format(m.erg / 100)}`; },
    afterBody: (it) => { const m = ms[it[0].dataIndex]; return [`Einnahmen ${eur0(m.ein)}`, `Ausgaben ${eur0(m.aus)}`, m.art === 'ist' ? 'Klick: Buchungen des Monats' : '']; },
  };
  o.onClick = (_, el) => { const m = el.length && ms[el[0].index]; if (m && m.art !== 'prognose') setze(zuBuchungen({ konto: '', ...monatZiel(m.k) })); };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length && ms[el[0].index].art !== 'prognose' ? 'pointer' : 'default'; };
  zeichne('c-s5-erg', {
    type: 'bar',
    data: { labels: ms.map((m) => monKurz(m.k)), datasets: [{ data: ms.map((m) => m.erg / 100), backgroundColor: ms.map((m) => (m.art === 'ist' ? alpha(m.erg >= 0 ? cP : cN, 0.85) : m.erg >= 0 ? pP : pN)), hoverBackgroundColor: ms.map((m) => (m.erg >= 0 ? cP : cN)), borderRadius: 4, maxBarThickness: 34 }] },
    options: o,
    plugins: [prognoseMit(ab, PROGNOSE), linieMit('schnitt', V.schnitt.erg / 100, `Ø ${plusMinus(V.schnitt.erg)}`, css('--text-2'), V.schnitt.erg >= 0), saeulenWerteMit({ groesse: 10.5, fmt: vorzeichenKurz })],
  });
}

// Kontostand am Monatsende: 12 Monate, dann gestrichelt die Prognose
function s5StandZeichnen(V) {
  if (!$('#c-s5-stand')) return;
  // Monatsenden ohne vollständige Summe bleiben als Lücke stehen (stand = null), damit kein zu niedriger Wert erscheint
  const ms = V.monate, ab = ms.findIndex((m) => m.art !== 'ist'), c = css('--accent');
  const o = basis();
  o.layout = { padding: { top: 22, left: 4, right: 8 } };
  o.interaction = { mode: 'index', intersect: false };
  o.scales = {
    x: { ...achsenStil(), grid: { display: false }, ticks: { ...achsenStil().ticks, font: { size: 11 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 8 } },
    y: { ...achsenStil(), ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 4 } },
  };
  o.plugins.tooltip.callbacks = { title: (it) => `Ende ${monLang(ms[it[0].dataIndex].k)}${ms[it[0].dataIndex].art !== 'ist' ? ' – erwartet' : ''}`, label: (it) => (it.raw == null ? ' nicht vollständig berechenbar' : ` Konten: ${EUR0.format(it.raw)}`) };
  const letzteIst = ab < 0 ? ms.length - 1 : ab - 1;
  // Klick: Kontostände an diesem Monatsende (Prognose: Reiter Konten mit Verlauf)
  o.onClick = (_, el) => { if (!el.length) return; const m = ms[el[0].index]; setze({ tab: 'konten', konto: '', stichtag: m.art === 'ist' ? monatsletzter(`${m.k}-01`) : '' }); };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; };
  zeichne('c-s5-stand', {
    type: 'line',
    data: { labels: ms.map((m) => monKurz(m.k)), datasets: [{ data: ms.map((m) => (m.stand == null ? null : m.stand / 100)), borderColor: c, backgroundColor: alpha(c, 0.1), fill: 'origin', cubicInterpolationMode: 'monotone', borderWidth: 2.5,
      pointRadius: ms.map((m, i) => (i === letzteIst || i === ms.length - 1 ? 4 : 2)), pointBackgroundColor: ms.map((m) => (m.art === 'ist' ? c : css('--surface'))), pointBorderColor: c, pointBorderWidth: 2,
      segment: { borderDash: (sg) => (ab >= 0 && sg.p1DataIndex >= ab ? [6, 4] : undefined) } }] },
    options: o,
    plugins: [prognoseMit(ab, PROGNOSE), punktWerteMit([0, letzteIst, ms.length - 1].filter((i, j, a) => i >= 0 && a.indexOf(i) === j), (v, i) => `${i > letzteIst ? '≈ ' : ''}${kurzWert(v)}`)],
  });
}

// ---------------------------------------------------------------- Kennzahlen: Wie entwickeln sich meine Finanzen?
// Aufbau: der Durchschnittsmonat als Tabelle (Einnahmen → Ausgaben → Ergebnis, je mit Vorjahr), was sich verändert hat,
// Monat für Monat als Grafik, Jahr für Jahr als Tabelle, darunter eine Leiste mit Auffälligem.
function k5Seite() {
  const box = $('#k2'), P = periode(), rechts = kontoWahlHtml() + zeitSeg(P);
  if (!P.monate.length) { box.innerHTML = kopf5('Kennzahlen', 'In diesem Jahr ist noch kein Monat abgeschlossen.', rechts); gehBinden(box); kennzahlenBinden(box); return; }
  const a = sammle(P.monate), v = P.vor.length ? sammle(P.vor) : null, ein = sammle(P.monate, 'ein'), einV = v ? sammle(P.vor, 'ein') : null, R = monatsRechnung();
  const pm = (x, c) => c / x.n, quote = (x) => (x.ein ? Math.round((x.erg / x.ein) * 100) : null);
  const P0 = `${P.label[0].toUpperCase()}${P.label.slice(1)}`;
  const zeit = zeitZiel(P.monate);
  let satz = `${P.hinweis}${P0} kamen im Schnitt ${zl(`<b>${eur0(pm(a, a.ein))}</b>`, { tab: 'uebersicht', kart: 'ein', wahl: '' })} im Monat herein und ${zl(`<b>${eur0(pm(a, a.aus))}</b>`, { tab: 'uebersicht', kart: 'aus', wahl: '' })} gingen raus – ${a.erg >= 0 ? 'übrig blieben' : 'es fehlten'} ${zs(`<b class="${a.erg >= 0 ? 'pos' : 'neg'}">${eur0(Math.abs(pm(a, a.erg)))}</b>`, '#k5-tab')} im Monat.`;
  if (v) {
    const dA = pm(a, a.aus) - pm(v, v.aus), dE = pm(a, a.ein) - pm(v, v.ein);
    satz += ` Gegenüber dem Vorjahr: Einnahmen <b class="${dE >= 0 ? 'pos' : 'neg'}">${plusMinus(dE)}</b>, Ausgaben <b class="${dA <= 0 ? 'pos' : 'neg'}">${plusMinus(dA)}</b> im Monat.`;
  }
  const vgl = (jetzt, vorher, mehrGut) => {
    if (vorher == null) return '';
    const d = jetzt - vorher;
    if (Math.abs(d) < 1000) return ' · wie im Vorjahr';
    return ` · <span class="${(d > 0) === mehrGut ? 'pos' : 'neg'}">${d > 0 ? '▲' : '▼'} ${eur0(Math.abs(d))}</span> ggü. Vorjahr`;
  };
  const zahlen = [
    zahl5('Einnahmen im Monat', eur0(pm(a, a.ein)), `Ø · davon Gehalt ${eur0(a.lohn / a.n)}${vgl(pm(a, a.ein), v && pm(v, v.ein), true)}`, { cls: 'pos', ziel: { tab: 'uebersicht', kart: 'ein', wahl: '' } }),
    zahl5('Ausgaben im Monat', eur0(pm(a, a.aus)), `Ø · davon fest ${eur0(a.fix / a.n)}${vgl(pm(a, a.aus), v && pm(v, v.aus), false)}`, { cls: 'neg', ziel: { tab: 'uebersicht', kart: 'aus', wahl: '' } }),
    zahl5(a.erg >= 0 ? 'Übrig im Monat' : 'Fehlbetrag im Monat', plusMinus(pm(a, a.erg)), `Ø · Sparquote ${quote(a) ?? '–'} %${v ? ` (Vorjahr ${quote(v)} %)` : ''} · je Monat →`, { cls: a.erg >= 0 ? 'pos' : 'neg', springe: '#k5-tab' }),
    // Spar- und Depotkonto mit Vorzeichen: + = gespart, − = mehr entnommen als eingezahlt (das deckt dann einen Teil des Ergebnisses)
    zahl5(a.spar >= 0 ? 'Aufs Spar- und Depotkonto' : 'Spar- und Depotkonto', a.sparRein || a.sparRaus ? plusMinus(a.spar / a.n) : '–',
      !(a.sparRein || a.sparRaus) ? 'in diesem Zeitraum nichts' : `Ø im Monat ${a.spar >= 0 ? 'gespart' : 'entnommen (mehr raus als rein)'} · eingezahlt ${eur0(a.sparRein)}, entnommen ${eur0(a.sparRaus)}`,
      { cls: a.spar < 0 ? 'neg' : '', ziel: zuBuchungen({ kat: 'Sparen', ...zeit }) }),
  ].join('');

  // Der Durchschnittsmonat: drei Blöcke wie bei den Verträgen, je Zeile Ø jetzt, Ø Vorjahr und Veränderung
  const diffZelle = (jetzt, vorher, mehrGut) => {
    if (vorher == null) return '<span class="dm-d muted">–</span>';
    const d = jetzt - vorher;
    if (Math.abs(d) < 1000) return '<span class="dm-d muted">≈</span>';
    return `<span class="dm-d ${(d > 0) === mehrGut ? 'pos' : 'neg'}">${plusMinus(d)}</span>`;
  };
  const zeile = (n, sub, jetzt, vorher, mehrGut, ziel, kopf = false) => {
    const tag = ziel ? 'button' : 'div';
    return `<${tag} class="${kopf ? 'vg-k' : 'vg-z'} dm-z"${ziel ? (ziel.springe ? ` data-springe="${ziel.springe}"` : geh(ziel)) : ''}${ziel ? ' title="Anklicken: Einzelheiten"' : ''}>
      <span class="${kopf ? 'vg-n' : 'vg-zn'}">${kopf ? `<b>${n}</b>` : n}${sub ? `<small>${sub}</small>` : ''}</span>
      <b class="dm-w">${eur0(jetzt)}</b><span class="dm-v">${vorher == null ? '–' : eur0(vorher)}</span>${diffZelle(jetzt, vorher, mehrGut)}</${tag}>`;
  };
  const vm = (x, c) => (x ? c / x.n : null);
  const quellen = [...ein.g.values()].filter((x) => x.c > 0 && x.k !== 'Lohn / Gehalt').sort((x, y) => y.c - x.c);
  const top = quellen.slice(0, 3), rest = quellen.slice(3), restC = rest.reduce((t, x) => t + x.c, 0);
  const restV = einV ? rest.reduce((t, x) => t + (einV.g.get(x.k)?.c || 0), 0) : 0;
  const einZeilen = [
    zeile('Gehalt', 'aufs Konto', a.lohn / a.n, vm(v, v?.lohn), true, zuBuchungen({ kat: 'Einnahmen', ukat: 'Lohn / Gehalt', art: 'ein', ...zeit })),
    ...top.map((x) => zeile(esc(schoen(x.k)), '', x.c / a.n, einV ? (einV.g.get(x.k)?.c || 0) / v.n : null, true, { tab: 'uebersicht', kart: 'ein', wahl: x.k })),
    ...(restC > 0 ? [zeile(`Übrige (${rest.length})`, rest.slice(0, 3).map((x) => esc(schoen(x.k))).join(', '), restC / a.n, einV ? restV / v.n : null, true, { tab: 'uebersicht', kart: 'ein', wahl: '' })] : []),
  ].join('');
  const ergV = v ? v.erg / v.n : null;
  const durchschnitt = `<div class="vgs dm">
    <div class="vg-kopf dm-z"><span>Ø je Monat</span><span>${esc(monatsText(P.monate))}</span><span>Vorjahr</span><span>Veränderung</span></div>
    <section class="vg" style="--vg:var(--ein)">${zeile('Einnahmen', '', a.ein / a.n, vm(v, v?.ein), true, { tab: 'uebersicht', kart: 'ein', wahl: '' }, true)}<div class="vg-l">${einZeilen}</div></section>
    <section class="vg" style="--vg:var(--aus)">${zeile('Ausgaben', '', a.aus / a.n, vm(v, v?.aus), false, { tab: 'uebersicht', kart: 'aus', wahl: '' }, true)}<div class="vg-l">
      ${zeile('Fixkosten', 'Verträge, Miete, Unterhalt', a.fix / a.n, vm(v, v?.fix), false, { tab: 'fix', fixtab: 'vertraege' })}
      ${zeile('Lebenshaltung', 'alle übrigen Ausgaben', dGezeigt(a.fix / a.n, a.aus / a.n), v ? dGezeigt(v.fix / v.n, v.aus / v.n) : null, false, zuBuchungen({ art: 'aus', nf: '1', ...zeit }))}</div></section>
    <section class="vg" style="--vg:${a.erg >= 0 ? 'var(--ein-text)' : 'var(--aus-text)'}">${zeile(a.erg >= 0 ? '= übrig' : '= Fehlbetrag', `Sparquote ${quote(a) ?? '–'} %${v ? ` · Vorjahr ${quote(v)} %` : ''}`, a.erg / a.n, ergV, true, { springe: '#k5-tab' }, true).replace(`<b class="dm-w">${eur0(a.erg / a.n)}</b>`, `<b class="dm-w ${a.erg >= 0 ? 'pos' : 'neg'}">${plusMinus(a.erg / a.n)}</b>`)}
      ${a.spar || v?.spar ? `<div class="vg-l">${zeile('Spar- und Depotkonto', a.spar >= 0 ? 'zusätzlich gespart, nicht in den Ausgaben' : 'mehr entnommen als eingezahlt (minus)', a.spar / a.n, v ? v.spar / v.n : null, true, zuBuchungen({ kat: 'Sparen', ...zeit })).replace('<b class="dm-w">-', '<b class="dm-w neg">-').replace('<span class="dm-v">-', '<span class="dm-v" style="color:var(--aus-text)">-')}</div>` : ''}</section>
  </div>`;

  // Was sich verändert hat (Kategorien je Monat ggü. Vorjahr)
  let veraendert = '<div class="leer klein">Für diesen Zeitraum gibt es kein Vorjahr zum Vergleich.</div>';
  let dAus = [];
  if (v) {
    const d = dAus = [...new Set([...a.g.keys(), ...v.g.keys()])].map((k) => ({ k, jetzt: (a.g.get(k)?.c || 0) / a.n, vorher: (v.g.get(k)?.c || 0) / v.n }))
      .map((x) => ({ ...x, d: x.jetzt - x.vorher })).filter((x) => Math.abs(x.d) >= 3000).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 8);
    veraendert = d.length ? `<div class="vd">${d.map((x) => `<button class="vd-z"${geh({ tab: 'uebersicht', kart: 'aus', wahl: x.k })} title="Klick: Einzelheiten zur Kategorie">
        <span class="vd-p ${x.d > 0 ? 'neg' : 'pos'}">${x.d > 0 ? '▲' : '▼'}</span><span class="vd-n">${esc(schoen(x.k))}<small>${eur0(x.vorher)} → ${eur0(x.jetzt)} im Monat</small></span><b class="${x.d > 0 ? 'neg' : 'pos'}">${plusMinus(x.d)}</b></button>`).join('')}</div>`
      : '<div class="leer klein">Kaum Veränderungen gegenüber dem Vorjahr.</div>';
    // nur wenn Platz ist: die Einnahmen-Seite und der größte Hebel
    const dEin = [...new Set([...ein.g.keys(), ...einV.g.keys()])].map((k) => ({ k, jetzt: (ein.g.get(k)?.c || 0) / a.n, vorher: (einV.g.get(k)?.c || 0) / v.n }))
      .map((x) => ({ ...x, d: x.jetzt - x.vorher })).filter((x) => Math.abs(x.d) >= 3000).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 4);
    if (dEin.length) veraendert += `<div class="s5-teil fuell-aus" data-fuell="2"><h3>Bei den Einnahmen</h3><div class="vd">${dEin.map((x, i) => `<button class="vd-z${i ? ' fuell-aus' : ''}"${i ? ` data-fuell="${2 + i}" data-stopp` : ''}${geh({ tab: 'uebersicht', kart: 'ein', wahl: x.k })} title="Klick: Einzelheiten">
        <span class="vd-p ${x.d > 0 ? 'pos' : 'neg'}">${x.d > 0 ? '▲' : '▼'}</span><span class="vd-n">${esc(schoen(x.k))}<small>${eur0(x.vorher)} → ${eur0(x.jetzt)} im Monat</small></span><b class="${x.d > 0 ? 'pos' : 'neg'}">${plusMinus(x.d)}</b></button>`).join('')}</div></div>`;
    const hebel = dAus.filter((x) => x.d > 0)[0];
    if (hebel) veraendert += `<p class="s5-tipp fuell-aus" data-fuell="1">Größter Hebel: ${zl(`<b>${esc(schoen(hebel.k))}</b>`, { tab: 'uebersicht', kart: 'aus', wahl: hebel.k })} kostet ${eur0(hebel.d)} mehr im Monat als im Vorjahr – zurück aufs Vorjahresniveau wären ${eur0(hebel.d * 12)} im Jahr.</p>`;
  }

  // Jahr für Jahr als Tabelle (neuestes oben), Zeile anklicken = Jahr wählen
  const alle = abgeschlosseneMonate(), jahre = [...new Set(alle.map((k) => +k.slice(0, 4)))].slice(-6).reverse();
  const jw = jahre.map((y) => ({ y, x: sammle(alle.filter((k) => +k.slice(0, 4) === y)) }));
  const maxE = Math.max(1, ...jw.map(({ x }) => Math.abs(x.n ? x.erg / x.n : 0)));
  const jahrTab = `<div class="jt"><div class="jt-z jt-kopf"><span>Jahr</span><span>Einnahmen</span><span>Ausgaben</span><span>Ergebnis</span></div>
    ${jw.map(({ y, x }) => { const e = x.n ? x.erg / x.n : 0; return `<button class="jt-z${P.jahr === y ? ' an' : ''}" data-zeit="${y}" title="Anklicken: ${y} auswählen">
      <span class="jt-j">${y}${x.n < 12 ? `<small>${x.n} Monate</small>` : ''}</span><span>${x.n ? eur0(x.ein / x.n) : '–'}</span><span>${x.n ? eur0(x.aus / x.n) : '–'}</span>
      <span class="jt-e"><b class="${e >= 0 ? 'pos' : 'neg'}">${plusMinus(e)}</b><i class="${e >= 0 ? 'plus' : 'minus'}" style="width:${(Math.abs(e) / maxE) * 100}%"></i></span></button>`; }).join('')}</div>`;

  // Auffällig – mit Hochrechnung aufs ganze Jahr, wenn ein laufendes Jahr gewählt ist
  const ms = P.monate.map((k) => ({ k, e: a.mon.get(k).ein - a.mon.get(k).aus, aus: a.mon.get(k).aus }));
  const best = [...ms].sort((x, y) => y.e - x.e)[0], schlecht = [...ms].sort((x, y) => x.e - y.e)[0];
  const tage = P.monate.reduce((t, k) => t + tageImMonat(k), 0);
  const gr = a.groesste;
  const fakten = [
    ['Monate im Plus', `${ms.filter((x) => x.e >= 0).length} von ${ms.length}`, { springe: '#k5-tab' }],
    ['Bester Monat', `${monKurz(best.k)} <span class="pos">${plusMinus(best.e)}</span>`, zuBuchungen(monatZiel(best.k))],
    ['Schwächster Monat', `${monKurz(schlecht.k)} <span class="neg">${plusMinus(schlecht.e)}</span>`, zuBuchungen(monatZiel(schlecht.k))],
    ['Ausgaben pro Tag', `Ø ${eur0(a.aus / tage)}`, { tab: 'uebersicht', kart: 'aus', wahl: '' }],
    ['Größte Einzelausgabe', gr ? `${eur0(-gr.c)} <small>${esc((gr.g || gr.z || '').slice(0, 22))}, ${dde(gr.d)}</small>` : '–', gr ? zuBuchungen({ q: gr.g ? `"${gr.g}"` : '', ...monatZiel(gr.d.slice(0, 7)), art: 'aus' }) : null],
  ];
  if (P.jahr === +D.bis.slice(0, 4) && P.monate.length < 12) {
    const restM = 12 - P.monate.length, jahrErg = a.erg + restM * R.erg;
    fakten.push([`Hochrechnung ${P.jahr}`, `<span class="${jahrErg >= 0 ? 'pos' : 'neg'}">≈ ${plusMinus(jahrErg)}</span> <small>bisher ${plusMinus(a.erg)} + ${restM} normale Monate</small>`, { tab: 'start' }]);
  } else if (P.jahr && P.monate.length < 12) fakten.push(['Datenbasis', `${P.monate.length} Monate <small>Daten ab ${monLang(P.monate[0])}</small>`, null]);
  else fakten.push(['Normaler Monat ab jetzt', `<span class="${R.erg >= 0 ? 'pos' : 'neg'}">${plusMinus(R.erg)}</span> <small>mit dem aktuellen Gehalt ${eur0(R.gehalt)}</small>`, { tab: 'start' }]);
  const leiste = `<div class="fl">${fakten.map(([t, w, ziel]) => `<${ziel ? 'button' : 'div'} class="card fl-z"${ziel ? (ziel.springe ? ` data-springe="${ziel.springe}"` : geh(ziel)) : ''} title="Anklicken: Einzelheiten"><span>${t}</span><b>${w}</b></${ziel ? 'button' : 'div'}>`).join('')}</div>`;

  // Tabelle aller Monate (aufklappbar)
  const z = (c) => (c ? eur0(c) : '<span class="muted">–</span>');
  const tabelle = `<table class="t3"><thead><tr><th>Monat</th><th class="r">Einnahmen</th><th class="r sp-m">davon Gehalt</th><th class="r">Ausgaben</th><th class="r sp-m">davon fest</th><th class="r">Ergebnis</th></tr></thead>
    <tbody>${P.monate.map((k) => { const m = a.mon.get(k), e = m.ein - m.aus; return `<tr class="klick"${geh(zuBuchungen(monatZiel(k)))}><td>${monLang(k)}</td><td class="r">${z(m.ein)}</td><td class="r muted sp-m">${z(m.lohn)}</td><td class="r">${z(m.aus)}</td><td class="r muted sp-m">${z(m.fix)}</td><td class="r ${e >= 0 ? 'pos' : 'neg'}"><b>${plusMinus(e)}</b></td></tr>`; }).join('')}</tbody>
    <tfoot><tr><td>Ø je Monat</td><td class="r">${eur0(a.ein / a.n)}</td><td class="r sp-m">${eur0(a.lohn / a.n)}</td><td class="r">${eur0(a.aus / a.n)}</td><td class="r sp-m">${eur0(a.fix / a.n)}</td><td class="r ${a.erg >= 0 ? 'pos' : 'neg'}">${plusMinus(a.erg / a.n)}</td></tr></tfoot></table>`;

  box.innerHTML = kopf5('Kennzahlen', satz, rechts) + `<div class="s5-zahlen">${zahlen}</div>
    <div class="s5-raster k5">
      ${karte5('Dein Durchschnittsmonat', `Ø je Monat ${P.label}${v ? ', daneben dasselbe Zeitfenster ein Jahr früher' : ''} · Zeile anklicken: Einzelheiten`, durchschnitt + RUNDUNG, 's5-b2')}
      ${karte5('Was sich verändert hat', v ? 'Ausgaben je Monat ggü. dem Vorjahr, größte Veränderungen zuerst · anklicken: Einzelheiten' : '', veraendert)}
      ${karte5('Monat für Monat', `Grün = Einnahmen, orange = Ausgaben, darunter das Ergebnis des Monats. Gestrichelt: dein aktuelles Gehalt (${eur0(R.gehalt)}). Säule anklicken: Buchungen.`, '<div class="s5-chart fuell"><canvas id="c-k5-monate"></canvas></div>', 's5-b2')}
      ${karte5('Jahr für Jahr', 'Ø je Monat · anklicken: dieses Jahr anzeigen', jahrTab)}
    </div>
    ${leiste}
    <details class="card s5-details" id="k5-tab"><summary>Alle Monate als Tabelle <span class="muted">· Zeile anklicken: Buchungen des Monats</span></summary><div class="t3-rahmen">${tabelle}</div></details>`;
  freiFuellen(box);
  gehBinden(box);
  kennzahlenBinden(box);
  k5MonateZeichnen(P, a, R);
}
function kennzahlenBinden(box) { box.querySelectorAll('[data-zeit]').forEach((b) => b.onclick = () => setze({ jahr: b.dataset.zeit, monat: '' })); }

// Säulenpaare Einnahmen/Ausgaben je Monat mit dem Ergebnis darunter und dem aktuellen Gehalt als Linie (ohne Zahlen an den Säulen – die stehen im Tooltip)
function k5MonateZeichnen(P, a, R) {
  const ks = P.monate, ein = ks.map((k) => a.mon.get(k).ein / 100), aus = ks.map((k) => a.mon.get(k).aus / 100);
  const cE = css('--ein'), cA = css('--aus');
  const o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.layout = { padding: { top: 8 } };
  o.scales = {
    x: { ...achsenStil(), grid: { display: false }, ticks: { ...achsenStil().ticks, padding: 20, font: { size: 11.5 }, maxRotation: 0 } },
    y: { ...achsenStil(), beginAtZero: true, ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 5 } },
  };
  o.plugins.tooltip.callbacks = { title: (it) => monLang(ks[it[0].dataIndex]), label: (it) => ` ${it.dataset.label}: ${EUR0.format(it.raw)}`, footer: (it) => { const i = it[0].dataIndex; const e = ein[i] - aus[i]; return `${e >= 0 ? 'Überschuss' : 'Fehlbetrag'}: ${EUR0.format(e)}`; } };
  o.onClick = (_, el) => { if (el.length) setze(zuBuchungen(monatZiel(ks[el[0].index]))); };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; };
  zeichne('c-k5-monate', {
    type: 'bar',
    data: { labels: ks.map(monKurz), datasets: [
      { label: 'Einnahmen', data: ein, backgroundColor: alpha(cE, 0.85), hoverBackgroundColor: cE, borderRadius: 4, maxBarThickness: 26, categoryPercentage: 0.72, barPercentage: 0.9 },
      { label: 'Ausgaben', data: aus, backgroundColor: alpha(cA, 0.85), hoverBackgroundColor: cA, borderRadius: 4, maxBarThickness: 26, categoryPercentage: 0.72, barPercentage: 0.9 },
    ] },
    options: o,
    plugins: [linieMit('gehalt', R.gehalt / 100, `Gehalt aktuell ${eur0(R.gehalt)}`, css('--ein-text')), ergebnisZeileMit(ein.map((x, i) => x - aus[i]))],
  });
}

// ---------------------------------------------------------------- Kategorien: Wofür geht mein Geld?
// Ausgaben in zwei Blöcken: überwiegend feste Kosten (mindestens die Hälfte sind Verträge) und frei gestaltbare – dort
// lässt sich am ehesten sparen. Einnahmen: Gehalt und sonstige. Rechts die Einzelheiten der gewählten Kategorie.
let kat2Grafik = null;
// Kopf rechts im Reiter Kategorien: Ausgaben / Einnahmen / Reisen / Prüfen, dazu Konten und Zeitraum (ohne P nur die Auswahl –
// Reisen gelten für alle Jahre und alle eigenen Konten)
function katRechts(P = null) {
  const nP = offenZahl(D), an = (k) => (k === (['ein', 'tags', 'pruefen'].includes(S.kart) ? S.kart : 'aus') ? 'an' : '');
  return `<div class="seg" role="group" aria-label="Ausgaben, Einnahmen, Reisen oder Prüfen"><button data-k2art="aus" class="${an('aus')}">Ausgaben</button><button data-k2art="ein" class="${an('ein')}">Einnahmen</button><button data-k2art="tags" class="${an('tags')}" title="Reisen und Projekte aus deinen Finanzguru-Tags">Reisen</button><button data-k2art="pruefen" title="Buchungen ohne passende Kategorie ansehen und selbst einordnen">Prüfen${nP ? ` <small class="pr-zahl">${NUM.format(nP)}</small>` : ''}</button></div>${P ? `${kontoWahlHtml()}${zeitSeg(P)}` : ''}`;
}
function tabKategorien() {
  // Prüfen bringt die Auswahl selbst mit (pruefen.js) – dort fehlt nur der Knopf „Reisen“
  if (S.kart === 'pruefen') return pruefenSeite(pruefHelfer()).replace('<button data-k2art="pruefen" class="an">', '<button data-k2art="tags" title="Reisen und Projekte aus deinen Finanzguru-Tags">Reisen</button><button data-k2art="pruefen" class="an">');
  if (S.kart === 'tags') { kat2Grafik = null; return sicher(() => reisenSeite(H, katRechts())) || kopf5('Reisen und Projekte', 'Die Reisen konnten nicht berechnet werden.', katRechts()); }
  const P = periode(), aus = S.kart !== 'ein';
  const rechts = katRechts(P);
  if (!P.monate.length) { kat2Grafik = null; return kopf5('Kategorien', 'In diesem Jahr ist noch kein Monat abgeschlossen.', rechts); }
  const a = sammle(P.monate, aus ? 'aus' : 'ein'), v = P.vor.length ? sammle(P.vor, aus ? 'aus' : 'ein') : null;
  const liste = [...a.g.values()].filter((x) => x.c > 0).sort((x, y) => y.c - x.c);
  const ges = liste.reduce((t, x) => t + x.c, 0);
  if (!liste.length) { kat2Grafik = null; return kopf5('Kategorien', 'Keine Buchungen in diesem Zeitraum.', rechts); }
  const anteil = (c) => Math.round((c / ges) * 100);
  const vorM = (x) => (v ? (v.g.get(x.k)?.c || 0) / v.n : null), dM = (x) => (v ? x.c / a.n - vorM(x) : null);
  const zeit = zeitZiel(P.monate), alleZiel = zuBuchungen({ art: aus ? 'aus' : 'ein', ...zeit });
  const fx = fixIds();
  for (const x of liste) x.fest = aus ? x.rows.filter((r) => fx.has(r.i)).reduce((t, r) => t - r.c, 0) : 0;
  const top = liste.slice(0, 3).map((x) => `${zl(`<b>${esc(schoen(x.k))}</b>`, { wahl: x.k })} (${anteil(x.c)} %)`);
  const verb = top.length > 1 ? `${top.slice(0, -1).join(', ')} und ${top.at(-1)}` : top[0];
  const gesZ = zl(`<b>${eur0(ges / a.n)}</b>`, alleZiel);
  let satz = P.hinweis + (aus ? `${P.label[0].toUpperCase()}${P.label.slice(1)} gingen im Schnitt ${gesZ} im Monat raus – am meisten für ${verb}.`
    : `${P.label[0].toUpperCase()}${P.label.slice(1)} kamen im Schnitt ${gesZ} im Monat herein – vor allem aus ${verb}.`);
  let s2 = null;
  if (v) {
    s2 = [...liste].filter((x) => Math.abs(dM(x)) >= 3000).sort((x, y) => (aus ? dM(y) - dM(x) : dM(x) - dM(y)))[0];
    if (s2 && (aus ? dM(s2) > 0 : dM(s2) < 0)) satz += ` Am stärksten ${aus ? 'gestiegen' : 'gesunken'}: ${zl(`<b>${esc(schoen(s2.k))}</b>`, { wahl: s2.k })} (<span class="neg">${plusMinus(dM(s2))}</span> im Monat ggü. Vorjahr).`;
    else s2 = null;
  }

  // Blöcke
  const bloecke = aus
    ? [{ titel: 'Überwiegend feste Kosten', erkl: 'mindestens die Hälfte sind Verträge: Unterhalt, Miete, Versicherungen … – kurzfristig kaum veränderbar', farbe: 'var(--fest)', l: liste.filter((x) => x.fest >= x.c * 0.5) },
      { titel: 'Frei gestaltbar', erkl: 'Einkauf, Freizeit, Anschaffungen … – hier lässt sich am ehesten sparen', farbe: 'var(--variabel)', l: liste.filter((x) => x.fest < x.c * 0.5) }]
    : [{ titel: 'Gehalt', erkl: 'Auszahlung aufs Konto vom Arbeitgeber', farbe: 'var(--ein)', l: liste.filter((x) => x.k === 'Lohn / Gehalt') },
      { titel: 'Sonstige Einnahmen', erkl: 'Erstattungen, Zinsen, Kapitalerträge, Steuern …', farbe: 'color-mix(in srgb, var(--ein) 55%, var(--surface))', l: liste.filter((x) => x.k !== 'Lohn / Gehalt') }];
  const festS = aus ? bloecke[0].l.reduce((t, x) => t + x.c, 0) : 0, freiS = aus ? ges - festS : 0;

  const vgesamt = v ? [...v.g.values()].reduce((t, x) => t + Math.max(0, x.c), 0) / v.n : null;
  const zahlen = aus ? [
    zahl5('Ausgaben im Monat', eur0(ges / a.n), `Ø ${esc(monatsText(P.monate))}${vgesamt != null ? ` · Vorjahr ${eur0(vgesamt)}` : ''}`, { cls: 'neg', ziel: alleZiel }),
    zahl5('Davon überwiegend fest', eur0(festS / a.n), `${Math.round((festS / ges) * 100)} % · ${bloecke[0].l.length} Kategorien · Liste ↓`, { springe: '#kb-0' }),
    zahl5('Davon frei gestaltbar', eur0(freiS / a.n), `${Math.round((freiS / ges) * 100)} % · ${bloecke[1].l.length} Kategorien · Liste ↓`, { springe: '#kb-1' }),
    s2 ? zahl5('Am stärksten gestiegen', esc(schoen(s2.k)), `${plusMinus(dM(s2))} im Monat ggü. Vorjahr`, { cls: 'neg', ziel: { wahl: s2.k } })
      : zahl5('Größter Posten', esc(schoen(liste[0].k)), `${eur0(liste[0].c / a.n)} im Monat · ${anteil(liste[0].c)} %`, { ziel: { wahl: liste[0].k } }),
  ].join('') : [
    zahl5('Einnahmen im Monat', eur0(ges / a.n), `Ø ${esc(monatsText(P.monate))}${vgesamt != null ? ` · Vorjahr ${eur0(vgesamt)}` : ''}`, { cls: 'pos', ziel: alleZiel }),
    zahl5('Davon Gehalt', eur0(bloecke[0].l.reduce((t, x) => t + x.c, 0) / a.n), `${Math.round((bloecke[0].l.reduce((t, x) => t + x.c, 0) / ges) * 100)} % der Einnahmen`, { ziel: { wahl: 'Lohn / Gehalt' } }),
    zahl5('Davon sonstige', eur0(bloecke[1].l.reduce((t, x) => t + x.c, 0) / a.n), `${bloecke[1].l.length} Quellen · Liste ↓`, { springe: '#kb-1' }),
    zahl5('Größte sonstige Quelle', bloecke[1].l[0] ? esc(schoen(bloecke[1].l[0].k)) : '–', bloecke[1].l[0] ? `${eur0(bloecke[1].l[0].c / a.n)} im Monat` : '', bloecke[1].l[0] ? { ziel: { wahl: bloecke[1].l[0].k } } : {}),
  ].join('');

  const wahl = liste.find((x) => x.k === S.wahl) || liste[0];
  const max = Math.max(liste[0].c / a.n, ...liste.map((x) => vorM(x) || 0));
  const dZelle = (d) => `<span class="kl-d ${d == null || Math.abs(d) < 1000 ? 'muted' : (d > 0) === aus ? 'neg' : 'pos'}">${d == null ? '' : Math.abs(d) < 1000 ? '≈' : plusMinus(d)}</span>`;
  const zeile = (x) => {
    const vm = vorM(x);
    // größter Posten der Kategorie (Unterkategorie bzw. bei Einnahmen der Absender), damit klar ist, was z. B. in „Finanzen“ steckt
    const [tn, tc] = aus ? [...x.unter].sort((p, q) => q[1] - p[1])[0] || [] : ([...x.empf].sort((p, q) => q[1].c - p[1].c)[0] || []).map((y, i) => (i ? y.c : y));
    const sub = tn && norm(tn) !== norm(x.k) && x.g !== 1 ? `v. a. ${esc(schoen(tn))}${tc < x.c * 0.995 ? ` (${Math.round((tc / x.c) * 100)} %)` : ''}` : '';
    return `<button class="vg-z kz kl-z${x === wahl ? ' an' : ''}" data-k2kat="${esc(x.k)}" title="${esc(schoen(x.k))}: Ø ${eur0(x.c / a.n)} im Monat${vm != null ? ` · Vorjahr ${eur0(vm)}` : ''}${aus ? ` · ${Math.round((x.fest / x.c) * 100)} % Verträge` : ''} – anklicken: Einzelheiten">
      <span class="vg-zn">${esc(schoen(x.k))}${sub ? `<small>${sub}</small>` : ''}</span>
      <span class="kl-b"><i style="width:${Math.max(1, (x.c / a.n / max) * 100)}%"></i>${vm ? `<b style="left:${(vm / max) * 100}%"></b>` : ''}</span>
      <b class="vg-zw">${eur0(x.c / a.n)}</b><span class="vg-zp">${anteil(x.c)} %</span>${dZelle(dM(x))}</button>`;
  };
  const block = (b, i) => {
    if (!b.l.length) return '';
    const s = b.l.reduce((t, x) => t + x.c, 0), sv = v ? b.l.reduce((t, x) => t + (vorM(x) || 0), 0) : null;
    return `<section class="vg kb" id="kb-${i}" style="--vg:${b.farbe}">
      <div class="vg-k kz"><span class="vg-n"><b>${b.titel}</b><small>${b.erkl}</small></span><span></span><b class="vg-w">${eur0(s / a.n)}</b><span class="vg-p">${anteil(s)} %</span>${dZelle(sv == null ? null : s / a.n - sv)}</div>
      <div class="vg-l">${b.l.map(zeile).join('')}</div></section>`;
  };
  const listeHtml = `<div class="vgs"><div class="vg-kopf kz"><span>${aus ? 'Kategorie' : 'Herkunft'}</span><span>${v ? 'Strich = Vorjahr' : ''}</span><span>Ø / Monat</span><span>Anteil</span><span>${v ? 'ggü. Vorjahr' : ''}</span></div>
    ${bloecke.map(block).join('')}
    <button class="vg-summe kz kl-summe"${geh(alleZiel)} title="Anklicken: alle Buchungen im Zeitraum"><span>Summe</span><span></span><b>${eur0(ges / a.n)}</b><span>100 %</span>${dZelle(vgesamt == null ? null : ges / a.n - vgesamt)}</button></div>`;

  // Einzelheiten der gewählten Kategorie
  const wd = dM(wahl), wv = vorM(wahl);
  const unter = [...(aus ? wahl.unter : new Map())].filter(([, c]) => c > 0).sort((x, y) => y[1] - x[1]);
  const empf = [...wahl.empf].filter(([, x]) => x.c > 0).sort((x, y) => y[1].c - x[1].c).slice(0, 5);
  // Einnahmen sind nur nach Unterkategorie gruppiert (Steuererstattung z. B. unter „Finanzen“) – also ohne Hauptkategorie filtern
  const katZiel = (z) => zuBuchungen(aus ? { art: 'aus', kat: wahl.k, ...z } : { art: 'ein', ...einFilter(wahl.k), ...z });
  kat2Grafik = { monate: P.monate, werte: P.monate.map((k) => (wahl.mon.get(k) || 0) / 100), schnitt: wahl.c / a.n / 100, aus, ziel: (k) => katZiel(monatZiel(k)) };
  const festAnteil = aus ? wahl.fest / wahl.c : 0;
  const jahrWert = (wahl.c / a.n) * 12;
  const stat = (t, w, cls_ = '') => `<div><span>${t}</span><b class="${cls_}">${w}</b></div>`;
  const tipp = aus ? (festAnteil >= 0.5 ? `${Math.round(festAnteil * 100)} % davon sind feste Verträge (Unterhalt, Versicherungen …) – kurzfristig kaum veränderbar.`
    : `10 % weniger brächten dir ${eur0(jahrWert * 0.1)} im Jahr.`) : '';
  const detail = `<section class="card s5-karte kl-detail">
    <div class="kl-d-kopf"><h2>${esc(schoen(wahl.k))}</h2>${zl('Alle Buchungen →', katZiel(zeit))}</div>
    <div class="kd-stats">
      ${stat('Ø im Monat', eur0(wahl.c / a.n))}
      ${stat('Anteil', `${anteil(wahl.c)} %`)}
      ${stat(P.jahr === +D.bis.slice(0, 4) && P.monate.length < 12 ? `Hochrechnung ${P.jahr}` : 'aufs Jahr (Ø × 12)', `≈ ${eur0(jahrWert)}`)}
      ${stat('ggü. Vorjahr', wd == null ? '–' : Math.abs(wd) < 1000 ? '≈ gleich' : plusMinus(wd), wd == null || Math.abs(wd) < 1000 ? '' : (wd > 0) === aus ? 'neg' : 'pos')}
    </div>
    <p class="s5-erkl">${eur0(wahl.c)} ${P.label} · ${NUM.format(wahl.rows.length)} Buchungen${wv != null ? ` · Vorjahr Ø ${eur0(wv)}` : ''}${tipp ? ` · ${tipp}` : ''}</p>
    <div class="s5-chart klein fuell"><canvas id="c-kat2"></canvas></div>
    <div class="kl-d-grid">
      ${unter.length > 1 ? `<div class="s5-teil"><h3>Wofür genau</h3>${balkenListe(unter.slice(0, 6).map(([u, c]) => ({ n: esc(schoen(u)), c: c / a.n, p: `${Math.round((c / wahl.c) * 100)} %`, farbe: aus ? 'var(--variabel)' : 'var(--ein)', ziel: zuBuchungen({ art: 'aus', kat: wahl.k, ukat: u === 'ohne Unterkategorie' ? '' : u, ...zeit }) })))}</div>` : ''}
      <div class="s5-teil"><h3>${aus ? 'An wen' : 'Von wem'}</h3>${balkenListe(empf.map(([e, x]) => ({ n: esc(e), sub: `${x.n} Buchungen`, c: x.c / a.n, p: `${Math.round((x.c / wahl.c) * 100)} %`, farbe: 'var(--muted)', ziel: katZiel({ q: `"${e}"`, ...zeit }) })))}</div>
    </div>
  </section>`;

  // Monat für Monat je Kategorie (aufklappbar; ältere Monate fallen auf schmalen Bildschirmen weg)
  const nM = P.monate.length;
  const reihen = liste.map((x) => {
    const schnitt = x.c / a.n;
    return `<tr${x === wahl ? ' class="an"' : ''}><td class="t3-n">${esc(schoen(x.k))}</td>${P.monate.map((k, i) => { const c = x.mon.get(k) || 0; return `<td class="r${i < nM - 3 ? ' m-alt' : ''}${c > schnitt * 1.6 && c - schnitt > 5000 ? ' hoch' : ''}${c ? ' klick' : ''}"${c ? ` data-k2zelle="${esc(x.k)}|${k}"` : ''}>${c ? NUM.format(Math.round(c / 100)) : '<span class="muted">–</span>'}</td>`; }).join('')}<td class="r"><b>${NUM.format(Math.round(schnitt / 100))}</b></td></tr>`;
  }).join('');
  const monSum = P.monate.map((k) => liste.reduce((t, x) => t + (x.mon.get(k) || 0), 0));
  const tabelle = `<div class="t3-rahmen"><table class="t3 t3-eng"><thead><tr><th>${aus ? 'Kategorie' : 'Einnahme'}</th>${P.monate.map((k, i) => `<th class="r${i < nM - 3 ? ' m-alt' : ''}">${monKurz(k)}</th>`).join('')}<th class="r">Ø</th></tr></thead><tbody>${reihen}</tbody>
    <tfoot><tr><td>Summe</td>${monSum.map((c, i) => `<td class="r${i < nM - 3 ? ' m-alt' : ''}">${NUM.format(Math.round(c / 100))}</td>`).join('')}<td class="r">${NUM.format(Math.round(ges / a.n / 100))}</td></tr></tfoot></table></div>`;
  return kopf5('Kategorien', satz, rechts) + `<div class="s5-zahlen">${zahlen}</div><div class="kl${aus ? '' : ' ein'}">
    ${karte5(`${aus ? 'Ausgaben' : 'Einnahmen'} nach ${aus ? 'Kategorie' : 'Herkunft'}`, `Ø je Monat ${esc(monatsText(P.monate))} · Zeile anklicken: Einzelheiten rechts`, listeHtml + RUNDUNG, 'kl-liste')}
    ${detail}</div>
    ${aus ? sicher(() => rahmenKarte(H)) : ''}
    <details class="card s5-details"><summary>Monat für Monat je ${aus ? 'Kategorie' : 'Einnahme'} <span class="muted">· in Euro · rot: deutlich über dem eigenen Ø · Zahl anklicken: Buchungen</span></summary>${tabelle}</details>`;
}

// Helfer für js/pruefen.js
const pruefHelfer = () => ({ D: () => D, S: () => S, setze: (p) => setze(p), neuZeichnen: () => tabelle(parse(S.q)), neuAufbauen, toast, esc, eur, eur0, dde, NUM,
  kopf5, zahl5, geh, zuBuchungen, schoen, norm, herunterladen, alsExcel, DIENST, einlesen });

// Helfer für die Zusatzmodule (steuerprognose, unterhalt, fristen, waechter, planung, vermoegen) – D und S über Funktionen,
// damit H nach neuAufbauen() gültig bleibt
function modulHelfer() {
  return { D: () => D, S: () => S, setze, neuZeichnen: () => aktualisieren(), toast, esc, eur, eur0, dde, NUM, MON, MONAT, kopf5, karte5, zahl5, zl, zs, geh, gehBinden,
    balkenListe, freiFuellen, zuBuchungen, monatZiel, zeitZiel, mVor, mkey, monKurz, monLang, plusTage, monatsletzter, tageImMonat, heuteLokal, tagKurz, plusMinus, norm,
    fremd: (x) => fremd(typeof x === 'number' ? D.konten[x] : x), istGemeinsam, median, fixIds, fixkostenErkennen, faellig, ausstehend, naechsteRegulaer, zahltag,
    gehaltstag, vertragName, vertragsKey, monatsRechnung, verlauf5, lebenshaltung, sammle, periode, abgeschlosseneMonate, einkommen, kontenSumme, vollSumme, summeText,
    schoen, det: (r) => det(r, D.j), gruppenSchluessel, kvLesen: Q.kvLesen, kvSchreiben: Q.kvSchreiben, alsExcel, alsCsv, herunterladen, zeichne, basis, achsenStil,
    css, alpha, achse, kurzWert, schraffur, steuerSumme: abschnittSumme, kinder, ausgleichTags, fristQuellen: [prognoseFristen, unterhaltFristen] };
}

// Monatsbalken der gewählten Kategorie mit dem Durchschnitt als beschriftete Linie
function kat2Zeichnen() {
  if (!kat2Grafik || !$('#c-kat2')) return;
  const g = kat2Grafik, farbe = css(g.aus ? '--variabel' : '--ein');
  const o = basis();
  o.layout = { padding: { top: 16 } };
  o.plugins.tooltip.callbacks = { title: (it) => monLang(g.monate[it[0].dataIndex]), label: (it) => ` ${EUR0.format(it.raw)}` };
  o.scales = { x: { ...achsenStil(), grid: { display: false }, ticks: { ...achsenStil().ticks, maxRotation: 0, font: { size: 11 } } }, y: { ...achsenStil(), beginAtZero: true, ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 4 } } };
  o.onClick = (_, el) => { if (el.length) setze(g.ziel(g.monate[el[0].index])); };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; };
  zeichne('c-kat2', { type: 'bar', data: { labels: g.monate.map((k) => MON[+k.slice(5) - 1]), datasets: [{ data: g.werte, backgroundColor: alpha(farbe, 0.9), borderRadius: 3, maxBarThickness: 24 }] },
    options: o, plugins: [linieMit('schnitt', g.schnitt, `Ø ${EUR0.format(g.schnitt)}`, css('--text-2')), saeulenWerteMit({ groesse: 9.5 })] });
}

// ---------------------------------------------------------------- Konten: Wie viel habe ich wo?
// Alle Konten in einer Liste, nach Zweck gruppiert: was du ausgeben kannst, Kreditkarte, Gebundenes – und zur
// Information die gemeinsamen Konten mit Kathrin und die der Kinder (zählen in keiner Summe).
const KONTO_GRUPPEN = [
  { id: 'frei', titel: 'Zum Ausgeben', erkl: 'Girokonten und Zahlungsdienste – zählen in deinen Summen', test: (k) => !fremd(k) && !/kaution|easybank|barclays|visa|kredit/i.test(k.name) },
  { id: 'karte', titel: 'Kreditkarte', erkl: 'minus = offener Betrag, wird vom Girokonto ausgeglichen', test: (k) => !fremd(k) && /easybank|barclays|visa|kredit/i.test(k.name) },
  { id: 'gebunden', titel: 'Gebunden', erkl: 'gehört dir, ist aber nicht frei verfügbar', test: (k) => !fremd(k) && /kaution/i.test(k.name) },
  { id: 'gemeinsam', titel: 'Gemeinsam mit Kathrin', erkl: 'zählt nicht mit – bei dir zählen nur deine Einzahlungen dorthin', test: (k) => k.gemeinsam, fremd: true },
  { id: 'kinder', titel: 'Konten der Kinder', erkl: 'zählt nicht mit – nur zur Information', test: (k) => k.kind, fremd: true },
];
let kontenGrafik = null;
function tabKonten() {
  const tag = stichtag(), ks = kontoSet(), drin = (i) => !ks || ks.has(i);
  const amTag = kontostaende(D, tag);
  const offen = amTag.filter((x) => !['nicht_eroeffnet', 'geschlossen'].includes(x.status));
  const stand = offen.filter((x) => !fremd(x.k));
  const vj = +D.bis.slice(0, 4) - 1;
  const schnell = [[D.bis, 'Heute'], [`${vj}-12-31`, `31.12.${vj}`], [`${vj - 1}-12-31`, `31.12.${vj - 1}`]];
  const rechts = `${kontoWahlHtml()}<div class="kon5-tag"><label for="stichtag" class="muted klein">Stand am</label><input type="date" id="stichtag" value="${tag}" min="${D.von}" max="${D.bis}">
    <div class="seg">${schnell.map(([d, t]) => `<button class="${d === tag ? 'an' : ''}" data-st="${d}">${t}</button>`).join('')}</div></div>`;
  const m = stand.filter((x) => x.status !== 'unbekannt');
  const unbekannt = offen.filter((x) => x.status === 'unbekannt');
  // Verlauf (24 Monatsenden) schon hier, damit die Erklärung Lücken nennen kann
  const vTage = [];
  { let [y, mo] = D.bis.slice(0, 7).split('-').map(Number); for (let i = 0; i < 24; i++) { const d = monatsletzter(`${mkey(y, mo)}-01`); vTage.unshift(d > D.bis ? D.bis : d); if (--mo === 0) { mo = 12; y--; } } }
  kontenGrafik = { tag, tage: vTage, summen: vTage.map((d) => kontenSumme(d, ks)) };
  if (!m.length) return kopf5('Konten', 'Am gewählten Tag gab es keine passenden Konten.', rechts) + eingangHtml();
  const jb = `${+tag.slice(0, 4) - 1}-12-31`, jbTag = jb < D.von ? D.von : jb;
  const anfang = new Map(kontostaende(D, jbTag).map((x) => [x.i, x.c]));
  const gew = m.filter((x) => drin(x.i) && x.c != null);
  // Summen der (gewählten) eigenen Konten – unvollständig, wenn ein Konto an dem Tag nicht berechenbar ist; dann keine Veränderung
  const sT = summeKonten(amTag.filter((x) => !fremd(x.k) && drin(x.i))), sJb = kontenSumme(jbTag, ks);
  const saldo = sT.c, seitJb = diffSumme(sJb, sT), offenZ = sT.voll ? '' : ' + ?';
  const kaution = gew.filter((x) => /kaution/i.test(x.k.name)).reduce((t, x) => t + x.c, 0);
  const heute = tag === D.bis, V = heute && !ks ? verlauf5() : null, ende = V?.monate.at(-1);
  const kautionK = gew.find((x) => /kaution/i.test(x.k.name));
  // Buchungen zum angeklickten Zeitraum: ganzes Jahr nur bei Stichtag heute oder 31.12., sonst Januar bis zum Monat des Stichtags
  const bisM = tag.slice(0, 7), ganzJahr = tag === D.bis || tag.slice(5) === '12-31';
  const zeitJb = ganzJahr ? { jahr: tag.slice(0, 4), monat: '' } : { zr: `${tag.slice(0, 4)}-01_${bisM}` }, jahrZiel = zuBuchungen(zeitJb);
  let satz = `Am ${dde(tag)} liegen auf ${ks ? 'den gewählten Konten' : 'deinen Konten'} ${zs(`<b class="${saldo < 0 ? 'neg' : ''}">${summeText(sT)}</b>`, '.kon5 .ko')}${sT.voll ? '' : ` – ${esc(fehltText(sT))}`}${kaution ? ` – davon ${zl(`${eur0(kaution)} Mietkaution`, zuBuchungen({ konto: kautionK.k.name }))}, frei verfügbar also <b class="${saldo - kaution < 0 ? 'neg' : ''}">${eur0(saldo - kaution)}${offenZ}</b>` : ''}.`;
  if (tag.slice(5) !== '12-31' && seitJb != null) satz += ` Seit Jahresbeginn ${zl(`<b class="${seitJb >= 0 ? 'pos' : 'neg'}">${plusMinus(seitJb)}</b>`, jahrZiel)}.`;
  if (ende?.stand != null) satz += ` Läuft alles so weiter wie geplant, sind es Ende ${MONAT[+ende.k.slice(5) - 1]} etwa ${zl(`<b class="${ende.stand < 0 ? 'neg' : ''}">${eur0(ende.stand)}</b>`, { tab: 'start' })}.`;
  const zahlen = [
    zahl5(heute ? 'Heute auf den Konten' : `Stand ${dde(tag)}`, summeText(sT), !sT.voll ? esc(fehltText(sT)) : `${ks ? `${gew.length} gewählte Konten` : 'ohne Depot, gemeinsame und Kinderkonten · je Konto ↓'}${summeHinweis(sT) ? ` · ${summeHinweis(sT)}` : ''}`, { cls: saldo < 0 ? 'neg' : '', springe: '.kon5 .ko' }),
    zahl5('Frei verfügbar', `${eur0(saldo - kaution)}${offenZ}`, kaution ? `ohne Mietkaution (${eur0(kaution)}) · Kautionskonto →` : 'keine Kaution gebunden', { cls: saldo - kaution < 0 ? 'neg' : '', ...(kaution ? { ziel: zuBuchungen({ konto: kautionK.k.name }) } : { springe: '.kon5 .ko' }) }),
    zahl5(`Seit 1. Januar ${tag.slice(0, 4)}`, seitJb == null ? '–' : plusMinus(seitJb), seitJb == null ? `nicht berechenbar: ${esc(fehltText(sJb && !sJb.voll ? sJb : sT))}` : `Stand 31.12.: ${summeText(sJb)} · ${ganzJahr ? `Buchungen ${tag.slice(0, 4)}` : `Buchungen Jan–${MON[+bisM.slice(5) - 1]} ${tag.slice(0, 4)}`} →`, { cls: seitJb == null ? '' : seitJb >= 0 ? 'pos' : 'neg', ziel: jahrZiel }),
    ende ? zahl5(`Prognose Ende ${MONAT[+ende.k.slice(5) - 1]}`, ende.stand == null ? '–' : `≈ ${eur0(ende.stand)}`, ende.stand == null ? 'nicht berechenbar: der Stand heute ist unvollständig' : `wenn alles läuft wie ein normaler Monat (${pmHtml(V.R.erg)})`, { cls: ende.stand < 0 ? 'neg' : '', ziel: { tab: 'start' } })
      : zahl5('Konten', NUM.format(gew.length), unbekannt.length ? `${unbekannt.length} ohne Daten für diesen Tag` : 'mit Daten zu diesem Tag', { springe: '.kon5 .ko' }),
  ].join('');

  // Letzte Buchung je Konto (bis zum Stichtag)
  const letzte = new Map();
  for (const r of D.rows) if (r.d <= tag && (!letzte.has(r.k) || r.d > letzte.get(r.k))) letzte.set(r.k, r.d);
  const maxC = Math.max(1, ...offen.filter((x) => x.status !== 'unbekannt').map((x) => Math.abs(x.c || 0)));
  const fragezeichen = (tip) => `<span class="muted" role="button" tabindex="0" title="${esc(tip)}" data-tipp="${esc(tip)}">?</span>`;
  const zeile = (x, g) => {
    const a0 = anfang.get(x.i), d = x.c != null && a0 != null ? x.c - a0 : null;
    const zusatz = { geschaetzt: 'geschätzt', ungefaehr: `± ${eur0(Math.round((x.abw || 0) * 100))}`, ruhend: `ruht · Stand ${dde(x.seit || '')}` }[x.status];
    const wert = x.status === 'unsicher' ? fragezeichen(STATUS_TEXT.unsicher) : `${zusatz && x.status !== 'ruhend' ? '≈ ' : ''}${eur0(x.c)}`;
    const unter = [x.k.vollstaendig ? '✓ lückenlos' : `Daten ab ${dde(x.k.von).slice(3)}`, letzte.has(x.i) ? `letzte Buchung ${dde(letzte.get(x.i)).slice(0, 6)}` : '', zusatz].filter(Boolean).join(' · ');
    return `<button class="vg-z ko-z${g.fremd || drin(x.i) ? '' : ' aus'}${x.c < 0 ? ' minus' : ''}"${geh(zuBuchungen({ konto: x.k.name, ...zeitJb }))} title="Anklicken: Buchungen von ${esc(x.k.name)}">
      <span class="vg-zn">${esc(x.k.name)}<small>${esc(unter)}</small></span>
      <span class="ko-b"><i style="width:${Math.max(0.5, (Math.abs(x.c || 0) / maxC) * 100)}%"></i></span>
      <b class="vg-zw ${x.c < 0 ? 'neg' : ''}">${wert}</b><span class="vg-zp ${d == null || g.fremd ? 'muted' : d >= 0 ? 'pos' : 'neg'}">${d == null ? '–' : plusMinus(d)}</span></button>`;
  };
  const gruppen = KONTO_GRUPPEN.map((g) => {
    const l = offen.filter((x) => x.status !== 'unbekannt' && g.test(x.k)).sort((a, b) => (b.c ?? -1e12) - (a.c ?? -1e12));
    if (!l.length) return '';
    // fehlt ein Konto (auch eines ohne Daten für diesen Tag, das unten genannt wird), steht wie bei ihm ein „?“
    const gs = summeKonten(offen.filter((x) => g.test(x.k) && (g.fremd || drin(x.i))));
    const farbe = g.fremd ? 'var(--muted)' : g.id === 'frei' ? 'var(--accent)' : g.id === 'karte' ? 'var(--aus)' : 'color-mix(in srgb, var(--accent) 45%, var(--surface))';
    return `<section class="vg kg${g.fremd ? ' fremd' : ''}" id="kg-${g.id}" style="--vg:${farbe}">
      <div class="vg-k"><span class="vg-n"><b>${g.titel}</b><small>${g.erkl}</small></span><span class="vg-b leer"></span><b class="vg-w ${gs.voll && gs.c < 0 ? 'neg' : ''}">${gs.voll ? summeText(gs) : fragezeichen(`${eur0(gs.c)} ${fehltText(gs)}`)}</b><span class="vg-p">${l.length} ${l.length === 1 ? 'Konto' : 'Konten'}</span></div>
      <div class="vg-l">${l.map((x) => zeile(x, g)).join('')}</div></section>`;
  }).join('');

  // Monatsenden: Summe aller (gewählten) eigenen Konten an diesem Tag und die Veränderung zum Vormonat
  const enden = [];
  { let [y, mo] = tag.slice(0, 7).split('-').map(Number); for (let i = 0; i < 13; i++) { if (--mo === 0) { mo = 12; y--; } const d = monatsletzter(`${mkey(y, mo)}-01`); if (d >= D.von) enden.unshift(d); } }
  const st = enden.map((d) => kontostaende(D, d));
  const sumAm = (l) => summeKonten(l.filter((x) => !fremd(x.k) && drin(x.i)));
  const reihe = [...enden.map((d, i) => ({ d, s: sumAm(st[i]) })), { d: tag, s: sT, jetzt: true }];
  const diffHtml = (d, nach = '') => (d == null ? `<span class="muted" title="nicht berechenbar: an einem der beiden Tage fehlt ein Konto">–</span>` : `<span class="${d >= 0 ? 'pos' : 'neg'}">${plusMinus(d)}${nach}</span>`);
  const monatsenden = `<div class="me">${reihe.slice(1).reverse().map((x, i) => {
    const vor = reihe[reihe.length - 2 - i];
    return `<button class="me-z${i >= 6 ? ' fuell-aus' : ''}"${i >= 6 ? ` data-fuell="${i}" data-stopp` : ''} data-st="${x.d}" title="${x.s.voll ? 'Anklicken: Kontostände an diesem Tag' : esc(`Unvollständig: ${fehltText(x.s)} – anklicken: Kontostände an diesem Tag`)}"><span>${x.jetzt ? (heute ? 'heute' : dde(x.d).slice(0, 6)) : `Ende ${monKurz(x.d.slice(0, 7))}`}</span><b class="${x.s.c < 0 ? 'neg' : ''}">${summeText(x.s)}</b>${diffHtml(diffSumme(vor.s, x.s))}</button>`;
  }).join('')}</div>`;
  // Verteilung nach Zweck und größte Bewegungen des Monats – nur wenn neben der Kontenliste Platz ist.
  // Gruppen aus allen eigenen Konten (auch ohne Daten für diesen Tag), damit sie dieselbe Lücke melden wie die Summe oben;
  // Anteile und Balken nur, wenn jede Gruppe vollständig ist – sonst wären die Prozente aus einem Teil gerechnet.
  const gruppenSumme = KONTO_GRUPPEN.filter((g) => !g.fremd).map((g) => ({ g, s: summeKonten(stand.filter((x) => drin(x.i) && g.test(x.k))) })).map((x) => ({ ...x, c: x.s.c })).filter((x) => x.c || !x.s.voll);
  const alleVoll = gruppenSumme.every((x) => x.s.voll);
  const positiv = alleVoll ? gruppenSumme.filter((x) => x.c > 0) : [], posS = positiv.reduce((t, x) => t + x.c, 0) || 1;
  const gFarbe = { frei: 'var(--accent)', gebunden: 'color-mix(in srgb, var(--accent) 45%, var(--surface))', karte: 'var(--aus)' };
  const verteilung = `<div class="s5-teil fuell-aus" data-fuell="20"><h3>Wo dein Geld liegt</h3>
    ${alleVoll ? `<div class="wf5-b">${positiv.map((x) => `<i style="width:${(x.c / posS) * 100}%;background:${gFarbe[x.g.id]}" data-springe="#kg-${x.g.id}" title="${x.g.titel}: ${summeText(x.s)}"></i>`).join('')}</div>` : '<p class="s5-erkl">Ohne Anteile: an diesem Tag fehlt der Stand eines Kontos („+ ?“).</p>'}
    <div class="wf5">${gruppenSumme.map((x) => `<button class="wf5-z" data-springe="#kg-${x.g.id}"><i style="background:${gFarbe[x.g.id]}"></i><span class="wf5-n">${x.g.titel}</span><b class="${x.c < 0 ? 'neg' : ''}">${summeText(x.s)}</b><span class="wf5-p">${alleVoll && x.c > 0 ? `${Math.round((x.c / posS) * 100)} %` : ''}</span></button>`).join('')}</div></div>`;
  const monatK = tag.slice(0, 7), eigene = new Set(gew.map((x) => x.i));
  const bewegt = D.rows.filter((r) => r.d.startsWith(monatK) && r.d <= tag && eigene.has(r.k) && r.art !== 'Umbuchung').sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 5);
  const bewegungen = bewegt.length ? `<div class="s5-teil fuell-aus" data-fuell="21"><h3>Größte Bewegungen im ${MONAT[+monatK.slice(5) - 1]}</h3><div class="nt">${bewegt.map((r) => `<button class="nt-z bw-z"${geh(zuBuchungen({ q: r.g ? `"${r.g}"` : '', ...monatZiel(monatK) }))} title="Anklicken: Buchungen"><span class="nt-n">${dde(r.d).slice(0, 6)} ${esc(r.g || r.z || '–')}</span><b class="${cls(r.c)}">${eur0(r.c)}</b></button>`).join('')}</div></div>` : '';
  // Höchster und tiefster Stand nur, wenn jede Summe des Zeitraums vollständig ist – fehlt ein Monatsende, kann es
  // dort höher oder tiefer gewesen sein (und nur, wenn es mindestens zwei gibt)
  const r13 = reihe.slice(-13), r12 = r13.every((x) => x.s.voll) ? r13 : [], vorJahr = reihe.length >= 13 ? reihe[reihe.length - 13] : null;
  const hoch = r12.reduce((a, x) => (!a || x.s.c > a.s.c ? x : a), null), tief = r12.reduce((a, x) => (!a || x.s.c < a.s.c ? x : a), null);
  const zeitraum = r13.length >= 13 ? '12 Monate' : `seit Ende ${monKurz(r13[0].d.slice(0, 7))}`;
  const ecke = (t, x) => (x && r12.length > 1 ? `<div class="klick" data-st="${x.d}"><dt>${t} (${zeitraum})</dt><dd class="${x.s.c < 0 ? 'neg' : ''}">${summeText(x.s)} <small class="inl">${x.jetzt ? 'heute' : `Ende ${monKurz(x.d.slice(0, 7))}`}</small></dd></div>` : '');
  const ecken = `<dl class="s5-dl fuell-aus" data-fuell="22">
    ${ecke('Höchster Stand', hoch)}${ecke('Tiefster Stand', tief)}
    ${vorJahr ? `<div class="klick" data-st="${vorJahr.d}"><dt>Vor einem Jahr</dt><dd class="${vorJahr.s.c < 0 ? 'neg' : ''}">${summeText(vorJahr.s)} <small class="inl">${diffHtml(diffSumme(vorJahr.s, sT), ' bis heute')}</small></dd></div>` : ''}</dl>`;
  // je Konto an den letzten 6 Monatsenden: alle (gewählten) eigenen Konten, die an einem dieser Tage geführt wurden
  const endenT = enden.slice(-6), stT = st.slice(-6), sumT = reihe.slice(-7, -1).map((x) => x.s);
  const alt = (i) => (i < endenT.length - 3 ? ' m-alt' : '');
  const gefuehrt = (x) => x && !['nicht_eroeffnet', 'geschlossen'].includes(x.status);
  const tabZeilen = D.konten.map((k, i) => i).filter((i) => !fremd(D.konten[i]) && drin(i) && [...stT, amTag].some((l) => gefuehrt(l[i])));
  const zelle = (x) => (!gefuehrt(x) || x.status === 'unbekannt' ? '<span class="muted">–</span>' : x.c == null ? fragezeichen(STATUS_TEXT[x.status]) : `<span class="${x.c < 0 ? 'neg' : ''}">${NUM.format(Math.round(x.c / 100))}</span>`);
  const zahl = (c) => NUM.format(Math.round(c / 100));
  const tabelle = `<div class="t3-rahmen"><table class="t3 t3-eng"><thead><tr><th>Konto</th>${endenT.map((d, i) => `<th class="r${alt(i)}">${monKurz(d.slice(0, 7))}</th>`).join('')}<th class="r">${dde(tag).slice(0, 6)}</th></tr></thead><tbody>
    ${tabZeilen.map((i) => `<tr><td class="t3-n">${esc(D.konten[i].name)}</td>${stT.map((l, j) => `<td class="r${alt(j)}">${zelle(l[i])}</td>`).join('')}<td class="r"><b>${zelle(amTag[i])}</b></td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Zusammen</td>${sumT.map((s, j) => `<td class="r${alt(j)}${s.c < 0 ? ' neg' : ''}"${s.voll ? '' : ` title="${esc(fehltText(s))}"`}>${summeText(s, zahl)}</td>`).join('')}<td class="r${saldo < 0 ? ' neg' : ''}">${summeText(sT, zahl)}</td></tr></tfoot></table></div>`;
  return kopf5('Konten', satz, rechts) + `<div class="s5-zahlen">${zahlen}</div>
    <div class="s5-raster kon5">
      ${karte5('Alle Konten', `Stand ${dde(tag)} · nach Zweck gruppiert · rechts: Veränderung seit 1.1. · anklicken: Buchungen${ks ? ' · blass: nicht gewählt' : ''}`,
        `<div class="ko vgs"><div class="vg-kopf"><span>Konto</span><span></span><span>Stand</span><span>seit 1.1.</span></div>${gruppen}</div>
        ${unbekannt.length ? `<p class="s5-erkl">Für diesen Tag noch ohne Daten: ${unbekannt.map((x) => `${esc(x.k.name)} (ab ${dde(x.k.von)})`).join(', ')}.</p>` : ''}`, 's5-b2')}
      <div class="s5-spalte">
        ${karte5('Verlauf', `Summe ${ks ? 'der gewählten Konten' : 'deiner Konten'} am Monatsende${V ? ' · gestrichelt: Prognose' : ''} · Punkt anklicken: Stand an diesem Tag.${lueckenText(kontenGrafik.summen)}`, '<div class="s5-chart klein"><canvas id="c-konten-verlauf"></canvas></div>')}
        ${karte5('Monatsenden', `Summe am Monatsende und Veränderung zum Vormonat · anklicken: Stand an diesem Tag${reihe.some((x) => !x.s.voll) ? ' · „+ ?“: für ein Konto fehlt an dem Tag der Stand' : ''}`, monatsenden + verteilung + bewegungen + ecken, '', zs('je Konto ↓', '#kon-tab'))}
      </div>
      ${sicher(() => vermoegenKarte(H))}${sicher(() => depotKarte(H))}
    </div>
    <details class="card s5-details" id="kon-tab"><summary>Kontostände je Konto an den Monatsenden <span class="muted">· in Euro</span></summary>${tabelle}</details>` + eingangHtml();
}

// Summe der Kontostände je Monatsende (24 Monate), ohne Kontenauswahl zusätzlich die Prognose.
// Unvollständige Summen (ein Konto an dem Tag nicht berechenbar) bleiben eine Lücke.
function kontenGrafikZeichnen() {
  if (!kontenGrafik || !$('#c-konten-verlauf')) return;
  const ks = kontoSet(), tage = [...kontenGrafik.tage];
  const werte = kontenGrafik.summen.map((s) => (vollSumme(s) == null ? null : s.c / 100));
  const labels = tage.map((d) => (d === D.bis ? 'heute' : monKurz(d.slice(0, 7))));
  let ab = -1;
  if (!ks) {
    const prog = verlauf5().monate.filter((m) => m.art !== 'ist');
    ab = tage.length;
    for (const m of prog) { tage.push(monatsletzter(`${m.k}-01`)); werte.push(m.stand == null ? null : m.stand / 100); labels.push(monKurz(m.k)); }
  }
  const c = css('--accent'), o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.layout = { padding: { top: 22, right: 8 } };
  o.plugins.tooltip.callbacks = { title: (it) => { const i = it[0].dataIndex; return `${ab >= 0 && i >= ab ? 'erwartet ' : 'Stand '}${dde(tage[i])}`; }, label: (it) => (it.raw == null ? ' nicht vollständig berechenbar' : ` ${ks ? 'gewählte Konten' : 'alle Konten'}: ${EUR0.format(it.raw)}`) };
  o.scales = {
    x: { ...achsenStil(), grid: { display: false }, ticks: { ...achsenStil().ticks, maxRotation: 0, autoSkip: true, autoSkipPadding: 10, font: { size: 11 } } },
    y: { ...achsenStil(), ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 5 } },
  };
  o.onClick = (_, el) => { if (el.length && (ab < 0 || el[0].index < ab)) setze({ stichtag: tage[el[0].index] }); };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length && (ab < 0 || el[0].index < ab) ? 'pointer' : 'default'; };
  const iTag = tage.indexOf(kontenGrafik.tag), letzteIst = ab < 0 ? tage.length - 1 : ab - 1;
  zeichne('c-konten-verlauf', { type: 'line', data: { labels, datasets: [{ data: werte, borderColor: c, backgroundColor: alpha(c, 0.1), fill: 'origin', cubicInterpolationMode: 'monotone', borderWidth: 2.5,
    pointRadius: tage.map((d, i) => (i === iTag || i === letzteIst || i === tage.length - 1 ? 4 : 0)), pointBackgroundColor: tage.map((_, i) => (ab >= 0 && i >= ab ? css('--surface') : c)), pointBorderColor: c, pointBorderWidth: 2, pointHoverRadius: 5,
    segment: { borderDash: (sg) => (ab >= 0 && sg.p1DataIndex >= ab ? [6, 4] : undefined) } }] },
    options: o, plugins: [prognoseMit(ab, PROGNOSE), punktWerteMit([0, letzteIst, tage.length - 1].filter((i, j, a) => i >= 0 && a.indexOf(i) === j), (v, i) => `${ab >= 0 && i >= ab ? '≈ ' : ''}${kurzWert(v)}`)] });
}

// ======================================================================= Tabellen
const KOLL = new Intl.Collator('de');
function sortiert() {
  const f = S.sort === 'betrag' ? (a, b) => Math.abs(a.c) - Math.abs(b.c) || a.c - b.c :   // nach Höhe des Betrags, egal ob rein oder raus
    S.sort === 'wer' ? (a, b) => KOLL.compare(a.g || a.z, b.g || b.z) : (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.i - b.i);
  const out = F.slice().sort(f);
  if (S.dir < 0) out.reverse();
  return out;
}

// Keine Treffer: Gibt es welche in anderen Jahren oder ohne die übrigen Filter? Dann zeigen und mit einem Klick dorthin.
function keineTreffer(conds) {
  const leer = '<div class="leer">Keine Buchungen gefunden. Suche oder Filter ändern?</div>';
  if (!conds.length && !S.jahr && !S.monat && !S.zr) return leer;
  const kurz = (r) => `<li><span>${dde(r.d)}</span><span>${esc(r.g || r.z || '–')}</span><span class="muted">${esc(D.konten[r.k].name)}</span><b class="${cls(r.c)}">${EUR.format(r.c / 100)}</b></li>`;
  const kasten = (text, l, ziel, knopf) => `<div class="leer kt"><p>${text}</p><ul class="kt-l">${l.slice(-5).reverse().map(kurz).join('')}</ul>${l.length > 5 ? `<p class="muted">… und ${l.length - 5} weitere</p>` : ''}<button class="btn" data-weiter="${esc(JSON.stringify(ziel))}">${knopf}</button></div>`;
  const zeitraum = [S.jahr ? `in ${esc(String(S.jahr).replace(/,/g, ', '))}` : '', S.monat ? `(${monateWahl().map((m) => MON[m - 1]).join(', ')})` : '', S.zr ? `von ${zrText()}` : ''].filter(Boolean).join(' ');
  // 1. dieselben Filter, nur ohne Jahr und Monat
  if (S.jahr || S.monat || S.zr) {
    const alt = { jahr: S.jahr, monat: S.monat, zr: S.zr, nf: S.nf };
    let l; try { S.jahr = ''; S.monat = ''; S.zr = ''; S.nf = ''; l = D.rows.filter(pruefer(conds)); } finally { Object.assign(S, alt); }
    if (l.length) {
      const jahre = [...new Set(l.map((r) => r.y))];
      return kasten(`${zeitraum ? `${zeitraum[0].toUpperCase()}${zeitraum.slice(1)}` : 'Im gewählten Zeitraum'} nichts gefunden – aber <b>${l.length} Treffer</b> in ${jahre.length === 1 ? jahre[0] : `${jahre.length} anderen Jahren`}:`, l,
        jahre.length === 1 ? { jahr: String(jahre[0]), monat: '', zr: '', nf: '', neu: '' } : { jahr: '', monat: '', zr: '', nf: '', neu: '' }, jahre.length === 1 ? `${jahre[0]} anzeigen` : 'In allen Jahren anzeigen');
    }
  }
  // 2. nur die Suche, ohne Konto, Kategorie, Art und Zeitraum
  const test = matcher(conds), l = D.rows.filter(test);
  if (l.length && (S.konto || S.kat || S.ukat || S.art !== 'alle' || !S.umb || S.jahr || S.monat || S.nf || S.neu || S.vertrag || S.reise)) {
    const konten = [...new Set(l.map((r) => r.k))], nurFremd = l.every((r) => FREMD_ART.has(r.art));
    const ziel = { jahr: '', monat: '', zr: '', nf: '', neu: '', vertrag: '', reise: '', konto: nurFremd && konten.length === 1 ? D.konten[konten[0]].name : '', kat: '', ukat: '', art: 'alle', umb: l.some((r) => r.art === 'Umbuchung') || S.umb };
    const warum = l.every((r) => r.art === 'Umbuchung') ? ' (es sind Umbuchungen, die sonst ausgeblendet sind)' : nurFremd ? ' (auf einem gemeinsamen bzw. Kinderkonto, das sonst nicht mitzählt)' : '';
    return kasten(`Mit den gesetzten Filtern nichts gefunden – ohne Filter gibt es <b>${l.length} Treffer</b>${warum}:`, l, ziel, 'Ohne Filter anzeigen');
  }
  return leer;
}

// Buchungen: oben die Treffer in Zahlen und eine kleine Monatsgrafik, darunter die Liste – nach Datum je Tag gruppiert
// (mit Tagessumme), nach Betrag oder Empfänger als einfache Liste. Zeile anklicken: Einzelheiten.
let buchGrafik = null;
function tabBuchungen(conds) {
  const rows = sortiert();
  buchGrafik = null;
  // bei „nur neue“ sagt die Leiste schon, dass nichts Neues da ist – die Suche in anderen Jahren passt dann nicht
  if (!rows.length) return sicher(() => neuLeiste(H)) + (S.neu ? '' : keineTreffer(conds));
  const w = highlightWords(conds);
  const re = w.length ? new RegExp('(' + w.map(escRe).join('|') + ')', 'gi') : null;
  const mk = (s) => (re ? esc(s).replace(re, '<mark>$1</mark>') : esc(s));
  const kn = (r) => D.konten[r.k].name;
  // Kennzahlen der Treffer (alle, nicht nur die angezeigten) – wie in den Kennzahlen nach Art: Einnahmen und Ausgaben
  // (Erstattungen mindern die Ausgaben), Sparen/Depot und Umbuchungen extra. Auf Konten der Kinder und gemeinsamen
  // Konten haben die Buchungen keine solche Art – dort zählt das Vorzeichen, ebenso wenn nur Sparen/Umbuchungen gefunden sind.
  const nachArt = (r) => (r.art === 'Einnahme' ? 'ein' : r.art === 'Ausgabe' ? 'aus' : FREMD_ART.has(r.art) ? (r.c > 0 ? 'ein' : 'aus') : 'extra');
  const nurExtra = rows.every((r) => nachArt(r) === 'extra'), seite = (r) => (nurExtra ? (r.c > 0 ? 'ein' : 'aus') : nachArt(r));
  let ein = 0, aus = 0, extra = 0, nEin = 0, nAus = 0, nExtra = 0, von = rows[0].d, bis = rows[0].d;
  const mon = new Map(), tag = new Map();
  for (const r of rows) {
    const s = seite(r), k = r.d.slice(0, 7), m = mon.get(k) || { ein: 0, aus: 0 };
    if (s === 'ein') { ein += r.c; m.ein += r.c; nEin++; } else if (s === 'aus') { aus -= r.c; m.aus -= r.c; nAus++; } else { extra += r.c; nExtra++; }
    if (r.d < von) von = r.d; if (r.d > bis) bis = r.d;
    mon.set(k, m);
    tag.set(r.d, (tag.get(r.d) || 0) + r.c);
  }
  const monate = [];
  for (let k = von.slice(0, 7); k <= bis.slice(0, 7); k = mVor(k, 1)) monate.push(k);
  const nM = monate.length, je = (c) => (nM > 1 ? ` · Ø ${eur0(c / nM)} im Monat` : '');
  const extraText = nExtra ? ` · extra: Sparen/Umbuchungen <span class="${extra < 0 ? 'neg' : ''}">${plusMinus(extra)}</span>` : '';
  const msA = [], msE = [];
  for (let k = von.slice(0, 7); k <= bis.slice(0, 7); k = mVor(k, 1)) { msA.push(mon.get(k)?.aus || 0); msE.push(mon.get(k)?.ein || 0); }
  const zahlen = [
    kachel({ titel: 'Treffer', wert: NUM.format(rows.length), aend: von === bis ? dde(von) : `${dde(von)} – ${dde(bis)}`, unter: 'Buchungen mit den gewählten Filtern' }),
    kachel({ titel: 'Ausgaben', wert: eur0(aus), aend: `${nAus} Buchungen${je(aus)}`, spark: msA.length > 1 ? sparkline(msA) : '', unter: 'Linie: je Monat' }),
    kachel({ titel: 'Einnahmen', wert: eur0(ein), cls_: ein < 0 ? 'neg' : '', aend: `${nEin} Buchungen${je(ein)}`, spark: msE.length > 1 ? sparkline(msE) : '', unter: 'Linie: je Monat' }),
    kachel({ titel: 'Saldo', wert: plusMinus(ein - aus), cls_: ein - aus >= 0 ? 'pos' : 'neg', aend: `Einnahmen minus Ausgaben${extraText}`, unter: 'Sparen und Umbuchungen extra' }),
  ].join('');
  const bkKern = `${NUM.format(rows.length)} ${rows.length === 1 ? 'Buchung' : 'Buchungen'}${von === bis ? ` am ${dde(von)}` : ` von ${dde(von)} bis ${dde(bis)}`}: Ausgaben <b>${eur0(aus)}</b> · Einnahmen <b>${eur0(ein)}</b>`;
  if (nM > 36) {   // lange Zeiträume: je Jahr
    const jahr = new Map();
    for (const [k, m] of mon) { const y = k.slice(0, 4), x = jahr.get(y) || { ein: 0, aus: 0 }; x.ein += m.ein; x.aus += m.aus; jahr.set(y, x); }
    const jahre = []; for (let y = +von.slice(0, 4); y <= +bis.slice(0, 4); y++) jahre.push(String(y));
    buchGrafik = { monate: jahre, mon: jahr, jahre: true };
  } else if (nM >= 2) buchGrafik = { monate, mon };
  const pf = (k) => (S.sort === k ? ` ${S.dir < 0 ? '↓' : '↑'}` : '');
  const sortKnoepfe = `<div class="seg bt-sort" role="group" aria-label="Sortieren">${[['datum', 'Datum'], ['betrag', 'Betrag'], ['wer', 'Empfänger']].map(([k, t]) => `<button data-sort="${k}" class="${S.sort === k ? 'an' : ''}" title="${S.sort === k ? 'nochmal klicken: Reihenfolge umdrehen' : `nach ${t} sortieren`}">${t}${pf(k)}</button>`).join('')}</div>`;
  const gruppiert = S.sort === 'datum', zeig = rows.slice(0, limit), anzahl = new Map();
  for (const r of rows) anzahl.set(r.d, (anzahl.get(r.d) || 0) + 1);
  const datum = (d) => `${WTAG[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${dde(d).slice(0, 6)}${d.slice(2, 4)}`;
  let h = '';
  zeig.forEach((r, i) => {
    const erster = !gruppiert || i === 0 || zeig[i - 1].d !== r.d, letzter = i === zeig.length - 1 || zeig[i + 1].d !== r.d;
    const auf = offen.has(r.i);
    h += `<div class="bz mit-datum${auf ? ' offen' : ''}${gruppiert && erster ? ' tag-anfang' : ''}" data-i="${r.i}" role="button" tabindex="0" aria-expanded="${auf ? 'true' : 'false'}" title="Anklicken: Einzelheiten">
      <span class="bz-d">${erster ? datum(r.d) : ''}</span>
      <span class="bz-n"><b>${mk(r.g || r.z || '–')}</b>${r.g && r.z ? `<small>${mk(r.z)}</small>` : ''}${sicher(() => chip(r))}</span>
      <span class="bz-k"><span>${esc(schoen(r.kat))}</span><small>${esc(schoen(r.ukat))}${r.ukat ? ' · ' : ''}${esc(kn(r))}</small></span>
      <b class="bz-b ${cls(r.c)}">${eur(r.c)}</b></div>`;
    if (auf) h += buchDetail(r);
    if (gruppiert && letzter && anzahl.get(r.d) > 1) h += `<div class="bz-tagsumme">${anzahl.get(r.d)} Buchungen am ${dde(r.d).slice(0, 6)} · zusammen <b class="${cls(tag.get(r.d))}">${eur(tag.get(r.d))}</b></div>`;
  });
  let fuss = `<div class="bt-summe"><span>Summe ${rows.length === 1 ? 'der Buchung' : `aller ${NUM.format(rows.length)} Treffer`}<small>Einnahmen ${eur(ein)} · Ausgaben ${eur(-aus)}${nExtra ? ` · Sparen/Umbuchungen ${eur(extra)}` : ''}</small></span><b class="${cls(ein - aus + extra)}">${eur(ein - aus + extra)}</b></div>`;
  if (rows.length > limit) fuss += `<div class="mehr">${NUM.format(limit)} von ${NUM.format(rows.length)} angezeigt <button class="btn sm" id="mehr">Weitere ${NUM.format(Math.min(500, rows.length - limit))} anzeigen</button></div>`;
  return `<div class="bt cp bx bk">${bxKopf('Buchungen', bkKern, 'Suche und Filter oben · Zeile anklicken: Einzelheiten · Säule anklicken: nur dieser Zeitraum')}
    <div class="cp-kz bt-zahlen">${zahlen}</div>
    ${buchGrafik ? `<div class="bt-grafik"><div class="bt-g-t"><b>Je ${buchGrafik.jahre ? 'Jahr' : 'Monat'}</b><span class="muted klein">Ausgaben orange, Einnahmen grün${nExtra ? ' (ohne Sparen/Umbuchungen)' : ''} · Säule anklicken: nur ${buchGrafik.jahre ? 'dieses Jahr' : 'dieser Monat'}</span></div><div class="s5-chart bt-chart"><canvas id="c-buch"></canvas></div></div>` : ''}
    ${sicher(() => neuLeiste(H))}
    <div class="bt-leiste"><span class="muted klein">${gruppiert ? 'Nach Datum, bei mehreren Buchungen am Tag mit Tagessumme' : S.sort === 'betrag' ? 'Nach Betrag sortiert' : 'Nach Empfänger sortiert'} · Zeile anklicken: Einzelheiten</span>${sortKnoepfe}</div>
    <div class="bt-liste">${h}</div>${fuss}</div>`;
}

// Einzelheiten einer Buchung (aufgeklappte Zeile)
function buchDetail(r) {
  const kn = (r) => D.konten[r.k].name;
  const dd = [['Verwendungszweck', r.z], ['Kategorie', `${schoen(r.kat)}${r.ukat ? ' · ' + schoen(r.ukat) : ''}`], ['Konto', kn(r)], ['Art', r.art],
    ['Vertrag', r.v], ['Tags', r.t], ['Notiz', r.n], ['Steuerkategorie (Buhl)', r.st], ['Früher genannt', r.ga.join(', ')]];
  const bx = det(r, D.j);
  dd.push(['Umsatzart', bx.uart], ['IBAN Gegenseite', ibanText(bx.iban)], ['Mandatsreferenz', bx.mref], ['Gläubiger-ID', bx.gid],
    ['Kategorie laut Quelle', (bx.kat0 || '').replace(/ › $/, '')], ['Kategorie geändert durch', r.regel || bx.regel], ['Datei', (bx.quelle || '').replace(/ › .*/, '')]);
  for (let x = dd.length - 1; x >= 0; x--) if (!dd[x][1]) dd.splice(x, 1);
  return `<div class="bz-detail"><dl>${dd.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="bz-knoepfe">${r.g ? `<button class="btn sm" data-alle="${esc(r.g)}">Alle Buchungen von „${esc(r.g.length > 40 ? r.g.slice(0, 40) + '…' : r.g)}“</button>` : ''}
    <button class="btn sm" data-nurkat="${esc(r.kat)}">Nur ${esc(schoen(r.kat))}</button>
    <button class="btn sm"${geh({ tab: 'uebersicht', kart: 'pruefen', wahl: gruppenSchluessel(r) })}>Kategorie prüfen/ändern</button>
    <label class="st-zuordnen klein">Steuer: <select data-steuer-i="${r.i}">${postenOptionen(steuerPosten(r), true)}</select></label></div></div>`;
}
function detailKnoepfe(el) {
  el.querySelectorAll('[data-alle]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); setze({ q: `"${b.dataset.alle}"` }); });
  el.querySelectorAll('[data-nurkat]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); setze({ kat: b.dataset.nurkat, ukat: '' }); });
  el.querySelectorAll('[data-steuer-i]').forEach((s) => {
    s.onclick = (e) => e.stopPropagation();
    s.onchange = () => { steuerZuordnen(D.rows[+s.dataset.steuerI], s.value); toast('Für die Steuer gespeichert – zu sehen im Reiter „Steuer“.'); };
  });
}
// auf-/zuklappen, ohne die ganze Liste und die Grafik neu zu zeichnen
function aufklappen(zeile) {
  const i = +zeile.dataset.i, auf = !offen.has(i);
  if (auf) offen.add(i); else offen.delete(i);
  zeile.classList.toggle('offen', auf);
  zeile.setAttribute('aria-expanded', String(auf));
  const alt = zeile.nextElementSibling?.classList.contains('bz-detail') ? zeile.nextElementSibling : null;
  if (!auf) { alt?.remove(); return; }
  if (alt) return;
  zeile.insertAdjacentHTML('afterend', buchDetail(D.rows[i]));
  gehBinden(zeile.nextElementSibling);
  detailKnoepfe(zeile.nextElementSibling);
}

// Ausgaben und Einnahmen der Treffer je Monat; Klick auf eine Säule: nur dieser Monat (übrige Filter bleiben)
function buchGrafikZeichnen() {
  if (!buchGrafik || !$('#c-buch')) return;
  const { monate, mon, jahre } = buchGrafik, cE = css('--ein'), cA = css('--aus');
  const o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.scales = {
    x: { ...achsenStil(), grid: { display: false }, ticks: { ...achsenStil().ticks, font: { size: 11 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 8 } },
    y: { ...achsenStil(), beginAtZero: true, ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 3 } },
  };
  o.plugins.tooltip.callbacks = { title: (it) => (jahre ? monate[it[0].dataIndex] : monLang(monate[it[0].dataIndex])), label: (it) => ` ${it.dataset.label}: ${EUR0.format(it.raw)}` };
  o.onClick = (_, el) => { if (el.length) setze(jahre ? { jahr: monate[el[0].index], monat: '', zr: '' } : { ...monatZiel(monate[el[0].index]) }); };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; };
  const g = (k, f) => (mon.get(k)?.[f] || 0) / 100;
  zeichne('c-buch', { type: 'bar', data: { labels: jahre ? monate : monate.map(monKurz), datasets: [
    { label: 'Ausgaben', data: monate.map((k) => g(k, 'aus')), backgroundColor: alpha(cA, 0.85), borderRadius: 3, maxBarThickness: 18, categoryPercentage: 0.75, barPercentage: 0.9 },
    { label: 'Einnahmen', data: monate.map((k) => g(k, 'ein')), backgroundColor: alpha(cE, 0.85), borderRadius: 3, maxBarThickness: 18, categoryPercentage: 0.75, barPercentage: 0.9 },
  ] }, options: o });
}

// Stichtag für die Kontostände: selbst gewählt, sonst der letzte Datenstand
const stichtag = () => S.stichtag || D.bis;

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
    <div class="tab-scroll"><table class="t fix eingang-t"><thead><tr><th class="erste">Datei</th><th class="sp-m" style="width:14%">erkannt als</th><th class="sp-m" style="width:16%">Konto</th>
      <th class="sp-m" style="width:16%">Zeitraum</th><th class="r" style="width:9%" title="Buchungen in der Datei">gelesen</th><th class="r" style="width:7%" title="neu in die Liste übernommen">neu</th>
      <th class="r sp-m" style="width:9%" title="schon in der Liste – nicht doppelt gezählt">doppelt</th></tr></thead><tbody>
    ${liste.map((x) => `<tr class="${x.ok ? '' : 'eingang-fehler'}"><td class="erste" title="${esc(x.datei)}"><div class="ell">${esc(name(x.datei))}</div><div class="klein ${x.ok ? 'muted' : 'neg'} ell" title="${esc(status(x))}">${esc(status(x))}</div></td>
      <td class="sp-m klein">${esc(x.art)}</td><td class="sp-m klein ell" title="${esc([...x.konten].join(', '))}">${esc([...x.konten].join(', ') || '–')}</td>
      <td class="sp-m klein">${x.von ? `${esc(x.von)} – ${esc(x.bis)}` : '–'}</td><td class="r">${NUM.format(x.gelesen)}</td>
      <td class="r ${x.neu ? 'pos' : 'muted'}"><b>${NUM.format(x.neu)}</b></td><td class="r sp-m muted">${NUM.format(x.doppelt)}</td></tr>`).join('')}
    </tbody></table></div></details>`;
}

const TITEL = {
  buchungen: () => ['Buchungen', `${[...(kontoSet() || [])].some((i) => D.konten[i].kind) ? 'mit Konto eines Kindes – zählt nicht zu deinen Finanzen · ' : [...(kontoSet() || [])].some((i) => D.konten[i].gemeinsam) ? 'mit gemeinsamem Konto – zählt nicht zu deinen Finanzen, nur deine Einzahlungen · ' : ''}${NUM.format(F.length)} Treffer · Zeile anklicken: Einzelheiten`],
  uebersicht: () => ['Kategorien', 'Zeile anklicken: Unterkategorien · Spaltenkopf: Monat bzw. Jahr filtern'],
  fix: () => ['Fixkosten und Abos', 'regelmäßige Zahlungen, automatisch erkannt'],
  konten: () => ['Konten', 'Zeile anklicken: Buchungen des Kontos'],
  steuer: () => ['Steuer', 'steuerlich relevante Buchungen je Steuerjahr'],
};
function tabelle(conds) {
  if (S.tab === 'start' || S.tab === 'kennzahlen' || UEBERBLICK[S.tab]) return;
  const el = $('#tab-inhalt');
  const [ti, hi] = (TITEL[S.tab] || TITEL.buchungen)();
  $('#t-tabelle').textContent = ti; $('#h-tabelle').textContent = hi;
  const frei = S.tab !== 'buchungen';
  $('#tabelle-card').classList.toggle('frei', frei);
  $('#tabelle-card .card-h').hidden = frei;
  if (S.tab === 'steuer') {
    steuerZeigen(el, { einJahr, toast, setze: (p) => setze(p), neuZeichnen: () => tabelle(conds), S, prognose: (j) => sicher(() => prognoseKarte(H, j)) });
    sicher(() => prognoseBinden(el, H));
    $('.dl').hidden = true;
    return;
  }
  if (S.tab === 'gehalt') {
    gehaltZeigen(el, gehaltHelfer());
    $('.dl').hidden = true;
    return;
  }
  $('.dl').hidden = false;
  el.innerHTML = S.tab === 'buchungen' ? tabBuchungen(conds) : `<div class="s5">${S.tab === 'uebersicht' ? tabKategorien() : S.tab === 'konten' ? tabKonten() : tabFixkosten()}</div>`;
  freiFuellen(el);
  gehBinden(el);
  // Zeitraum, Kategorien, Fixkosten-Ansicht
  el.querySelectorAll('[data-zeit]').forEach((b) => b.onclick = () => setze({ jahr: b.dataset.zeit, monat: '' }));
  el.querySelectorAll('[data-k2art]').forEach((b) => b.onclick = () => setze({ kart: b.dataset.k2art, wahl: '' }));
  el.querySelectorAll('.kl-z[data-k2kat]').forEach((b) => b.onclick = () => { setze({ wahl: b.dataset.k2kat }); if (matchMedia('(max-width: 1180px)').matches) $('.kl-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  el.querySelectorAll('[data-k2zelle]').forEach((td) => td.onclick = () => {
    const [k, m] = td.dataset.k2zelle.split('|');
    setze(zuBuchungen({ jahr: m.slice(0, 4), monat: String(+m.slice(5)), art: S.kart, ...(S.kart === 'aus' ? { kat: k } : einFilter(k)) }));
  });
  el.querySelectorAll('[data-fixtab]').forEach((b) => b.onclick = () => setze({ fixtab: b.dataset.fixtab }));
  el.querySelectorAll('[data-sort]').forEach((th) => th.onclick = () => {
    const k = th.dataset.sort;
    S.dir = S.sort === k ? -S.dir : k === 'wer' ? 1 : -1; S.sort = k; tabelle(conds);
  });
  el.querySelectorAll('[data-i]').forEach((tr) => tr.onclick = (e) => {
    if (e.target.closest('.bz-detail')) return;
    aufklappen(tr);
  });
  if (S.tab === 'buchungen') sicher(() => waechterBinden(el, H));
  el.querySelectorAll('[data-weiter]').forEach((b) => b.onclick = () => setze(JSON.parse(b.dataset.weiter)));
  detailKnoepfe(el);
  $('#mehr')?.addEventListener('click', () => { limit += 500; tabelle(conds); });
  el.querySelectorAll('[data-fixansicht]').forEach((b) => b.onclick = () => { fixAnsicht = b.dataset.fixansicht; tabelle(conds); $('#btn-reset').hidden = !abweichend(); });
  el.querySelector('.fix-grundlage')?.addEventListener('toggle', (e) => { fixGrundlageAuf = e.target.open; });
  el.querySelectorAll('[data-leben]').forEach((b) => b.onclick = () => {
    lebenWahl = b.dataset.leben;
    if (lebenWahl === 'eigen' && !lebenEigen) lebenEigen = Math.round(lebenshaltung().schnitt / 100) * 100;
    try { localStorage.setItem('fd.leben2', lebenWahl); localStorage.setItem('fd.lebeneigen', String(lebenEigen)); } catch {}
    D.mr = D.v5 = D.v5s = null;   // Übersicht und Prognose rechnen mit derselben Lebenshaltung
    tabelle(conds);
    if (lebenWahl === 'eigen') $('#leben-eigen')?.select();
  });
  $('#leben-eigen')?.addEventListener('change', (e) => {
    lebenEigen = Math.max(0, Math.round((+e.target.value || 0) * 100));
    try { localStorage.setItem('fd.lebeneigen', String(lebenEigen)); } catch {}
    D.mr = D.v5 = D.v5s = null;
    tabelle(conds);
  });
  if (S.tab === 'fix') planBinden();
  if (S.tab === 'fix' && S.fixtab === 'unterhalt') sicher(() => unterhaltBinden(el, H));
  if (S.tab === 'fix' && S.fixtab === 'kalender') sicher(() => fristenBinden(el, H));
  if (S.tab === 'konten') kontenGrafikZeichnen();
  if (S.tab === 'konten') sicher(() => vermoegenBinden(el, H));
  if (S.tab === 'buchungen') buchGrafikZeichnen();
  if (S.tab === 'uebersicht' && S.kart === 'pruefen') { pruefenBinden(el); pruefenGeoeffnet(); }
  else if (S.tab === 'uebersicht' && S.kart === 'tags') sicher(() => reisenBinden(el, H));
  else if (S.tab === 'uebersicht') { kat2Zeichnen(); if (S.kart !== 'ein') sicher(() => rahmenBinden(el, H)); }
  $('#stichtag')?.addEventListener('change', (e) => { const v = e.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setze({ stichtag: v }); });
  el.querySelectorAll('[data-st]').forEach((b) => b.onclick = () => setze({ stichtag: b.dataset.st === D.bis && !S.jahr ? '' : b.dataset.st }));
  el.querySelectorAll('tr[data-konto]').forEach((tr) => tr.onclick = () => setze({ konto: tr.dataset.konto, tab: 'buchungen' }));
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
// Ergebnis je Eingabe merken: die Vertragserkennung fragt dieselben Daten, Namen und Zwecke sehr oft ab
const merken = (fn) => { const m = new Map(); return (s) => { let v = m.get(s); if (v === undefined) { v = fn(s); m.set(s, v); } return v; }; };
const msAm = merken((d) => Date.parse(d));
const tageZwischen = (a, b) => (msAm(b) - msAm(a)) / 864e5;
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const zweckSignatur = merken((z) => norm(z).replace(/[^a-z ]+/g, ' ').replace(MONATSWORTE, ' ').replace(/\b[a-z]{1,2}\b/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' '));
const empfaengerKey = merken((g) => norm(g).replace(/\d{5,}/g, '').replace(/\s+/g, ' ').trim());

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

// Finanzguru benennt Empfänger manchmal um – und nur bei einem Teil der Buchungen. Damit ein Vertrag nicht in „beendet“
// und „neu“ zerfällt, gilt je früherem Namen + Verwendungszweck der heutige Name, den die umbenannten Buchungen tragen
// (nur wenn eindeutig: mindestens 2 Buchungen und 75 % auf denselben neuen Namen).
function namenAngleichen() {
  const zaehl = new Map();
  for (const r of D.rows) for (const a of r.ga) {
    const k = `${empfaengerKey(a)}|${zweckSignatur(r.z)}`;
    if (!zaehl.has(k)) zaehl.set(k, new Map());
    zaehl.get(k).set(r.g, (zaehl.get(k).get(r.g) || 0) + 1);
  }
  const neu = new Map();
  for (const [k, m] of zaehl) {
    const ges = [...m.values()].reduce((t, n) => t + n, 0), [name, n] = [...m].sort((a, b) => b[1] - a[1])[0];
    if (n >= 2 && n / ges >= 0.75) neu.set(k, name);
  }
  return (r) => neu.get(`${empfaengerKey(r.g)}|${zweckSignatur(r.z)}`) || r.g;
}

function fixkostenErkennen() {
  if (D.fix) return D.fix;
  const out = [], benutzt = new Set();
  const beitrag = beitragsBuchungen(), name = namenAngleichen();
  // Schritt 1: Empfänger + Verwendungszweck; Beiträge zum Gemeinschaftskonto nach Verwendungszweck
  const gruppen = new Map();
  for (const r of D.rows) {
    const b = beitrag.has(r.i);
    const ab = r.art === 'Ausgabe' || (r.art === 'Gemeinschaftskonto' && r.c < 0);
    if ((!ab && !b) || (!r.g && !b)) continue;
    const key = b ? `gemeinsam|${zweckSignatur(r.z) || beitrag.get(r.i)}` : empfaengerKey(name(r)) + '|' + zweckSignatur(r.z);
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
    const key = empfaengerKey(name(r));
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
const fixSichtbar = (alle) => alle.filter((f) => f.aktiv || fixAnsicht === 'alle' || (fixAnsicht === 'frueher' && f.zuletzt >= FRUEHER_AB));

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
    aktuell: { wert: lohn.get(letzter) || 0, knopf: 'aktuelles Gehalt', name: 'Gehaltseingang', zeit: `im ${MONAT[+letzter.slice(5) - 1]} ${letzter.slice(0, 4)}`, vom: 'vom aktuellen Gehalt', am: 'am aktuellen Gehalt', spalte: 'vom Gehalt', reihe: 'lohn' },
    schnitt: { wert: summe(lohn) / 12, knopf: 'Ø Gehalt 12 Monate', name: 'Ø Gehaltseingang', zeit: `${spanne}, mit Sonderzahlungen`, vom: 'vom Ø Gehalt', am: 'am Ø Gehalt', spalte: 'vom Gehalt', reihe: 'lohn' },
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

let fixGrundlageAuf = false;   // „Rechengrundlage“ aufgeklappt
const FIX_KURZ = { 'Haushalt (Gemeinschaftskonto)': 'Haushalt', 'Abos & Mitgliedschaften': 'Abos', 'Kinder & Betreuung': 'Kinder', 'Steuern & Gebühren': 'Steuern',
  'Telefon & Internet': 'Telefon', Trennungsunterhalt: 'Trennungs&shy;unterhalt', Kindesunterhalt: 'Kindes&shy;unterhalt', Versicherungen: 'Versiche&shy;rungen' };
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
  const kat = new Map(), katVm = new Map(), letzt = monate.length - 1;   // katVm: je Kategorie der letzte Monat (Vormonat)
  let spar = 0;
  for (const r of D.rows) {
    const i = idx.get(r.d.slice(0, 7));
    if (i == null || istGemeinsam(r.k)) continue;
    if (r.art === 'Ausgabe' && !fx.has(r.i)) { werte[i] -= r.c; const k = r.kat || 'Sonstiges'; kat.set(k, (kat.get(k) || 0) - r.c); if (i === letzt) katVm.set(k, (katVm.get(k) || 0) - r.c); }
    else if (r.art === 'Sparen') spar -= r.c;
  }
  const n = monate.length || 1;
  const kats = [...kat].map(([k, c]) => ({ kat: k, c: c / n })).filter((x) => x.c > 0).sort((a, b) => b.c - a.c);
  // Vormonat je Kategorie (c), daneben der Ø 12 Monate (o) als Vergleich
  const katsVm = [...kat].map(([k, c]) => ({ kat: k, c: katVm.get(k) || 0, o: c / n })).filter((x) => x.c > 0 || x.o > 0).sort((a, b) => b.c - a.c || b.o - a.o);
  return (D.leben = { monate, werte, kats, katsVm, schnitt: werte.reduce((s, x) => s + x, 0) / n, typisch: werte.length ? median(werte) : 0, spar: spar / n });
}
let lebenWahl = (() => { try { return localStorage.getItem('fd.leben2') || 'vormonat'; } catch { return 'vormonat'; } })();
// Lebenshaltung so, wie sie im Reiter Fixkosten gewählt ist (Ø 12 Monate, typischer Monat oder eigener Wert)
const lebenGewaehlt = () => (lebenWahl === 'eigen' && lebenEigen ? lebenEigen : lebenWahl === 'typisch' ? lebenshaltung().typisch : lebenWahl === 'vormonat' ? lebenshaltung().werte.at(-1) ?? lebenshaltung().schnitt : lebenshaltung().schnitt);
let lebenEigen = (() => { try { return +localStorage.getItem('fd.lebeneigen') || 0; } catch { return 0; } })();   // Cent

// Geld auf deinen eigenen Konten (ohne Gemeinschaftskonto und Pockets, Mietkaution und die Konten der Kinder);
// null, wenn sich der heutige Stand eines dieser Konten nicht berechnen lässt
function ruecklagen() {
  return vollSumme(summeKonten(kontostaende(D, D.bis).filter((x) => !fremd(x.k) && !istGemeinsam(x.i) && !/kaution/i.test(x.k.name))));
}

// Tag im Monat, an dem ein Vertrag abgebucht wird (Median der letzten Zahlungen), und der Tag, an dem das Gehalt kommt
const zahltag = (f) => Math.min(31, Math.max(1, Math.round(median(f.rows.slice(-4).map((r) => +r.d.slice(8, 10))))));
function gehaltstag() {
  const t = D.rows.filter((r) => r.art === 'Einnahme' && r.ukat === 'Lohn / Gehalt' && r.c >= 100000).slice(-6).map((r) => +r.d.slice(8, 10));
  return t.length ? Math.round(median(t)) : 0;
}
// nächste Fälligkeit eines nicht monatlichen Vertrags nach dem Datenstand (eine ausstehende kennt ausstehend())
function naechsteZahlung(f) {
  let t = Date.parse(f.zuletzt), am;
  do { t += f.rh.tage * 864e5; am = new Date(t).toISOString().slice(0, 10); } while (am <= D.bis);
  return am;
}
// Name eines Vertrags für Listen: „Miete Kathrin Kluge“, „Kindesunterhalt Leo“, „Lebensversicherung“ …
function vertragName(f) {
  const a = fixArt(f), t = fixTitel(f, a);
  if (a === 'Miete') return `Miete ${f.name}`;
  if (a === 'Kindesunterhalt') return `Kindesunterhalt ${t}`;
  if (a === 'Trennungsunterhalt') return 'Trennungsunterhalt';
  if (a === 'Kinder & Betreuung') { const v = (f.name.match(/,\s*(\S+)/) || [])[1]; const u = f.ukat && !/^kinder$/i.test(f.ukat) ? schoen(f.ukat) : 'Kinder'; return v ? `${u} ${v}` : t; }
  if (f.beitrag) return `${t} (${f.name})`;
  return t;
}
const vertragsKey = (f) => `${f.name}|${f.sig}|${f.seit}`;
const pzVon = (v, g) => (!g ? '–' : Math.abs(v / g) < 0.0005 ? '< 0,1 %' : `${NUM.format(Math.round((v / g) * 1000) / 10)} %`);

// Ein oder mehrere Balken „Einkommen = 100 %“: Fixkosten | Lebenshaltung | was bleibt (rot schraffiert: was fehlt)
function budgetBalken(zeilen, B, G = B) {   // Balkenlänge: B = Einkommen (100 %); Prozente im Tooltip vom Gehalt G
  const max = Math.max(B, ...zeilen.map((z) => z.fk + z.l));
  const w = (c) => `${(Math.max(0, c) / max) * 100}%`;
  const teil = (cls_, c, tip) => (c > 0 ? `<i class="${cls_}" style="width:${w(c)}" title="${esc(tip)}">${c / max >= 0.09 ? `<span>${eur0(c)}</span>` : ''}</i>` : '');
  return `<div class="bb">${zeilen.map((z) => {
    const rest = B - z.fk - z.l;
    return `<div class="bb-zeile">${z.titel ? `<div class="bb-t">${esc(z.titel)}</div>` : ''}
      <div class="bb-balken">${teil('bb-fix', z.fk, `Fixkosten ${eur0(z.fk)} · ${pzVon(z.fk, G)} vom Gehalt`)}${teil('bb-leben', z.l, `Lebenshaltung ${eur0(z.l)} · ${pzVon(z.l, G)} vom Gehalt`)}${teil('bb-rest', rest, `bleibt ${eur0(rest)} · ${pzVon(rest, G)} vom Gehalt`)}
        ${rest < 0 ? `<b class="bb-minus" style="left:${w(B)};width:${w(-rest)}" title="fehlt ${eur0(-rest)}"></b>` : ''}
        ${max > B ? `<b class="bb-linie" style="left:${w(B)}" title="100 % = Einkommen"></b>` : ''}</div></div>`;
  }).join('')}</div>`;
}

// Fixkosten: Was ist fest verplant – und was bleibt? Grundlage ist das aktuelle Gehalt; der normale Monat wie in der Übersicht.
function tabFixkosten() {
  // Bereich Familie: nur Unterhalt und Unterhaltsrechner (ohne den Fixkosten-Kopf)
  if (S.fixtab === 'unterhalt') return kopf5('Familie', 'Unterhalt für deine Kinder: Monat für Monat, Ausgleich und Unterhaltsrechner.')
    + `<div class="s5">${sicher(() => unterhaltSeite(H)) || '<div class="card leer">Die Unterhalts-Übersicht konnte nicht berechnet werden.</div>'}</div>`;
  const ks = kontoSet(), R = monatsRechnung();
  const gefiltert = fixkostenErkennen().filter((f) => !ks || ks.has(f.k));   // Verträge der gewählten Konten
  const alle = gefiltert.filter((f) => !f.gemeinsam), aktiv = alle.filter((f) => f.aktiv);
  const vomGemeinsamen = fixSichtbar(gefiltert.filter((f) => f.gemeinsam));
  const nFrueher = alle.filter((f) => !f.aktiv && f.zuletzt >= FRUEHER_AB).length, nAelter = alle.filter((f) => !f.aktiv && f.zuletzt < FRUEHER_AB).length;
  const liste = fixSichtbar(alle);
  // Gehalt, sonstige Einnahmen und Lebenshaltung gibt es nur für alle Konten. Die Rechnung „was bleibt“ (Satz, Balken,
  // „Was wäre wenn“) nimmt deshalb immer die Verträge aller Konten (R.fix); die Kontenauswahl wirkt auf die Vertragsliste.
  // was bleibt: aus den gezeigten, auf Euro gerundeten Teilen – wie im Cockpit und im Geldfluss
  const pm = aktiv.reduce((s, f) => s + f.proMonat, 0), G = R.gehalt, L = R.leben, E = G + R.sonst, rest = [G, R.sonst, -R.fix, -L].reduce((t, c) => t + Math.round(c / 100) * 100, 0);
  const pct = (v) => pzVon(v, G);
  // Gruppen je Art, sortiert nach laufender Summe
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
  const ueber = nachArt(aktiv), arten = nachArt(liste), ueberAlle = ks ? nachArt(R.vertraege) : ueber;
  // B = Einkommen (Gehalt + typische sonstige Einnahmen) für das, was übrig bleibt; Quote und Puffer wie überall vom aktuellen Gehalt G
  fixKontext = { B: E, G, bz: { vom: 'vom Gehalt', name: 'Einkommen' }, pm: R.fix, L, lauf: R.vertraege, ruecklage: ruecklagen() };
  const termine = naechsteTermine(aktiv), tSumme = termine.reduce((t, x) => t + x.f.betrag, 0);
  const jaehrl = aktiv.filter((f) => f.rh.proJahr < 12);
  const vertrZiel = S.fixtab === 'vertraege' ? (sel) => ({ springe: sel }) : () => ({ ziel: { fixtab: 'vertraege' } });
  const vz = (inhalt, sel = '.fix5 .vgs') => (S.fixtab === 'vertraege' ? zs(inhalt, sel) : zl(inhalt, { fixtab: 'vertraege' }));
  const satz = ks ? `Auf ${ks.size === 1 ? `dem Konto ${esc(kontoText())}` : 'den gewählten Konten'} laufen ${aktiv.length} ${aktiv.length === 1 ? 'Vertrag' : 'Verträge'} über ${vz(`<b>${eur0(pm)}</b>`)} im Monat – ${pct(pm)} deines Gehalts (${zl(`<b>${eur0(G)}</b>`, zuGehalt())}).
    Was im Monat bleibt, lässt sich nur für alle Konten rechnen (Gehalt und Lebenshaltung gehören zu allen): ${zl(`<b class="${rest >= 0 ? 'pos' : 'neg'}">${rest >= 0 ? 'bleiben' : 'fehlen'} ${eur0(Math.abs(rest))}</b>`, { tab: 'start' })}.`
    : `Von deinem Gehalt (${zl(`<b>${eur0(G)}</b>`, zuGehalt())}) sind ${vz(`<b>${eur0(pm)}</b>`)} im Monat fest verplant – <b class="${pm <= G * 0.5 ? 'pos' : 'neg'}">${pct(pm)}</b>${pm > G * 0.5 ? ' (Faustregel: höchstens 50 %)' : ''}.
    ${rest >= 0 ? 'Nach' : 'Mit'} Lebenshaltung (${S.fixtab === 'vertraege' ? zs(eur0(L), '#fix-leben') : zl(eur0(L), { fixtab: 'vertraege', _springe: '#fix-leben' })}) und sonstigen Einnahmen (${zl(`+${eur0(R.sonst)}`, { tab: 'uebersicht', kart: 'ein', wahl: '', jahr: '' })}) ${rest >= 0 ? 'bleiben' : 'fehlen'} ${zl(`<b class="${rest >= 0 ? 'pos' : 'neg'}">${eur0(Math.abs(rest))}</b>`, { tab: 'start' })} im Monat.`;
  const zahlen = [
    zahl5('Fixkosten im Monat', eur0(pm), `${aktiv.length} laufende Verträge · jährliche anteilig · Liste ↓`, vertrZiel('.fix5 .vgs')),
    zahl5('Anteil am Gehalt', pct(pm), `${ks ? 'nur Verträge der gewählten Konten · ' : ''}von ${eur0(G)} netto (${monKurz(R.gehaltMonat)}) · Faustregel höchstens 50 % · Gehälter →`, { cls: pm <= G * 0.5 ? 'pos' : 'neg', ziel: zuGehalt() }),
    zahl5('Fixkosten im Jahr', eur0(pm * 12), jaehrl.length ? `davon ${eur0(jaehrl.reduce((t, f) => t + f.proJahr, 0))} nicht monatlich (${jaehrl.length} Verträge) · Kalender →` : 'alles monatlich', { ziel: { fixtab: 'kalender' } }),
    zahl5('Nächste 30 Tage', eur0(tSumme), `${termine.length} feste Abbuchungen · Kalender ansehen`, { ziel: { fixtab: 'kalender' } }),
  ].join('');
  // Balken (immer alle Konten): große Arten einzeln, kleine (unter 4 %) zusammen
  const gross = ueberAlle.filter((g) => g.summe >= (R.fix + L) * 0.04), klein = ueberAlle.filter((g) => g.summe > 0 && g.summe < (R.fix + L) * 0.04), kleinS = klein.reduce((t, g) => t + g.summe, 0);
  const teile = [...gross.map((g) => ({ n: FIX_KURZ[g.art] || esc(g.art), c: g.summe, tip: `${g.art}: ${eur0(g.summe)} im Monat · ${pct(g.summe)} vom Gehalt – anklicken: Verträge`, ...vertrZiel(`#${fvId(g.art)}`) })),
    ...(kleinS ? [{ n: 'Übrige', c: kleinS, tip: `${klein.map((g) => `${g.art} ${eur0(g.summe)}`).join(', ')} – zusammen ${eur0(kleinS)} im Monat`, ...vertrZiel(`#${fvId(klein[0].art)}`) }] : [])];
  const lh = lebenshaltung();
  if (lebenWahl === 'eigen' && !lebenEigen) lebenWahl = 'vormonat';
  const knopf = (k, t, wert) => `<button data-leben="${k}" class="${lebenWahl === k ? 'an' : ''}">${t}${wert != null ? ` <small>${eur0(wert)}</small>` : ''}</button>`;
  let h = kopf5('Fixkosten', satz, kontoWahlHtml()) + `<div class="s5-zahlen">${zahlen}</div>
    <section class="card s5-karte fix5-balken"><div class="s5-kt"><div class="s5-kt-t"><h2>Dein Monat in einem Balken</h2>
      <p class="s5-erkl">Dunkel = Fixkosten je Art, hell = Lebenshaltung, rot schraffiert = was fehlt. Der senkrechte Strich ist dein Einkommen (Gehalt + übliche sonstige Einnahmen). Fläche anklicken: Einzelheiten.${ks ? ' <b>Gilt für alle Konten</b> – die Kontenauswahl wirkt nur auf die Verträge.' : ''}</p></div></div>
      ${geldBalken({ ...R, ein: E, aus: R.fix + L, erg: rest }, teile)}
      <details class="fix-grundlage"${fixGrundlageAuf ? ' open' : ''}><summary>Gerechnet mit Gehalt ${eur0(G)} (${monLang(R.gehaltMonat)}), sonstigen Einnahmen ${eur0(R.sonst)} (typischer Monat) und Lebenshaltung ${eur0(L)} (${lebenName()}) · <span class="link">Lebenshaltung ändern</span></summary>
        <div class="fix-einst"><div class="fix-bezug-zeile"><span>Lebenshaltung</span><div class="seg fix-bezug">${lh.monate.length ? knopf('vormonat', `Vormonat ${MON[+lh.monate.at(-1).slice(5) - 1]}`, lh.werte.at(-1)) : ''}${knopf('schnitt', 'Ø 12 Monate', lh.schnitt)}${knopf('typisch', 'typischer Monat', lh.typisch)}${knopf('eigen', 'eigener Wert')}</div>
          ${lebenWahl === 'eigen' ? `<label class="fix-eigen"><input type="number" id="leben-eigen" min="0" step="50" inputmode="numeric" value="${Math.round(L / 100)}"> € / Monat</label>` : ''}</div></div>
        <p class="muted klein">Lebenshaltung = alle übrigen Ausgaben deiner Konten (Einkauf, Tanken, Freizeit, Urlaub, Anschaffungen) ohne Fixkosten und ohne Gemeinschaftskonto, ${esc(monatsText(lh.monate))}. „Typischer Monat“ ist der Median – einzelne teure Monate zählen dann weniger. Die Wahl gilt überall: normaler Monat, laufender Monat und Prognose. Beim Vormonat zeigt das Cockpit zum Vergleich die Prognose mit Ø 12 Monate.</p>
      </details>
    </section>`;
  const reiter = (k, t) => `<button data-fixtab="${k}" class="${S.fixtab === k ? 'an' : ''}">${t}</button>`;
  h += `<div class="fix-tabs"><div class="seg">${reiter('vertraege', `Verträge <small>${aktiv.length}</small>`)}${reiter('kalender', 'Wann abgebucht wird')}${S.fixtab === 'plan' ? reiter('plan', 'Was wäre wenn …') : ''}</div></div>`;
  h += S.fixtab === 'kalender' ? `<div class="card fix-zk k3">${zahlungskalenderHtml(aktiv)}</div>${sicher(() => fristenListe(H))}`
    : S.fixtab === 'unterhalt' ? `<div class="s5">${sicher(() => unterhaltSeite(H)) || '<div class="card leer">Die Unterhalts-Übersicht konnte nicht berechnet werden.</div>'}</div>`
    : S.fixtab === 'plan' ? `<div class="card fix-plan k3" id="fix-plan">${planHtml()}</div>`
      : fixVertraegeAnsicht({ liste, arten, ueber, pct, pm, vomGemeinsamen, aktiv, alle, nFrueher, nAelter, termine, tSumme, R });
  h += `<details class="fix-fuss muted klein"><summary>So wird gerechnet</summary><p>Fixkosten sind automatisch erkannte regelmäßige Zahlungen (gleicher Empfänger und Verwendungszweck, regelmäßiger Abstand; jährliche anteilig je Monat). Deine Überweisungen aufs Gemeinschaftskonto zählen mit, was von dort abgeht, nicht noch einmal. Normaler Monat = Gehalt + typische sonstige Einnahmen − Fixkosten − Lebenshaltung. Stand ${dde(D.bis)}.</p></details>`;
  return h;
}

// Verträge nach Art gruppiert (Art als Kopf, die Verträge eingerückt darunter), daneben Wofür, Lebenshaltung und die nächsten Abbuchungen
// Für freie Fläche neben den Verträgen: feste Abbuchungen der nächsten 12 Monate als Säulen (außer der Reihe hervorgehoben)
// und ein paar Eckdaten
function fixJahrHtml(aktiv) {
  const Z = zahlungsDaten(aktiv), max = Math.max(1, ...Z.monate.map((m) => m.summe));
  const normal = Z.tag1.reduce((t, x) => t + x.c, 0), teuer = [...Z.monate].sort((a, b) => b.summe - a.summe)[0];
  const extra = Z.monate.reduce((t, m) => t + m.extra.reduce((s, f) => s + f.betrag, 0), 0);
  const maxX = Math.max(1, ...Z.monate.map((m) => m.summe - normal));
  const saeulen = `<div class="s5-teil fuell-aus" data-fuell="1"><h3>Außer der Reihe – die nächsten 12 Monate</h3>
    <div class="mj">${Z.monate.map((m) => { const ex = Math.max(0, m.summe - normal); return `<button class="mj-s" data-fixtab="kalender" title="${esc(`${monLang(m.k)}: ${eur0(m.summe)} feste Abbuchungen${m.extra.length ? ` – außer der Reihe: ${m.extra.map((f) => `${vertragName(f)} ${eur0(f.betrag)}`).join(', ')}` : ' – nichts außer der Reihe'}`)}">
      <span class="mj-w">${ex ? eur0(ex) : ''}</span><span class="mj-b"><i class="mj-x" style="height:${(ex / maxX) * 100}%"></i></span><span class="mj-m">${MON[+m.k.slice(5) - 1].slice(0, 1)}</span></button>`; }).join('')}</div>
    <p class="s5-erkl">zusätzlich zu ${eur0(normal)}, die jeden Monat gleich abgehen · Säule anklicken: Kalender</p></div>`;
  const fakten = `<dl class="s5-dl fuell-aus" data-fuell="2">
    <div><dt>Teuerster Monat</dt><dd>${teuer ? `${monKurz(teuer.k)} · ${eur0(teuer.summe)}` : '–'}</dd></div>
    <div><dt>Außer der Reihe im Jahr</dt><dd>${eur0(extra)}</dd></div>
    ${Z.gt ? `<div><dt>Gehalt kommt um den</dt><dd>${Z.gt}.</dd></div>` : ''}</dl>`;
  // kürzlich beendete Verträge (letzte 12 Monate): was weggefallen ist und wie viel das im Monat spart
  const seit = plusTage(D.bis, -365);
  // ohne Verträge, bei denen an denselben Empfänger weiter gezahlt wird (umgestellt, nicht beendet – z. B. Unterhalt je Kind statt gesamt)
  const laufendAn = new Set(aktiv.map((f) => empfaengerKey(f.name)));
  const weg = fixkostenErkennen().filter((f) => !f.aktiv && !f.gemeinsam && f.zuletzt >= seit && !laufendAn.has(empfaengerKey(f.name))).sort((a, b) => b.proMonat - a.proMonat);
  const beendet = weg.length ? `<div class="s5-teil fuell-aus" data-fuell="3"><h3>In den letzten 12 Monaten beendet</h3><div class="nt">${weg.map((f, i) => `<button class="nt-z bw-z${i ? ' fuell-aus' : ''}"${i ? ` data-fuell="${3 + i}" data-stopp` : ''} data-fix="${esc(vertragsKey(f))}" title="Anklicken: alle Zahlungen"><span class="nt-n">${esc(vertragName(f))} <small>bis ${dde(f.zuletzt).slice(3)}</small></span><b>${eur0(f.proMonat)}/Monat</b></button>`).join('')}</div></div>` : '';
  return saeulen + fakten + beendet;
}
const fvId = (art) => `fv-${norm(art).replace(/[^a-z]+/g, '-')}`;
// Farbe je Art: von dunkel (größter Posten) nach hell, alle im Ton der Fixkosten
const fvFarbe = (i, n) => `color-mix(in srgb, var(--fest) ${Math.round(100 - (i / Math.max(1, n - 1)) * 58)}%, var(--surface))`;
function fixVertraegeAnsicht(o) {
  const { liste, arten, ueber, pct, pm, vomGemeinsamen, aktiv, alle, nFrueher, nAelter, termine, tSumme, R } = o;
  const seg = (k, t) => `<button data-fixansicht="${k}" class="${fixAnsicht === k ? 'an' : ''}">${t}</button>`;
  const e2 = (c) => EUR.format(c / 100);
  const da = ueber.filter((g) => g.summe > 0), farbeVon = new Map(da.map((g, i) => [g.art, fvFarbe(i, da.length)]));
  const farbe = (art) => farbeVon.get(art) || 'var(--muted)';
  const maxG = Math.max(1, ...arten.map((g) => g.summe));
  const anzahl = (n) => `${n} ${n === 1 ? 'Vertrag' : 'Verträge'}`;
  const gruppe = (g) => {
    const fs = [...g.fs].sort((a, b) => (b.aktiv - a.aktiv) || b.proMonat - a.proMonat);
    const kind = (f) => {
      const titel = fixTitel(f, g.art), vt = verlaufText(f), n = naechsteAbbuchung(f);
      const rhythmus = `${f.rh.name} ${e2(f.betrag)}`, wann = f.aktiv ? (n ? (n <= D.bis ? `fällig seit ${dde(n).slice(0, 6)}, noch nicht gebucht` : `nächste ${dde(n).slice(0, 6)}`) : '') : `beendet ${dde(f.zuletzt).slice(3)}`;
      const unter = [titel !== f.name ? f.name : '', vt].filter(Boolean).map(esc).join(' · ');
      return `<button class="vg-z${f.aktiv ? '' : ' beendet'}" data-fix="${esc(vertragsKey(f))}" title="${esc(vertragName(f))} – alle Zahlungen anzeigen">
        <span class="vg-zn">${esc(titel)}${unter ? `<small>${unter}</small>` : ''}<small class="vg-mobil">${esc([rhythmus, wann].filter(Boolean).join(' · '))}</small></span>
        <span class="vg-zr">${esc(rhythmus)}${wann ? `<small>${esc(wann)}</small>` : ''}</span>
        <b class="vg-zw">${f.aktiv ? eur0(f.proMonat) : '–'}</b><span class="vg-zp">${f.aktiv ? pct(f.proMonat) : ''}</span></button>`;
    };
    return `<section class="vg" id="${fvId(g.art)}" style="--vg:${farbe(g.art)}">
      <div class="vg-k"><span class="vg-n"><b>${esc(g.art)}</b><small>${g.laufend ? anzahl(g.laufend) : 'beendet'}${g.fs.length > g.laufend && g.laufend ? ` · ${g.fs.length - g.laufend} beendet` : ''}${['Kindesunterhalt', 'Trennungsunterhalt'].includes(g.art) ? ` · ${zl('Monat für Monat →', { fixtab: 'unterhalt' })}` : ''}</small></span>
        <span class="vg-b"><i style="width:${Math.max(1, (g.summe / maxG) * 100)}%"></i></span><b class="vg-w">${g.summe ? eur0(g.summe) : '–'}</b><span class="vg-p">${g.summe ? pct(g.summe) : ''}</span></div>
      <div class="vg-l">${fs.map(kind).join('')}</div></section>`;
  };
  const vertraege = `<div class="vg-kopf"><span>Art · Vertrag</span><span></span><span>pro Monat</span><span>% Gehalt</span></div>${arten.map(gruppe).join('')}
    <div class="vg-summe"><span>Summe laufend<small>${eur0(pm * 12)} im Jahr</small></span><span></span><b>${eur0(pm)}</b><span>${pct(pm)}</span></div>`;
  const gem = vomGemeinsamen.length ? `<p class="s5-erkl"><b>Vom Gemeinschaftskonto bezahlt</b> (nicht mitgezählt – ihr deckt sie aus euren Einzahlungen): ${vomGemeinsamen.filter((f) => f.aktiv).map((f) => `${esc(f.name)} ${e2(f.betrag)}`).join(' · ') || '–'}</p>` : '';
  // Wofür: ein Balken = alle Fixkosten, darunter die Arten mit Anteil
  const wofuer = !da.length ? '<div class="leer klein">Keine laufenden Fixkosten.</div>'
    : `<div class="wf5-b">${da.map((g) => `<i style="width:${(g.summe / pm) * 100}%;background:${farbe(g.art)}" data-springe="#${fvId(g.art)}" title="${esc(g.art)}: ${eur0(g.summe)} im Monat"></i>`).join('')}</div>
      <div class="wf5">${da.map((g) => `<button class="wf5-z" data-springe="#${fvId(g.art)}" title="Anklicken: die Verträge"><i style="background:${farbe(g.art)}"></i><span class="wf5-n">${esc(g.art)}<small>${anzahl(g.laufend)} · ${pct(g.summe)} vom Gehalt</small></span><b>${eur0(g.summe)}</b><span class="wf5-p">${Math.round((g.summe / pm) * 100)} %</span></button>`).join('')}</div>`;
  return `<div class="s5-raster fix5">
    ${karte5('Verträge', 'nach Art gruppiert: oben die Summe der Art, eingerückt die einzelnen Verträge · anklicken: alle Zahlungen', `<div class="seg fix-seg">${seg('laufend', `Laufend (${aktiv.length})`)}${nFrueher ? seg('frueher', `+ frühere seit 2020 (${nFrueher})`) : ''}${nFrueher + nAelter ? seg('alle', `alle (${alle.length})`) : ''}</div>${liste.length ? `<div class="vgs">${vertraege}</div>` : '<div class="leer">Keine regelmäßigen Zahlungen gefunden.</div>'}${gem}`, 's5-b2')}
    <div class="s5-spalte">
      ${karte5('Wofür', `Anteil an deinen Fixkosten (${eur0(pm)} im Monat) · anklicken: die Verträge`, wofuer)}
      ${lebenKarte(R)}
      ${karte5('Nächste 30 Tage', 'Feste Abbuchungen je Tag, dazwischen das erwartete Gehalt · anklicken: alle Zahlungen', termineHtml(termine, 14) + fixJahrHtml(aktiv), '', zl(`<span class="s5-wert">${eur0(tSumme)}</span>`, { fixtab: 'kalender' }))}
    </div>
  </div>`;
}

// Lebenshaltung: wofür das übrige Geld geht (Ø je Monat der letzten 12 Monate, ohne Verträge) – jede Zeile führt zu genau diesen Buchungen
function lebenKarte(R) {
  const lh = R.lh;
  if (!lh.monate.length) return '';
  // Grundlage Vormonat: Kopfwert und Zeilen aus dem Vormonat (derselbe Wert wie im normalen Monat), Ø 12 Monate daneben
  if (lebenWahl === 'vormonat') {
    const vm = lh.monate.at(-1), wert = lh.werte.at(-1), kurz = MONAT[+vm.slice(5) - 1];
    const zielVm = (kat) => zuBuchungen({ art: 'aus', nf: '1', ...monatZiel(vm), ...(kat ? { kat } : {}) });
    const l = lh.katsVm, top = l.slice(0, 7), rest = l.slice(7), rC = rest.reduce((t, k) => t + k.c, 0), rO = rest.reduce((t, k) => t + k.o, 0);
    // gezeigte Euro-Werte so gerundet, dass die Zeilen die Summe ergeben (Vormonat und Ø je für sich)
    const cs = [...top.map((k) => k.c), ...(rest.length ? [rC] : [])], os = [...top.map((k) => k.o), ...(rest.length ? [rO] : [])], cZ = rundeTeile(cs), oZ = rundeTeile(os);
    const zeile = (i, n, c, o, ziel, sub = '') => ({ n, sub, c, w: c > 0 ? eur0(cZ[i]) : '–', marke: o > 0 ? o : null, p: o > 0 ? `Ø ${eur0(oZ[i])}` : '–', farbe: 'var(--variabel)', ziel });
    const liste = balkenListe([...top.map((k, i) => zeile(i, esc(schoen(k.kat)), k.c, k.o, zielVm(k.kat))),
      ...(rest.length ? [zeile(top.length, `Übrige (${rest.length})`, rC, rO, zielVm(''), rest.slice(0, 3).map((k) => esc(schoen(k.kat))).join(', '))] : []),
      { n: '<b>Summe</b>', c: 0, w: `<b>${eur0(wert)}</b>`, p: `<b>Ø ${eur0(lh.schnitt)}</b>`, cls: 'bl-summe' }],
      { max: Math.max(1, ...top.map((k) => Math.max(k.c, k.o)), rC, rO), kopf: ['Kategorie', kurz, 'Ø 12 Mon.'] });
    return karte5('Lebenshaltung', `Wofür das übrige Geld geht: Vormonat ${esc(monLang(vm))}, ohne Verträge · daneben Ø 12 Monate ${esc(monatsText(lh.monate))} · anklicken: genau diese Buchungen`,
      liste + RUNDUNG, '', zl(`<span class="s5-wert">${eur0(wert)}</span>`, zielVm('')), 'fix-leben');
  }
  const zr = `${lh.monate[0]}_${lh.monate[lh.monate.length - 1]}`;
  const ziel = (kat) => zuBuchungen({ art: 'aus', zr, nf: '1', ...(kat ? { kat } : {}) });
  const top = lh.kats.slice(0, 7), rest = lh.kats.slice(7), restC = rest.reduce((t, k) => t + k.c, 0);
  const anteil = (c) => `${Math.round((c / lh.schnitt) * 100)} %`;
  const liste = balkenListe([...top.map((k) => ({ n: esc(schoen(k.kat)), c: k.c, p: anteil(k.c), farbe: 'var(--variabel)', ziel: ziel(k.kat) })),
    ...(restC > 0 ? [{ n: `Übrige (${rest.length})`, sub: rest.slice(0, 3).map((k) => esc(schoen(k.kat))).join(', '), c: restC, p: anteil(restC), farbe: 'var(--muted)', ziel: ziel('') }] : [])]);
  const anders = lebenWahl !== 'schnitt' ? `<p class="s5-erkl">Gerechnet wird mit ${esc(lebenName())}: ${eur0(R.leben)}.</p>` : '';
  return karte5('Lebenshaltung', `Wofür das übrige Geld geht: Ø je Monat ${esc(monatsText(lh.monate))}, ohne Verträge · anklicken: genau diese Buchungen`, liste + anders, '', zl(`<span class="s5-wert">${eur0(lh.schnitt)}</span>`, ziel('')), 'fix-leben');
}

// Zahlungskalender: die nächsten 12 Monate untereinander, die Tage nebeneinander. Monatliche Zahlungen (orange),
// Zahlungen außer der Reihe – jährlich, halb- oder vierteljährlich – (violett, beschriftet) und das Gehalt (grün).
// Kreisfläche ∝ Betrag; rechts die Summe der festen Abbuchungen je Monat.
function termineImMonat(f, k) {
  const letzter = +monatsletzter(`${k}-01`).slice(8);
  if (f.rh.proJahr === 12) return [Math.min(zahltag(f), letzter)];
  const tage = [], a = Date.parse(`${k}-01`), b = Date.parse(monatsletzter(`${k}-01`)) + 864e5 - 1;
  let t = Date.parse(f.zuletzt);
  if (f.zuletzt.slice(0, 7) === k) tage.push(+f.zuletzt.slice(8));
  for (let i = 0; i < 60 && t <= b; i++) { t += f.rh.tage * 864e5; if (t >= a && t <= b) tage.push(new Date(t).getUTCDate()); }
  return tage;
}

function zahlungsDaten(lauf) {
  const jetzt = D.bis.slice(0, 7), ek = einkommen(), lohn = ek.aktuell.wert || ek.schnitt.wert, gt = gehaltstag();
  const monate = [];
  for (let i = 0; i < 12; i++) {
    const k = mVor(jetzt, i), tage = new Map();
    for (const f of lauf) for (const d of termineImMonat(f, k)) {
      if (!tage.has(d)) tage.set(d, { mon: 0, extra: [], fs: [] });
      const x = tage.get(d);
      if (f.rh.proJahr === 12) { x.mon += f.betrag; x.fs.push(f); } else x.extra.push(f);
    }
    const summe = [...tage.values()].reduce((t, x) => t + x.mon + x.extra.reduce((s, f) => s + f.betrag, 0), 0);
    const extra = [...tage.values()].flatMap((x) => x.extra);
    monate.push({ k, tage, summe, extra });
  }
  // monatliche Abbuchungen je Tag (für Satz und Tagesliste) – gleich in jedem Monat
  const tag1 = Array.from({ length: 31 }, () => ({ c: 0, fs: [] }));
  for (const f of lauf) if (f.rh.proJahr === 12) { const t = tag1[zahltag(f) - 1]; t.c += f.betrag; t.fs.push(f); }
  return { monate, lohn, gt, jetzt, tag1, lohnMon: ek.letzter };
}

function zahlungskalenderHtml(lauf) {
  const Z = zahlungsDaten(lauf), { monate, lohn, gt, jetzt } = Z;
  const ges = Z.tag1.reduce((t, x) => t + x.c, 0);
  if (!ges) return '<div class="leer">Keine regelmäßigen Abbuchungen.</div>';
  let kum = 0, bisTag = 31;
  for (let i = 0; i < 31; i++) { kum += Z.tag1[i].c; if (kum >= ges * 0.9) { bisTag = i + 1; break; } }
  const vorGehalt = gt ? Z.tag1.slice(0, gt - 1).reduce((t, x) => t + x.c, 0) : ges;
  const extraJahr = monate.reduce((t, m) => t + m.extra.reduce((s, f) => s + f.betrag, 0), 0);
  const lohnText = `${MONAT[+Z.lohnMon.slice(5) - 1]}: ${eur0(lohn)}`;
  const satz = `<b>${Math.round((kum / ges) * 100)} %</b> der monatlichen Abbuchungen (${eur0(kum)} von ${eur0(ges)}) gehen bis zum <b>${bisTag}.</b> ab${gt ? `, das Gehalt (zuletzt ${lohnText}) kommt erst um den <b>${gt}.</b> Zum Monatsanfang sollten also gut <b>${eur0(vorGehalt)}</b> auf dem Konto sein` : ''}.
    ${extraJahr ? ` Außer der Reihe kommen in den nächsten 12 Monaten <b>${eur0(extraJahr)}</b> dazu – im Schnitt ${eur0(extraJahr / 12)} im Monat.` : ''}`;
  const maxTag = Math.max(lohn || 0, ...monate.flatMap((m) => [...m.tage.values()].map((x) => x.mon)), 1);
  const R = (c, min = 4) => Math.max(min, Math.sqrt(c / maxTag) * 13);
  const maxSum = Math.max(...monate.map((m) => m.summe), 1), normal = ges;
  const pos = (d) => `${((d - 0.5) / 31) * 100}%`;
  const heute = +D.bis.slice(8);
  const kreis = (cls_, d, c, tip, extra = '') => { const r = R(c, cls_ === 'extra' ? 6 : 4); return `<span class="zk-k ${cls_}" role="button" tabindex="0" style="left:${pos(d)};width:${r * 2}px;height:${r * 2}px" title="${esc(tip)}" data-tipp="${esc(tip)}">${extra}</span>`; };
  const zeilen = monate.map((m, i) => {
    let inhalt = '';
    for (const [d, x] of [...m.tage].sort((a, b) => a[0] - b[0])) {
      const vorbei = m.k === jetzt && d <= heute, offen = vorbei && x.fs.some((f) => ausstehend(f));   // Zahltag vorbei, aber noch nicht gebucht
      if (x.mon) inhalt += kreis(`mon${vorbei ? ' vorbei' : ''}`, d, x.mon, `${d}. ${MONAT[+m.k.slice(5) - 1]}: ${eur0(x.mon)}${vorbei ? (!offen ? ' (schon abgebucht)' : x.fs.every((f) => ausstehend(f)) ? ' (noch nicht gebucht)' : ' (teils noch nicht gebucht)') : ''}\n${x.fs.map((f) => `${vertragName(f)}: ${EUR.format(f.betrag / 100)}${vorbei && ausstehend(f) ? ' – noch nicht gebucht' : ''}`).join('\n')}`);
      for (const f of x.extra) {
        inhalt += kreis('extra', d, f.betrag, `${d}. ${MONAT[+m.k.slice(5) - 1]}: ${vertragName(f)} ${EUR.format(f.betrag / 100)} (${f.rh.name})`);
        inhalt += `<span class="zk-l${d > 18 ? ' links' : ''}" role="button" tabindex="0" style="left:${pos(d)}" data-fix="${esc(vertragsKey(f))}">${esc(vertragName(f))} <b>${eur0(f.betrag)}</b></span>`;
      }
    }
    if (gt && lohn) inhalt += kreis('lohn', gt, lohn, `Gehalt um den ${gt}.: ≈ ${eur0(lohn)} (zuletzt ${lohnText})`);
    const mehr = m.summe - normal;
    return `<div class="zk-zeile${m.k === jetzt ? ' jetzt' : ''}">
      <span class="zk-m"><b>${MON[+m.k.slice(5) - 1]}</b> ${m.k.slice(2, 4)}</span>
      <div class="zk-spur">${m.k === jetzt ? `<span class="zk-heute" style="left:${pos(heute + 0.5)}"></span>` : ''}${inhalt}</div>
      <span class="zk-s"><i style="width:${(m.summe / maxSum) * 100}%"></i><b>${eur0(m.summe)}</b>${mehr >= 500 ? `<small>+${eur0(mehr)}</small>` : ''}</span></div>`;
  }).join('');
  return `<p class="ab-satz">${satz}</p>
    <div class="zk-leg"><span><i class="zk-k mon"></i>monatlich</span><span><i class="zk-k extra"></i>außer der Reihe (jährlich, halb- oder vierteljährlich)</span><span><i class="zk-k lohn"></i>Gehalt (zuletzt ${eur0(lohn)})</span><span class="muted">Kreisfläche = Betrag · Kreis antippen: Einzelheiten</span></div>
    <div class="zk">
      <div class="zk-zeile zk-kopf"><span class="zk-m"></span><div class="zk-spur">${[1, 5, 10, 15, 20, 25, 31].map((d) => `<span style="left:${pos(d)}">${d}.</span>`).join('')}</div><span class="zk-s">feste Abbuchungen</span></div>
      ${zeilen}
    </div>`;
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
  const { B, G, bz, pm, L, lauf, ruecklage } = fixKontext;
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
    return `<div class="plan-start"><div class="fix-grafik-t">Heute</div>${budgetBalken([{ fk: pm, l: L }], B, G)}
      <p class="klein">${rest1 >= 0 ? `Für neue feste Kosten hast du derzeit bis zu <b>${eur0(rest1)}</b> im Monat frei, mit Sparpuffer (10 % vom Gehalt) <b>${eur0(Math.max(0, rest1 - G * 0.1))}</b>.` : `Schon heute fehlen dir im Schnitt <b>${eur0(-rest1)}</b> im Monat – neue feste Kosten gehen nur, wenn anderes wegfällt oder die Lebenshaltung sinkt.`}</p></div>`;
  }
  const pm2 = pm + neu - weg, rest2 = B - pm2 - L2, puffer = G * 0.1;
  const urteil = rest2 >= puffer ? 'gut' : rest2 >= 0 ? 'knapp' : 'nein';
  const titel = { gut: 'Ja, das kannst du dir leisten', knapp: 'Knapp – das geht nur mit wenig Puffer', nein: 'So ist das nicht leistbar' }[urteil];
  const text = urteil === 'nein'
    ? `Dir würden jeden Monat <b>${eur0(-rest2)}</b> fehlen. Dafür müsstest du die Lebenshaltung ${sp ? 'um weitere' : 'um'} ${pzVon(-rest2, L2)} senken oder andere Verträge kündigen.`
    : urteil === 'knapp'
      ? `Es blieben <b>${eur0(rest2)}</b> im Monat (${pzVon(rest2, G)} ${esc(bz.vom)}). Empfohlen sind mindestens 10 % vom Gehalt (${eur0(puffer)}) als Puffer zum Sparen und für Unvorhergesehenes.`
      : `Danach bleiben dir <b>${eur0(rest2)}</b> im Monat (${pzVon(rest2, G)} ${esc(bz.vom)}) zum Sparen und für Unvorhergesehenes.`;
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
    const netto = einkommen().aktuell.wert || B;
    grenzen += `<li>Warmmiete höchstens <b>${eur0(Math.max(0, wohnAlt + restL - puffer - andere))}</b> mit Puffer bzw. <b>${eur0(Math.max(0, wohnAlt + restL - andere))}</b> bis zur Grenze.</li>
      <li class="muted">Faustregel von Vermietern und Banken: Warmmiete höchstens ein Drittel vom Netto – bei ${eur0(netto)} also ${eur0(netto / 3)}. Unterhalt und deine übrigen Fixkosten berücksichtigt sie nicht, deshalb zählt die Rechnung oben.</li>`;
  }
  let einmalHtml = '';
  if (einmal && ruecklage == null) einmalHtml = `<div class="plan-einmal"><div><b>Einmalig ${eur0(einmal)}</b> · dein heutiger Kontostand lässt sich nicht vollständig berechnen – ob das Geld reicht, kann die App deshalb nicht sagen.</div></div>`;
  else if (einmal) {
    const danach = ruecklage - einmal, bedarf = pm2 + L2;
    einmalHtml = `<div class="plan-einmal ${danach >= 3 * bedarf ? 'gut' : danach >= 0 ? 'knapp' : 'nein'}"><div><b>Einmalig ${eur0(einmal)}</b> · auf deinen Konten liegen ${eur0(ruecklage)}
      → danach ${danach >= 0 ? `<b>${eur0(danach)}</b>, das reicht für ${NUM.format(Math.round((danach / bedarf) * 10) / 10)} Monate Ausgaben (empfohlen als Notgroschen: 3 Monate = ${eur0(3 * bedarf)}).` : `<b>fehlen ${eur0(-danach)}</b>${rest2 > 0 ? ` – mit deinem Spielraum in etwa ${Math.ceil(-danach / rest2)} Monaten angespart.` : '.'}`}</div>
      <div class="klein muted">Konten ohne Gemeinschaftskonto und Pockets, Mietkaution und die Konten der Kinder; Depot ist nicht enthalten.</div></div>`;
  }
  return `<div class="plan-urteil ${urteil}"><b>${titel}</b><div>${text}</div></div>
    ${budgetBalken([{ titel: 'Heute', fk: pm, l: L }, { titel: 'Mit Plan', fk: pm2, l: L2 }], B, G)}
    <table class="plan-tab"><thead><tr><th></th><th class="r">heute</th><th class="r">mit Plan</th><th class="r">Änderung</th></tr></thead><tbody>
      ${zeile('Fixkosten / Monat', pm, pm2)}
      ${zeile('Fixkostenquote (vom Gehalt)', G ? (pm / G) * 10000 : 0, G ? (pm2 / G) * 10000 : 0, true, (v) => `${NUM.format(Math.round(v / 10) / 10)} %`).replace(/([+−][\d,]+) %<\/td><\/tr>$/, '$1 Pkt.</td></tr>')}
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


// ======================================================================= Herunterladen
function dateiname(teil) {
  const f = [S.jahr, monateWahl().map((m) => MON[m - 1]).join(' '), S.konto, S.kat, S.ukat, S.q && S.q.replace(/["|<>]/g, ' ')].filter(Boolean).join(' ');
  const heute = heuteLokal();
  return `Finanzen ${teil}${f ? ' – ' + f : ''} (${heute})`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function tabelleExport() {
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
const ZUSTAND = ['q', 'jahr', 'monat', 'konto', 'kat', 'ukat', 'art', 'umb', 'tab', 'stichtag', 'wahl', 'kart', 'fixtab', 'zr', 'nf', 'neu', 'vertrag', 'reise', 'sjahr', 'sfilter', 'sabf', 'gmonat', 'gbasis', 'gtjahr'];
const zustand = (x) => JSON.stringify(ZUSTAND.map((k) => x[k]));

function setze(p, { tippen = false } = {}) {
  const vorher = zustand(S), tabVorher = S.tab;
  Object.assign(S, p);
  if ('tab' in p && !('fixtab' in p) && S.fixtab === 'unterhalt' && S.tab !== 'fix') S.fixtab = 'vertraege';   // Familie verlassen
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
  $('#btn-lupe').hidden = false;
  navZeigen();
  $('#werkzeug').hidden = t !== 'buchungen';
  schnellSuche();
  $('#fuss').hidden = t === 'start';
  $('#seite-start').hidden = t !== 'start' && !UEBERBLICK[t];
  $('#seite-kennzahlen').hidden = t !== 'kennzahlen';
  $('#tabelle-card').hidden = t === 'start' || t === 'kennzahlen' || !!UEBERBLICK[t];
  filterZeigen(conds);
  // jede Grafik für sich: ein Fehler in einer soll die anderen nicht leer lassen (sicher, oben)
  if (t === 'start') sicher(cockpitSeite);
  else if (UEBERBLICK[t]) { try { UEBERBLICK[t](); } catch (e) { console.error(e); $('#s5').innerHTML = '<div class="card leer">Dieser Überblick konnte nicht berechnet werden.</div>'; } }
  else if (t === 'kennzahlen') sicher(k5Seite);
  else tabelle(conds);
}

// Buchungen ohne Suche: ein paar Vorschläge zum Antippen
function schnellSuche() {
  const box = $('#schnell');
  box.hidden = S.tab !== 'buchungen' || !!S.q;
  if (box.hidden) return;
  const V = [['Über 500 €', '>500'], ['Gehalt', 'gehalt'], ['Miete', 'miete'], ['Versicherungen', 'versicherung'], ['Unterhalt', 'unterhalt'], ['Tanken', 'tankstelle|tanken'], ['Erstattungen', 'erstattung']];
  box.innerHTML = `<span class="muted klein">Schnell finden:</span>${V.map(([t, q]) => `<button class="chip" data-schnell="${esc(q)}">${t}</button>`).join('')}`;
  box.querySelectorAll('[data-schnell]').forEach((b) => b.onclick = () => setze({ q: b.dataset.schnell }));
}

function hashSchreiben(hist = 'ersetzen') {
  const p = new URLSearchParams();
  for (const k of ['q', 'jahr', 'monat', 'zr', 'nf', 'neu', 'vertrag', 'reise', 'konto', 'kat', 'ukat', 'stichtag', 'wahl', 'sjahr', 'sfilter', 'sabf', 'gmonat', 'gbasis', 'gtjahr']) if (S[k]) p.set(k, S[k]);
  if (S.kart !== 'aus') p.set('kart', S.kart);
  if (S.fixtab !== 'vertraege') p.set('fixtab', S.fixtab);
  if (S.art !== 'alle') p.set('art', S.art);
  if (S.umb) p.set('umb', '1');
  if (S.tab !== 'start') p.set('tab', S.tab);
  const h = p.toString(), url = h ? '#' + h : location.pathname + location.search;
  if (hist === 'neu') { stufe++; history.pushState({ fd: stufe }, '', url); }
  else if (hist === 'ersetzen') history.replaceState({ fd: stufe }, '', url);
}
let ersterStart = true;
// So sieht jede Seite beim Öffnen der App aus: aktuelles Jahr, alle Konten, keine Suche, keine Auswahl
const startJahr = () => { const jetzt = new Date().getFullYear(); return String(D.rows.some((r) => r.y === jetzt) ? jetzt : +D.bis.slice(0, 4)); };
const grundZustand = () => ({ ...S0, jahr: startJahr(), tab: S.tab, fixtab: S.fixtab === 'unterhalt' ? 'unterhalt' : S0.fixtab, sort: S.sort, dir: S.dir });
function abweichend() {
  if (!D) return false;
  const g = grundZustand();
  return ZUSTAND.some((k) => k !== 'tab' && String(S[k]) !== String(g[k])) || fixAnsicht !== 'laufend';
}
function zuruecksetzen() {
  fixAnsicht = 'laufend';
  document.querySelectorAll('.kw-liste').forEach((l) => { l.hidden = true; });
  setze(grundZustand());
  window.scrollTo({ top: 0 });
}
function hashLesen() {
  const p = new URLSearchParams(location.hash.slice(1));
  S = { ...S0, sort: S.sort, dir: S.dir };
  // Grundeinstellung beim Öffnen ohne Auswahl in der Adresse: das aktuelle Jahr (ohne Daten dafür: das letzte Jahr mit Daten)
  if (ersterStart && D && ![...p.keys()].length) S.jahr = startJahr();
  if (D) ersterStart = false;
  for (const k of ['q', 'konto', 'kat', 'ukat', 'wahl']) if (p.get(k)) S[k] = p.get(k);
  if (/^\d{4}(,\d{4})*$/.test(p.get('jahr') || '')) S.jahr = p.get('jahr');
  if (/^\d{1,2}(,\d{1,2})*$/.test(p.get('monat') || '')) S.monat = p.get('monat');
  if (['ein', 'pruefen', 'tags'].includes(p.get('kart'))) S.kart = p.get('kart');
  if (['kalender', 'plan', 'unterhalt'].includes(p.get('fixtab'))) S.fixtab = p.get('fixtab');
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.get('stichtag') || '')) S.stichtag = p.get('stichtag');
  if (/^\d{4}-\d{2}_\d{4}-\d{2}$/.test(p.get('zr') || '')) S.zr = p.get('zr');
  if (p.get('nf') === '1') S.nf = '1';
  if (p.get('neu') === '1') S.neu = '1';
  if (p.get('vertrag')) S.vertrag = p.get('vertrag');
  if (p.get('reise')) S.reise = p.get('reise');
  if (['aus', 'ein'].includes(p.get('art'))) S.art = p.get('art');
  S.umb = p.get('umb') === '1';
  if (/^\d{4}$/.test(p.get('sjahr') || '')) S.sjahr = p.get('sjahr');
  if (/^\w{1,20}$/.test(p.get('sfilter') || '')) S.sfilter = p.get('sfilter');
  if (/^\w{1,20}$/.test(p.get('sabf') || '')) S.sabf = p.get('sabf');
  if (/^\d{4}-\d{2}$/.test(p.get('gmonat') || '')) S.gmonat = p.get('gmonat');
  if (['vm', 'vj'].includes(p.get('gbasis'))) S.gbasis = p.get('gbasis');
  if (/^\d{4}$/.test(p.get('gtjahr') || '')) S.gtjahr = p.get('gtjahr');
  if (['kennzahlen', 'buchungen', 'uebersicht', 'konten', 'fix', 'gehalt', 'steuer', 'geldfluss', 'vermoegen', 'einkommen', 'familie'].includes(p.get('tab'))) S.tab = p.get('tab');
  if (p.get('tab') === 'cockpit') S.tab = 'start';
}

// Ergebnis der Nachprüfung (nachpruefen.py) – nur wenn etwas nicht bestanden ist, unauffällig mit aufklappbarer Liste
function nachpruefungText() {
  const n = D?.j?.nachpruefung;
  if (!n || n.ok !== false) return '';
  const m = /(\d+)\s+von\s+(\d+)/.exec(n.ergebnis || '');
  return m ? `Nachprüfung: ${m[1]} von ${m[2]} bestanden` : 'Nachprüfung: nicht alles bestanden';
}
function nachpruefungHtml() {
  const t = nachpruefungText();
  if (!t) return '';
  const n = D.j.nachpruefung, f = n.fehler || [];
  return `<details class="nachpruefung klein"><summary>${t}${n.zeit ? ` (${dde(n.zeit.slice(0, 10))}, ${n.zeit.slice(11, 16)} Uhr)` : ''}</summary>
    ${f.length ? `<ul>${f.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<p class="muted">Diese Prüfungen sind nicht bestanden. Die Daten wurden trotzdem übernommen.</p></details>`;
}

let appVersion = '';
function standZeigen() {
  const j = D.j;
  // zwei Zeilen: Datenstand, darunter die Versionsnummer (steht nur in sw.js – einmal lesen)
  const zeigen = () => { $('#stand').innerHTML = `<span>${NUM.format(D.rows.length)} Buchungen · ${dde(D.von)} – ${dde(D.bis)}</span>${appVersion ? `<small>Version ${esc(appVersion)}</small>` : ''}`; };
  zeigen();
  if (!appVersion) fetch('sw.js', { cache: 'no-store' }).then((r) => r.text()).then((t) => {
    const m = /VERSION = '([^']+)'/.exec(t);
    if (m && D) { appVersion = m[1]; zeigen(); }
  }).catch(() => {});
  const mail = Q.kontoEmail?.();
  const herkunft = { drive: `aus Google Drive${mail ? ` (${mail})` : ''}`, pc: `aus der verknüpften Datei ${quelle.name} auf diesem PC`, datei: `aus der Datei ${quelle.name}`, lokal: 'lokale Testdaten' }[quelle.quelle] || '';
  const erstellt = j.erstellt ? `${dde(j.erstellt.slice(0, 10))}, ${j.erstellt.slice(11, 16)} Uhr` : '';
  $('#fuss').textContent = `Daten ${herkunft}, erstellt am ${erstellt}. Neue Kontodaten einfach in Google Drive › 10 Finanzen › Eingang legen – der PC übernimmt sie automatisch; danach hier ↻.${nachpruefungText() ? ` ${nachpruefungText()} – Einzelheiten unter „Daten einlesen“.` : ''}`;
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
  const j = v.j || Q.pruefen(v.text);   // frisch geladene Fassungen bringen die schon geprüften Daten mit
  quelle = v;
  D = aufbereiten(j);
  if (LOKAL) window.__fd = { D, fix: () => fixkostenErkennen(), mr: () => monatsRechnung(), sammle, periode };   // nur zum Testen auf dem eigenen Rechner
  chatDaten(D);
  entscheidungenLaden(j).then((fehlen) => { if (fehlen && D?.j === j) { neuAufbauen(); aktualisieren(); } });
  steuerDaten(D).then(() => { if (S.tab === 'steuer') tabelle(parse(S.q)); else if (S.tab === 'start' && startOhneSteuer) { try { cockpitSeite(); } catch (e) { console.error(e); } } else if (S.tab === 'einkommen') sicher(einkommenSeite); });
  // Zusatzmodule: eigene Angaben aus diesem Gerät (IndexedDB) einmal laden, danach neu zeichnen; neuAufbauen() braucht das nicht
  H ??= modulHelfer();
  Promise.all([prognoseLaden, unterhaltLaden, fristenLaden, waechterLaden, vermoegenLaden].map((f) => Promise.resolve().then(() => f(H)).catch(console.error))).then(() => { if (D?.j === j) aktualisieren(); });
  hashLesen();
  selectsFuellen();
  $('#start').hidden = true;
  $('#dash').hidden = false;
  standZeigen();
  aktualisieren();
}

// Daten mit den aktuellen Kategorie-Entscheidungen neu aufbereiten (ohne neu zu zeichnen)
function neuAufbauen() {
  D = aufbereiten(D.j);
  if (LOKAL) window.__fd = { D, fix: () => fixkostenErkennen(), mr: () => monatsRechnung(), sammle, periode };
  chatDaten(D);
  steuerDaten(D);
}

// Minuswerte überall rot (Wunsch des Nutzers): jedes Element, dessen Text mit einem Minus vor einer Zahl beginnt.
// Eigene Klasse „ist-minus“: „minus“ setzt der Code selbst für Balken (Jahr für Jahr, Konten, Gehalt) und darf nicht verschwinden.
const MINUS = /^\s*[−-]\s?\d/;
function minusRot(root) {
  if (!root || root.nodeType !== 1 || root.closest('svg, canvas, select, option, textarea, script, style')) return;
  for (const e of [root, ...root.querySelectorAll('*')]) {
    if (e.closest('svg, canvas, select, option')) continue;
    if (e.tagName === 'BUTTON' && e.parentElement?.classList.contains('seg')) e.setAttribute('aria-pressed', String(e.classList.contains('an')));
    const n = [...e.childNodes].find((x) => x.nodeType === 1 || x.textContent.trim());
    e.classList.toggle('ist-minus', !!n && n.nodeType === 3 && MINUS.test(n.textContent));
  }
}
// Bei zwei Spalten (901–1180 px) bliebe neben einer einzelnen Karte ohne Partner die halbe Zeile leer: Die letzte Karte
// jeder ungeraden Folge einzelner Karten (zwischen breiten .s5-b2) bekommt „s5-solo“ und zieht dann über die volle Breite (app.css)
function soloMarkieren() {
  document.querySelectorAll('.s5-raster').forEach((r) => {
    let lauf = [];
    const ende = () => { lauf.forEach((k, i) => k.classList.toggle('s5-solo', i === lauf.length - 1 && lauf.length % 2 === 1)); lauf = []; };
    for (const k of r.children) {
      if (k.hidden) continue;
      if (k.classList.contains('s5-b2')) { k.classList.remove('s5-solo'); ende(); } else lauf.push(k);
    }
    ende();
  });
}
new MutationObserver((ms) => {
  let neu = false;
  for (const m of ms) {
    // Umschalter (.seg): Zustand „an“ auch für Screenreader (aria-pressed)
    if (m.type === 'attributes') { if (m.target.tagName === 'BUTTON' && m.target.parentElement?.classList.contains('seg')) m.target.setAttribute('aria-pressed', String(m.target.classList.contains('an'))); }
    else if (m.type === 'characterData') minusRot(m.target.parentElement);
    else { neu = true; for (const n of m.addedNodes) minusRot(n.nodeType === 1 ? n : n.parentElement); }
  }
  if (neu) soloMarkieren();
}).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });

// Hinweise, die sonst nur als Maus-Tooltip (title) da sind: [data-tipp] zeigt den Text beim Anklicken/Antippen als Meldung;
// auf Geräten ohne Maus genauso für jedes andere Element mit title, das selbst nichts tut
document.addEventListener('click', (e) => {
  const t = e.target.closest?.('[data-tipp]');
  if (t) { e.stopPropagation(); e.preventDefault(); toast(t.dataset.tipp); return; }
  if (!matchMedia('(hover: none)').matches) return;
  const el = e.target.closest?.('[title]');
  if (!el || el.onclick || el.closest('button, a, input, select, textarea, summary, label, [role="button"], [data-geh], [data-springe], [data-fix]') || el.querySelector('button, a, input, select, canvas, [role="button"]')) return;
  toast(el.title);
}, true);
// Tastatur: Enter/Leertaste auf Flächen mit role="button" (Zeilen, Kreise, Balkenstücke) wirken wie ein Klick
document.addEventListener('keydown', (e) => {
  if ((e.key !== 'Enter' && e.key !== ' ') || e.defaultPrevented) return;
  const t = e.target;
  if (t.getAttribute?.('role') !== 'button' || ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(t.tagName)) return;
  e.preventDefault(); t.click();
});

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
      // ohne PC-Dienst (Handy): zeigen, was im Eingang noch auf den PC wartet
      let wartend = null;
      if (Q.hatToken()) { try { wartend = await Q.eingangDateien(); } catch { wartend = null; } }
      return einlesenMeldung({ ohneDienst: true, wartend });
    }
    const start = Date.now(), seit = st.gestartet;
    txt.textContent = 'Wird eingelesen …';
    // sichtbarer Fortschritt: ein Aufbau dauert etwa 4–5 Minuten (Buchungsliste, Excel-Auswertung, Nachprüfung, App-Daten)
    const t0 = seit ? Date.parse(seit) : start;
    const balken = einlesenBalken(st.automatisch);
    const tick = setInterval(() => balken.zeit(Date.now() - t0), 1000);
    try {
      while (st.laeuft && Date.now() - start < 20 * 60e3) {
        await warte(2500);
        try { st = await dienst('/status'); } catch { /* weiter warten */ }
      }
    } finally { clearInterval(tick); balken.weg(); }
    const e = st.letztes && (!seit || st.letztes.zeit >= seit.slice(0, 19)) ? st.letztes : null;
    let neu = await datenNeuLaden(false);
    // Google Drive braucht nach dem Aufbau etwas, bis die neue Datei hochgeladen ist
    for (let i = 0; !neu && quelle?.quelle === 'drive' && e?.status === 'aufgebaut' && i < 4; i++) { await warte(8000); neu = await datenNeuLaden(false); }
    einlesenMeldung({ e, automatisch: st.automatisch });
  } finally {
    einlesenLaeuft = false; btn.classList.remove('dreht'); btn.disabled = false; txt.textContent = 'Daten einlesen';
  }
}

// Leiste unten während des Einlesens: was passiert, wie lange es schon läuft, ungefähr wie lange noch
function einlesenBalken(automatisch) {
  let b = $('#einlesen-balken');
  if (!b) { b = Object.assign(document.createElement('div'), { id: 'einlesen-balken', className: 'einlesen-balken' }); document.body.append(b); }
  b.innerHTML = `<div><b>${automatisch ? 'Der automatische Durchgang läuft gerade' : 'Dein PC liest die neuen Daten ein'}</b>
    <span class="klein">Buchungsliste, Excel-Auswertung, Nachprüfung und App-Daten – dauert etwa 4–5 Minuten. Du kannst die App solange weiter benutzen.</span></div>
    <div class="eb-fort"><i></i></div><span class="eb-zeit">0:00</span>`;
  b.hidden = true;   // erst nach 3 Sekunden zeigen – ist nichts Neues da, ist der Dienst sofort fertig
  const fort = b.querySelector('.eb-fort i'), zeit = b.querySelector('.eb-zeit'), t1 = Date.now();
  return {
    zeit(ms) {
      const s = Math.max(0, Math.round(ms / 1000));
      if (Date.now() - t1 >= 3000) b.hidden = false;
      zeit.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      fort.style.width = `${Math.min(95, (s / 270) * 100)}%`;
    },
    weg() { b.hidden = true; },
  };
}

function einlesenMeldung({ e, ohneDienst, automatisch, wartend }) {
  let dlg = $('#dlg-einlesen');
  if (!dlg) { dlg = Object.assign(document.createElement('dialog'), { id: 'dlg-einlesen', className: 'dlg' }); document.body.append(dlg); }
  const stand = D?.j?.erstellt ? `${dde(D.j.erstellt.slice(0, 10))}, ${D.j.erstellt.slice(11, 16)} Uhr` : '';
  let h;
  if (ohneDienst) {
    const pc = matchMedia('(pointer: fine)').matches && !/android|iphone|ipad/i.test(navigator.userAgent);
    const zeit = (iso) => { const d = new Date(iso); return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`; };
    h = wartend?.length
      ? `<h2>${wartend.length === 1 ? '1 Datei wartet' : `${wartend.length} Dateien warten`} auf deinen PC</h2>
        <table class="hilfe-tab datei-tab">${wartend.map((f) => `<tr><td>${esc(f.name)}<div class="klein muted">abgelegt ${zeit(f.createdTime || f.modifiedTime)}</div></td></tr>`).join('')}</table>
        <p>Einlesen kann nur dein PC – das Handy hat dafür kein Programm. Er übernimmt die ${wartend.length === 1 ? 'Datei' : 'Dateien'} automatisch, sobald er an ist (bei der Anmeldung und danach alle 30 Minuten); danach hier noch einmal ↻.</p>
        <p class="klein muted">Bisheriger Datenstand: ${stand}.</p>`
      : `<h2>Neueste Daten geladen</h2><p>Datenstand: <b>${stand}</b>.</p>
        ${wartend ? '<p>Im Eingang wartet nichts – alles ist übernommen.</p>' : ''}
        <p class="muted">Neue Dateien im Eingang (Google Drive › 10 Finanzen › Eingang) übernimmt dein PC automatisch – bei der Anmeldung und alle 30 Minuten, solange er an ist. Am PC geht es mit diesem Knopf auch sofort.</p>`;
    if (pc) h += '<p class="klein muted">Hinweis: Auf diesem PC antwortet der Einlese-Dienst gerade nicht. Er startet bei der nächsten Windows-Anmeldung automatisch. Fragt der Browser, ob die Seite auf Geräte im lokalen Netzwerk zugreifen darf, bitte „Zulassen“ wählen.</p>';
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
      ${e.uebernommen.length ? `<table class="hilfe-tab datei-tab">${e.uebernommen.map((x) => `<tr><td>${esc(x.datei)}<div class="klein muted">${esc(x.art)}</div></td><td class="r"><b class="${x.neu ? 'pos' : 'muted'}">${NUM.format(x.neu || 0)} neu</b><div class="klein muted">${NUM.format(x.doppelt || 0)} schon vorhanden</div></td></tr>`).join('')}</table>` : ''}
      ${e.nicht.length ? `<p class="neg"><b>Nicht übernommen:</b></p><table class="hilfe-tab datei-tab">${e.nicht.map((x) => `<tr><td>${esc(x.datei)}</td><td class="klein">${esc(x.status)}</td></tr>`).join('')}</table>` : ''}
      <p class="klein muted">Übernommene Dateien liegen jetzt in Eingang › verarbeitet. Datenstand: ${stand}.</p>`;
  }
  dlg.innerHTML = `${h}${nachpruefungHtml()}<form method="dialog" class="dlg-knoepfe">${D ? '<button class="btn" value="details" id="einlesen-details">Alle Dateien im Eingang</button>' : ''}<button class="btn primary" value="ok">OK</button></form>`;
  dlg.querySelector('#einlesen-details')?.addEventListener('click', () => setTimeout(() => { setze({ tab: 'konten' }); springe('.eingang'); }, 0));
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
  let cur = 'auto';   // Standard: folgt dem Gerät (hell/dunkel)
  try { cur = localStorage.getItem('fd.theme') || 'auto'; } catch {}
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
      e.preventDefault(); if (D && S.tab !== 'buchungen') setze({ tab: 'buchungen' }); $('#q').focus(); $('#q').select();
    }
  });
  $('#q-hilfe').onclick = () => $('#dlg-hilfe').showModal();
  $('#beispiele').querySelectorAll('button').forEach((b) => b.onclick = () => { $('#dlg-hilfe').close(); setze({ q: b.textContent }); });
  $('#f-jahr').onclick = () => jahrMenu();
  document.addEventListener('click', (e) => { if (!$('#f-jahr-box').contains(e.target)) jahrMenu(false); });
  $('#f-mehr-knopf').onclick = () => { filterMehr = !filterMehr; try { localStorage.setItem('fd.filtermehr', filterMehr ? '1' : ''); } catch {} filterZeigen(parse(S.q)); };
  $('#btn-zurueck').onclick = () => zurueck();
  $('#btn-reset').onclick = () => zuruecksetzen();
  // Kontenauswahl (in Buchungen und in den Köpfen der Seiten): auf-/zuklappen, anhaken, alle
  document.addEventListener('click', (e) => {
    const auf = e.target.closest('[data-kw-auf]');
    document.querySelectorAll('.kw-liste:not([hidden])').forEach((l) => { if (!l.parentElement.contains(e.target)) { l.hidden = true; l.previousElementSibling.setAttribute('aria-expanded', 'false'); } });
    if (auf) { const l = auf.nextElementSibling; if (l.hidden) kontoWahlListe(l); l.hidden = !l.hidden; auf.setAttribute('aria-expanded', String(!l.hidden)); }
    if (e.target.closest('[data-kw-alle]')) setze({ konto: '' });
  });
  document.addEventListener('change', (e) => {
    const c = e.target.closest('[data-kw]');
    if (!c) return;
    const box = c.closest('.kw-liste');
    setze({ konto: [...box.querySelectorAll('[data-kw]:checked')].map((x) => x.dataset.kw).join('|') });
  });
  $('#f-kat').onchange = (e) => setze({ kat: e.target.value, ukat: '' });
  $('#f-umb').onchange = (e) => setze({ umb: e.target.checked });
  document.querySelectorAll('#f-art button').forEach((b) => b.onclick = () => setze({ art: b.dataset.v }));
  document.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => bereichOeffnen(b.dataset.bereich));
  $('#btn-lupe').onclick = () => { setze({ tab: 'buchungen' }); setTimeout(() => { $('#q').focus(); $('#q').select(); }, 30); };
  mehrMenuBinden();
  $('#dl-xlsx').onclick = () => exportieren('xlsx');
  $('#dl-csv').onclick = () => exportieren('csv');
  document.querySelectorAll('[data-bild]').forEach((b) => b.onclick = () => bildSpeichern(b.dataset.bild));

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
    if (!confirm('Abmelden und alles auf diesem Gerät löschen?\n\nWeg sind dann: die gespeicherten Daten, der Chat-Schlüssel, alle Einstellungen – und deine Steuer-Zuordnungen sowie Kategorie-Entscheidungen, die noch nicht an den PC übertragen sind.\nSteuer-Zuordnungen vorher sichern: Reiter „Steuer“ → „Sicherung speichern“.')) return;
    await Q.geraetLeeren();
    chatVergessen();
    D = null; quelle = null;
    $('#dlg-menu').close();
    history.replaceState(null, '', location.pathname);
    $('#tabs').hidden = true; $('#btn-lupe').hidden = true; $('#bereich-seg').hidden = true;
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
    breiteT = setTimeout(() => { const w = $('#tab-inhalt').clientWidth; if (D && (S.tab === 'uebersicht' || S.tab === 'gehalt') && Math.abs(w - breiteAlt) > 20) { breiteAlt = w; tabelle(parse(S.q)); } }, 150);
  }).observe($('#tab-inhalt'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => themeSetzen());
}

async function start() {
  events();
  chatStart({ setze: (p) => setze(p), fixkosten: () => fixkostenErkennen(), normalerMonat: () => (D ? monatsRechnung() : null) });
  themeSetzen();
  let v = null;
  if (LOKAL) v = await Q.lokalLaden().catch(() => null);
  if (!v) v = await Q.cacheLesen();
  // verknüpfte Datei am PC: ist sie neuer als die gespeicherte Fassung, gleich die neue zeigen (statt erst die alte)
  let pcOk = false, pcNeu = null;
  if (v?.quelle === 'pc') { try { pcNeu = await Q.pcLaden(v, false); pcOk = true; } catch {} if (pcNeu) v = pcNeu; }
  Q.vorladen?.();
  // Gespeicherte Daten vor dem automatischen Aufräumen des Browsers schützen
  navigator.storage?.persist?.().catch(() => {});
  if (v) {
    try { anzeigen(v); } catch (e) { return startZeigen(e.message); }
    if (v.quelle === 'drive') driveHolen(false).catch(() => {});
    if (v.quelle === 'pc') { if (!pcOk) pcHolen(false); else if (pcNeu) toast('Neue Daten geladen.'); }
  } else startZeigen();
  if ('serviceWorker' in navigator && !LOKAL) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
