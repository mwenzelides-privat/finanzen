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
const S0 = { q: '', jahr: '', monat: '', konto: '', kat: '', ukat: '', art: 'alle', umb: false, tab: 'start', sort: 'datum', dir: -1, stichtag: '', wahl: '', kart: 'aus', fixtab: 'vertraege' };
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
// Gewählte Monate: S.monat ist „3“ oder „1,2,3“
const monateWahl = () => (S.monat ? String(S.monat).split(',').map(Number).filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b) : []);
const JAHRES_FARBEN = ['--accent', '--aus', '--ein', '#9085e9', '#eda100', '#e87ba4', '#4a3aa7', '--muted'];
// Farbe je Jahr im Vergleich: das neueste Jahr in Blau, davor Orange, Grün, …
function jahresFarbe(idx, anzahl) { const f = JAHRES_FARBEN[(anzahl - 1 - idx) % JAHRES_FARBEN.length]; return f.startsWith('--') ? css(f) : f; }

// Prüffunktion für alle Filter; mitJahr = false lässt Jahr und Zeitangaben der Suche weg (für den Vorjahresvergleich),
// mitArt = false den Filter „nur Einnahmen/Ausgaben“ (für die Kennzahlen, die immer beide Seiten zeigen)
function pruefer(conds, mitJahr = true, mitArt = true) {
  const test = matcher(mitJahr ? conds : conds.filter((c) => c.kind !== 'zeit'));
  const jahre = mitJahr ? jahreWahl() : [], monate = monateWahl();
  const ks = kontoSet();
  const fremdGewaehlt = !!ks && [...ks].some((i) => fremd(D.konten[i]));
  return (r) => (S.umb || r.art !== 'Umbuchung') && (!FREMD_ART.has(r.art) || fremdGewaehlt)
    && (!jahre.length || jahre.includes(r.y)) && (!monate.length || monate.includes(r.m)) && (!ks || ks.has(r.k))
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
  $('#f-zurueck').hidden = true;
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
const laufendText = () => `noch nicht abgeschlossen – Daten bis ${dde(D.bis).slice(0, 6)}`;

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
  const ek = einkommen(), B = ek.aktuell.wert || ek.schnitt.wert, L = lebenGewaehlt(), spiel = B - pm - L;   // Grundlage: aktuelles Gehalt
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
    kachel('fix', 'fix', 'Fixkosten pro Monat', eur0(pm), '', `<span class="ue-d ${pm <= B * 0.5 ? 'gut' : 'schlecht'}">${B ? pzVon(pm, B) : '–'} vom aktuellen Gehalt</span> <span class="muted">Ziel: höchstens 50 %</span>`,
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

const UE_FEST = '#b8461b';   // feste Ausgaben (dunkles Orange) – variable heller
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
      <p class="ue-satz">Von deinem aktuellen Nettogehalt (<b>${eur0(B)}</b>, ${MONAT[+ek.letzter.slice(5) - 1]}) bleiben nach Fixkosten und Lebenshaltung ${rest >= 0 ? `<b class="pos">${eur0(rest)}</b> übrig.` : `<b class="neg">−${eur0(-rest)}</b> – du lebst gerade von Rücklagen.`}</p>
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

// Abbuchungen der nächsten 30 Tage aus den erkannten Verträgen – nach Monat gruppiert, mit Zwischensumme und Laufsumme
function ueTermine(fixV, n = 40, ziel = '#ue-termine') {
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
  const summe = liste.reduce((t, x) => t + x.f.betrag, 0);
  const tagText = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return `${WTAG[d.getUTCDay()]} ${+iso.slice(8)}.${+iso.slice(5, 7)}.`; };
  // je Tag eine Zeile mit allen Verträgen; je Monat eine Zwischensumme; rechts die Laufsumme
  const tage = new Map(), proMonat = new Map();
  for (const x of liste) {
    (tage.get(x.am) || tage.set(x.am, []).get(x.am)).push(x.f);
    const k = x.am.slice(0, 7), g = proMonat.get(k) || { c: 0, n: 0 }; g.c += x.f.betrag; g.n++; proMonat.set(k, g);
  }
  let kum = 0, zuletzt = '', frei = n, wegN = 0, wegC = 0;
  const gruppen = ziel === '#uem-termine';   // Zwischensummen je Monat nur in der breiten Karte der Monatsansicht
  const chip = (f, mitBetrag) => `<button class="ab-v" data-fix="${esc(f.name)}" data-sig="${esc(f.sig)}" title="${esc(vertragName(f))} · ${eur0(f.betrag)} · ${f.rh.name} – alle Zahlungen anzeigen">${esc(vertragName(f))}${f.rh.proJahr < 12 ? ` <i class="ue-t-rh">${esc(f.rh.name)}</i>` : ''}${mitBetrag ? ` <b>${eur0(f.betrag)}</b>` : ''}</button>`;
  const zeilen = [...tage].map(([am, fs]) => {
    const c = fs.reduce((t, f) => t + f.betrag, 0); kum += c;
    if (frei <= 0) { wegN += fs.length; wegC += c; return ''; }   // passt nicht mehr hinein
    let kopf = '';
    if (gruppen && am.slice(0, 7) !== zuletzt) {
      zuletzt = am.slice(0, 7);
      const g = proMonat.get(zuletzt), name = MONAT[+zuletzt.slice(5) - 1];
      kopf = `<div class="ue-t-gruppe"><span>${zuletzt === heute.slice(0, 7) ? `Rest ${name}` : `${name} bis ${+bis.slice(8)}.`}</span><span>${g.n} Abbuchung${g.n > 1 ? 'en' : ''} · <b>${eur0(g.c)}</b>${summe ? ` <small>${Math.round((g.c / summe) * 100)} %</small>` : ''}</span></div>`;
    }
    const zeig = fs.slice(0, frei), rest = fs.slice(zeig.length); frei -= zeig.length;
    return `${kopf}<div class="ue-td"><span class="ue-t-d">${tagText(am)}</span><span class="ab-vs">${zeig.map((f) => chip(f, fs.length > 1)).join('')}${rest.length ? `<span class="ue-t-mehr muted">+ ${rest.length} weitere (${eur0(rest.reduce((t, f) => t + f.betrag, 0))})</span>` : ''}</span><b class="ue-td-s">${eur0(c)}</b><span class="ue-t-k" title="bis dahin zusammen">Σ ${eur0(kum)}</span></div>`;
  }).join('') + (wegN ? `<div class="ue-t-mehr muted">+ ${wegN} weitere danach (${eur0(wegC)})</div>` : '');
  $(ziel).innerHTML = `<div class="ue-h"><h2>Nächste 30 Tage</h2><span class="ue-h-wert">${liste.length} feste Abbuchungen · <b>${eur0(summe)}</b></span></div>
    <div class="ue-termine">${liste.length ? zeilen : '<div class="leer">Keine festen Abbuchungen in den nächsten 30 Tagen.</div>'}</div>`;
  const tb = $(`${ziel} .ue-termine`);
  if (n > 1 && tb && tb.scrollHeight > tb.clientHeight + 2) return ueTermine(fixV, n - 1, ziel);
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
  const typ = { ein: med((x) => x.ein), sonst: med((x) => x.ein - x.lohn), var: med((x) => x.var), lohn: med((x) => x.lohn), spar: med((x) => x.spar) };
  // Grundlage für Prognose und Prozente: das aktuelle Gehalt (letzter Monat mit Gehaltseingang)
  const ekA = einkommen(), akt = ekA.aktuell.wert || typ.lohn;
  const schnitt = { ein: avg((x) => x.ein), aus: avg((x) => x.aus), fest: avg((x) => x.aus - x.var), lohn: avg((x) => x.lohn), kat: new Map() };
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
      monate.push({ k, art: 'ist', ein: x.ein, aus: x.aus, festAus: x.aus - x.var, lohn: x.lohn, erg: x.ein - x.aus, x, stand: kontenSumme(ende > heute ? heute : ende) });
    } else if (i === 0) {
      const offenFest = fest(plusTage(heute, 1), ende);
      const gehaltKommt = x.lohn > 0 ? 0 : akt;
      // Einnahmen: das aktuelle Gehalt (falls noch nicht da) plus die typischen sonstigen Einnahmen, soweit sie noch fehlen
      const einE = x.ein + gehaltKommt + Math.max(0, typ.sonst - (x.ein - x.lohn)), ausE = x.aus + offenFest + Math.max(0, typ.var - x.var);
      stand += einE - x.ein - (ausE - x.aus) + typ.spar * (1 - +heute.slice(8) / +ende.slice(8));
      const tag = +heute.slice(8), tage = +ende.slice(8);
      monate.push({ k, art: 'laeuft', ein: einE, aus: ausE, festAus: x.aus - x.var + offenFest, lohn: x.lohn + gehaltKommt, erg: einE - ausE, x, bisher: { ein: x.ein, aus: x.aus, erg: x.ein - x.aus }, offenFest, gehaltKommt, tag, tage, stand });
    } else {
      const f = fest(`${k}-01`, ende), einE = akt + typ.sonst, ausE = typ.var + f;
      stand += einE - ausE + typ.spar;
      monate.push({ k, art: 'prognose', ein: einE, aus: ausE, festAus: f, lohn: akt, erg: einE - ausE, fest: f, stand });
    }
  }
  return (D.ueM = { monate, ref, typ, schnitt, vertraege, gt, jetzt, laeuft, ist, w, akt, aktMonat: ekA.letzter });
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
  ueTermine(fixkostenErkennen().filter((f) => !f.gemeinsam && f.aktiv), 40, '#uem-termine');
}

// Kacheln: heute, dieser Monat, wohin es läuft, Durchschnitt, Fixkosten
function ueKacheln(M) {
  const heute = kontenSumme(D.bis), anfang = kontenSumme(plusTage(`${M.jetzt}-01`, -1));
  const jetzt = M.monate[3], ende = M.monate[6];
  const sE = M.schnitt.ein, sA = M.schnitt.aus, sErg = sE - sA;
  const fixV = fixkostenErkennen().filter((f) => !f.gemeinsam && f.aktiv), pm = fixV.reduce((t, f) => t + f.proMonat, 0);
  const ek = einkommen(), B = ek.aktuell.wert || ek.schnitt.wert, gMon = `${MON[+ek.letzter.slice(5) - 1]} ${ek.letzter.slice(2, 4)}`;
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
    kachel('fixg', 'fix', 'Fixkosten vom Gehalt', B ? pzVon(pm, B) : '–', pm <= B * 0.5 ? 'pos' : 'neg',
      `<span class="muted">${eur0(pm)} von ${eur0(B)} aktuellem Gehalt (${gMon}) · Ziel ≤ 50 %</span>`, fixGehaltBalken(pm, lebenGewaehlt(), B)),
    kachel('schnitt', 'erg', 'Ø pro Monat (12 Monate)', vz(sErg), sErg >= 0 ? 'pos' : 'neg',
      `<span class="muted">${eur0(sE)} rein · ${eur0(sA)} raus</span> <span class="ue-d ${sErg >= 0 ? 'gut' : 'schlecht'}">Sparquote ${sE ? `${sErg < 0 ? '−' : ''}${Math.abs(Math.round((sErg / sE) * 100))} %` : '–'}</span>`),
  ].join('');
  $('#uem-kpis').querySelectorAll('[data-uemz]').forEach((b) => b.onclick = () => ({
    konten: () => setze({ tab: 'konten' }), monat: () => { ueAuswahl = [M.jetzt]; ueMonate(); },
    prognose: () => { ueAuswahl = M.monate.slice(4).map((m) => m.k); ueMonate(); },
    schnitt: () => setze({ tab: 'kennzahlen', jahr: '', monat: '' }), fixg: () => setze({ tab: 'fix' }),
  })[b.dataset.uemz]());
}

