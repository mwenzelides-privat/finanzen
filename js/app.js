// Finanzen – Dashboard: Übersicht, Kennzahlen, Buchungen, Kategorien, Fixkosten, Konten, Steuer. Jede Seite: ein Satz als Antwort,
// wenige erklärte Kennzahlen und Grafiken, ein Ausblick; Suche und Filter gibt es bei den Buchungen.
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
const S0 = { q: '', jahr: '', monat: '', konto: '', kat: '', ukat: '', art: 'alle', umb: false, tab: 'start', sort: 'datum', dir: -1, stichtag: '', wahl: '', kart: 'aus', fixtab: 'vertraege', zr: '', nf: '' };
let S = { ...S0 };
let F = [];            // gefilterte Buchungen (nach Datum aufsteigend)
let limit = 150;
const offen = new Set();
const charts = {};

// ======================================================================= Daten aufbereiten
function aufbereiten(j) {
  const K = j.kategorien, U = j.unterkategorien, A = j.arten, konten = j.konten, ST = j.steuerkategorien || [];
  const rows = j.buchungen.map((b, i) => {
    const [d, k, c, g, z, kat, ukat, art, v, t, n, st, frueher] = b;
    const r = { i, d, y: +d.slice(0, 4), m: +d.slice(5, 7), k, c, g, z, kat: K[kat], ukat: U[ukat], art: A[art], v, t, n };
    r.ga = frueher || [];   // frühere Namen der Gegenseite (Finanzguru benennt Empfänger manchmal um)
    r.st = ST[st] || '';
    r.s = norm(`${g} ${r.ga.join(' ')} ${z} ${r.kat} ${r.ukat} ${konten[k].name} ${v} ${t} ${n} ${r.st}`);
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
    j, konten, rows, von: j.von, bis: j.bis > new Date().toISOString().slice(0, 10) ? new Date().toISOString().slice(0, 10) : j.bis,   // Valuta in der Zukunft verschiebt „heute“ nicht
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
    && (!jahre.length || jahre.includes(r.y)) && (!monate.length || monate.includes(r.m)) && (!zr || (r.d.slice(0, 7) >= zr[0] && r.d.slice(0, 7) <= zr[1])) && (!S.nf || !fixIds().has(r.i)) && (!ks || ks.has(r.k))
    && (!S.kat || r.kat === S.kat) && (!S.ukat || r.ukat === S.ukat)
    && (!mitArt || S.art === 'alle' || (S.art === 'aus' ? r.art === 'Ausgabe' : r.art === 'Einnahme'))
    && test(r);
}

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

// Zeitraum-Menü: Kästchen = Jahr an/aus (mehrere = Vergleich), Jahreszahl = nur dieses Jahr
function jahrListeBauen() {
  const n = new Map();
  for (const r of D.rows) n.set(r.y, (n.get(r.y) || 0) + 1);
  const liste = $('#f-jahr-liste');
  liste.innerHTML = `<button class="auswahl-alle" data-jalle>Alle Jahre <small>${NUM.format(D.rows.length)} Buchungen</small></button>
    <div class="auswahl-jahre">${[...D.jahre].reverse().map((y) => `<div class="auswahl-zeile"><input type="checkbox" id="jchk-${y}" data-jchk="${y}" aria-label="${y} zum Vergleich"><button type="button" data-jnur="${y}" title="Nur ${y} zeigen">${y}</button><small>${NUM.format(n.get(y) || 0)}</small></div>`).join('')}</div>
    <div class="auswahl-fuss">Kästchen anhaken: mehrere Jahre vergleichen<br>Jahreszahl anklicken: nur dieses Jahr</div>`;
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
  $('#f-jahr-text').textContent = !jw.length ? 'Alle Jahre' : jw.length === 1 ? String(jw[0]) : jw.length <= 3 ? `${jw.join(', ')} · Vergleich` : `${jw.length} Jahre · Vergleich`;
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
  if (S.nf) chips.push(`<button class="chip" data-nf="1" title="Auch feste Verträge zeigen">ohne feste Verträge<span class="x">×</span></button>`);
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
  $('#chips').querySelectorAll('[data-mehr]').forEach((b) => b.onclick = () => setze(({ konto: { konto: '' }, kat: { kat: '', ukat: '' }, art: { art: 'alle' }, umb: { umb: false } })[b.dataset.mehr]));
  const aktiv = S.q || S.jahr || S.monat || S.zr || S.nf || S.konto || S.kat || S.ukat || S.art !== 'alle' || S.umb;
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
const tagKurz = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return `${WTAG[d.getUTCDay()]} ${+iso.slice(8)}.${+iso.slice(5, 7)}.`; };
const monatsText = (ms) => (!ms.length ? '' : ms.length === 1 ? monKurz(ms[0]) : `${monKurz(ms[0])} – ${monKurz(ms[ms.length - 1])}`);
// Summe aller eigenen Konten an einem Tag (ohne Depot, gemeinsame und Kinderkonten)
const kontenSumme = (tag) => (tag < D.von ? null : kontostaende(D, tag).filter((x) => !fremd(x.k) && x.c != null && x.status !== 'unbekannt').reduce((t, x) => t + x.c, 0));

// Buchungen, die zu einem erkannten Fixkosten-Vertrag gehören (auch deine festen Einzahlungen aufs Gemeinschaftskonto)
function fixIds() {
  if (!D.fixIds) D.fixIds = new Set(fixkostenErkennen().filter((f) => !f.gemeinsam).flatMap((f) => f.rows.map((r) => r.i)));
  return D.fixIds;
}

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

// Nächste Abbuchung eines laufenden Vertrags (monatlich: am üblichen Tag, sonst nach Rhythmus)
function naechsteAbbuchung(f) {
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
function periode() {
  const alle = abgeschlosseneMonate(), j = einJahr();
  const monate = j ? alle.filter((k) => +k.slice(0, 4) === j) : alle.slice(-12);
  const vor = monate.map((k) => mkey(+k.slice(0, 4) - 1, +k.slice(5))).filter((k) => k >= D.von.slice(0, 7));
  const label = !monate.length ? '' : j ? (monate.length === 12 ? `im Jahr ${j}` : `${j} (${MON[+monate[0].slice(5) - 1]}–${MON[+monate.at(-1).slice(5) - 1]})`)
    : `in den letzten 12 Monaten (${monKurz(monate[0])} – ${monKurz(monate.at(-1))})`;
  return { monate, vor: vor.length === monate.length ? vor : [], label, jahr: j };
}
function zeitSeg() {
  const j = einJahr();
  return `<div class="seg s5-zeit" role="group" aria-label="Zeitraum">${[['', '12 Monate'], ...D.jahre.slice(-4).reverse().map((y) => [String(y), String(y)])]
    .map(([v, t]) => `<button data-zeit="${v}" class="${(v ? +v === j : !j) ? 'an' : ''}">${t}</button>`).join('')}</div>`;
}

// Einnahmen und Ausgaben in bestimmten Monaten (gewählte Konten): Summen, je Monat und gruppiert
// (Ausgaben nach Kategorie, Einnahmen nach Unterkategorie) mit Unterkategorien, Empfängern und Monaten
function sammle(monate, art = 'aus') {
  const set = new Set(monate), fx = fixIds(), ks = kontoSet(), g = new Map(), mon = new Map(monate.map((k) => [k, { ein: 0, lohn: 0, aus: 0, fix: 0, spar: 0, n: 0 }]));
  let ein = 0, aus = 0, fix = 0, spar = 0, lohn = 0, n = 0, groesste = null;
  for (const r of D.rows) {
    const k = r.d.slice(0, 7), m = mon.get(k);
    if (!m || !set.has(k) || (ks && !ks.has(r.k))) continue;
    if (r.art === 'Sparen') { spar -= r.c; m.spar -= r.c; continue; }
    if (r.art !== 'Einnahme' && r.art !== 'Ausgabe') continue;
    n++; m.n++;
    if (r.art === 'Einnahme') { ein += r.c; m.ein += r.c; if (r.ukat === 'Lohn / Gehalt') { m.lohn += r.c; lohn += r.c; } }
    else { aus -= r.c; m.aus -= r.c; if (fx.has(r.i)) { fix -= r.c; m.fix -= r.c; } if (!groesste || r.c < groesste.c) groesste = r; }
    if ((art === 'aus') !== (r.art === 'Ausgabe')) continue;
    const key = art === 'aus' ? r.kat || 'Sonstiges' : r.ukat || 'Sonstige Einnahmen';
    const c = art === 'aus' ? -r.c : r.c;
    let x = g.get(key);
    if (!x) g.set(key, (x = { k: key, c: 0, unter: new Map(), empf: new Map(), mon: new Map(), rows: [] }));
    x.c += c; x.rows.push(r);
    if (art === 'aus') { const u = r.ukat || 'ohne Unterkategorie'; x.unter.set(u, (x.unter.get(u) || 0) + c); }
    const e = r.g || r.z || '–', ee = x.empf.get(e) || { c: 0, n: 0 };
    ee.c += c; ee.n++; x.empf.set(e, ee);
    x.mon.set(k, (x.mon.get(k) || 0) + c);
  }
  return { n: monate.length, ein, aus, fix, spar, lohn, erg: ein - aus, g, mon, buchungen: n, groesste, monate };
}

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
function gehBinden(el) {
  el.querySelectorAll('[data-geh]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const z = JSON.parse(b.dataset.geh), sp = z._springe;
    delete z._springe;
    setze(z);
    if (sp) setTimeout(() => springe(sp, false), 60);   // nach dem Seitenwechsel direkt hinspringen
  });
  el.querySelectorAll('[data-fix]').forEach((b) => b.onclick = () => setze({ q: `"${b.dataset.fix}"${b.dataset.sig ? ' ' + b.dataset.sig : ''}`, tab: 'buchungen', jahr: '', monat: '', zr: '', konto: '', kat: '', ukat: '', art: 'alle' }));
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
const zuBuchungen = (x = {}) => ({ tab: 'buchungen', q: '', jahr: '', monat: '', zr: '', nf: '', kat: '', ukat: '', art: 'alle', ...x });
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
const linieMit = (id, wert, text, farbe, oben = true) => ({
  id,
  afterDatasetsDraw(ch) {
    const y = ch.scales.y.getPixelForValue(wert), a = ch.chartArea, c = ch.ctx;
    if (y < a.top - 1 || y > a.bottom + 1) return;
    c.save(); c.strokeStyle = farbe; c.lineWidth = 1.5; c.setLineDash([5, 4]);
    c.beginPath(); c.moveTo(a.left, y); c.lineTo(a.right, y); c.stroke(); c.setLineDash([]);
    c.font = `700 11px ${css('--font')}`; c.textAlign = 'right'; c.textBaseline = oben ? 'bottom' : 'top';
    const w = c.measureText(text).width;   // rechts beschriftet, dort stören keine Säulenwerte
    c.fillStyle = css('--surface'); c.fillRect(a.right - w - 8, oben ? y - 15 : y + 1, w + 8, 14);
    c.fillStyle = farbe; c.fillText(text, a.right - 4, oben ? y - 2 : y + 2);
    c.restore();
  },
});
// Prognosebereich ab Index: grau hinterlegt, oben beschriftet
const prognoseMit = (ab, text = 'Prognose') => ({
  id: 'prognose',
  beforeDatasetsDraw(ch) {
    if (ab < 0) return;
    const x = ch.scales.x, a = ch.chartArea, c = ch.ctx, n = ch.data.labels.length, b = x.width / n;
    const links = x.getPixelForValue(ab) - b / 2;
    c.save(); c.fillStyle = 'rgba(128, 128, 128, 0.08)'; c.fillRect(links, a.top, a.right - links, a.bottom - a.top);
    c.fillStyle = css('--muted'); c.font = `700 10px ${css('--font')}`; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText(text.toUpperCase(), links + 5, a.top + 3);
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
  return (D.mr = { gehalt, gehaltMonat: ek.letzter, sonst, fix, leben, ein: gehalt + sonst, aus: fix + leben, erg: gehalt + sonst - fix - leben, vertraege, ref, gt: gehaltstag(), lh: lebenshaltung() });
}
const lebenName = () => (lebenWahl === 'eigen' && lebenEigen ? 'dein eigener Wert' : lebenWahl === 'typisch' ? 'typischer Monat' : 'Ø 12 Monate');

// Die letzten 12 abgeschlossenen Monate, der laufende Monat (bisher + erwartet) und 3 Monate Prognose,
// je mit Ergebnis und Kontostand am Monatsende. Prognose: normaler Monat, feste Abbuchungen im jeweiligen Monat.
function verlauf5() {
  if (D.v5) return D.v5;
  const R = monatsRechnung(), heute = D.bis, jetzt = heute.slice(0, 7), laeuft = heute !== monatsletzter(heute);
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
  const monate = R.ref.map((k) => { const x = w(k); return { k, art: 'ist', ein: x.ein, aus: x.aus, erg: x.ein - x.aus, fest: x.aus - x.var, lohn: x.lohn, stand: kontenSumme(monatsletzter(`${k}-01`)) }; });
  const heuteStand = kontenSumme(heute);
  let stand = heuteStand ?? 0, lauf = null;
  if (laeuft) {
    const x = w(jetzt), ende = monatsletzter(`${jetzt}-01`);
    const offenFest = R.vertraege.reduce((t, f) => t + faellig(f, plusTage(heute, 1), ende), 0);
    const gehaltKommt = x.lohn > 0 ? 0 : R.gehalt, sonstKommt = Math.max(0, R.sonst - (x.ein - x.lohn)), varKommt = Math.max(0, R.leben - x.var);
    const ein = x.ein + gehaltKommt + sonstKommt, aus = x.aus + offenFest + varKommt;
    stand += gehaltKommt + sonstKommt - offenFest - varKommt + Math.min(0, spar - x.spar);
    lauf = { k: jetzt, art: 'laeuft', ein, aus, erg: ein - aus, x, offenFest, gehaltKommt, varKommt, tag: +heute.slice(8), tage: +ende.slice(8), stand };
    monate.push(lauf);
  }
  for (let i = 1; i <= 3; i++) {
    const k = mVor(jetzt, i), ende = monatsletzter(`${k}-01`);
    const fest = R.vertraege.reduce((t, f) => t + faellig(f, `${k}-01`, ende), 0);
    const ein = R.gehalt + R.sonst, aus = R.leben + fest;
    stand += ein - aus + spar;
    monate.push({ k, art: 'prognose', ein, aus, erg: ein - aus, fest, stand });
  }
  const n = R.ref.length || 1, summe = (f) => monate.filter((m) => m.art === 'ist').reduce((t, m) => t + f(m), 0);
  const schnitt = { ein: summe((m) => m.ein) / n, aus: summe((m) => m.aus) / n, erg: summe((m) => m.erg) / n, lohn: summe((m) => m.lohn) / n };
  // Sonderzahlungen der 12 Monate: Gehalt deutlich über dem üblichen, größere sonstige Einnahmen (ab 1.000 €)
  const refSet = new Set(R.ref), eigen = (r) => r.art === 'Einnahme' && refSet.has(r.d.slice(0, 7)) && !istGemeinsam(r.k) && !fremd(D.konten[r.k]);
  const lohnRows = D.rows.filter((r) => eigen(r) && r.ukat === 'Lohn / Gehalt' && r.c >= 100000);
  const lohnMed = lohnRows.length ? median(lohnRows.map((r) => r.c)) : 0;
  const sonder = D.rows.filter((r) => eigen(r) && (r.ukat === 'Lohn / Gehalt' ? lohnMed && r.c > lohnMed * 1.3 : r.c >= 100000))
    .map((r) => ({ r, extra: r.ukat === 'Lohn / Gehalt' ? r.c - lohnMed : r.c })).sort((a, b) => b.extra - a.extra);
  return (D.v5 = { monate, R, lauf, heuteStand, spar, schnitt, sonder, jetzt });
}
const sonderText = (l) => l.map(({ r }) => zl(`${r.ukat === 'Lohn / Gehalt' ? 'dem hohen Gehalt' : esc(schoen(r.ukat || 'Einnahme'))} im ${MONAT[+r.d.slice(5, 7) - 1]} ${r.d.slice(0, 4)} (${eur0(r.c)})`, zuBuchungen({ konto: '', art: 'ein', kat: r.kat, ukat: r.ukat, ...monatZiel(r.d.slice(0, 7)) }))).join(' und ');

// Ein Balken für den normalen Monat: Linie = Einkommen (Gehalt + sonstige Einnahmen), Flächen = Fixkosten (auf Wunsch
// je Art) und Lebenshaltung, grün = was bleibt, rot schraffiert = was fehlt
function geldBalken(R, teile = null) {
  const E = R.ein, aus = R.fix + R.leben, max = Math.max(E, aus, 1), w = (c) => (Math.max(0, c) / max) * 100, rest = E - aus;
  const t = (cls_, x) => (x.c > 0 ? `<i class="gb-t ${cls_}${w(x.c) >= 7.5 ? ' lbl' : ''}${w(x.c) >= 20 ? ' gross' : ''}" style="width:${w(x.c)}%"${x.ziel ? geh(x.ziel) : ''}${x.springe ? ` data-springe="${x.springe}"` : ''} title="${esc(x.tip || `${x.n}: ${eur0(x.c)}`)}">${w(x.c) >= 7.5 ? `<span>${x.n}</span><b>${eur0(x.c)}</b>` : ''}</i>` : '');
  const fest = (teile || [{ n: 'Fixkosten', c: R.fix, ziel: { tab: 'fix', fixtab: 'vertraege' } }]).map((x) => t('gb-fest', x)).join('');
  return `<div class="gb">
    <div class="gb-balken">${fest}${t('gb-leben', { n: 'Lebenshaltung', c: R.leben, ziel: { tab: 'fix', fixtab: 'vertraege', _springe: '#fix-leben' }, tip: `Lebenshaltung ${eur0(R.leben)} im Monat – anklicken: wofür` })}${rest > 0 ? t('gb-rest', { n: 'bleibt', c: rest }) : ''}
      ${rest < 0 ? `<b class="gb-minus" style="left:${w(E)}%;width:${w(-rest)}%" title="fehlt ${eur0(-rest)} im Monat"></b>` : ''}<b class="gb-linie" style="left:${w(E)}%"></b></div>
    <div class="gb-skala"><span><i class="gb-sym"></i>Einkommen ${eur0(E)}</span><span>Ausgaben ${eur0(aus)}</span>${rest < 0 ? `<span class="gb-f"><i class="gb-sym-f"></i>fehlt ${eur0(-rest)}</span>` : `<span class="gb-b">bleibt ${eur0(rest)}</span>`}</div>
  </div>`;
}

// Feste Abbuchungen der nächsten Tage
function naechsteTermine(vs, tage = 30) {
  const bis = plusTage(D.bis, tage), l = [];
  for (const f of vs) { const am = naechsteAbbuchung(f); if (am && am > D.bis && am <= bis) l.push({ f, am }); }
  return l.sort((a, b) => (a.am < b.am ? -1 : a.am > b.am ? 1 : b.f.betrag - a.f.betrag));
}
// Wann das nächste Gehalt erwartet wird (in den nächsten 30 Tagen), damit man sieht, was davor und danach abgeht
function naechstesGehalt() {
  const R = monatsRechnung(), V = verlauf5();
  if (!R.gt || !R.gehalt) return null;
  let k = D.bis.slice(0, 7);
  if (!(V.lauf && V.lauf.gehaltKommt)) k = mVor(k, 1);
  const am = `${k}-${String(Math.min(R.gt, tageImMonat(k))).padStart(2, '0')}`;
  return am > D.bis && am <= plusTage(D.bis, 30) ? { am, c: R.gehalt } : null;
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
    h += `<div class="nt-tag"><div class="nt-k"><span class="nt-d">${tagKurz(am)}</span><span class="nt-a">${fs.length ? `${fs.length} ${fs.length === 1 ? 'Abbuchung' : 'Abbuchungen'}` : ''}</span><b>${fs.length ? `−${eur0(summe)}` : ''}</b></div>
      ${lohn ? `<button class="nt-z nt-lohn"${geh(zuGehalt())} title="Anklicken: alle Gehälter"><span class="nt-n">Gehalt erwartet</span><b>+${eur0(g.c)}</b></button>` : ''}
      ${zeig.map((f) => `<button class="nt-z" data-fix="${esc(f.name)}" data-sig="${esc(f.sig)}" title="${esc(vertragName(f))} · ${esc(f.rh.name)} – alle Zahlungen anzeigen"><span class="nt-n">${esc(vertragName(f))}${f.rh.proJahr < 12 ? ` <small>${esc(f.rh.name)}</small>` : ''}</span><b>${eur0(f.betrag)}</b></button>`).join('')}</div>`;
  }
  if (weg.length) h += `<div class="nt-mehr">+ ${weg.length} weitere Abbuchungen · ${eur0(weg.reduce((t, f) => t + f.betrag, 0))}</div>`;
  return `<div class="nt">${h}</div>`;
}

// ---------------------------------------------------------------- Übersicht: Wie stehe ich da – und wohin läuft es?
function startSeite() {
  const box = $('#s5'), V = verlauf5(), R = V.R, ms = V.monate, lauf = V.lauf, letzte = ms[ms.length - 1];
  const gMon = monLang(R.gehaltMonat), heute = V.heuteStand ?? 0, s = V.schnitt;
  const anfang = kontenSumme(plusTage(`${V.jetzt}-01`, -1));
  const monatJ = MONAT[+V.jetzt.slice(5) - 1], monatE = MONAT[+letzte.k.slice(5) - 1];
  const ref = V.monate.filter((m) => m.art === 'ist').map((m) => m.k);
  const zuB = (x) => zuBuchungen({ konto: '', ...x });   // die Übersicht rechnet immer mit allen Konten
  const lk = R.lh.kats[0];
  // Antwort in zwei, drei Sätzen: normaler Monat heute, warum es bisher anders aussah, wohin es läuft – jede Zahl anklickbar
  let satz = `Mit deinem aktuellen Gehalt von ${zl(`<b>${eur0(R.gehalt)}</b>`, zuGehalt())} ${R.erg >= 0 ? 'bleiben' : 'fehlen'} in einem normalen Monat rund ${zl(`<b class="${R.erg >= 0 ? 'pos' : 'neg'}">${eur0(Math.abs(R.erg))}</b>`, { tab: 'fix', fixtab: 'vertraege' })}${R.erg >= 0 ? ' übrig' : ''}.`;
  const schnittZ = zl(`<b class="${s.erg >= 0 ? 'pos' : 'neg'}">${plusMinus(s.erg)}</b>`, { tab: 'kennzahlen', jahr: '', monat: '', zr: '', konto: '' });
  if (s.erg - R.erg > 20000 && V.sonder.length) satz += ` In den letzten 12 Monaten waren es im Schnitt ${schnittZ} – dank Sonderzahlungen wie ${sonderText(V.sonder.slice(0, 2))}.`;
  else satz += ` In den letzten 12 Monaten waren es im Schnitt ${schnittZ} im Monat.`;
  satz += ` Läuft alles so weiter, stehen Ende ${monatE} etwa ${zl(`<b>${eur0(letzte.stand)}</b>`, { tab: 'konten', stichtag: '', konto: '' })} auf deinen Konten.`;

  const zahlen = [
    zahl5('Auf deinen Konten', eur0(heute), `heute · ${anfang != null ? `${plusMinus(heute - anfang)} seit 1. ${monatJ}` : ''}${lauf?.gehaltKommt ? ' – das Gehalt kommt noch' : ''}`, { cls: heute < 0 ? 'neg' : '', ziel: { tab: 'konten', stichtag: '', konto: '' } }),
    zahl5('Gehalt aktuell', eur0(R.gehalt), `netto im ${gMon}${R.gt ? ` · kommt um den ${R.gt}.` : ''} · anklicken: alle Gehälter`, { ziel: zuGehalt() }),
    zahl5(R.erg >= 0 ? 'Normaler Monat: bleibt' : 'Normaler Monat: fehlt', plusMinus(R.erg), 'Gehalt + Sonstiges − Fixkosten − Lebenshaltung', { cls: R.erg >= 0 ? 'pos' : 'neg', ziel: { tab: 'fix', fixtab: 'vertraege', konto: '' } }),
    zahl5(`Prognose Ende ${monatE}`, `≈ ${eur0(letzte.stand)}`, `auf deinen Konten · ${plusMinus(letzte.stand - heute)} ggü. heute`, { cls: letzte.stand < 0 ? 'neg' : '', ziel: { tab: 'konten', stichtag: '', konto: '' } }),
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
      </dl>`;
  }
  const st = steuerStand();
  if (st) monat += `<button class="s5-hinweis"${geh({ tab: 'steuer' })}><b>Steuer ${st.jahr}</b> ${st.offen ? `· ${st.offen} Entscheidungen offen` : '· alles entschieden'} <span class="link">→</span></button>`;

  const termine = naechsteTermine(R.vertraege), tSumme = termine.reduce((t, x) => t + x.f.betrag, 0);
  box.innerHTML = kopf5(`Übersicht <span class="s5-stand">Daten bis ${dde(D.bis)}</span>`, satz)
    + `<div class="s5-zahlen">${zahlen}</div>
    <div class="s5-raster s5-start">
      ${karte5('Was am Monatsende übrig blieb', `Einnahmen minus Ausgaben je Monat. Grün = Plus, rot = Minus, schraffiert = erwartet. Gestrichelt: Durchschnitt der letzten 12 Monate. Säule anklicken: Buchungen des Monats.`, '<div class="s5-chart fuell"><canvas id="c-s5-erg"></canvas></div>', 's5-b2', zl('alle 12 Monate →', zuB(zeitZiel(ref))))}
      ${karte5('Ein normaler Monat ab jetzt', 'Mit deinem aktuellen Gehalt, den laufenden Verträgen und deiner üblichen Lebenshaltung · Zeile anklicken: Einzelheiten', rechnung + tipp, 's5-mr')}
      ${karte5('Kontostand', 'Summe deiner Konten am Monatsende (ohne Depot, gemeinsame und Kinderkonten). Gestrichelt: Prognose. Punkt anklicken: Kontostände an diesem Tag.', '<div class="s5-chart klein fuell"><canvas id="c-s5-stand"></canvas></div>')}
      ${karte5(lauf ? `${monatJ} bisher` : 'Dieser Monat', lauf ? 'Was schon gebucht ist und was bis Monatsende noch kommt' : '', monat || '<div class="leer klein">Der Monat ist abgeschlossen.</div>')}
      ${karte5('Nächste 30 Tage', 'Feste Abbuchungen aus deinen Verträgen · anklicken: alle Zahlungen des Vertrags', termineHtml(termine, 6), '', zl(`<span class="s5-wert">${eur0(tSumme)}</span>`, { tab: 'fix', fixtab: 'kalender', konto: '' }))}
    </div>`;
  gehBinden(box);
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
    title: (it) => { const m = ms[it[0].dataIndex]; return `${monLang(m.k)}${m.art === 'prognose' ? ' – Prognose' : m.art === 'laeuft' ? ' – erwartet bis Monatsende' : ''}`; },
    label: (it) => { const m = ms[it.dataIndex]; return ` ${m.erg >= 0 ? 'Überschuss' : 'Fehlbetrag'}: ${EUR0.format(m.erg / 100)}`; },
    afterBody: (it) => { const m = ms[it[0].dataIndex]; return [`Einnahmen ${eur0(m.ein)}`, `Ausgaben ${eur0(m.aus)}`, m.art === 'ist' ? 'Klick: Buchungen des Monats' : '']; },
  };
  o.onClick = (_, el) => { const m = el.length && ms[el[0].index]; if (m && m.art !== 'prognose') setze(zuBuchungen({ konto: '', ...monatZiel(m.k) })); };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length && ms[el[0].index].art !== 'prognose' ? 'pointer' : 'default'; };
  zeichne('c-s5-erg', {
    type: 'bar',
    data: { labels: ms.map((m) => monKurz(m.k)), datasets: [{ data: ms.map((m) => m.erg / 100), backgroundColor: ms.map((m) => (m.art === 'ist' ? alpha(m.erg >= 0 ? cP : cN, 0.85) : m.erg >= 0 ? pP : pN)), hoverBackgroundColor: ms.map((m) => (m.erg >= 0 ? cP : cN)), borderRadius: 4, maxBarThickness: 34 }] },
    options: o,
    plugins: [prognoseMit(ab), linieMit('schnitt', V.schnitt.erg / 100, `Ø ${plusMinus(V.schnitt.erg)}`, css('--text-2'), V.schnitt.erg >= 0), saeulenWerteMit({ groesse: 10.5, fmt: vorzeichenKurz })],
  });
}

// Kontostand am Monatsende: 12 Monate, dann gestrichelt die Prognose
function s5StandZeichnen(V) {
  if (!$('#c-s5-stand')) return;
  const ms = V.monate.filter((m) => m.stand != null), ab = ms.findIndex((m) => m.art !== 'ist'), c = css('--accent');
  const o = basis();
  o.layout = { padding: { top: 22, left: 4, right: 8 } };
  o.interaction = { mode: 'index', intersect: false };
  o.scales = {
    x: { ...achsenStil(), grid: { display: false }, ticks: { ...achsenStil().ticks, font: { size: 11 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 8 } },
    y: { ...achsenStil(), ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 4 } },
  };
  o.plugins.tooltip.callbacks = { title: (it) => `Ende ${monLang(ms[it[0].dataIndex].k)}${ms[it[0].dataIndex].art !== 'ist' ? ' – erwartet' : ''}`, label: (it) => ` Konten: ${EUR0.format(it.raw)}` };
  const letzteIst = ab < 0 ? ms.length - 1 : ab - 1;
  // Klick: Kontostände an diesem Monatsende (Prognose: Reiter Konten mit Verlauf)
  o.onClick = (_, el) => { if (!el.length) return; const m = ms[el[0].index]; setze({ tab: 'konten', konto: '', stichtag: m.art === 'ist' ? monatsletzter(`${m.k}-01`) : '' }); };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; };
  zeichne('c-s5-stand', {
    type: 'line',
    data: { labels: ms.map((m) => monKurz(m.k)), datasets: [{ data: ms.map((m) => m.stand / 100), borderColor: c, backgroundColor: alpha(c, 0.1), fill: 'origin', cubicInterpolationMode: 'monotone', borderWidth: 2.5,
      pointRadius: ms.map((m, i) => (i === letzteIst || i === ms.length - 1 ? 4 : 2)), pointBackgroundColor: ms.map((m) => (m.art === 'ist' ? c : css('--surface'))), pointBorderColor: c, pointBorderWidth: 2,
      segment: { borderDash: (sg) => (ab >= 0 && sg.p1DataIndex >= ab ? [6, 4] : undefined) } }] },
    options: o,
    plugins: [prognoseMit(ab), punktWerteMit([0, letzteIst, ms.length - 1].filter((i, j, a) => i >= 0 && a.indexOf(i) === j), (v, i) => `${i > letzteIst ? '≈ ' : ''}${kurzWert(v)}`)],
  });
}

// ---------------------------------------------------------------- Kennzahlen: Wie entwickeln sich meine Finanzen?
// Aufbau: der Durchschnittsmonat als Tabelle (Einnahmen → Ausgaben → Ergebnis, je mit Vorjahr), was sich verändert hat,
// Monat für Monat als Grafik, Jahr für Jahr als Tabelle, darunter eine Leiste mit Auffälligem.
function k5Seite() {
  const box = $('#k2'), P = periode(), rechts = kontoWahlHtml() + zeitSeg();
  if (!P.monate.length) { box.innerHTML = kopf5('Kennzahlen', 'In diesem Jahr ist noch kein Monat abgeschlossen.', rechts); gehBinden(box); kennzahlenBinden(box); return; }
  const a = sammle(P.monate), v = P.vor.length ? sammle(P.vor) : null, ein = sammle(P.monate, 'ein'), einV = v ? sammle(P.vor, 'ein') : null, R = monatsRechnung();
  const pm = (x, c) => c / x.n, quote = (x) => (x.ein ? Math.round((x.erg / x.ein) * 100) : null);
  const P0 = `${P.label[0].toUpperCase()}${P.label.slice(1)}`;
  const zeit = zeitZiel(P.monate);
  let satz = `${P0} kamen im Schnitt ${zl(`<b>${eur0(pm(a, a.ein))}</b>`, { tab: 'uebersicht', kart: 'ein', wahl: '' })} im Monat herein und ${zl(`<b>${eur0(pm(a, a.aus))}</b>`, { tab: 'uebersicht', kart: 'aus', wahl: '' })} gingen raus – ${a.erg >= 0 ? 'übrig blieben' : 'es fehlten'} ${zs(`<b class="${a.erg >= 0 ? 'pos' : 'neg'}">${eur0(Math.abs(pm(a, a.erg)))}</b>`, '#k5-tab')} im Monat.`;
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
    zahl5('Aufs Spar- und Depotkonto', a.spar > 0 ? eur0(a.spar / a.n) : '–', a.spar > 0 ? `Ø im Monat · zusammen ${eur0(a.spar)} – zusätzlich zum Ergebnis` : 'in diesem Zeitraum nichts', { ziel: zuBuchungen({ kat: 'Sparen', ...zeit }) }),
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
    zeile('Gehalt', 'netto', a.lohn / a.n, vm(v, v?.lohn), true, zuBuchungen({ kat: 'Einnahmen', ukat: 'Lohn / Gehalt', art: 'ein', ...zeit })),
    ...top.map((x) => zeile(esc(schoen(x.k)), '', x.c / a.n, einV ? (einV.g.get(x.k)?.c || 0) / v.n : null, true, { tab: 'uebersicht', kart: 'ein', wahl: x.k })),
    ...(restC > 0 ? [zeile(`Übrige (${rest.length})`, rest.slice(0, 3).map((x) => esc(schoen(x.k))).join(', '), restC / a.n, einV ? restV / v.n : null, true, { tab: 'uebersicht', kart: 'ein', wahl: '' })] : []),
  ].join('');
  const ergV = v ? v.erg / v.n : null;
  const durchschnitt = `<div class="vgs dm">
    <div class="vg-kopf dm-z"><span>Ø je Monat</span><span>${esc(monatsText(P.monate))}</span><span>Vorjahr</span><span>Veränderung</span></div>
    <section class="vg" style="--vg:var(--ein)">${zeile('Einnahmen', '', a.ein / a.n, vm(v, v?.ein), true, { tab: 'uebersicht', kart: 'ein', wahl: '' }, true)}<div class="vg-l">${einZeilen}</div></section>
    <section class="vg" style="--vg:var(--aus)">${zeile('Ausgaben', '', a.aus / a.n, vm(v, v?.aus), false, { tab: 'uebersicht', kart: 'aus', wahl: '' }, true)}<div class="vg-l">
      ${zeile('Fixkosten', 'Verträge, Miete, Unterhalt', a.fix / a.n, vm(v, v?.fix), false, { tab: 'fix', fixtab: 'vertraege' })}
      ${zeile('Lebenshaltung', 'alle übrigen Ausgaben', (a.aus - a.fix) / a.n, v ? (v.aus - v.fix) / v.n : null, false, zuBuchungen({ art: 'aus', nf: '1', ...zeit }))}</div></section>
    <section class="vg" style="--vg:${a.erg >= 0 ? 'var(--ein-text)' : 'var(--aus-text)'}">${zeile(a.erg >= 0 ? '= übrig' : '= Fehlbetrag', `Sparquote ${quote(a) ?? '–'} %${v ? ` · Vorjahr ${quote(v)} %` : ''}`, a.erg / a.n, ergV, true, { springe: '#k5-tab' }, true).replace(`<b class="dm-w">${eur0(a.erg / a.n)}</b>`, `<b class="dm-w ${a.erg >= 0 ? 'pos' : 'neg'}">${plusMinus(a.erg / a.n)}</b>`)}
      ${a.spar > 0 || v?.spar > 0 ? `<div class="vg-l">${zeile('Aufs Spar- und Depotkonto', 'zusätzlich gespart, nicht in den Ausgaben', Math.max(0, a.spar) / a.n, v ? Math.max(0, v.spar) / v.n : null, true, zuBuchungen({ kat: 'Sparen', ...zeit }))}</div>` : ''}</section>
  </div>`;

  // Was sich verändert hat (Kategorien je Monat ggü. Vorjahr)
  let veraendert = '<div class="leer klein">Für diesen Zeitraum gibt es kein Vorjahr zum Vergleich.</div>';
  if (v) {
    const d = [...new Set([...a.g.keys(), ...v.g.keys()])].map((k) => ({ k, jetzt: (a.g.get(k)?.c || 0) / a.n, vorher: (v.g.get(k)?.c || 0) / v.n }))
      .map((x) => ({ ...x, d: x.jetzt - x.vorher })).filter((x) => Math.abs(x.d) >= 3000).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 8);
    veraendert = d.length ? `<div class="vd">${d.map((x) => `<button class="vd-z"${geh({ tab: 'uebersicht', kart: 'aus', wahl: x.k })} title="Klick: Einzelheiten zur Kategorie">
        <span class="vd-p ${x.d > 0 ? 'neg' : 'pos'}">${x.d > 0 ? '▲' : '▼'}</span><span class="vd-n">${esc(schoen(x.k))}<small>${eur0(x.vorher)} → ${eur0(x.jetzt)} im Monat</small></span><b class="${x.d > 0 ? 'neg' : 'pos'}">${plusMinus(x.d)}</b></button>`).join('')}</div>`
      : '<div class="leer klein">Kaum Veränderungen gegenüber dem Vorjahr.</div>';
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
  if (P.jahr && P.monate.length < 12) {
    const restM = 12 - P.monate.length, jahrErg = a.erg + restM * R.erg;
    fakten.push([`Hochrechnung ${P.jahr}`, `<span class="${jahrErg >= 0 ? 'pos' : 'neg'}">≈ ${plusMinus(jahrErg)}</span> <small>bisher ${plusMinus(a.erg)} + ${restM} normale Monate</small>`, { tab: 'start' }]);
  } else fakten.push(['Normaler Monat ab jetzt', `<span class="${R.erg >= 0 ? 'pos' : 'neg'}">${plusMinus(R.erg)}</span> <small>mit dem aktuellen Gehalt ${eur0(R.gehalt)}</small>`, { tab: 'start' }]);
  const leiste = `<div class="fl">${fakten.map(([t, w, ziel]) => `<${ziel ? 'button' : 'div'} class="card fl-z"${ziel ? (ziel.springe ? ` data-springe="${ziel.springe}"` : geh(ziel)) : ''} title="Anklicken: Einzelheiten"><span>${t}</span><b>${w}</b></${ziel ? 'button' : 'div'}>`).join('')}</div>`;

  // Tabelle aller Monate (aufklappbar)
  const z = (c) => (c ? eur0(c) : '<span class="muted">–</span>');
  const tabelle = `<table class="t3"><thead><tr><th>Monat</th><th class="r">Einnahmen</th><th class="r sp-m">davon Gehalt</th><th class="r">Ausgaben</th><th class="r sp-m">davon fest</th><th class="r">Ergebnis</th></tr></thead>
    <tbody>${P.monate.map((k) => { const m = a.mon.get(k), e = m.ein - m.aus; return `<tr class="klick"${geh(zuBuchungen(monatZiel(k)))}><td>${monLang(k)}</td><td class="r">${z(m.ein)}</td><td class="r muted sp-m">${z(m.lohn)}</td><td class="r">${z(m.aus)}</td><td class="r muted sp-m">${z(m.fix)}</td><td class="r ${e >= 0 ? 'pos' : 'neg'}"><b>${plusMinus(e)}</b></td></tr>`; }).join('')}</tbody>
    <tfoot><tr><td>Ø je Monat</td><td class="r">${eur0(a.ein / a.n)}</td><td class="r sp-m">${eur0(a.lohn / a.n)}</td><td class="r">${eur0(a.aus / a.n)}</td><td class="r sp-m">${eur0(a.fix / a.n)}</td><td class="r ${a.erg >= 0 ? 'pos' : 'neg'}">${plusMinus(a.erg / a.n)}</td></tr></tfoot></table>`;

  box.innerHTML = kopf5('Kennzahlen', satz, rechts) + `<div class="s5-zahlen">${zahlen}</div>
    <div class="s5-raster k5">
      ${karte5('Dein Durchschnittsmonat', `Ø je Monat ${P.label}${v ? ', daneben dasselbe Zeitfenster ein Jahr früher' : ''} · Zeile anklicken: Einzelheiten`, durchschnitt, 's5-b2')}
      ${karte5('Was sich verändert hat', v ? 'Ausgaben je Monat ggü. dem Vorjahr, größte Veränderungen zuerst · anklicken: Einzelheiten' : '', veraendert)}
      ${karte5('Monat für Monat', `Grün = Einnahmen, orange = Ausgaben, darunter das Ergebnis des Monats. Gestrichelt: dein aktuelles Gehalt (${eur0(R.gehalt)}). Säule anklicken: Buchungen.`, '<div class="s5-chart fuell"><canvas id="c-k5-monate"></canvas></div>', 's5-b2')}
      ${karte5('Jahr für Jahr', 'Ø je Monat · anklicken: dieses Jahr anzeigen', jahrTab)}
    </div>
    ${leiste}
    <details class="card s5-details" id="k5-tab"><summary>Alle Monate als Tabelle <span class="muted">· Zeile anklicken: Buchungen des Monats</span></summary><div class="t3-rahmen">${tabelle}</div></details>`;
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
function tabKategorien() {
  const P = periode(), aus = S.kart !== 'ein';
  const rechts = `<div class="seg" role="group" aria-label="Ausgaben oder Einnahmen"><button data-k2art="aus" class="${aus ? 'an' : ''}">Ausgaben</button><button data-k2art="ein" class="${aus ? '' : 'an'}">Einnahmen</button></div>${kontoWahlHtml()}${zeitSeg()}`;
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
  let satz = aus ? `${P.label[0].toUpperCase()}${P.label.slice(1)} gingen im Schnitt ${gesZ} im Monat raus – am meisten für ${verb}.`
    : `${P.label[0].toUpperCase()}${P.label.slice(1)} kamen im Schnitt ${gesZ} im Monat herein – vor allem aus ${verb}.`;
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
    : [{ titel: 'Gehalt', erkl: 'netto vom Arbeitgeber', farbe: 'var(--ein)', l: liste.filter((x) => x.k === 'Lohn / Gehalt') },
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
  const katZiel = (z) => zuBuchungen(aus ? { art: 'aus', kat: wahl.k, ...z } : { art: 'ein', kat: 'Einnahmen', ukat: wahl.k, ...z });
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
      ${stat(P.jahr && P.monate.length < 12 ? `Hochrechnung ${P.jahr}` : 'aufs Jahr', `≈ ${eur0(jahrWert)}`)}
      ${stat('ggü. Vorjahr', wd == null ? '–' : Math.abs(wd) < 1000 ? '≈ gleich' : plusMinus(wd), wd == null || Math.abs(wd) < 1000 ? '' : (wd > 0) === aus ? 'neg' : 'pos')}
    </div>
    <p class="s5-erkl">${eur0(wahl.c)} ${P.label} · ${NUM.format(wahl.rows.length)} Buchungen${wv != null ? ` · Vorjahr Ø ${eur0(wv)}` : ''}${tipp ? ` · ${tipp}` : ''}</p>
    <div class="s5-chart klein fuell"><canvas id="c-kat2"></canvas></div>
    <div class="kl-d-grid">
      ${unter.length > 1 ? `<div class="s5-teil"><h3>Wofür genau</h3>${balkenListe(unter.slice(0, 6).map(([u, c]) => ({ n: esc(schoen(u)), c: c / a.n, p: `${Math.round((c / wahl.c) * 100)} %`, farbe: aus ? 'var(--variabel)' : 'var(--ein)', ziel: zuBuchungen({ art: 'aus', kat: wahl.k, ukat: u === 'ohne Unterkategorie' ? '' : u, ...zeit }) })))}</div>` : ''}
      <div class="s5-teil"><h3>${aus ? 'An wen' : 'Von wem'}</h3>${balkenListe(empf.map(([e, x]) => ({ n: esc(e), sub: `${x.n} Buchungen`, c: x.c / a.n, p: `${Math.round((x.c / wahl.c) * 100)} %`, farbe: 'var(--muted)', ziel: zuBuchungen({ q: `"${e}"`, art: aus ? 'aus' : 'ein', ...zeit }) })))}</div>
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
    ${karte5(`${aus ? 'Ausgaben' : 'Einnahmen'} nach ${aus ? 'Kategorie' : 'Herkunft'}`, `Ø je Monat ${esc(monatsText(P.monate))} · Zeile anklicken: Einzelheiten rechts`, listeHtml, 'kl-liste')}
    ${detail}</div>
    <details class="card s5-details"><summary>Monat für Monat je ${aus ? 'Kategorie' : 'Einnahme'} <span class="muted">· in Euro · rot: deutlich über dem eigenen Ø · Zahl anklicken: Buchungen</span></summary>${tabelle}</details>`;
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
  const offen = kontostaende(D, tag).filter((x) => !['nicht_eroeffnet', 'geschlossen'].includes(x.status));
  const stand = offen.filter((x) => !fremd(x.k));
  const vj = +D.bis.slice(0, 4) - 1;
  const schnell = [[D.bis, 'Heute'], [`${vj}-12-31`, `31.12.${vj}`], [`${vj - 1}-12-31`, `31.12.${vj - 1}`]];
  const rechts = `${kontoWahlHtml()}<div class="kon5-tag"><label for="stichtag" class="muted klein">Stand am</label><input type="date" id="stichtag" value="${tag}" min="${D.von}" max="${D.bis}">
    <div class="seg">${schnell.map(([d, t]) => `<button class="${d === tag ? 'an' : ''}" data-st="${d}">${t}</button>`).join('')}</div></div>`;
  kontenGrafik = { tag };
  const m = stand.filter((x) => x.status !== 'unbekannt');
  const unbekannt = offen.filter((x) => x.status === 'unbekannt');
  if (!m.length) return kopf5('Konten', 'Am gewählten Tag gab es keine passenden Konten.', rechts) + eingangHtml();
  const jb = `${+tag.slice(0, 4) - 1}-12-31`;
  const anfang = new Map(kontostaende(D, jb < D.von ? D.von : jb).map((x) => [x.i, x.c]));
  const gew = m.filter((x) => drin(x.i) && x.c != null);
  const saldo = gew.reduce((t, x) => t + x.c, 0), saldoJb = gew.reduce((t, x) => t + (anfang.get(x.i) ?? 0), 0);
  const kaution = gew.filter((x) => /kaution/i.test(x.k.name)).reduce((t, x) => t + x.c, 0);
  const heute = tag === D.bis, V = heute && !ks ? verlauf5() : null, ende = V?.monate.at(-1);
  const kautionK = gew.find((x) => /kaution/i.test(x.k.name));
  const jahrZiel = zuBuchungen({ jahr: tag.slice(0, 4), monat: '' });
  let satz = `Am ${dde(tag)} liegen auf ${ks ? 'den gewählten Konten' : 'deinen Konten'} ${zs(`<b class="${saldo < 0 ? 'neg' : ''}">${eur0(saldo)}</b>`, '.kon5 .ko')}${kaution ? ` – davon ${zl(`${eur0(kaution)} Mietkaution`, zuBuchungen({ konto: kautionK.k.name }))}, frei verfügbar also <b>${eur0(saldo - kaution)}</b>` : ''}.`;
  if (tag.slice(5) !== '12-31') satz += ` Seit Jahresbeginn ${zl(`<b class="${saldo - saldoJb >= 0 ? 'pos' : 'neg'}">${plusMinus(saldo - saldoJb)}</b>`, jahrZiel)}.`;
  if (ende) satz += ` Läuft alles so weiter wie geplant, sind es Ende ${MONAT[+ende.k.slice(5) - 1]} etwa ${zl(`<b>${eur0(ende.stand)}</b>`, { tab: 'start' })}.`;
  const zahlen = [
    zahl5(heute ? 'Heute auf den Konten' : `Stand ${dde(tag)}`, eur0(saldo), ks ? `${gew.length} gewählte Konten` : 'ohne Depot, gemeinsame und Kinderkonten · je Konto ↓', { cls: saldo < 0 ? 'neg' : '', springe: '.kon5 .ko' }),
    zahl5('Frei verfügbar', eur0(saldo - kaution), kaution ? `ohne Mietkaution (${eur0(kaution)}) · Kautionskonto →` : 'keine Kaution gebunden', kaution ? { ziel: zuBuchungen({ konto: kautionK.k.name }) } : { springe: '.kon5 .ko' }),
    zahl5(`Seit 1. Januar ${tag.slice(0, 4)}`, plusMinus(saldo - saldoJb), `Stand 31.12.: ${eur0(saldoJb)} · Buchungen ${tag.slice(0, 4)} →`, { cls: saldo - saldoJb >= 0 ? 'pos' : 'neg', ziel: jahrZiel }),
    ende ? zahl5(`Prognose Ende ${MONAT[+ende.k.slice(5) - 1]}`, `≈ ${eur0(ende.stand)}`, `wenn alles läuft wie ein normaler Monat (${plusMinus(V.R.erg)})`, { cls: ende.stand < 0 ? 'neg' : '', ziel: { tab: 'start' } })
      : zahl5('Konten', NUM.format(gew.length), unbekannt.length ? `${unbekannt.length} ohne Daten für diesen Tag` : 'mit Daten zu diesem Tag', { springe: '.kon5 .ko' }),
  ].join('');

  // Letzte Buchung je Konto (bis zum Stichtag)
  const letzte = new Map();
  for (const r of D.rows) if (r.d <= tag && (!letzte.has(r.k) || r.d > letzte.get(r.k))) letzte.set(r.k, r.d);
  const maxC = Math.max(1, ...offen.filter((x) => x.status !== 'unbekannt').map((x) => Math.abs(x.c || 0)));
  const zeile = (x, g) => {
    const a0 = anfang.get(x.i), d = x.c != null && a0 != null ? x.c - a0 : null;
    const zusatz = { geschaetzt: 'geschätzt', ungefaehr: `± ${eur0(Math.round((x.abw || 0) * 100))}` }[x.status];
    const wert = x.status === 'unsicher' ? `<span class="muted" title="${esc(STATUS_TEXT.unsicher)}">?</span>` : `${zusatz ? '≈ ' : ''}${eur0(x.c)}`;
    const unter = [x.k.vollstaendig ? '✓ lückenlos' : `Daten ab ${dde(x.k.von).slice(3)}`, letzte.has(x.i) ? `letzte Buchung ${dde(letzte.get(x.i)).slice(0, 6)}` : '', zusatz].filter(Boolean).join(' · ');
    return `<button class="vg-z ko-z${g.fremd || drin(x.i) ? '' : ' aus'}${x.c < 0 ? ' minus' : ''}"${geh(zuBuchungen({ konto: x.k.name, jahr: tag.slice(0, 4) }))} title="Anklicken: Buchungen von ${esc(x.k.name)}">
      <span class="vg-zn">${esc(x.k.name)}<small>${esc(unter)}</small></span>
      <span class="ko-b"><i style="width:${Math.max(0.5, (Math.abs(x.c || 0) / maxC) * 100)}%"></i></span>
      <b class="vg-zw ${x.c < 0 ? 'neg' : ''}">${wert}</b><span class="vg-zp ${d == null || g.fremd ? 'muted' : d >= 0 ? 'pos' : 'neg'}">${d == null ? '–' : plusMinus(d)}</span></button>`;
  };
  const gruppen = KONTO_GRUPPEN.map((g) => {
    const l = offen.filter((x) => x.status !== 'unbekannt' && g.test(x.k)).sort((a, b) => (b.c ?? -1e12) - (a.c ?? -1e12));
    if (!l.length) return '';
    const summe = l.filter((x) => g.fremd || drin(x.i)).reduce((t, x) => t + (x.c || 0), 0);
    const farbe = g.fremd ? 'var(--muted)' : g.id === 'frei' ? 'var(--accent)' : g.id === 'karte' ? 'var(--aus)' : 'color-mix(in srgb, var(--accent) 45%, var(--surface))';
    return `<section class="vg kg${g.fremd ? ' fremd' : ''}" id="kg-${g.id}" style="--vg:${farbe}">
      <div class="vg-k"><span class="vg-n"><b>${g.titel}</b><small>${g.erkl}</small></span><span class="vg-b leer"></span><b class="vg-w ${summe < 0 ? 'neg' : ''}">${eur0(summe)}</b><span class="vg-p">${l.length} ${l.length === 1 ? 'Konto' : 'Konten'}</span></div>
      <div class="vg-l">${l.map((x) => zeile(x, g)).join('')}</div></section>`;
  }).join('');

  // Monatsenden: Summe deiner (gewählten) Konten und die Veränderung zum Vormonat
  const enden = [];
  { let [y, mo] = tag.slice(0, 7).split('-').map(Number); for (let i = 0; i < 7; i++) { if (--mo === 0) { mo = 12; y--; } const d = monatsletzter(`${mkey(y, mo)}-01`); if (d >= D.von) enden.unshift(d); } }
  const st = enden.map((d) => new Map(kontostaende(D, d).map((x) => [x.i, x.c])));
  const sumAm = (s2) => gew.reduce((t, x) => t + (s2.get(x.i) || 0), 0);
  const reihe = [...enden.map((d, i) => ({ d, c: sumAm(st[i]) })), { d: tag, c: saldo, jetzt: true }];
  const monatsenden = `<div class="me">${reihe.slice(1).reverse().map((x, i, a) => {
    const vor = reihe[reihe.length - 2 - i], diff = x.c - vor.c;
    return `<button class="me-z" data-st="${x.d}" title="Anklicken: Kontostände an diesem Tag"><span>${x.jetzt ? (heute ? 'heute' : dde(x.d).slice(0, 6)) : `Ende ${monKurz(x.d.slice(0, 7))}`}</span><b>${eur0(x.c)}</b><span class="${diff >= 0 ? 'pos' : 'neg'}">${plusMinus(diff)}</span></button>`;
  }).join('')}</div>`;
  const alt = (i) => (i < enden.length - 3 ? ' m-alt' : '');
  const tabelle = `<div class="t3-rahmen"><table class="t3 t3-eng"><thead><tr><th>Konto</th>${enden.map((d, i) => `<th class="r${alt(i)}">${monKurz(d.slice(0, 7))}</th>`).join('')}<th class="r">${dde(tag).slice(0, 6)}</th></tr></thead><tbody>
    ${gew.map((x) => `<tr><td class="t3-n">${esc(x.k.name)}</td>${st.map((s2, i) => `<td class="r${alt(i)}">${s2.get(x.i) == null ? '<span class="muted">–</span>' : NUM.format(Math.round(s2.get(x.i) / 100))}</td>`).join('')}<td class="r"><b>${NUM.format(Math.round(x.c / 100))}</b></td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Zusammen</td>${st.map((s2, i) => `<td class="r${alt(i)}">${NUM.format(Math.round(sumAm(s2) / 100))}</td>`).join('')}<td class="r">${NUM.format(Math.round(saldo / 100))}</td></tr></tfoot></table></div>`;
  return kopf5('Konten', satz, rechts) + `<div class="s5-zahlen">${zahlen}</div>
    <div class="s5-raster kon5">
      ${karte5('Alle Konten', `Stand ${dde(tag)} · nach Zweck gruppiert · rechts: Veränderung seit 1.1. · anklicken: Buchungen${ks ? ' · blass: nicht gewählt' : ''}`,
        `<div class="ko vgs"><div class="vg-kopf"><span>Konto</span><span></span><span>Stand</span><span>seit 1.1.</span></div>${gruppen}</div>
        ${unbekannt.length ? `<p class="s5-erkl">Für diesen Tag noch ohne Daten: ${unbekannt.map((x) => `${esc(x.k.name)} (ab ${dde(x.k.von)})`).join(', ')}.</p>` : ''}`, 's5-b2')}
      <div class="s5-spalte">
        ${karte5('Verlauf', `Summe ${ks ? 'der gewählten Konten' : 'deiner Konten'} am Monatsende${V ? ' · gestrichelt: Prognose' : ''} · Punkt anklicken: Stand an diesem Tag`, '<div class="s5-chart klein"><canvas id="c-konten-verlauf"></canvas></div>')}
        ${karte5('Monatsenden', 'Summe am Monatsende und Veränderung zum Vormonat · anklicken: Stand an diesem Tag', monatsenden, '', zs('je Konto ↓', '#kon-tab'))}
      </div>
    </div>
    <details class="card s5-details" id="kon-tab"><summary>Kontostände je Konto an den Monatsenden <span class="muted">· in Euro</span></summary>${tabelle}</details>` + eingangHtml();
}

// Summe der Kontostände je Monatsende (24 Monate), ohne Kontenauswahl zusätzlich die Prognose
function kontenGrafikZeichnen() {
  if (!kontenGrafik || !$('#c-konten-verlauf')) return;
  const ks = kontoSet(), tage = [];
  let [y, mo] = D.bis.slice(0, 7).split('-').map(Number);
  for (let i = 0; i < 24; i++) { const d = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); tage.unshift(d > D.bis ? D.bis : d); if (--mo === 0) { mo = 12; y--; } }
  const werte = tage.map((d) => kontostaende(D, d).filter((x) => (ks ? ks.has(x.i) : !fremd(x.k)) && x.c != null && x.status !== 'unbekannt').reduce((t, x) => t + x.c, 0) / 100);
  const labels = tage.map((d) => (d === D.bis ? 'heute' : monKurz(d.slice(0, 7))));
  let ab = -1;
  if (!ks) {
    const prog = verlauf5().monate.filter((m) => m.art !== 'ist');
    ab = tage.length;
    for (const m of prog) { tage.push(monatsletzter(`${m.k}-01`)); werte.push(m.stand / 100); labels.push(monKurz(m.k)); }
  }
  const c = css('--accent'), o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.layout = { padding: { top: 22, right: 8 } };
  o.plugins.tooltip.callbacks = { title: (it) => { const i = it[0].dataIndex; return `${ab >= 0 && i >= ab ? 'erwartet ' : 'Stand '}${dde(tage[i])}`; }, label: (it) => ` ${ks ? 'gewählte Konten' : 'alle Konten'}: ${EUR0.format(it.raw)}` };
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
    options: o, plugins: [prognoseMit(ab), punktWerteMit([0, letzteIst, tage.length - 1].filter((i, j, a) => i >= 0 && a.indexOf(i) === j), (v, i) => `${ab >= 0 && i >= ab ? '≈ ' : ''}${kurzWert(v)}`)] });
}

// ======================================================================= Tabellen
function sortiert() {
  const f = S.sort === 'betrag' ? (a, b) => Math.abs(a.c) - Math.abs(b.c) || a.c - b.c :   // nach Höhe des Betrags, egal ob rein oder raus
    S.sort === 'wer' ? (a, b) => (a.g || a.z).localeCompare(b.g || b.z, 'de') : (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.i - b.i);
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
  const zeitraum = [S.jahr ? (S.jahr.includes(',') ? `in ${S.jahr.replace(/,/g, ', ')}` : `in ${S.jahr}`) : '', S.monat ? `(${monateWahl().map((m) => MON[m - 1]).join(', ')})` : '', S.zr ? `von ${zrText()}` : ''].filter(Boolean).join(' ');
  // 1. dieselben Filter, nur ohne Jahr und Monat
  if (S.jahr || S.monat || S.zr) {
    const alt = { jahr: S.jahr, monat: S.monat, zr: S.zr };
    let l; try { S.jahr = ''; S.monat = ''; S.zr = ''; l = D.rows.filter(pruefer(conds)); } finally { Object.assign(S, alt); }
    if (l.length) {
      const jahre = [...new Set(l.map((r) => r.y))];
      return kasten(`${zeitraum ? `${zeitraum[0].toUpperCase()}${zeitraum.slice(1)}` : 'Im gewählten Zeitraum'} nichts gefunden – aber <b>${l.length} Treffer</b> in ${jahre.length === 1 ? jahre[0] : `${jahre.length} anderen Jahren`}:`, l,
        jahre.length === 1 ? { jahr: String(jahre[0]), monat: '', zr: '' } : { jahr: '', monat: '', zr: '' }, jahre.length === 1 ? `${jahre[0]} anzeigen` : 'In allen Jahren anzeigen');
    }
  }
  // 2. nur die Suche, ohne Konto, Kategorie, Art und Zeitraum
  const test = matcher(conds), l = D.rows.filter(test);
  if (l.length && (S.konto || S.kat || S.ukat || S.art !== 'alle' || !S.umb || S.jahr || S.monat)) {
    const konten = [...new Set(l.map((r) => r.k))], nurFremd = l.every((r) => FREMD_ART.has(r.art));
    const ziel = { jahr: '', monat: '', zr: '', konto: nurFremd && konten.length === 1 ? D.konten[konten[0]].name : '', kat: '', ukat: '', art: 'alle', umb: l.some((r) => r.art === 'Umbuchung') || S.umb };
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
  if (!rows.length) return keineTreffer(conds);
  const w = highlightWords(conds);
  const re = w.length ? new RegExp('(' + w.map(escRe).join('|') + ')', 'gi') : null;
  const mk = (s) => (re ? esc(s).replace(re, '<mark>$1</mark>') : esc(s));
  const kn = (r) => D.konten[r.k].name;
  // Kennzahlen der Treffer (alle, nicht nur die angezeigten)
  let ein = 0, aus = 0, von = rows[0].d, bis = rows[0].d;
  const mon = new Map(), tag = new Map();
  for (const r of rows) {
    if (r.c > 0) ein += r.c; else aus -= r.c;
    if (r.d < von) von = r.d; if (r.d > bis) bis = r.d;
    const k = r.d.slice(0, 7), m = mon.get(k) || { ein: 0, aus: 0 };
    if (r.c > 0) m.ein += r.c; else m.aus -= r.c;
    mon.set(k, m);
    tag.set(r.d, (tag.get(r.d) || 0) + r.c);
  }
  const monate = [];
  for (let k = von.slice(0, 7); k <= bis.slice(0, 7); k = mVor(k, 1)) monate.push(k);
  const nM = monate.length, je = (c) => (nM > 1 ? ` · Ø ${eur0(c / nM)} im Monat` : '');
  const zahlen = [
    zahl5('Treffer', NUM.format(rows.length), von === bis ? dde(von) : `${dde(von)} – ${dde(bis)}`),
    zahl5('Ausgaben', eur0(aus), `${rows.filter((r) => r.c < 0).length} Buchungen${je(aus)}`, { cls: aus ? 'neg' : '' }),
    zahl5('Einnahmen', eur0(ein), `${rows.filter((r) => r.c > 0).length} Buchungen${je(ein)}`, { cls: ein ? 'pos' : '' }),
    zahl5('Saldo', plusMinus(ein - aus), 'Einnahmen minus Ausgaben der Treffer', { cls: ein - aus >= 0 ? 'pos' : 'neg' }),
  ].join('');
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
    h += `<div class="bz mit-datum${auf ? ' offen' : ''}${gruppiert && erster ? ' tag-anfang' : ''}" data-i="${r.i}" title="Anklicken: Einzelheiten">
      <span class="bz-d">${erster ? datum(r.d) : ''}</span>
      <span class="bz-n"><b>${mk(r.g || r.z || '–')}</b>${r.g && r.z ? `<small>${mk(r.z)}</small>` : ''}</span>
      <span class="bz-k"><span>${esc(schoen(r.kat))}</span><small>${esc(schoen(r.ukat))}${r.ukat ? ' · ' : ''}${esc(kn(r))}</small></span>
      <b class="bz-b ${cls(r.c)}">${eur(r.c)}</b></div>`;
    if (auf) {
      const dd = [['Verwendungszweck', r.z], ['Kategorie', `${schoen(r.kat)}${r.ukat ? ' · ' + schoen(r.ukat) : ''}`], ['Konto', kn(r)], ['Art', r.art],
        ['Vertrag', r.v], ['Tags', r.t], ['Notiz', r.n], ['Steuerkategorie (Buhl)', r.st], ['Früher genannt', r.ga.join(', ')]].filter(([, v]) => v);
      h += `<div class="bz-detail"><dl>${dd.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        <div class="bz-knoepfe">${r.g ? `<button class="btn sm" data-alle="${esc(r.g)}">Alle Buchungen von „${esc(r.g.length > 40 ? r.g.slice(0, 40) + '…' : r.g)}“</button>` : ''}
        <button class="btn sm" data-nurkat="${esc(r.kat)}">Nur ${esc(schoen(r.kat))}</button>
        <label class="st-zuordnen klein">Steuer: <select data-steuer-i="${r.i}">${postenOptionen(steuerPosten(r), true)}</select></label></div></div>`;
    }
    if (gruppiert && letzter && anzahl.get(r.d) > 1) h += `<div class="bz-tagsumme">${anzahl.get(r.d)} Buchungen am ${dde(r.d).slice(0, 6)} · zusammen <b class="${cls(tag.get(r.d))}">${eur(tag.get(r.d))}</b></div>`;
  });
  let fuss = `<div class="bt-summe"><span>Summe ${rows.length === 1 ? 'der Buchung' : `aller ${NUM.format(rows.length)} Treffer`}<small>Einnahmen ${eur(ein)} · Ausgaben ${eur(-aus)}</small></span><b class="${cls(ein - aus)}">${eur(ein - aus)}</b></div>`;
  if (rows.length > limit) fuss += `<div class="mehr">${NUM.format(limit)} von ${NUM.format(rows.length)} angezeigt <button class="btn sm" id="mehr">Weitere ${NUM.format(Math.min(500, rows.length - limit))} anzeigen</button></div>`;
  return `<div class="bt">
    <div class="s5-zahlen bt-zahlen">${zahlen}</div>
    ${buchGrafik ? `<div class="bt-grafik"><div class="bt-g-t"><b>Je ${buchGrafik.jahre ? 'Jahr' : 'Monat'}</b><span class="muted klein">Ausgaben orange, Einnahmen grün · Säule anklicken: nur ${buchGrafik.jahre ? 'dieses Jahr' : 'dieser Monat'}</span></div><div class="s5-chart bt-chart"><canvas id="c-buch"></canvas></div></div>` : ''}
    <div class="bt-leiste"><span class="muted klein">${gruppiert ? 'Nach Datum, bei mehreren Buchungen am Tag mit Tagessumme' : S.sort === 'betrag' ? 'Nach Betrag sortiert' : 'Nach Empfänger sortiert'} · Zeile anklicken: Einzelheiten</span>${sortKnoepfe}</div>
    <div class="bt-liste">${h}</div>${fuss}</div>`;
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
  buchungen: () => ['Buchungen', `${[...(kontoSet() || [])].some((i) => D.konten[i].kind) ? 'mit Konto eines Kindes – zählt nicht zu deinen Finanzen · ' : [...(kontoSet() || [])].some((i) => D.konten[i].gemeinsam) ? 'mit gemeinsamem Konto – zählt nicht zu deinen Finanzen, nur deine Einzahlungen · ' : ''}${NUM.format(F.length)} Treffer · Zeile anklicken: Einzelheiten`],
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
  const frei = S.tab !== 'buchungen';
  $('#tabelle-card').classList.toggle('frei', frei);
  $('#tabelle-card .card-h').hidden = frei;
  if (S.tab === 'steuer') {
    steuerZeigen(el, { einJahr, toast, setze: (p) => setze(p), neuZeichnen: () => tabelle(conds) });
    $('.dl').hidden = true;
    return;
  }
  $('.dl').hidden = false;
  el.innerHTML = S.tab === 'buchungen' ? tabBuchungen(conds) : `<div class="s5">${S.tab === 'uebersicht' ? tabKategorien() : S.tab === 'konten' ? tabKonten() : tabFixkosten()}</div>`;
  gehBinden(el);
  // Zeitraum, Kategorien, Fixkosten-Ansicht
  el.querySelectorAll('[data-zeit]').forEach((b) => b.onclick = () => setze({ jahr: b.dataset.zeit, monat: '' }));
  el.querySelectorAll('[data-k2art]').forEach((b) => b.onclick = () => setze({ kart: b.dataset.k2art, wahl: '' }));
  el.querySelectorAll('.kl-z[data-k2kat]').forEach((b) => b.onclick = () => { setze({ wahl: b.dataset.k2kat }); if (matchMedia('(max-width: 1180px)').matches) $('.kl-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  el.querySelectorAll('[data-k2zelle]').forEach((td) => td.onclick = () => {
    const [k, m] = td.dataset.k2zelle.split('|');
    setze({ tab: 'buchungen', q: '', jahr: m.slice(0, 4), monat: String(+m.slice(5)), zr: '', art: S.kart, ...(S.kart === 'aus' ? { kat: k, ukat: '' } : { kat: 'Einnahmen', ukat: k }) });
  });
  el.querySelectorAll('[data-fixtab]').forEach((b) => b.onclick = () => setze({ fixtab: b.dataset.fixtab }));
  el.querySelectorAll('[data-sort]').forEach((th) => th.onclick = () => {
    const k = th.dataset.sort;
    S.dir = S.sort === k ? -S.dir : k === 'wer' ? 1 : -1; S.sort = k; tabelle(conds);
  });
  el.querySelectorAll('[data-i]').forEach((tr) => tr.onclick = (e) => {
    if (e.target.closest('.bz-detail')) return;
    const i = +tr.dataset.i; offen.has(i) ? offen.delete(i) : offen.add(i); tabelle(conds);
  });
  el.querySelectorAll('[data-alle]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); setze({ q: `"${b.dataset.alle}"` }); });
  el.querySelectorAll('[data-weiter]').forEach((b) => b.onclick = () => setze(JSON.parse(b.dataset.weiter)));
  el.querySelectorAll('[data-nurkat]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); setze({ kat: b.dataset.nurkat, ukat: '' }); });
  el.querySelectorAll('[data-steuer-i]').forEach((s) => {
    s.onclick = (e) => e.stopPropagation();
    s.onchange = () => { steuerZuordnen(D.rows[+s.dataset.steuerI], s.value); toast('Für die Steuer gespeichert – zu sehen im Reiter „Steuer“.'); };
  });
  $('#mehr')?.addEventListener('click', () => { limit += 500; tabelle(conds); });
  el.querySelectorAll('[data-fixansicht]').forEach((b) => b.onclick = () => { fixAnsicht = b.dataset.fixansicht; tabelle(conds); $('#btn-reset').hidden = !abweichend(); });
  el.querySelector('.fix-grundlage')?.addEventListener('toggle', (e) => { fixGrundlageAuf = e.target.open; });
  el.querySelectorAll('[data-leben]').forEach((b) => b.onclick = () => {
    lebenWahl = b.dataset.leben;
    if (lebenWahl === 'eigen' && !lebenEigen) lebenEigen = Math.round(lebenshaltung().schnitt / 100) * 100;
    try { localStorage.setItem('fd.leben', lebenWahl); localStorage.setItem('fd.lebeneigen', String(lebenEigen)); } catch {}
    D.mr = D.v5 = null;   // Übersicht und Prognose rechnen mit derselben Lebenshaltung
    tabelle(conds);
    if (lebenWahl === 'eigen') $('#leben-eigen')?.select();
  });
  $('#leben-eigen')?.addEventListener('change', (e) => {
    lebenEigen = Math.max(0, Math.round((+e.target.value || 0) * 100));
    try { localStorage.setItem('fd.lebeneigen', String(lebenEigen)); } catch {}
    D.mr = D.v5 = null;
    tabelle(conds);
  });
  if (S.tab === 'fix') planBinden();
  if (S.tab === 'konten') kontenGrafikZeichnen();
  if (S.tab === 'buchungen') buchGrafikZeichnen();
  if (S.tab === 'uebersicht') kat2Zeichnen();
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
// Lebenshaltung so, wie sie im Reiter Fixkosten gewählt ist (Ø 12 Monate, typischer Monat oder eigener Wert)
const lebenGewaehlt = () => (lebenWahl === 'eigen' && lebenEigen ? lebenEigen : lebenWahl === 'typisch' ? lebenshaltung().typisch : lebenshaltung().schnitt);
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
  if (a === 'Kinder & Betreuung') { const v = (f.name.match(/,\s*(\S+)/) || [])[1]; const u = f.ukat && !/^kinder$/i.test(f.ukat) ? schoen(f.ukat) : 'Kinder'; return v ? `${u} ${v}` : t; }
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

// Fixkosten: Was ist fest verplant – und was bleibt? Grundlage ist das aktuelle Gehalt; der normale Monat wie in der Übersicht.
function tabFixkosten() {
  const ks = kontoSet(), R = monatsRechnung();
  const gefiltert = fixkostenErkennen().filter((f) => !ks || ks.has(f.k));   // Verträge der gewählten Konten
  const alle = gefiltert.filter((f) => !f.gemeinsam), aktiv = alle.filter((f) => f.aktiv);
  const vomGemeinsamen = fixSichtbar(gefiltert.filter((f) => f.gemeinsam));
  const nFrueher = alle.filter((f) => !f.aktiv && f.zuletzt >= FRUEHER_AB).length, nAelter = alle.filter((f) => !f.aktiv && f.zuletzt < FRUEHER_AB).length;
  const liste = fixSichtbar(alle);
  const pm = aktiv.reduce((s, f) => s + f.proMonat, 0), G = R.gehalt, L = R.leben, E = G + R.sonst, rest = E - pm - L;
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
  const ueber = nachArt(aktiv), arten = nachArt(liste);
  fixKontext = { B: E, bz: { vom: 'vom Einkommen', name: 'Einkommen' }, pm, L, lauf: aktiv, ruecklage: ruecklagen() };
  const termine = naechsteTermine(aktiv), tSumme = termine.reduce((t, x) => t + x.f.betrag, 0);
  const jaehrl = aktiv.filter((f) => f.rh.proJahr < 12);
  const vertrZiel = S.fixtab === 'vertraege' ? (sel) => ({ springe: sel }) : () => ({ ziel: { fixtab: 'vertraege' } });
  const vz = (inhalt, sel = '.fix5 .vgs') => (S.fixtab === 'vertraege' ? zs(inhalt, sel) : zl(inhalt, { fixtab: 'vertraege' }));
  const satz = `Von deinem Gehalt (${zl(`<b>${eur0(G)}</b>`, zuGehalt())}) sind ${vz(`<b>${eur0(pm)}</b>`)} im Monat fest verplant – <b class="${pm <= G * 0.5 ? 'pos' : 'neg'}">${pct(pm)}</b>${pm > G * 0.5 ? ' (Faustregel: höchstens 50 %)' : ''}.
    ${rest >= 0 ? 'Nach' : 'Mit'} Lebenshaltung (${S.fixtab === 'vertraege' ? zs(eur0(L), '#fix-leben') : zl(eur0(L), { fixtab: 'vertraege', _springe: '#fix-leben' })}) und sonstigen Einnahmen (${zl(`+${eur0(R.sonst)}`, { tab: 'uebersicht', kart: 'ein', wahl: '', jahr: '' })}) ${rest >= 0 ? 'bleiben' : 'fehlen'} ${zl(`<b class="${rest >= 0 ? 'pos' : 'neg'}">${eur0(Math.abs(rest))}</b>`, { tab: 'start' })} im Monat.`;
  const zahlen = [
    zahl5('Fixkosten im Monat', eur0(pm), `${aktiv.length} laufende Verträge · jährliche anteilig · Liste ↓`, vertrZiel('.fix5 .vgs')),
    zahl5('Anteil am Gehalt', pct(pm), `von ${eur0(G)} netto (${monKurz(R.gehaltMonat)}) · Faustregel höchstens 50 % · Gehälter →`, { cls: pm <= G * 0.5 ? 'pos' : 'neg', ziel: zuGehalt() }),
    zahl5('Fixkosten im Jahr', eur0(pm * 12), jaehrl.length ? `davon ${eur0(jaehrl.reduce((t, f) => t + f.proJahr, 0))} nicht monatlich (${jaehrl.length} Verträge) · Kalender →` : 'alles monatlich', { ziel: { fixtab: 'kalender' } }),
    zahl5('Nächste 30 Tage', eur0(tSumme), `${termine.length} feste Abbuchungen · Kalender ansehen`, { ziel: { fixtab: 'kalender' } }),
  ].join('');
  // Balken: große Arten einzeln, kleine (unter 4 %) zusammen
  const gross = ueber.filter((g) => g.summe >= (pm + L) * 0.04), klein = ueber.filter((g) => g.summe > 0 && g.summe < (pm + L) * 0.04), kleinS = klein.reduce((t, g) => t + g.summe, 0);
  const teile = [...gross.map((g) => ({ n: FIX_KURZ[g.art] || esc(g.art), c: g.summe, tip: `${g.art}: ${eur0(g.summe)} im Monat · ${pct(g.summe)} vom Gehalt – anklicken: Verträge`, ...vertrZiel(`#${fvId(g.art)}`) })),
    ...(kleinS ? [{ n: 'Übrige', c: kleinS, tip: `${klein.map((g) => `${g.art} ${eur0(g.summe)}`).join(', ')} – zusammen ${eur0(kleinS)} im Monat`, ...vertrZiel(`#${fvId(klein[0].art)}`) }] : [])];
  const lh = lebenshaltung();
  if (lebenWahl === 'eigen' && !lebenEigen) lebenWahl = 'schnitt';
  const knopf = (k, t, wert) => `<button data-leben="${k}" class="${lebenWahl === k ? 'an' : ''}">${t}${wert != null ? ` <small>${eur0(wert)}</small>` : ''}</button>`;
  let h = kopf5('Fixkosten', satz, kontoWahlHtml()) + `<div class="s5-zahlen">${zahlen}</div>
    <section class="card s5-karte fix5-balken"><div class="s5-kt"><div class="s5-kt-t"><h2>Dein Monat in einem Balken</h2>
      <p class="s5-erkl">Dunkel = Fixkosten je Art, hell = Lebenshaltung, rot schraffiert = was fehlt. Der senkrechte Strich ist dein Einkommen (Gehalt + übliche sonstige Einnahmen). Fläche anklicken: Einzelheiten.</p></div></div>
      ${geldBalken({ ...R, fix: pm, ein: E, aus: pm + L, erg: rest }, teile)}
      <details class="fix-grundlage"${fixGrundlageAuf ? ' open' : ''}><summary>Gerechnet mit Gehalt ${eur0(G)} (${monLang(R.gehaltMonat)}), sonstigen Einnahmen ${eur0(R.sonst)} (typischer Monat) und Lebenshaltung ${eur0(L)} (${lebenName()}) · <span class="link">Lebenshaltung ändern</span></summary>
        <div class="fix-einst"><div class="fix-bezug-zeile"><span>Lebenshaltung</span><div class="seg fix-bezug">${knopf('schnitt', 'Ø 12 Monate', lh.schnitt)}${knopf('typisch', 'typischer Monat', lh.typisch)}${knopf('eigen', 'eigener Wert')}</div>
          ${lebenWahl === 'eigen' ? `<label class="fix-eigen"><input type="number" id="leben-eigen" min="0" step="50" inputmode="numeric" value="${Math.round(L / 100)}"> € / Monat</label>` : ''}</div></div>
        <p class="muted klein">Lebenshaltung = alle übrigen Ausgaben deiner Konten (Einkauf, Tanken, Freizeit, Urlaub, Anschaffungen) ohne Fixkosten und ohne Gemeinschaftskonto, ${esc(monatsText(lh.monate))}. „Typischer Monat“ ist der Median – einzelne teure Monate zählen dann weniger. Die Wahl gilt auch für die Übersicht und die Prognose.</p>
      </details>
    </section>`;
  const reiter = (k, t) => `<button data-fixtab="${k}" class="${S.fixtab === k ? 'an' : ''}">${t}</button>`;
  h += `<div class="fix-tabs"><div class="seg">${reiter('vertraege', `Verträge <small>${aktiv.length}</small>`)}${reiter('kalender', 'Wann abgebucht wird')}${reiter('plan', 'Was wäre wenn …')}</div></div>`;
  h += S.fixtab === 'kalender' ? `<div class="card fix-zk k3">${zahlungskalenderHtml(aktiv)}</div>`
    : S.fixtab === 'plan' ? `<div class="card fix-plan k3" id="fix-plan">${planHtml()}</div>`
      : fixVertraegeAnsicht({ liste, arten, ueber, pct, pm, vomGemeinsamen, aktiv, alle, nFrueher, nAelter, termine, tSumme, R });
  h += `<details class="fix-fuss muted klein"><summary>So wird gerechnet</summary><p>Fixkosten sind automatisch erkannte regelmäßige Zahlungen (gleicher Empfänger und Verwendungszweck, regelmäßiger Abstand; jährliche anteilig je Monat). Deine Überweisungen aufs Gemeinschaftskonto zählen mit, was von dort abgeht, nicht noch einmal. Normaler Monat = Gehalt + typische sonstige Einnahmen − Fixkosten − Lebenshaltung. Stand ${dde(D.bis)}.</p></details>`;
  return h;
}

// Verträge nach Art gruppiert (Art als Kopf, die Verträge eingerückt darunter), daneben Wofür, Lebenshaltung und die nächsten Abbuchungen
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
      const rhythmus = `${f.rh.name} ${e2(f.betrag)}`, wann = f.aktiv ? (n ? `nächste ${dde(n).slice(0, 6)}` : '') : `beendet ${dde(f.zuletzt).slice(3)}`;
      const unter = [titel !== f.name ? f.name : '', vt].filter(Boolean).map(esc).join(' · ');
      return `<button class="vg-z${f.aktiv ? '' : ' beendet'}" data-fix="${esc(f.name)}" data-sig="${esc(f.sig)}" title="${esc(vertragName(f))} – alle Zahlungen anzeigen">
        <span class="vg-zn">${esc(titel)}${unter ? `<small>${unter}</small>` : ''}<small class="vg-mobil">${esc([rhythmus, wann].filter(Boolean).join(' · '))}</small></span>
        <span class="vg-zr">${esc(rhythmus)}${wann ? `<small>${esc(wann)}</small>` : ''}</span>
        <b class="vg-zw">${f.aktiv ? eur0(f.proMonat) : '–'}</b><span class="vg-zp">${f.aktiv ? pct(f.proMonat) : ''}</span></button>`;
    };
    return `<section class="vg" id="${fvId(g.art)}" style="--vg:${farbe(g.art)}">
      <div class="vg-k"><span class="vg-n"><b>${esc(g.art)}</b><small>${g.laufend ? anzahl(g.laufend) : 'beendet'}${g.fs.length > g.laufend && g.laufend ? ` · ${g.fs.length - g.laufend} beendet` : ''}</small></span>
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
      ${karte5('Nächste 30 Tage', 'Feste Abbuchungen je Tag, dazwischen das erwartete Gehalt · anklicken: alle Zahlungen', termineHtml(termine, 14), '', zl(`<span class="s5-wert">${eur0(tSumme)}</span>`, { fixtab: 'kalender' }))}
    </div>
  </div>`;
}

// Lebenshaltung: wofür das übrige Geld geht (Ø je Monat der letzten 12 Monate, ohne Verträge) – jede Zeile führt zu genau diesen Buchungen
function lebenKarte(R) {
  const lh = R.lh;
  if (!lh.monate.length) return '';
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
  const kreis = (cls_, d, c, tip, extra = '') => { const r = R(c, cls_ === 'extra' ? 6 : 4); return `<span class="zk-k ${cls_}" style="left:${pos(d)};width:${r * 2}px;height:${r * 2}px" title="${esc(tip)}">${extra}</span>`; };
  const zeilen = monate.map((m, i) => {
    let inhalt = '';
    for (const [d, x] of [...m.tage].sort((a, b) => a[0] - b[0])) {
      const vorbei = m.k === jetzt && d <= heute;
      if (x.mon) inhalt += kreis(`mon${vorbei ? ' vorbei' : ''}`, d, x.mon, `${d}. ${MONAT[+m.k.slice(5) - 1]}: ${eur0(x.mon)}${vorbei ? ' (schon abgebucht)' : ''}\n${x.fs.map((f) => `${vertragName(f)}: ${EUR.format(f.betrag / 100)}`).join('\n')}`);
      for (const f of x.extra) {
        inhalt += kreis('extra', d, f.betrag, `${d}. ${MONAT[+m.k.slice(5) - 1]}: ${vertragName(f)} ${EUR.format(f.betrag / 100)} (${f.rh.name})`);
        inhalt += `<span class="zk-l${d > 18 ? ' links' : ''}" style="left:${pos(d)}" data-fix="${esc(f.name)}" data-sig="${esc(f.sig)}">${esc(vertragName(f))} <b>${eur0(f.betrag)}</b></span>`;
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
    const netto = einkommen().aktuell.wert || B;
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


// ======================================================================= Herunterladen
function dateiname(teil) {
  const f = [S.jahr, monateWahl().map((m) => MON[m - 1]).join(' '), S.konto, S.kat, S.ukat, S.q && S.q.replace(/["|<>]/g, ' ')].filter(Boolean).join(' ');
  const heute = new Date().toISOString().slice(0, 10);
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
const ZUSTAND = ['q', 'jahr', 'monat', 'konto', 'kat', 'ukat', 'art', 'umb', 'tab', 'stichtag', 'wahl', 'kart', 'fixtab', 'zr', 'nf'];
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
  $('#werkzeug').hidden = t !== 'buchungen';
  schnellSuche();
  $('#fuss').hidden = t === 'start';
  $('#seite-start').hidden = t !== 'start';
  $('#seite-kennzahlen').hidden = t !== 'kennzahlen';
  $('#tabelle-card').hidden = t === 'start' || t === 'kennzahlen';
  filterZeigen(conds);
  // jede Grafik für sich: ein Fehler in einer soll die anderen nicht leer lassen
  const sicher = (f) => { try { return f(); } catch (e) { console.error(e); return null; } };
  if (t === 'start') sicher(startSeite);
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
  for (const k of ['q', 'jahr', 'monat', 'zr', 'nf', 'konto', 'kat', 'ukat', 'stichtag', 'wahl']) if (S[k]) p.set(k, S[k]);
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
const grundZustand = () => ({ ...S0, jahr: startJahr(), tab: S.tab, sort: S.sort, dir: S.dir });
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
  for (const k of ['q', 'jahr', 'monat', 'konto', 'kat', 'ukat', 'wahl']) if (p.get(k)) S[k] = p.get(k);
  if (p.get('kart') === 'ein') S.kart = 'ein';
  if (['kalender', 'plan'].includes(p.get('fixtab'))) S.fixtab = p.get('fixtab');
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.get('stichtag') || '')) S.stichtag = p.get('stichtag');
  if (/^\d{4}-\d{2}_\d{4}-\d{2}$/.test(p.get('zr') || '')) S.zr = p.get('zr');
  if (p.get('nf') === '1') S.nf = '1';
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
  if (LOKAL) window.__fd = { D, fix: () => fixkostenErkennen(), mr: () => monatsRechnung(), sammle, periode };   // nur zum Testen auf dem eigenen Rechner
  chatDaten(D);
  steuerDaten(D).then(() => { if (S.tab === 'steuer') tabelle(parse(S.q)); else if (S.tab === 'start') { try { startSeite(); } catch (e) { console.error(e); } } });
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
      // ohne PC-Dienst (Handy): zeigen, was im Eingang noch auf den PC wartet
      let wartend = null;
      if (Q.hatToken()) { try { wartend = await Q.eingangDateien(); } catch { wartend = null; } }
      return einlesenMeldung({ ohneDienst: true, wartend });
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
        <table class="hilfe-tab">${wartend.map((f) => `<tr><td>${esc(f.name)}</td><td class="r klein muted">abgelegt ${zeit(f.createdTime || f.modifiedTime)}</td></tr>`).join('')}</table>
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
  document.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => setze({ tab: b.dataset.tab }));
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
  chatStart({ setze: (p) => setze(p), fixkosten: () => fixkostenErkennen(), normalerMonat: () => (D ? monatsRechnung() : null) });
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