// Gehalt = 100 %: Fixkosten | Lebenshaltung | bleibt – was fehlt, rot schraffiert hinter der 100-%-Marke
function fixGehaltBalken(pm, L, B) {
  if (!B) return '';
  const rest = B - pm - L, max = Math.max(B, pm + L), w = (c) => (Math.max(0, c) / max) * 100, p = (c) => `${Math.round((c / B) * 100)} %`;
  return `<span class="uem-fg" title="Gehalt = 100 %: Fixkosten ${eur0(pm)} (${p(pm)}) · Lebenshaltung ${eur0(L)} (${p(L)}) · ${rest >= 0 ? `bleibt ${eur0(rest)}` : `fehlt ${eur0(-rest)}`} (${p(Math.abs(rest))})">
    <i class="uem-fg-fix" style="width:${w(pm)}%"></i><i class="uem-fg-leben" style="width:${w(L)}%"></i>${rest > 0 ? `<i class="uem-fg-rest" style="width:${w(rest)}%"></i>` : ''}
    ${rest < 0 ? `<b class="uem-fg-minus" style="left:${w(B)}%;width:${w(-rest)}%"></b>` : ''}<b class="uem-fg-50" style="left:${w(B * 0.5)}%"></b>${max > B ? `<b class="uem-fg-100" style="left:${w(B)}%"></b>` : ''}</span>`;
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
  const cF = UE_FEST;
  const pE = muster(cE), pA = muster(cA), pF = muster(cF);
  const fuell = (farbe, p, stark = 0.9) => ms.map((m) => (m.art === 'prognose' ? p : m.art === 'laeuft' ? alpha(farbe, stark * 0.6) : alpha(farbe, stark)));
  const erg = ms.map((m) => m.erg / 100);
  const o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.layout = { padding: { top: 18, bottom: 2 } };
  o.plugins.tooltip.callbacks = {
    title: (it) => { const m = ms[it[0].dataIndex]; return `${MONAT[+m.k.slice(5) - 1]} ${m.k.slice(0, 4)}${m.art === 'prognose' ? ' – Prognose' : m.art === 'laeuft' ? ' – erwartet bis Monatsende' : ''}`; },
    label: (it) => ` ${it.dataset.label}: ${it.raw == null ? '–' : EUR0.format(it.raw)}`,
    footer: (it) => { const m = ms[it[0].dataIndex]; return [`${m.erg >= 0 ? 'Überschuss' : 'Fehlbetrag'}: ${EUR0.format(m.erg / 100)}`, M.akt ? `feste Ausgaben = ${Math.round((m.festAus / M.akt) * 100)} % vom aktuellen Gehalt (${EUR0.format(M.akt / 100)})` : '', m.art === 'laeuft' ? `bisher: ${EUR0.format(m.bisher.ein / 100)} rein, ${EUR0.format(m.bisher.aus / 100)} raus` : '', 'Klick: Monat wählen · Strg/Umschalt: mehrere'].filter(Boolean); },
  };
  o.scales = {
    x: { ...achsenStil(), stacked: true, grid: { display: false }, ticks: { ...achsenStil().ticks, padding: 20, font: { size: 12, weight: '600' }, color: css('--text-2') } },
    y: { ...achsenStil(), stacked: true, beginAtZero: true, ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 5 } },
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
      { label: 'Einnahmen', stack: 'ein', data: ms.map((m) => m.ein / 100), backgroundColor: fuell(cE, pE), hoverBackgroundColor: cE, borderRadius: 4, maxBarThickness: 40, categoryPercentage: 0.7, barPercentage: 0.88, order: 2 },
      { label: 'Ausgaben fest', stack: 'aus', data: ms.map((m) => m.festAus / 100), backgroundColor: fuell(cF, pF), hoverBackgroundColor: cF, borderRadius: 0, maxBarThickness: 40, categoryPercentage: 0.7, barPercentage: 0.88, order: 2 },
      { label: 'Ausgaben variabel', stack: 'aus', data: ms.map((m) => (m.aus - m.festAus) / 100), backgroundColor: fuell(cA, pA, 0.55), hoverBackgroundColor: cA, borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 40, categoryPercentage: 0.7, barPercentage: 0.88, order: 2 },
      { type: 'line', stack: 'konto', label: 'Kontostand Monatsende', data: ms.map((m) => (m.stand == null ? null : m.stand / 100)), borderColor: cK, backgroundColor: cK, borderWidth: 2.5, tension: 0.3,
        pointRadius: ms.map((_, i) => (gewaehlt.has(i) ? 5 : 3.5)), pointBackgroundColor: ms.map((m) => (m.art === 'ist' ? cK : css('--surface'))), pointBorderColor: cK, pointBorderWidth: 2,
        segment: { borderDash: (s) => (s.p1DataIndex > ij - 1 ? [6, 4] : undefined) }, order: 1 },
    ] },
    options: o, plugins: [hintergrund, {
      // Werte: Einnahmen oben, Ausgaben gesamt oben auf dem Stapel, fester Anteil im dunklen Teil, Kontostand an der Linie
      id: 'ueWerte',
      afterDatasetsDraw(ch) {
        const c = ch.ctx, [mE, mF, mV, mK] = [0, 1, 2, 3].map((i) => ch.getDatasetMeta(i));
        c.save(); c.textAlign = 'center'; c.lineJoin = 'round'; c.lineWidth = 3; c.strokeStyle = css('--surface');
        const schreib = (t, x, y, farbe, fett = 600, gr = 9.5) => { c.font = `${fett} ${gr}px ${css('--font')}`; c.fillStyle = farbe; c.strokeText(t, x, y); c.fillText(t, x, y); };
        ms.forEach((m, i) => {
          c.textBaseline = 'bottom';
          if (mE.data[i]) schreib(kurzWert(m.ein / 100), mE.data[i].x, mE.data[i].y - 3, css('--text-2'));
          if (mV.data[i]) schreib(kurzWert(m.aus / 100), mV.data[i].x, Math.min(mV.data[i].y, mF.data[i].y) - 3, css('--text-2'));
          const f = mF.data[i];
          if (f && f.base - f.y > 15 && M.akt) { c.textBaseline = 'middle'; c.font = `700 9px ${css('--font')}`; c.fillStyle = '#fff'; c.fillText(`${Math.round((m.festAus / M.akt) * 100)} %`, f.x, (f.y + f.base) / 2); }
          const k = mK.data[i];
          if (k && m.stand != null) { c.textBaseline = 'bottom'; schreib(kurzWert(m.stand / 100), k.x, k.y - 6, cK, 700); }
        });
        c.restore();
      },
    }],
  });
}

// Die Auswahl als Monatsrechnung (Wasserfall): Einnahmen − feste − variable Ausgaben = Ergebnis.
// Volle Fläche = schon gebucht, schraffiert = noch erwartet (laufender Monat, Prognose). Darunter vier Eckdaten.
function ueAuswahlKarte(M) {
  const sel = M.monate.filter((m) => ueAuswahl.includes(m.k)), n = sel.length;
  const sum = (f) => sel.reduce((t, m) => t + f(m), 0) / n;
  const ein = sum((m) => m.ein), aus = sum((m) => m.aus), fest = sum((m) => m.festAus), vari = aus - fest, erg = ein - aus;
  // schon gebucht: abgeschlossene Monate ganz, der laufende bis heute, Prognosen nichts
  const gebucht = (m, f) => (m.art === 'prognose' ? 0 : f(m.x));
  const kEin = sum((m) => gebucht(m, (x) => x.ein)), kVar = sum((m) => gebucht(m, (x) => x.var)), kFest = sum((m) => gebucht(m, (x) => x.aus - x.var));
  const nurIst = sel.every((m) => m.art === 'ist'), lauf = n === 1 && sel[0].art === 'laeuft' ? sel[0] : null;
  const prog = !nurIst;
  const titel = n === 1 ? `${MONAT[+sel[0].k.slice(5) - 1]} ${sel[0].k.slice(0, 4)}` : `${monatName(sel[0].k)} – ${monatName(sel[n - 1].k)}`;
  const art = nurIst ? 'abgeschlossen' : lauf ? '' : sel.every((m) => m.art === 'prognose') ? 'Prognose' : 'mit Prognose';
  const sE = M.schnitt.ein, sA = M.schnitt.aus, sF = M.schnitt.fest, sV = sA - sF, sErg = sE - sA;
  const pz = (a, b) => (b ? Math.round(((a - b) / Math.abs(b)) * 100) : 0);
  const ca = prog ? '≈ ' : '';
  const vgl = (v, s, mehrGut) => {
    const p = pz(v, s);
    return `<span class="wf-n ${Math.abs(p) < 3 ? '' : (p > 0) === mehrGut ? 'gut' : 'schlecht'}" title="Ø 12 Monate: ${eur0(s)}">${Math.abs(p) < 3 ? '≈ Ø' : `${p > 0 ? '+' : '−'}${Math.abs(p)} % ggü. Ø`}</span>`;
  };
  // Wasserfall-Skala
  const lo = Math.min(0, ein - fest, erg), hi = Math.max(ein, 1), X = (v) => ((v - lo) / (hi - lo)) * 100;
  const balken = (von, bis, cls_, schraffiert = false) => (bis - von > 0 ? `<i class="wf-b ${cls_}${schraffiert ? ' erw' : ''}" style="left:${X(von)}%;width:${X(bis) - X(von)}%"></i>` : '');
  const verbinder = (v) => `<b class="wf-vb" style="left:${X(v)}%"></b>`;
  const null0 = lo < 0 ? `<b class="wf-0" style="left:${X(0)}%"></b>` : '';
  const zeile = (l, wert, spur, notiz, cls_ = '', tip = '') => `<div class="wf-z ${cls_}" title="${esc(tip)}"><span class="wf-l">${l}</span><span class="wf-s">${null0}${spur}</span><span class="wf-w">${wert}</span>${notiz}</div>`;
  const q = M.akt ? Math.round((fest / M.akt) * 100) : null;
  const jeM = n > 1 ? ' je Monat' : '';
  let h = `<div class="ue-h"><h2>${esc(titel)} <span class="muted">${n > 1 ? `· ${n} Monate, je Monat` : art ? `· ${art}` : ''}</span></h2>${nurIst || lauf ? `<button class="link klein" id="uem-buchungen">Buchungen →</button>` : ''}</div>`;
  if (lauf) {
    const anteil = Math.round((lauf.tag / lauf.tage) * 100);
    h += `<div class="wf-tempo" title="Monat zu ${anteil} % vorbei"><span>Tag ${lauf.tag} von ${lauf.tage}</span><span class="wf-tempo-bar"><i style="width:${anteil}%"></i></span><span>${anteil} %</span></div>`;
  }
  h += `<div class="uem-auswahl"><div class="wf">
    ${zeile('Einnahmen', `${ca}${eur0(ein)}`, balken(0, kEin, 'ein') + balken(kEin, ein, 'ein', true), vgl(ein, sE, true), '',
      `Einnahmen${jeM}: ${eur0(ein)}${prog ? ` · schon gebucht ${eur0(kEin)}` : ''} · Ø ${eur0(sE)}`)}
    ${zeile('− fest', `${ca}${eur0(fest)}`, verbinder(ein) + balken(ein - kFest, ein, 'fix') + balken(ein - fest, ein - kFest, 'fix', true),
      `<span class="wf-n ${q == null ? '' : q <= 50 ? 'gut' : 'schlecht'}" title="feste Ausgaben im Verhältnis zum aktuellen Gehalt (${eur0(M.akt)}) · Ziel höchstens 50 %">${q == null ? '–' : `${q} % vom Gehalt`}</span>`, '',
      `Feste Ausgaben${jeM}: ${eur0(fest)}${prog ? ` · schon abgebucht ${eur0(kFest)}` : ''} · Ø ${eur0(sF)}`)}
    ${zeile('− variabel', `${ca}${eur0(vari)}`, verbinder(ein - fest) + balken(ein - fest - kVar, ein - fest, 'var') + balken(ein - fest - vari, ein - fest - kVar, 'var', true), vgl(vari, sV, false), '',
      `Variable Ausgaben${jeM}: ${eur0(vari)}${prog ? ` · bisher ${eur0(kVar)}` : ''} · Ø ${eur0(sV)}`)}
    ${zeile('= Ergebnis', `<b class="${erg >= 0 ? 'pos' : 'neg'}">${ca}${erg < 0 ? '−' : '+'}${eur0(Math.abs(erg))}</b>`, verbinder(erg) + balken(Math.min(0, erg), Math.max(0, erg), erg >= 0 ? 'plus' : 'minus', prog),
      `<span class="wf-n" title="Durchschnitt der letzten 12 abgeschlossenen Monate">Ø ${sErg < 0 ? '−' : '+'}${eur0(Math.abs(sErg))}</span>`, 'wf-erg')}
  </div>`;
  if (prog) h += `<div class="wf-leg"><span><i class="wf-k"></i>schon gebucht</span><span><i class="wf-k erw"></i>noch erwartet</span></div>`;
  // vier Eckdaten
  const fakt = (l, w, sub = '', cls_ = '') => `<div class="wf-f"><span>${l}</span><div><b class="${cls_}">${w}</b>${sub ? `<small>${sub}</small>` : ''}</div></div>`;
  const f = [];
  const quote = ein > 0 ? `${erg < 0 ? '−' : ''}${Math.abs(Math.round((erg / ein) * 100))} %` : '–';
  if (lauf) {
    f.push(fakt('Noch fällig (fest)', eur0(lauf.offenFest), 'bis Monatsende'));
    f.push(lauf.gehaltKommt ? fakt('Gehalt erwartet', `≈ ${eur0(lauf.gehaltKommt)}`, M.gt ? `um den ${M.gt}.` : '') : fakt('Gehalt ist da', eur0(lauf.x.lohn), ''));
  } else if (nurIst) {
    const lohn = sum((m) => m.x.lohn);
    f.push(fakt(`Gehalt${n > 1 ? ' je Monat' : ''}`, eur0(lohn), `aktuell ${eur0(M.akt)}`));
    f.push(n > 1 ? fakt('Ergebnis gesamt', `${erg < 0 ? '−' : '+'}${eur0(Math.abs(erg * n))}`, `${n} Monate`, erg >= 0 ? 'pos' : 'neg') : fakt('Sparquote', quote, 'vom Einkommen', erg >= 0 ? 'pos' : 'neg'));
  } else {
    f.push(fakt('Gehalt (aktuell)', eur0(M.akt), `zuletzt ${MONAT[+M.aktMonat.slice(5) - 1]}`));
    f.push(n > 1 ? fakt('Ergebnis gesamt', `≈ ${erg < 0 ? '−' : '+'}${eur0(Math.abs(erg * n))}`, `${n} Monate`, erg >= 0 ? 'pos' : 'neg') : fakt('Sparquote', `≈ ${quote}`, 'vom Einkommen', erg >= 0 ? 'pos' : 'neg'));
  }
  const letzte = sel[n - 1], ende = M.monate[M.monate.length - 1];
  if (letzte.stand != null) f.push(fakt(`Konten Ende ${MONAT[+letzte.k.slice(5) - 1]}`, `${letzte.art === 'ist' ? '' : '≈ '}${eur0(letzte.stand)}`, letzte.art === 'ist' ? 'tatsächlich' : 'erwartet', letzte.stand < 0 ? 'neg' : ''));
  if (ende.stand != null && ende.k !== letzte.k) f.push(fakt(`Konten Ende ${MONAT[+ende.k.slice(5) - 1]}`, `≈ ${eur0(ende.stand)}`, `ggü. heute ${ende.stand - kontenSumme(D.bis) < 0 ? '−' : '+'}${eur0(Math.abs(ende.stand - kontenSumme(D.bis)))}`, ende.stand < 0 ? 'neg' : ''));
  else f.push(fakt('Sparquote', `${prog ? '≈ ' : ''}${quote}`, 'vom Einkommen', erg >= 0 ? 'pos' : 'neg'));
  h += `<div class="wf-fakten">${f.slice(0, 4).join('')}</div>`;
  if (sel.some((m) => m.art === 'prognose')) h += '<p class="wf-fuss">Prognose: aktuelles Gehalt, typische variable Ausgaben und die fälligen Verträge – ohne Sonderzahlungen.</p>';
  h += '</div>';
  $('#uem-stand').innerHTML = h;
  // was nicht hineinpasst, fällt weg: zuerst die Fußnote, dann die Legende, dann eine Reihe Eckdaten
  const box = $('#uem-stand .uem-auswahl'), passt = () => box.scrollHeight <= box.clientHeight + 2;
  for (const s of ['.wf-fuss', '.wf-leg']) if (!passt()) box.querySelector(s)?.remove();
  if (!passt()) [...box.querySelectorAll('.wf-f')].slice(2).forEach((e) => e.remove());
  if (!passt()) box.querySelector('.wf-fakten')?.remove();
  $('#uem-buchungen')?.addEventListener('click', () => setze(ueFilterFuer(sel.filter((m) => m.art !== 'prognose').map((m) => m.k))));
}

// Monate → Filter für die anderen Reiter (gleiches Jahr: Jahr + Monate; über den Jahreswechsel: beide Jahre, nur diese Monate)
function ueFilterFuer(keys, extra = {}) {
  const jahre = [...new Set(keys.map((k) => k.slice(0, 4)))];
  return { tab: 'buchungen', jahr: jahre.length === 1 ? jahre[0] : jahre[jahre.length - 1], monat: keys.filter((k) => k.slice(0, 4) === jahre[jahre.length - 1]).map((k) => String(+k.slice(5))).join(','), q: '', ...extra };
}

// Kategorien der gewählten Monate (je Monat) mit Anteil, Summe und dem Durchschnitt als Marke.
// Im laufenden Monat: wie viel vom üblichen Monatsbetrag schon erreicht ist; übliche Kategorien ohne Buchung bisher füllen den Rest.
function ueAuswahlKategorien(M, nMax = 16) {
  const sel = M.monate.filter((m) => ueAuswahl.includes(m.k) && m.art !== 'prognose');
  const box = $('#uem-kat');
  const anteil = (v, g) => (g ? `${Math.round((v / g) * 100)} %` : '');
  if (!sel.length) {
    // nur Prognose: die festen Abbuchungen im Zeitraum
    const von = `${ueAuswahl[0]}-01`, bis = monatsletzter(`${ueAuswahl[ueAuswahl.length - 1]}-01`);
    const l = M.vertraege.map((f) => ({ f, c: faellig(f, von, bis) })).filter((x) => x.c > 0).sort((a, b) => b.c - a.c);
    const ges = l.reduce((t, x) => t + x.c, 0), top = l.slice(0, nMax), rest = l.slice(nMax);
    $('#uem-kat-t').textContent = 'Feste Abbuchungen im Zeitraum';
    $('#uem-kat-leg').innerHTML = `<span class="muted">${ueAuswahl.length} Monat${ueAuswahl.length > 1 ? 'e' : ''}</span>`;
    box.innerHTML = !l.length ? '<div class="leer">Keine festen Abbuchungen.</div>'
      : `<div class="ue-kz uem-kz kopf"><span></span><span></span><span>Betrag</span><span>Anteil</span><span>Rhythmus</span></div>`
      + top.map(({ f, c }) => `<div class="ue-kz uem-kz"><span class="ue-kz-n">${esc(vertragName(f))}</span><span class="ue-kz-b"><i style="width:${(c / l[0].c) * 100}%"></i></span><span class="ue-kz-w">${eur0(c)}</span><span class="ue-kz-p">${anteil(c, ges)}</span><span class="ue-kz-d muted">${esc(f.rh.name)}</span></div>`).join('')
      + (rest.length ? `<div class="ue-kz uem-kz rest"><span class="ue-kz-n">Übrige (${rest.length})</span><span></span><span class="ue-kz-w">${eur0(rest.reduce((t, x) => t + x.c, 0))}</span><span class="ue-kz-p">${anteil(rest.reduce((t, x) => t + x.c, 0), ges)}</span><span></span></div>` : '')
      + `<div class="ue-kz uem-kz summe"><span class="ue-kz-n">Summe · ${l.length} Zahlungen</span><span></span><span class="ue-kz-w">${eur0(ges)}</span><span class="ue-kz-p">100 %</span><span></span></div>`;
    if (nMax > 1 && box.scrollHeight > box.clientHeight + 2) return ueAuswahlKategorien(M, nMax - 1);
    return;
  }
  const n = sel.length, kat = new Map();
  for (const m of sel) for (const [k, v] of m.x.kat) kat.set(k, (kat.get(k) || 0) + v / n);
  const lauf = n === 1 && sel[0].art === 'laeuft';
  const echt = [...kat].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  // übliche Kategorien (Ø ab 50 €), die in der Auswahl noch nicht vorkommen – nur als Füllung, wenn Platz ist
  const ohne = [...M.schnitt.kat].filter(([k, s]) => s >= 5000 && !(kat.get(k) > 0)).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => [k, 0]);
  const l = [...echt, ...ohne], ges = sel.reduce((t, m) => t + m.x.aus, 0) / n;   // wie in den Kacheln
  const top = l.slice(0, nMax), restL = l.slice(nMax).filter(([, v]) => v > 0), rest = restL.reduce((t, [, v]) => t + v, 0);
  const sGes = M.schnitt.aus;
  $('#uem-kat-t').textContent = `Ausgaben nach Kategorie${n > 1 ? ' · je Monat' : lauf ? ' · bisher' : ''}`;
  $('#uem-kat-leg').innerHTML = `<span><i class="uem-marke"></i>Ø 12 Monate</span>${lauf ? '<span class="muted">% vom Ø = so viel vom üblichen Monat ist schon erreicht</span>' : ''}`;
  const max = Math.max(1, ...top.map(([k, v]) => Math.max(v, M.schnitt.kat.get(k) || 0)));
  const vglZelle = (v, s) => {
    if (lauf) return `<span class="ue-kz-d ${!s ? 'muted' : v > s ? 'schlecht' : 'muted'}">${!s ? 'neu' : `${Math.round((v / s) * 100)} % vom Ø`}</span>`;
    const d = v - s, klein = Math.abs(d) < Math.max(2000, s * 0.05);
    return `<span class="ue-kz-d ${klein ? 'muted' : d > 0 ? 'schlecht' : 'gut'}">${!s ? 'neu' : klein ? '≈ Ø' : `${d > 0 ? '+' : '−'}${eur0(Math.abs(d))}`}</span>`;
  };
  box.innerHTML = `<div class="ue-kz uem-kz kopf"><span></span><span></span><span>Betrag</span><span>Anteil</span><span>${lauf ? 'vom Ø' : 'ggü. Ø'}</span></div>` + top.map(([k, v]) => {
    const s = M.schnitt.kat.get(k) || 0;
    return `<button class="ue-kz uem-kz${v ? '' : ' ohne'}" data-uemkat="${esc(k)}" title="${esc(schoen(k))}: ${eur0(v)}${ges ? ` (${anteil(v, ges)} der Ausgaben)` : ''} · Ø ${eur0(s)} im Monat – Klick: Buchungen">
      <span class="ue-kz-n">${esc(schoen(k))}</span>
      <span class="ue-kz-b uem-kz-b"><i style="width:${(v / max) * 100}%"></i>${s ? `<b class="uem-marke-b" style="left:${(s / max) * 100}%"></b>` : ''}</span>
      <span class="ue-kz-w">${v ? eur0(v) : '–'}</span>
      <span class="ue-kz-p">${v ? anteil(v, ges) : ''}</span>
      ${vglZelle(v, s)}</button>`;
  }).join('')
    + (rest > 0 ? `<div class="ue-kz uem-kz rest"><span class="ue-kz-n">Übrige (${restL.length})</span><span class="ue-kz-b"><i style="width:${(rest / max) * 100}%"></i></span><span class="ue-kz-w">${eur0(rest)}</span><span class="ue-kz-p">${anteil(rest, ges)}</span><span></span></div>` : '')
    + `<div class="ue-kz uem-kz summe" title="Summe aller Ausgaben${n > 1 ? ' je Monat' : ''} · Ø 12 Monate ${eur0(sGes)}"><span class="ue-kz-n">Summe${n > 1 ? ' je Monat' : ''} · ${echt.length} Kategorien</span><span class="ue-kz-b uem-kz-b"><i style="width:${sGes ? Math.min(100, (ges / Math.max(ges, sGes)) * 100) : 100}%"></i>${sGes ? `<b class="uem-marke-b" style="left:${(sGes / Math.max(ges, sGes)) * 100}%"></b>` : ''}</span><span class="ue-kz-w">${eur0(ges)}</span><span class="ue-kz-p">100 %</span>${vglZelle(ges, sGes)}</div>`;
  if (nMax > 1 && box.scrollHeight > box.clientHeight + 2) return ueAuswahlKategorien(M, nMax - 1);
  box.querySelectorAll('[data-uemkat]').forEach((b) => b.onclick = () => setze(ueFilterFuer(sel.map((m) => m.k), { kat: b.dataset.uemkat, ukat: '' })));
}

// ======================================================================= Durchschnitte und Quoten
// Grundlage sind nur abgeschlossene Monate: Der laufende Monat (Gehalt oft noch nicht da) würde jeden Durchschnitt verfälschen.
const mkey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const tageImMonat = (k) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)).getUTCDate();
// Buchungen, die zu einem erkannten Fixkosten-Vertrag gehören (auch deine festen Einzahlungen aufs Gemeinschaftskonto)
function fixIds() {
  if (!D.fixIds) D.fixIds = new Set(fixkostenErkennen().filter((f) => !f.gemeinsam).flatMap((f) => f.rows.map((r) => r.i)));
  return D.fixIds;
}
const monatsText = (ms) => {
  if (!ms.length) return '';
  const t = (k) => `${MON[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
  return ms.length === 1 ? t(ms[0]) : `${t(ms[0])} – ${t(ms[ms.length - 1])}`;
};
// ======================================================================= Seiten: eine Frage, eine Antwort, Details darunter
// Kennzahlen, Kategorien und Konten zeigen oben in einem Satz die Antwort, darunter schlichte Tabellen und wenige Grafiken.
// Sie rechnen mit allen eigenen Einnahmen und Ausgaben der gewählten Konten (ohne Umbuchungen, Kinder- und
// Gemeinschaftskonten). Suche und übrige Filter gehören zum Reiter Buchungen.
const monKurz = (k) => `${MON[+k.slice(5) - 1]} ${k.slice(2, 4)}`;
const plusMinus = (c) => `${c >= 0 ? '+' : '−'}${eur0(Math.abs(c))}`;

// Zeitraum der Seite: „12 Monate“ (kein Jahr gewählt) = die letzten zwölf abgeschlossenen Monate, sonst die
// abgeschlossenen Monate des Jahres; dazu dieselben Monate ein Jahr früher zum Vergleich
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
  return `<div class="seg sk-zeit" role="group" aria-label="Zeitraum">${[['', '12 Monate'], ...D.jahre.slice(-4).reverse().map((y) => [String(y), String(y)])]
    .map(([v, t]) => `<button data-zeit="${v}" class="${(v ? +v === j : !j) ? 'an' : ''}">${t}</button>`).join('')}</div>`;
}
const seitenKopf = (titel, antwort, rechts = '') => `<div class="sk-kopf"><div class="sk-kopf-t"><h1>${titel}</h1>${antwort ? `<p class="sk-antwort">${antwort}</p>` : ''}</div>${rechts ? `<div class="sk-kopf-r">${rechts}</div>` : ''}</div>`;
const karte = (titel, hinweis, inhalt, cls_ = '') => `<div class="card k3 ${cls_}"><div class="k3-t"><h2>${titel}</h2>${hinweis ? `<span class="muted klein">${hinweis}</span>` : ''}</div>${inhalt}</div>`;

// Einnahmen und Ausgaben in bestimmten Monaten (gewählte Konten): Summen, je Monat und gruppiert
// (Ausgaben nach Kategorie, Einnahmen nach Unterkategorie) mit Unterkategorien, Empfängern, Monaten und größten Buchungen
function sammle(monate, art = 'aus') {
  const set = new Set(monate), fx = fixIds(), ks = kontoSet(), g = new Map(), mon = new Map(monate.map((k) => [k, { ein: 0, lohn: 0, aus: 0, fix: 0, spar: 0, n: 0 }]));
  let ein = 0, aus = 0, fix = 0, spar = 0, n = 0, groesste = null;
  for (const r of D.rows) {
    const k = r.d.slice(0, 7), m = mon.get(k);
    if (!m || (ks && !ks.has(r.k))) continue;
    if (r.art === 'Sparen') { spar -= r.c; m.spar -= r.c; continue; }
    if (r.art !== 'Einnahme' && r.art !== 'Ausgabe') continue;
    n++; m.n++;
    if (r.art === 'Einnahme') { ein += r.c; m.ein += r.c; if (r.ukat === 'Lohn / Gehalt') m.lohn += r.c; }
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
  return { n: monate.length, ein, aus, fix, spar, erg: ein - aus, g, mon, buchungen: n, groesste, monate };
}

// ---------------------------------------------------------------- Kennzahlen: Wie entwickeln sich meine Finanzen?
function k2Seite() {
  const box = $('#k2'), P = periode(), rechts = kontoWahlHtml() + zeitSeg();
  if (!P.monate.length) { box.innerHTML = seitenKopf('Kennzahlen', 'In diesem Jahr ist noch kein Monat abgeschlossen.', rechts); return; }
  const a = sammle(P.monate), v = P.vor.length ? sammle(P.vor) : null, ein = sammle(P.monate, 'ein');
  const pm = (x, c) => c / x.n, quote = (x) => (x.ein ? Math.round((x.erg / x.ein) * 100) : null);
  const ek = einkommen(), lohnAkt = ek.aktuell.wert, lohnMon = ek.letzter;
  const lohnSum = [...a.mon.values()].reduce((t, m) => t + m.lohn, 0), lohnN = [...a.mon.values()].filter((m) => m.lohn > 0).length;
  const P0 = `${P.label[0].toUpperCase()}${P.label.slice(1)}`;
  const antwort = `Dein Gehalt ist aktuell <b>${eur0(lohnAkt)}</b> netto (${MONAT[+lohnMon.slice(5) - 1]} ${lohnMon.slice(0, 4)}). ${P0} kamen im Schnitt <b>${eur0(pm(a, a.ein))}</b> im Monat herein
    (davon Gehalt ${eur0(lohnN ? lohnSum / a.n : 0)}), ausgegeben hast du <b>${eur0(pm(a, a.aus))}</b> – ${a.erg >= 0 ? `übrig blieben <b class="pos">${eur0(pm(a, a.erg))}</b>` : `es fehlten <b class="neg">${eur0(-pm(a, a.erg))}</b>`} im Monat.`;
  const vgl = (jetzt, vorher, mehrGut) => {
    if (vorher == null) return '<span class="muted">ohne Vorjahr</span>';
    const d = jetzt - vorher;
    if (Math.abs(d) < 1000) return `<span class="muted">wie im Vorjahr (${eur0(vorher)})</span>`;
    return `<span class="${(d > 0) === mehrGut ? 'pos' : 'neg'}">${d > 0 ? '▲' : '▼'} ${eur0(Math.abs(d))}</span> <span class="muted">ggü. Vorjahr (${eur0(vorher)})</span>`;
  };
  const kachel = (t, w, cls_, unter, ziel) => `<button class="card k2-k"${ziel ? ` data-k2ziel="${ziel}"` : ''}><span class="k2-k-t">${t}</span><b class="${cls_}">${w}</b><span class="k2-k-u">${unter}</span></button>`;
  const fq = a.ein ? Math.round((a.fix / a.ein) * 100) : null, fqv = v?.ein ? Math.round((v.fix / v.ein) * 100) : null;
  const kacheln = [
    kachel('Gehalt aktuell', eur0(lohnAkt), '', `netto, ${MONAT[+lohnMon.slice(5) - 1]} ${lohnMon.slice(0, 4)} · Ø im Zeitraum ${eur0(lohnN ? lohnSum / lohnN : 0)}`, ''),
    kachel('Einnahmen im Monat', eur0(pm(a, a.ein)), 'pos', vgl(pm(a, a.ein), v && pm(v, v.ein), true), 'ein'),
    kachel('Ausgaben im Monat', eur0(pm(a, a.aus)), 'neg', vgl(pm(a, a.aus), v && pm(v, v.aus), false), 'aus'),
    kachel(a.erg >= 0 ? 'Übrig im Monat' : 'Fehlbetrag im Monat', eur0(Math.abs(pm(a, a.erg))), a.erg >= 0 ? 'pos' : 'neg', `Sparquote ${quote(a) ?? '–'} %${v ? ` <span class="muted">· Vorjahr ${quote(v)} %</span>` : ''}`, ''),
    kachel('Fixkosten', fq == null ? '–' : `${fq} %`, fq > 50 ? 'neg' : '', `der Einnahmen · Ø ${eur0(pm(a, a.fix))} im Monat${fqv != null ? ` <span class="muted">· Vorjahr ${fqv} %</span>` : ''}`, 'fix'),
  ].join('');

  // Monat für Monat
  const z = (c) => (c ? eur0(c) : '<span class="muted">–</span>');
  const zeilen = P.monate.map((k) => {
    const m = a.mon.get(k), e = m.ein - m.aus;
    return `<tr class="klick" data-k2monat="${k}"><td>${MONAT[+k.slice(5) - 1]} ${k.slice(0, 4)}</td><td class="r">${z(m.ein)}</td><td class="r muted sp-m">${z(m.lohn)}</td><td class="r">${z(m.aus)}</td>
      <td class="r muted sp-m">${z(m.fix)}</td><td class="r ${e >= 0 ? 'pos' : 'neg'}"><b>${plusMinus(e)}</b></td><td class="r sp-m">${m.ein ? `${Math.round((e / m.ein) * 100)} %` : '–'}</td></tr>`;
  }).join('');
  const sum = (f) => [...a.mon.values()].reduce((t, m) => t + f(m), 0);
  const fussZ = (t, d) => `<tr><td>${t}</td><td class="r">${eur0(sum((m) => m.ein) / d)}</td><td class="r sp-m">${eur0(sum((m) => m.lohn) / d)}</td><td class="r">${eur0(sum((m) => m.aus) / d)}</td>
    <td class="r sp-m">${eur0(sum((m) => m.fix) / d)}</td><td class="r ${a.erg >= 0 ? 'pos' : 'neg'}">${plusMinus(a.erg / d)}</td><td class="r sp-m">${quote(a) ?? '–'} %</td></tr>`;
  const tabelle = `<table class="t3"><thead><tr><th>Monat</th><th class="r">Einnahmen</th><th class="r sp-m">davon Gehalt</th><th class="r">Ausgaben</th><th class="r sp-m">davon fest</th><th class="r">Ergebnis</th><th class="r sp-m">Quote</th></tr></thead>
    <tbody>${zeilen}</tbody><tfoot>${fussZ('Ø je Monat', a.n)}${fussZ('Summe', 1)}</tfoot></table>`;

  // Einnahmen nach Herkunft und wohin die Ausgaben gehen
  const einL = [...ein.g.values()].filter((x) => x.c > 0).sort((x, y) => y.c - x.c);
  const einS = einL.reduce((t, x) => t + x.c, 0) || 1;
  const balkenZ = (name, c, ges, farbe, ziel) => `<div class="k3-bz"${ziel || ''}><span>${name}</span><span class="k3-b"><i style="width:${Math.max(1, (c / ges) * 100)}%;background:${farbe}"></i></span><b>${eur0(c / a.n)}</b><span class="muted">${Math.round((c / ges) * 100)} %</span></div>`;
  const herkunft = einL.slice(0, 7).map((x) => balkenZ(esc(schoen(x.k)), x.c, einS, 'var(--ein)')).join('')
    + (einL.length > 7 ? balkenZ(`Übrige (${einL.length - 7})`, einL.slice(7).reduce((t, x) => t + x.c, 0), einS, 'var(--muted)') : '');
  const ges = Math.max(a.ein, a.aus + Math.max(0, a.erg)) || 1;
  const wohin = balkenZ('Fixkosten', a.fix, a.ein || ges, '#b8461b') + balkenZ('übrige Ausgaben', a.aus - a.fix, a.ein || ges, 'var(--aus)')
    + (a.erg >= 0 ? balkenZ('übrig', a.erg, a.ein || ges, 'var(--ein)') : balkenZ('Fehlbetrag', -a.erg, a.ein || ges, 'var(--aus-text)'))
    + (a.spar > 0 ? `<div class="muted klein k3-fuss">Zusätzlich aufs Spar- und Depotkonto: Ø ${eur0(a.spar / a.n)} im Monat.</div>` : '');

  // Was sich verändert hat
  let einsicht;
  if (v) {
    const d = [...new Set([...a.g.keys(), ...v.g.keys()])].map((k) => ({ k, jetzt: (a.g.get(k)?.c || 0) / a.n, vorher: (v.g.get(k)?.c || 0) / v.n }))
      .map((x) => ({ ...x, d: x.jetzt - x.vorher })).filter((x) => Math.abs(x.d) >= 3000).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 8);
    const dEin = pm(a, a.ein) - pm(v, v.ein);
    const zz = [];
    if (Math.abs(dEin) >= 10000) zz.push(`<div class="k2-e"><span class="k2-e-p ${dEin > 0 ? 'pos' : 'neg'}">${dEin > 0 ? '▲' : '▼'}</span><span><b>Einnahmen</b> ${eur0(pm(v, v.ein))} → ${eur0(pm(a, a.ein))}</span><b class="${dEin > 0 ? 'pos' : 'neg'}">${plusMinus(dEin)}</b></div>`);
    for (const x of d) zz.push(`<button class="k2-e" data-k2kat="${esc(x.k)}"><span class="k2-e-p ${x.d > 0 ? 'neg' : 'pos'}">${x.d > 0 ? '▲' : '▼'}</span><span><b>${esc(schoen(x.k))}</b> ${eur0(x.vorher)} → ${eur0(x.jetzt)}</span><b class="${x.d > 0 ? 'neg' : 'pos'}">${plusMinus(x.d)}</b></button>`);
    einsicht = zz.join('') || '<div class="leer">Kaum Veränderungen gegenüber dem Vorjahr.</div>';
  } else einsicht = '<div class="leer">Für diesen Zeitraum gibt es kein Vorjahr zum Vergleich.</div>';

  // Auffälligkeiten
  const ms = P.monate.map((k) => ({ k, e: a.mon.get(k).ein - a.mon.get(k).aus, aus: a.mon.get(k).aus }));
  const best = [...ms].sort((x, y) => y.e - x.e)[0], schlecht = [...ms].sort((x, y) => x.e - y.e)[0], teuer = [...ms].sort((x, y) => y.aus - x.aus)[0];
  const tage = P.monate.reduce((t, k) => t + tageImMonat(k), 0);
  const fakten = [
    ['Monate im Plus', `${ms.filter((x) => x.e >= 0).length} von ${ms.length}`],
    ['Bester Monat', `${monKurz(best.k)} <span class="pos">${plusMinus(best.e)}</span>`],
    ['Schwächster Monat', `${monKurz(schlecht.k)} <span class="neg">${plusMinus(schlecht.e)}</span>`],
    ['Teuerster Monat', `${monKurz(teuer.k)} · ${eur0(teuer.aus)}`],
    ['Ausgaben pro Tag', eur0(a.aus / tage)],
    ['Größte Einzelausgabe', a.groesste ? `${eur0(-a.groesste.c)} · ${esc((a.groesste.g || a.groesste.z || '').slice(0, 26))} (${dde(a.groesste.d).slice(0, 6)})` : '–'],
    ['Buchungen', NUM.format(a.buchungen)],
    ['Gespart (Spar-/Depotkonto)', a.spar > 0 ? `${eur0(a.spar)} · Ø ${eur0(a.spar / a.n)}` : '–'],
  ].map(([t, w]) => `<div><dt>${t}</dt><dd>${w}</dd></div>`).join('');

  box.innerHTML = seitenKopf('Kennzahlen', antwort, rechts)
    + `<div class="k2-kacheln k5">${kacheln}</div>
    <div class="k3-reihe k3-21">
      ${karte('Monat für Monat', 'Zeile anklicken: Buchungen des Monats', tabelle)}
      <div class="k3-spalte">${karte('Woher das Geld kommt', 'Ø je Monat · Anteil', `<div class="k3-bl">${herkunft}</div>`)}${karte('Wohin es geht', 'Ø je Monat · Anteil an den Einnahmen', `<div class="k3-bl">${wohin}</div>`)}</div>
    </div>
    <div class="k3-reihe k3-21">
      ${karte('Jahr für Jahr', 'Ø je Monat · Linie: Sparquote · Säule anklicken: Jahr wählen', '<div class="k2-chart"><canvas id="c-jahre"></canvas></div>')}
      ${karte('Was sich verändert hat', v ? 'Kategorien je Monat ggü. Vorjahr · anklicken: Details' : '', `<div class="k2-einsicht">${einsicht}</div>`)}
    </div>
    ${karte('Auffällig', P.label, `<dl class="k3-fakten">${fakten}</dl>`)}`;
  box.querySelectorAll('[data-k2kat]').forEach((b) => b.onclick = () => setze({ tab: 'uebersicht', kart: 'aus', wahl: b.dataset.k2kat }));
  box.querySelectorAll('[data-k2ziel]').forEach((b) => b.onclick = () => { const z2 = b.dataset.k2ziel; setze(z2 === 'fix' ? { tab: 'fix' } : { tab: 'uebersicht', kart: z2, wahl: '' }); });
  box.querySelectorAll('[data-k2monat]').forEach((tr) => tr.onclick = () => setze({ tab: 'buchungen', jahr: tr.dataset.k2monat.slice(0, 4), monat: String(+tr.dataset.k2monat.slice(5)), q: '', kat: '', ukat: '', art: 'alle' }));
  box.querySelectorAll('[data-zeit]').forEach((b) => b.onclick = () => setze({ jahr: b.dataset.zeit, monat: '' }));
  k2Jahre();
}

// Ø Einnahmen und Ausgaben je Monat für jedes Jahr, dazu die Sparquote
function k2Jahre() {
  const alle = abgeschlosseneMonate();
  const jahre = [...new Set(alle.map((k) => +k.slice(0, 4)))].slice(-8);
  const w = jahre.map((y) => sammle(alle.filter((k) => +k.slice(0, 4) === y)));
  const j = einJahr(), cE = css('--ein'), cA = css('--aus'), cL = css('--accent');
  const an = (i) => !j || jahre[i] === j;
  const o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.plugins.legend = { display: true, position: 'top', align: 'end', labels: { color: css('--text-2'), usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, font: { size: 12 } } };
  o.plugins.tooltip.callbacks = {
    title: (it) => `${jahre[it[0].dataIndex]} – Ø je Monat (${w[it[0].dataIndex].n} Monate)`,
    label: (it) => (it.dataset.yAxisID === 'q' ? ` Sparquote: ${it.raw == null ? '–' : NUM.format(Math.round(it.raw)) + ' %'}` : ` ${it.dataset.label}: ${EUR0.format(it.raw)}`),
    afterBody: (it) => { const x = w[it[0].dataIndex]; return x.n ? [`${x.erg >= 0 ? 'Übrig' : 'Fehlbetrag'} Ø ${eur0(Math.abs(x.erg) / x.n)} im Monat`] : []; },
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
    { label: 'Einnahmen', data: w.map((x) => (x.n ? x.ein / x.n / 100 : 0)), backgroundColor: jahre.map((_, i) => alpha(cE, an(i) ? .9 : .4)), hoverBackgroundColor: cE, borderRadius: 4, maxBarThickness: 28, order: 2 },
    { label: 'Ausgaben', data: w.map((x) => (x.n ? x.aus / x.n / 100 : 0)), backgroundColor: jahre.map((_, i) => alpha(cA, an(i) ? .9 : .4)), hoverBackgroundColor: cA, borderRadius: 4, maxBarThickness: 28, order: 2 },
    { type: 'line', label: 'Sparquote', yAxisID: 'q', data: w.map((x) => (x.ein ? Math.round((x.erg / x.ein) * 1000) / 10 : null)), borderColor: cL, backgroundColor: cL, borderWidth: 2, pointRadius: 3, tension: 0.3, order: 1 },
  ] }, options: o });
}

// ---------------------------------------------------------------- Kategorien: Wofür geht mein Geld?
let kat2Grafik = null;
function tabKategorien() {
  const P = periode(), aus = S.kart !== 'ein';
  const rechts = `<div class="seg sk-art" role="group" aria-label="Ausgaben oder Einnahmen"><button data-k2art="aus" class="${aus ? 'an' : ''}">Ausgaben</button><button data-k2art="ein" class="${aus ? '' : 'an'}">Einnahmen</button></div>${kontoWahlHtml()}${zeitSeg()}`;
  if (!P.monate.length) { kat2Grafik = null; return seitenKopf('Kategorien', 'In diesem Jahr ist noch kein Monat abgeschlossen.', rechts); }
  const a = sammle(P.monate, aus ? 'aus' : 'ein'), v = P.vor.length ? sammle(P.vor, aus ? 'aus' : 'ein') : null;
  const liste = [...a.g.values()].filter((x) => x.c > 0).sort((x, y) => y.c - x.c);
  const ges = liste.reduce((t, x) => t + x.c, 0);
  if (!liste.length) { kat2Grafik = null; return seitenKopf('Kategorien', 'Keine Buchungen in diesem Zeitraum.', rechts); }
  const anteil = (c) => Math.round((c / ges) * 100);
  const dM = (x) => (v ? x.c / a.n - (v.g.get(x.k)?.c || 0) / v.n : null);
  const top = liste.slice(0, 3).map((x) => `<b>${esc(schoen(x.k))}</b> (${anteil(x.c)} %)`);
  const verb = top.length > 1 ? `${top.slice(0, -1).join(', ')} und ${top.at(-1)}` : top[0];
  let antwort = aus ? `Die meisten Ausgaben ${P.label} gehen an ${verb} – zusammen <b>${eur0(ges / a.n)}</b> im Monat.` : `Deine Einnahmen ${P.label} kommen vor allem aus ${verb} – zusammen <b>${eur0(ges / a.n)}</b> im Monat.`;
  if (v) {
    const s2 = [...liste].filter((x) => Math.abs(dM(x)) >= 3000).sort((x, y) => (aus ? dM(y) - dM(x) : dM(x) - dM(y)))[0];
    if (s2 && (aus ? dM(s2) > 0 : dM(s2) < 0)) antwort += ` Am stärksten ${aus ? 'gestiegen' : 'gesunken'}: <b>${esc(schoen(s2.k))}</b> (<span class="neg">${plusMinus(dM(s2))}</span> im Monat ggü. Vorjahr).`;
  }
  const wahl = liste.find((x) => x.k === S.wahl) || liste[0];
  const max = liste[0].c;
  const zeile = (x) => {
    const d = dM(x);
    return `<button class="kat2-z${x === wahl ? ' an' : ''}" data-k2kat="${esc(x.k)}">
      <span class="kat2-n">${esc(schoen(x.k))}</span>
      <span class="kat2-b"><i style="width:${Math.max(1, (x.c / max) * 100)}%"></i></span>
      <span class="kat2-w">${eur0(x.c / a.n)}</span><span class="kat2-p">${anteil(x.c)} %</span>
      <span class="kat2-d ${d == null || Math.abs(d) < 1000 ? 'muted' : (d > 0) === aus ? 'neg' : 'pos'}">${d == null ? '' : Math.abs(d) < 1000 ? '≈' : plusMinus(d)}</span></button>`;
  };
  // Detail der gewählten Kategorie
  const wv = v?.g.get(wahl.k), wd = dM(wahl);
  const unter = [...(aus ? wahl.unter : new Map())].filter(([, c]) => c > 0).sort((x, y) => y[1] - x[1]);
  const empf = [...wahl.empf].filter(([, x]) => x.c > 0).sort((x, y) => y[1].c - x[1].c).slice(0, 6);
  const groesste = [...wahl.rows].sort((x, y) => (aus ? x.c - y.c : y.c - x.c)).slice(0, 5);
  const uMax = unter[0]?.[1] || 1;
  let treiber = '';
  if (aus && wv && Math.abs(wd) >= 3000) {
    const t = unter.map(([u, c]) => ({ u, d: c / a.n - (wv.unter.get(u) || 0) / v.n })).sort((x, y) => (wd > 0 ? y.d - x.d : x.d - y.d))[0];
    if (t && Math.abs(t.d) >= 2000) treiber = `, vor allem ${esc(schoen(t.u))} (${plusMinus(t.d)})`;
  }
  kat2Grafik = { monate: P.monate, werte: P.monate.map((k) => (wahl.mon.get(k) || 0) / 100), vor: wv ? P.vor.map((k) => (wv.mon.get(k) || 0) / 100) : null, schnitt: wahl.c / a.n / 100, aus };
  const detail = `<div class="card kat2-detail">
    <div class="kat2-d-kopf"><h2>${esc(schoen(wahl.k))}</h2><b>${eur0(wahl.c / a.n)} <small>im Monat</small></b></div>
    <p class="kat2-d-satz">${anteil(wahl.c)} % deiner ${aus ? 'Ausgaben' : 'Einnahmen'} · zusammen ${eur0(wahl.c)} ${P.label} · ${NUM.format(wahl.rows.length)} Buchungen${wd != null && Math.abs(wd) >= 1000 ? ` · <span class="${(wd > 0) === aus ? 'neg' : 'pos'}">${plusMinus(wd)} im Monat</span> ggü. Vorjahr${treiber}` : ''}</p>
    <div class="kat2-chart"><canvas id="c-kat2"></canvas></div>
    <div class="muted klein">je Monat · gestrichelt: Durchschnitt${wv ? ' · grau: derselbe Monat im Vorjahr' : ''}</div>
    <div class="kat2-d-grid">
      ${unter.length > 1 ? `<div><div class="kat2-d-t">Wofür genau</div><div class="kat2-u">${unter.slice(0, 8).map(([u, c]) => `<button class="kat2-uz" data-k2ukat="${esc(u)}"><span>${esc(schoen(u))}</span><b>${eur0(c / a.n)}</b><span class="muted">${Math.round((c / wahl.c) * 100)} %</span></button>`).join('')}</div></div>` : ''}
      <div><div class="kat2-d-t">${aus ? 'Größte Empfänger' : 'Von wem'}</div>
        <div class="kat2-e">${empf.map(([e, x]) => `<div><span class="kat2-e-n">${esc(e)}</span><span class="muted klein">${x.n}×</span><b>${eur0(x.c)}</b></div>`).join('')}</div></div>
    </div>
    <div class="kat2-d-t">Größte Einzelbuchungen</div>
    <div class="kat2-e">${groesste.map((r) => `<div><span class="kat2-e-n">${dde(r.d).slice(0, 6)} ${esc(r.g || r.z || '–')}</span><span class="muted klein">${esc(schoen(r.ukat || ''))}</span><b>${eur0(Math.abs(r.c))}</b></div>`).join('')}</div>
    <button class="btn sm kat2-buch" data-k2buch>Alle Buchungen ${esc(schoen(wahl.k))} →</button>
  </div>`;
  // Monat für Monat je Kategorie (ältere Monate fallen auf schmalen Bildschirmen weg)
  const nM = P.monate.length;
  const kopf = P.monate.map((k, i) => `<th class="r${i < nM - 3 ? ' m-alt' : ''}">${monKurz(k)}</th>`).join('');
  const reihen = liste.map((x) => {
    const schnitt = x.c / a.n;
    return `<tr${x === wahl ? ' class="an"' : ''}><td class="t3-n">${esc(schoen(x.k))}</td>${P.monate.map((k, i) => { const c = x.mon.get(k) || 0; return `<td class="r${i < nM - 3 ? ' m-alt' : ''}${c > schnitt * 1.6 && c - schnitt > 5000 ? ' hoch' : ''}${c ? ' klick' : ''}"${c ? ` data-k2zelle="${esc(x.k)}|${k}"` : ''}>${c ? NUM.format(Math.round(c / 100)) : '<span class="muted">–</span>'}</td>`; }).join('')}
      <td class="r"><b>${NUM.format(Math.round(schnitt / 100))}</b></td><td class="r sp-m">${NUM.format(Math.round(x.c / 100))}</td></tr>`;
  }).join('');
  const monSum = P.monate.map((k) => liste.reduce((t, x) => t + (x.mon.get(k) || 0), 0));
  const monatsTabelle = karte(`Monat für Monat je ${aus ? 'Kategorie' : 'Einnahme'}`, 'in Euro · fett: Ø je Monat · hervorgehoben: deutlich über dem eigenen Durchschnitt · Zahl anklicken: Buchungen',
    `<div class="t3-rahmen"><table class="t3 t3-eng"><thead><tr><th>${aus ? 'Kategorie' : 'Einnahme'}</th>${kopf}<th class="r">Ø</th><th class="r sp-m">Summe</th></tr></thead><tbody>${reihen}</tbody>
      <tfoot><tr><td>Summe</td>${monSum.map((c, i) => `<td class="r${i < nM - 3 ? ' m-alt' : ''}">${NUM.format(Math.round(c / 100))}</td>`).join('')}<td class="r">${NUM.format(Math.round(ges / a.n / 100))}</td><td class="r sp-m">${NUM.format(Math.round(ges / 100))}</td></tr></tfoot></table></div>`, 'k3-voll');
  return seitenKopf('Kategorien', antwort, rechts) + `<div class="kat2${aus ? '' : ' ein'}">
    <div class="card kat2-liste"><div class="kat2-kopf"><span>${aus ? 'Kategorie' : 'Einnahme'}</span><span></span><span>Ø / Monat</span><span>Anteil</span><span>${v ? 'ggü. Vorjahr' : ''}</span></div>
      ${liste.map(zeile).join('')}
      <div class="kat2-summe"><span>Summe</span><span></span><span>${eur0(ges / a.n)}</span><span>100 %</span><span>${v ? plusMinus(ges / a.n - [...v.g.values()].reduce((t, x) => t + Math.max(0, x.c), 0) / v.n) : ''}</span></div></div>
    ${detail}</div>${monatsTabelle}`;
}

// Monatsbalken der gewählten Kategorie mit dem Durchschnitt als Linie (blass: dieselben Monate im Vorjahr)
function kat2Zeichnen() {
  if (!kat2Grafik || !$('#c-kat2')) return;
  const g = kat2Grafik, farbe = css(g.aus ? '--aus' : '--ein');
  const o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.plugins.tooltip.callbacks = { title: (it) => `${MONAT[+g.monate[it[0].dataIndex].slice(5) - 1]} ${g.monate[it[0].dataIndex].slice(0, 4)}`, label: (it) => ` ${it.dataset.label}: ${EUR0.format(it.raw)}` };
  o.scales = { x: { ...achsenStil(), grid: { display: false } }, y: { ...achsenStil(), beginAtZero: true, ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 4 } } };
  const ds = [{ label: 'dieser Zeitraum', data: g.werte, backgroundColor: alpha(farbe, .85), borderRadius: 3, maxBarThickness: 22, order: 2 }];
  if (g.vor) ds.push({ label: 'Vorjahr', data: g.vor, backgroundColor: alpha(css('--muted'), .25), borderRadius: 3, maxBarThickness: 22, order: 3 });
  ds.push({ type: 'line', label: 'Durchschnitt', data: g.werte.map(() => g.schnitt), borderColor: css('--text-2'), borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, order: 1 });
  zeichne('c-kat2', { type: 'bar', data: { labels: g.monate.map((k) => MON[+k.slice(5) - 1]), datasets: ds }, options: o });
}

// ---------------------------------------------------------------- Konten: Wie viel habe ich wo?
function tabKonten() {
  const tag = stichtag(), ks = kontoSet();
  const drin = (i) => !ks || ks.has(i);
  const stand = kontostaende(D, tag).filter((x) => !fremd(x.k) && !['nicht_eroeffnet', 'geschlossen'].includes(x.status));
  const vj = +D.bis.slice(0, 4) - 1;
  const schnell = [[D.bis, 'Heute'], [`${vj}-12-31`, `31.12.${vj}`], [`${vj - 1}-12-31`, `31.12.${vj - 1}`]];
  const rechts = `${kontoWahlHtml()}<div class="kon2-tag"><label for="stichtag" class="muted klein">Stand am</label><input type="date" id="stichtag" value="${tag}" min="${D.von}" max="${D.bis}">
    <div class="seg">${schnell.map(([d, t]) => `<button class="${d === tag ? 'an' : ''}" data-st="${d}">${t}</button>`).join('')}</div></div>`;
  kontenGrafik = { tag, vert: [] };
  const m = stand.filter((x) => x.status !== 'unbekannt').sort((a, b) => (drin(b.i) - drin(a.i)) || ((b.c ?? -1e12) - (a.c ?? -1e12)));
  const unbekannt = stand.filter((x) => x.status === 'unbekannt');
  if (!m.length) return seitenKopf('Konten', 'Am gewählten Tag gab es keine passenden Konten.', rechts) + gemeinsamKontenHtml(tag) + kinderKontenHtml(tag) + eingangHtml();
  const jb = `${+tag.slice(0, 4) - 1}-12-31`;
  const anfang = new Map(kontostaende(D, jb < D.von ? D.von : jb).map((x) => [x.i, x.c]));
  const gew = m.filter((x) => drin(x.i) && x.c != null);
  const saldo = gew.reduce((t, x) => t + x.c, 0), saldoJb = gew.reduce((t, x) => t + (anfang.get(x.i) ?? 0), 0);
  const kaution = gew.filter((x) => /kaution/i.test(x.k.name)).reduce((t, x) => t + x.c, 0);
  const groesst = gew.filter((x) => !/kaution/i.test(x.k.name)).sort((a, b) => b.c - a.c)[0];
  // Bewegungen im Jahr bis zum Stichtag je Konto
  const jahrAb = `${tag.slice(0, 4)}-01-01`, bew = new Map(), letzte = new Map();
  for (const r of D.rows) {
    if (r.d > tag) continue;
    if (!letzte.has(r.k) || r.d > letzte.get(r.k)) letzte.set(r.k, r.d);
    if (r.d < jahrAb) continue;
    const b = bew.get(r.k) || { ein: 0, aus: 0 };
    if (r.c > 0) b.ein += r.c; else b.aus += r.c;
    bew.set(r.k, b);
  }
  const antwort = `Am ${dde(tag)} liegen auf ${ks ? 'den gewählten Konten' : 'deinen Konten'} <b class="${saldo < 0 ? 'neg' : ''}">${eur0(saldo)}</b>${kaution ? ` – davon ${eur0(kaution)} Mietkaution, frei verfügbar also <b>${eur0(saldo - kaution)}</b>` : ''}.
    ${tag.slice(5) !== '12-31' ? `Seit Jahresbeginn <b class="${saldo - saldoJb >= 0 ? 'pos' : 'neg'}">${plusMinus(saldo - saldoJb)}</b>.` : ''}${groesst ? ` Am meisten auf: ${esc(groesst.k.name)} (${eur0(groesst.c)}).` : ''}`;
  const zeile = (x) => {
    const k = x.k, b = bew.get(x.i) || { ein: 0, aus: 0 }, a0 = anfang.get(x.i);
    const zusatz = { geschaetzt: 'geschätzt', ungefaehr: `± ${eur0(Math.round((x.abw || 0) * 100))}` }[x.status];
    const wert = x.status === 'unsicher' ? `<span class="muted" title="${STATUS_TEXT.unsicher}">nicht berechenbar</span>` : `${zusatz ? '≈ ' : ''}${eur(x.c)}`;
    const d = x.c != null && a0 != null ? x.c - a0 : null;
    return `<tr class="klick${drin(x.i) ? '' : ' aus'}" data-konto="${esc(k.name)}"><td><b>${esc(k.name)}</b><small>${k.vollstaendig ? '<span class="ok">✓ lückenlos</span> seit ' + dde(k.von).slice(3) : 'Daten ab ' + dde(k.von).slice(3)}${zusatz ? ` · ${zusatz}` : ''}</small></td>
      <td class="r ${x.c < 0 ? 'neg' : ''}"><b>${wert}</b></td><td class="r ${d == null ? 'muted' : d >= 0 ? 'pos' : 'neg'}">${d == null ? '–' : plusMinus(d)}</td>
      <td class="r sp-m">${b.ein ? eur0(b.ein) : '<span class="muted">–</span>'}</td><td class="r sp-m">${b.aus ? eur0(-b.aus) : '<span class="muted">–</span>'}</td><td class="r sp-m muted">${letzte.has(x.i) ? dde(letzte.get(x.i)) : '–'}</td></tr>`;
  };
  // Kontostände je Monatsende (letzte 4) – nur die gewählten Konten
  const enden = [];
  { let [y, mo] = tag.slice(0, 7).split('-').map(Number); for (let i = 0; i < 4; i++) { if (--mo === 0) { mo = 12; y--; } const d = monatsletzter(`${mkey(y, mo)}-01`); if (d >= D.von) enden.unshift(d); } }
  const st = enden.map((d) => new Map(kontostaende(D, d).map((x) => [x.i, x.c])));
  const verlaufT = `<table class="t3 t3-eng"><thead><tr><th>Konto</th>${enden.map((d, i) => `<th class="r${i < enden.length - 3 ? ' m-alt' : ''}">${monKurz(d.slice(0, 7))}</th>`).join('')}<th class="r">${dde(tag).slice(0, 6)}</th></tr></thead><tbody>
    ${gew.map((x) => `<tr><td class="t3-n">${esc(x.k.name)}</td>${st.map((s2, i) => `<td class="r${i < enden.length - 3 ? ' m-alt' : ''}">${s2.get(x.i) == null ? '<span class="muted">–</span>' : NUM.format(Math.round(s2.get(x.i) / 100))}</td>`).join('')}<td class="r"><b>${NUM.format(Math.round(x.c / 100))}</b></td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Zusammen</td>${st.map((s2, i) => `<td class="r${i < enden.length - 3 ? ' m-alt' : ''}">${NUM.format(Math.round(gew.reduce((t, x) => t + (s2.get(x.i) || 0), 0) / 100))}</td>`).join('')}<td class="r">${NUM.format(Math.round(saldo / 100))}</td></tr></tfoot></table>`;
  return seitenKopf('Konten', antwort, rechts) + `<div class="k3-reihe k3-11">
    ${karte('Deine Konten', `Stand ${dde(tag)} · Zeile anklicken: Buchungen des Kontos${ks ? ' · grau: nicht gewählt' : ''}`, `<table class="t3"><thead><tr><th>Konto</th><th class="r">Stand</th><th class="r">seit 1.1.</th><th class="r sp-m">Eingänge ${tag.slice(0, 4)}</th><th class="r sp-m">Ausgänge ${tag.slice(0, 4)}</th><th class="r sp-m">letzte Buchung</th></tr></thead>
      <tbody>${m.map(zeile).join('')}</tbody><tfoot><tr><td>Zusammen${ks ? ' (gewählt)' : ''}<small>ohne Depot, gemeinsame und Kinderkonten</small></td><td class="r">${eur(saldo)}</td><td class="r ${saldo - saldoJb >= 0 ? 'pos' : 'neg'}">${plusMinus(saldo - saldoJb)}</td><td class="sp-m"></td><td class="sp-m"></td><td class="sp-m"></td></tr></tfoot></table>
      ${unbekannt.length ? `<div class="muted klein k3-fuss">Für diesen Tag noch ohne Daten: ${unbekannt.map((x) => `${esc(x.k.name)} (ab ${dde(x.k.von)})`).join(', ')}.</div>` : ''}`)}
    <div class="k3-spalte">${karte('Verlauf', `Summe ${ks ? 'der gewählten Konten' : 'deiner Konten'} je Monatsende · Punkt anklicken: Stand an diesem Tag`, '<div class="kon2-chart"><canvas id="c-konten-verlauf"></canvas></div>')}
      ${karte('Kontostände je Monatsende', 'in Euro', `<div class="t3-rahmen">${verlaufT}</div>`)}</div>
  </div>` + gemeinsamKontenHtml(tag) + kinderKontenHtml(tag) + eingangHtml();
}

// ---------------------------------------------------------------- Fixkosten: Verträge als Tabelle, daneben Wofür und Wann
function naechsteAbbuchung(f) {
  if (!f.aktiv) return '';
  if (f.rh.proJahr !== 12) return naechsteZahlung(f);
  const tag = zahltag(f), im = (y, m) => `${mkey(y, m)}-${String(Math.min(tag, tageImMonat(mkey(y, m)))).padStart(2, '0')}`;
  let [y, m] = D.bis.slice(0, 7).split('-').map(Number);
  let am = im(y, m);
  if (am <= D.bis || f.zuletzt.slice(0, 7) === D.bis.slice(0, 7)) { if (++m > 12) { m = 1; y++; } am = im(y, m); }
  return am;
}
function fixVertraegeAnsicht(o) {
  const { liste, arten, ueber, B, pct, bz, pmListe, vomGemeinsamen, aktiv, alle, nFrueher, nAelter, lauf } = o;
  const seg = (k, t) => `<button data-fixansicht="${k}" class="${fixAnsicht === k ? 'an' : ''}">${t}</button>`;
  const e2 = (c) => EUR.format(c / 100);
  let rows = '';
  for (const g of arten) {
    rows += `<tr class="fv-g"><td colspan="3"><b>${esc(g.art)}</b> <span class="muted klein">${g.laufend ? `${g.laufend} laufend` : 'beendet'}</span></td><td class="r"><b>${g.summe ? eur0(g.summe) : '–'}</b></td><td class="r">${g.summe ? pct(g.summe) : ''}</td><td class="sp-m"></td></tr>`;
    for (const f of [...g.fs].sort((a, b) => (b.aktiv - a.aktiv) || b.proMonat - a.proMonat)) {
      const titel = fixTitel(f, g.art), vt = verlaufText(f), n = naechsteAbbuchung(f);
      rows += `<tr class="fv-z klick${f.aktiv ? '' : ' beendet'}" data-fix="${esc(f.name)}" data-sig="${esc(f.sig)}" title="Alle Zahlungen anzeigen">
        <td><span class="fv-titel">${esc(titel)}</span><small>${[titel !== f.name ? f.name : '', f.aktiv ? `seit ${dde(f.seit).slice(3)}` : `bis ${dde(f.zuletzt).slice(3)}`, vt].filter(Boolean).map(esc).join(' · ')}</small></td>
        <td class="sp-m">${esc(f.rh.name)}</td><td class="r">${e2(f.betrag)}</td><td class="r">${f.aktiv ? eur0(f.proMonat) : '<span class="muted">–</span>'}</td>
        <td class="r">${f.aktiv ? pct(f.proMonat) : ''}</td><td class="sp-m">${n ? dde(n) : ''}</td></tr>`;
    }
  }
  const tabelle = `<table class="t3 fv"><thead><tr><th>Vertrag</th><th class="sp-m">Rhythmus</th><th class="r">Betrag</th><th class="r">pro Monat</th><th class="r">${esc(bz.spalte)}</th><th class="sp-m">nächste Abbuchung</th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr><td colspan="3">Summe laufend<small>${eur0(pmListe * 12)} im Jahr</small></td><td class="r">${eur0(pmListe)}</td><td class="r">${pct(pmListe)}</td><td class="sp-m"></td></tr></tfoot></table>`;
  const gem = vomGemeinsamen.length ? `<div class="muted klein k3-fuss"><b>Vom Gemeinschaftskonto bezahlt</b> (nicht mitgezählt, ihr deckt sie aus euren Einzahlungen): ${vomGemeinsamen.filter((f) => f.aktiv).map((f) => `${esc(f.name)} ${e2(f.betrag)}`).join(' · ') || '–'}</div>` : '';
  // Kennzahlen zu den Verträgen
  const zd = zahlungsDaten(lauf), teuer = [...zd.monate].sort((a, b) => b.summe - a.summe)[0], groesster = [...lauf].sort((a, b) => b.proMonat - a.proMonat)[0];
  const jaehrl = lauf.filter((f) => f.rh.proJahr < 12);
  const fakten = [
    ['Laufende Verträge', NUM.format(lauf.length)],
    ['Fixkosten im Jahr', eur0(pmListe * 12)],
    ['Größter Posten', groesster ? `${esc(vertragName(groesster))} · ${eur0(groesster.proMonat)}` : '–'],
    ['Teuerster Monat (nächste 12)', teuer ? `${monKurz(teuer.k)} · ${eur0(teuer.summe)}` : '–'],
    ['Nicht monatlich', jaehrl.length ? `${jaehrl.length} Verträge · ${eur0(jaehrl.reduce((t, f) => t + f.proJahr, 0))} im Jahr` : '–'],
    ['Gehalt kommt um den', zd.gt ? `${zd.gt}.` : '–'],
  ].map(([t, w]) => `<div><dt>${t}</dt><dd>${w}</dd></div>`).join('');
  return `<div class="k3-reihe k3-21">
    ${karte('Verträge', 'Zeile anklicken: alle Zahlungen', `<div class="fix-leiste-r"><div class="seg fix-seg">${seg('laufend', `Laufend (${aktiv.length})`)}${nFrueher ? seg('frueher', `+ frühere seit 2020 (${nFrueher})`) : ''}${nFrueher + nAelter ? seg('alle', `alle (${alle.length})`) : ''}</div></div>${liste.length ? tabelle : '<div class="leer">Keine regelmäßigen Zahlungen gefunden.</div>'}${gem}`)}
    <div class="k3-spalte">${karte('Wofür', `pro Monat · ${esc(bz.spalte)}`, artenHtml(ueber, pct))}
      <div class="card ue-karte k3-termine" id="fix-termine"></div>
      ${karte('Auf einen Blick', '', `<dl class="k3-fakten k3-fakten-1">${fakten}</dl>`)}</div>
  </div>`;
}

// ======================================================================= Tabellen
function sortiert() {
  const f = S.sort === 'betrag' ? (a, b) => a.c - b.c : S.sort === 'wer' ? (a, b) => (a.g || a.z).localeCompare(b.g || b.z, 'de') : (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.i - b.i);
  const out = F.slice().sort(f);
  if (S.dir < 0) out.reverse();
  return out;
}

// Keine Treffer: Gibt es welche in anderen Jahren oder ohne die übrigen Filter? Dann zeigen und mit einem Klick dorthin.
function keineTreffer(conds) {
  const leer = '<div class="leer">Keine Buchungen gefunden. Suche oder Filter ändern?</div>';
  if (!conds.length && !S.jahr && !S.monat) return leer;
  const kurz = (r) => `<li><span>${dde(r.d)}</span><span>${esc(r.g || r.z || '–')}</span><span class="muted">${esc(D.konten[r.k].name)}</span><b class="${cls(r.c)}">${EUR.format(r.c / 100)}</b></li>`;
  const kasten = (text, l, ziel, knopf) => `<div class="leer kt"><p>${text}</p><ul class="kt-l">${l.slice(-5).reverse().map(kurz).join('')}</ul>${l.length > 5 ? `<p class="muted">… und ${l.length - 5} weitere</p>` : ''}<button class="btn" data-weiter="${esc(JSON.stringify(ziel))}">${knopf}</button></div>`;
  const zeitraum = [S.jahr ? (S.jahr.includes(',') ? `in ${S.jahr.replace(/,/g, ', ')}` : `in ${S.jahr}`) : '', S.monat ? `(${monateWahl().map((m) => MON[m - 1]).join(', ')})` : ''].filter(Boolean).join(' ');
  // 1. dieselben Filter, nur ohne Jahr und Monat
  if (S.jahr || S.monat) {
    const alt = { jahr: S.jahr, monat: S.monat };
    let l; try { S.jahr = ''; S.monat = ''; l = D.rows.filter(pruefer(conds)); } finally { Object.assign(S, alt); }
    if (l.length) {
      const jahre = [...new Set(l.map((r) => r.y))];
      return kasten(`${zeitraum ? `${zeitraum[0].toUpperCase()}${zeitraum.slice(1)}` : 'Im gewählten Zeitraum'} nichts gefunden – aber <b>${l.length} Treffer</b> in ${jahre.length === 1 ? jahre[0] : `${jahre.length} anderen Jahren`}:`, l,
        jahre.length === 1 ? { jahr: String(jahre[0]), monat: '' } : { jahr: '', monat: '' }, jahre.length === 1 ? `${jahre[0]} anzeigen` : 'In allen Jahren anzeigen');
    }
  }
  // 2. nur die Suche, ohne Konto, Kategorie, Art und Zeitraum
  const test = matcher(conds), l = D.rows.filter(test);
  if (l.length && (S.konto || S.kat || S.ukat || S.art !== 'alle' || !S.umb || S.jahr || S.monat)) {
    const konten = [...new Set(l.map((r) => r.k))], nurFremd = l.every((r) => FREMD_ART.has(r.art));
    const ziel = { jahr: '', monat: '', konto: nurFremd && konten.length === 1 ? D.konten[konten[0]].name : '', kat: '', ukat: '', art: 'alle', umb: l.some((r) => r.art === 'Umbuchung') || S.umb };
    const warum = l.every((r) => r.art === 'Umbuchung') ? ' (es sind Umbuchungen, die sonst ausgeblendet sind)' : nurFremd ? ' (auf einem gemeinsamen bzw. Kinderkonto, das sonst nicht mitzählt)' : '';
    return kasten(`Mit den gesetzten Filtern nichts gefunden – ohne Filter gibt es <b>${l.length} Treffer</b>${warum}:`, l, ziel, 'Ohne Filter anzeigen');
  }
  return leer;
}

function tabBuchungen(conds) {
  const rows = sortiert();
  if (!rows.length) return keineTreffer(conds);
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

// Stichtag für die Kontostände: selbst gewählt, sonst der letzte Datenstand
const stichtag = () => S.stichtag || D.bis;

// Gemeinsame Konten mit Kathrin: nur zur Information – bei dir zählen nur deine Einzahlungen
function gemeinsamKontenHtml(tag) {
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
  const stand = kontostaende(D, tag);
  const k = stand.filter((x) => x.k.kind && !['nicht_eroeffnet', 'geschlossen'].includes(x.status));
  if (!k.length) return '';
  return `<details class="eingang kinder-konten"><summary><b>Konten der Kinder</b> <span class="muted">· ${k.length} Konten · zählen nicht zu deinen Finanzen (nicht in Summen, Durchschnitten und Grafiken)</span></summary>
    <p class="muted klein">Was du den Kindern überweist (Taschengeld, „Sparen Leo/Mara“, Geschenke), ist bei dir eine Ausgabe in der Kategorie Kinder; Erstattungen von Auslagen sind Einnahmen; Darlehen bleiben neutral. Zeile anklicken: Buchungen des Kontos.</p>
    <div class="tab-scroll"><table class="t fix"><thead><tr><th class="erste">Konto</th><th class="r" style="width:150px">Stand ${dde(tag)}</th><th class="sp-m" style="width:230px">Daten</th></tr></thead><tbody>
    ${k.map((x) => `<tr class="klick" data-konto="${esc(x.k.name)}"><td class="erste">${esc(x.k.name)}</td><td class="r">${x.c == null ? '<span class="muted">unbekannt</span>' : eur(x.c)}</td><td class="klein sp-m">ab ${dde(x.k.von)}</td></tr>`).join('')}
    </tbody></table></div></details>`;
}

// Grafiken im Reiter Konten: Summe der Kontostände je Monatsende (36 Monate) und Verteilung am Stichtag
let kontenGrafik = null;
function kontenGrafikZeichnen() {
  if (!kontenGrafik || !$('#c-konten-verlauf')) return;
  const nur = -1, ks = kontoSet();
  const tage = [];
  let [y, mo] = D.bis.slice(0, 7).split('-').map(Number);
  for (let i = 0; i < 36; i++) {
    const d = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    tage.unshift(d > D.bis ? D.bis : d);
    if (--mo === 0) { mo = 12; y--; }
  }
  const werte = tage.map((d) => kontostaende(D, d).filter((x) => (ks ? ks.has(x.i) : !fremd(x.k)) && x.c != null && x.status !== 'unbekannt').reduce((t, x) => t + x.c, 0) / 100);
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
  buchungen: () => ['Buchungen', `${[...(kontoSet() || [])].some((i) => D.konten[i].kind) ? 'mit Konto eines Kindes – zählt nicht zu deinen Finanzen · ' : [...(kontoSet() || [])].some((i) => D.konten[i].gemeinsam) ? 'mit gemeinsamem Konto – zählt nicht zu deinen Finanzen, nur deine Einzahlungen · ' : ''}${NUM.format(F.length)} Treffer · Zeile anklicken für Details · Spaltenkopf: sortieren`],
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
  el.innerHTML = S.tab === 'uebersicht' ? tabKategorien() : S.tab === 'konten' ? tabKonten() : S.tab === 'fix' ? tabFixkosten([]) : tabBuchungen(conds);
  // Zeitraum, Kategorien, Fixkosten-Ansicht
  el.querySelectorAll('[data-zeit]').forEach((b) => b.onclick = () => setze({ jahr: b.dataset.zeit, monat: '' }));
  el.querySelectorAll('[data-k2art]').forEach((b) => b.onclick = () => setze({ kart: b.dataset.k2art, wahl: '' }));
  el.querySelectorAll('.kat2-z[data-k2kat]').forEach((b) => b.onclick = () => { setze({ wahl: b.dataset.k2kat }); if (matchMedia('(max-width: 1100px)').matches) $('.kat2-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  const katWahlJetzt = () => el.querySelector('.kat2-z.an')?.dataset.k2kat || S.wahl;
  const katBuchungen = (extra) => setze({ tab: 'buchungen', q: '', monat: '', art: S.kart, ...(S.kart === 'aus' ? { kat: katWahlJetzt(), ukat: '' } : { kat: 'Einnahmen', ukat: katWahlJetzt() }), ...extra });
  el.querySelectorAll('[data-k2zelle]').forEach((td) => td.onclick = () => {
    const [k, m] = td.dataset.k2zelle.split('|');
    setze({ tab: 'buchungen', q: '', jahr: m.slice(0, 4), monat: String(+m.slice(5)), art: S.kart, ...(S.kart === 'aus' ? { kat: k, ukat: '' } : { kat: 'Einnahmen', ukat: k }) });
  });
  el.querySelector('[data-k2buch]')?.addEventListener('click', () => katBuchungen({}));
  el.querySelectorAll('[data-k2ukat]').forEach((b) => b.onclick = () => katBuchungen({ ukat: b.dataset.k2ukat === 'ohne Unterkategorie' ? '' : b.dataset.k2ukat }));
  el.querySelectorAll('[data-fixtab]').forEach((b) => b.onclick = () => setze({ fixtab: b.dataset.fixtab }));
  el.querySelectorAll('th[data-sort]').forEach((th) => th.onclick = () => {
    const k = th.dataset.sort;
    S.dir = S.sort === k ? -S.dir : k === 'wer' ? 1 : -1; S.sort = k; tabelle(conds);
  });
  el.querySelectorAll('tr[data-i]').forEach((tr) => tr.onclick = () => {
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
  el.querySelectorAll('[data-fixansicht]').forEach((b) => b.onclick = () => { fixAnsicht = b.dataset.fixansicht; tabelle(conds); });
  el.querySelectorAll('[data-fixbezug]').forEach((b) => b.onclick = () => { fixBezug = b.dataset.fixbezug; try { localStorage.setItem('fd.fixbezug2', fixBezug); } catch {} tabelle(conds); });
  el.querySelectorAll('.fix-zeile[data-fix]').forEach((tr) => tr.onclick = () => setze({ q: `"${tr.dataset.fix}"${tr.dataset.sig ? ' ' + tr.dataset.sig : ''}`, tab: 'buchungen' }));
  el.querySelectorAll('.fix-kopfzeile[data-fixgruppe]').forEach((b) => b.onclick = () => fixGruppeUmschalten(b.dataset.fixgruppe));
  el.querySelectorAll('.fa-zeile[data-fixgruppe], .kb-fix[data-fixgruppe]').forEach((b) => b.onclick = () => fixGruppeUmschalten(b.dataset.fixgruppe, true));
  el.querySelector('.fix-vertraege')?.addEventListener('toggle', (e) => { fixListeAuf = e.target.open; });
  el.querySelector('.fix-grundlage')?.addEventListener('toggle', (e) => { fixGrundlageAuf = e.target.open; });
  el.querySelectorAll('.zk-l[data-fix], .ab-v[data-fix], .fv-z[data-fix]').forEach((b) => b.onclick = () => setze({ q: `"${b.dataset.fix}"${b.dataset.sig ? ' ' + b.dataset.sig : ''}`, tab: 'buchungen' }));
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
  if (S.tab === 'fix' && $('#fix-termine')) ueTermine(fixkostenErkennen().filter((f) => !f.gemeinsam && f.aktiv && (!kontoSet() || kontoSet().has(f.k))), 12, '#fix-termine');
  $('#fix-alle-auf')?.addEventListener('click', () => {
    const alleArten = [...el.querySelectorAll('.fix-kopfzeile')].map((b) => b.dataset.fixgruppe);
    fixOffen = alleArten.every((a) => fixOffen.has(a)) ? new Set() : new Set(alleArten);
    tabelle(conds);
  });
  if (S.tab === 'fix') fixGrafikZeichnen();
  if (S.tab === 'konten') kontenGrafikZeichnen();
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
const fixSichtbar = (alle) => alle.filter((f) => f.aktiv || fixAnsicht === 'alle' || (fixAnsicht === 'frueher' && f.zuletzt >= FRUEHER_AB));

// Bezugsgröße für die Prozente: aktuelles Nettogehalt, Ø Gehalt der letzten 12 Monate oder Ø aller Einnahmen.
// Die 12 Monate enden mit dem letzten Monat, in dem Gehalt eingegangen ist.
let fixBezug = (() => { try { return localStorage.getItem('fd.fixbezug2') || 'aktuell'; } catch { return 'aktuell'; } })();
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

function tabFixkosten(conds) {
  const ks = kontoSet();
  const gefiltert = fixkostenErkennen().filter((f) => !ks || ks.has(f.k));   // Verträge der gewählten Konten (Suche und übrige Filter gehören zu „Buchungen“)
  const alle = gefiltert.filter((f) => !f.gemeinsam);
  const vomGemeinsamen = fixSichtbar(gefiltert.filter((f) => f.gemeinsam));
  const aktiv = alle.filter((f) => f.aktiv);
  const nFrueher = alle.filter((f) => !f.aktiv && f.zuletzt >= FRUEHER_AB).length, nAelter = alle.filter((f) => !f.aktiv && f.zuletzt < FRUEHER_AB).length;
  const liste = fixSichtbar(alle);
  const pmListe = aktiv.reduce((s, f) => s + f.proMonat, 0);
  // Überblick und Rechner rechnen immer mit allen laufenden Verträgen – mit Filter wäre die Rechnung unvollständig
  const alleV = gefiltert.filter((f) => !f.gemeinsam), lauf = alleV.filter((f) => f.aktiv);
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
  let h = seitenKopf('Fixkosten', satz, kontoWahlHtml()) + `<div class="fix-kopf fix-held">
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

  const reiter = (k, t) => `<button data-fixtab="${k}" class="${S.fixtab === k ? 'an' : ''}">${t}</button>`;
  h += `<div class="fix-tabs"><div class="seg">${reiter('vertraege', `Verträge <small>${aktiv.length}</small>`)}${reiter('kalender', 'Wann abgebucht wird')}${reiter('plan', 'Was wäre wenn …')}</div></div>`;
  h += S.fixtab === 'kalender' ? `<div class="card fix-zk k3">${zahlungskalenderHtml(lauf)}</div>`
    : S.fixtab === 'plan' ? `<div class="card fix-plan k3" id="fix-plan">${planHtml()}</div>`
      : fixVertraegeAnsicht({ liste, arten, ueber, B, pct, bz, pmListe, vomGemeinsamen, aktiv, alle, nFrueher, nAelter, lauf });
  h += `<details class="fix-fuss muted klein"><summary>So wird gerechnet</summary><p>Einkommen − Fixkosten − Lebenshaltung = Spielraum. Fixkosten: automatisch erkannte regelmäßige Zahlungen (gleicher Empfänger und Verwendungszweck, regelmäßiger Abstand; jährliche anteilig). Deine Überweisungen aufs Gemeinschaftskonto zählen mit, was von dort abgeht, nicht noch einmal. Lebenshaltung: alle übrigen Ausgaben deiner Konten (Einkauf, Tanken, Freizeit, Urlaub, Anschaffungen) der letzten 12 abgeschlossenen Monate. Die Überblicksgrafiken und der Rechner nutzen immer alle Verträge, auch wenn oben gefiltert ist. Stand ${dde(D.bis)}.${zeit}</p></details>`;
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

// Abbuchungen je Tag (gleich in jedem Monat), mit dem Gehalt an seinem Tag; ✓ = in diesem Monat schon abgebucht
function tageslisteHtml(lauf) {
  const Z = zahlungsDaten(lauf), zeilen = [];
  Z.tag1.forEach((t, i) => {
    const d = i + 1;
    if (Z.gt === d) zeilen.push(`<div class="ab-tag ab-gtag"><span class="ab-d">${d}.</span><span class="ab-vs"><span class="ab-g">Gehalt kommt (zuletzt ${eur0(Z.lohn)})</span></span><span class="ab-s pos">+${eur0(Z.lohn)}</span></div>`);
    if (!t.c) return;
    const fs = [...t.fs].sort((x, y) => y.betrag - x.betrag);
    const bezahlt = (f) => f.zuletzt.slice(0, 7) === Z.jetzt;
    zeilen.push(`<div class="ab-tag${fs.every(bezahlt) ? ' ab-bezahlt' : ''}"><span class="ab-d">${d}.</span>
      <span class="ab-vs">${fs.map((f) => `<button class="ab-v${bezahlt(f) ? ' ok' : ''}" data-fix="${esc(f.name)}" data-sig="${esc(f.sig)}" title="${bezahlt(f) ? `im ${MONAT[+Z.jetzt.slice(5) - 1]} schon abgebucht – ` : ''}alle Zahlungen anzeigen">${bezahlt(f) ? '<i>✓</i>' : ''}${esc(vertragName(f))} <b>${eur0(f.betrag)}</b></button>`).join('')}</span>
      <span class="ab-s">${eur0(t.c)}</span></div>`);
  });
  return `<div class="ab-liste">${zeilen.join('')}</div>`;
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
const ZUSTAND = ['q', 'jahr', 'monat', 'konto', 'kat', 'ukat', 'art', 'umb', 'tab', 'stichtag', 'wahl', 'kart', 'fixtab'];
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
  $('#kpis').hidden = true;
  schnellSuche();
  $('#fuss').hidden = t === 'start';
  document.body.classList.toggle('ue-modus', t === 'start');
  $('#seite-start').hidden = t !== 'start';
  $('#seite-kennzahlen').hidden = t !== 'kennzahlen';
  $('#tabelle-card').hidden = t === 'start' || t === 'kennzahlen';
  filterZeigen(conds);
  // jede Grafik für sich: ein Fehler in einer soll die anderen nicht leer lassen
  const sicher = (f) => { try { return f(); } catch (e) { console.error(e); return null; } };
  if (t === 'start') sicher(uebersicht);
  else if (t === 'kennzahlen') sicher(k2Seite);
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
  for (const k of ['q', 'jahr', 'monat', 'konto', 'kat', 'ukat', 'stichtag', 'wahl']) if (S[k]) p.set(k, S[k]);
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
function hashLesen() {
  const p = new URLSearchParams(location.hash.slice(1));
  S = { ...S0, sort: S.sort, dir: S.dir };
  // Grundeinstellung beim Öffnen ohne Auswahl in der Adresse: das aktuelle Jahr (ohne Daten dafür: das letzte Jahr mit Daten)
  if (ersterStart && D && ![...p.keys()].length) {
    const jetzt = new Date().getFullYear();
    S.jahr = String(D.rows.some((r) => r.y === jetzt) ? jetzt : +D.bis.slice(0, 4));
  }
  if (D) ersterStart = false;
  for (const k of ['q', 'jahr', 'monat', 'konto', 'kat', 'ukat', 'wahl']) if (p.get(k)) S[k] = p.get(k);
  if (p.get('kart') === 'ein') S.kart = 'ein';
  if (['kalender', 'plan'].includes(p.get('fixtab'))) S.fixtab = p.get('fixtab');
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
