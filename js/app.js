// Finanzen – Dashboard: eine Suche, zwei Grafiken, drei Tabellen. Alles reagiert auf Suche und Filter.
import { norm, parse, matcher, highlightWords } from './suche.js';
import * as Q from './quelle.js';
import { alsExcel, alsCsv, herunterladen } from './export.js';
import { chatStart, chatDaten, chatVergessen } from './chat.js';

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

let D = null;          // aufbereitete Daten
let quelle = null;     // gespeicherte Fassung (Text + Herkunft)
const S0 = { q: '', jahr: '', monat: '', konto: '', kat: '', ukat: '', art: 'alle', umb: false, tab: 'buchungen', sort: 'datum', dir: -1 };
let S = { ...S0 };
let F = [];            // gefilterte Buchungen (nach Datum aufsteigend)
let limit = 150;
const offen = new Set();
const charts = {};

// ======================================================================= Daten aufbereiten
function aufbereiten(j) {
  const K = j.kategorien, U = j.unterkategorien, A = j.arten, konten = j.konten;
  const rows = j.buchungen.map((b, i) => {
    const [d, k, c, g, z, kat, ukat, art, v, t, n] = b;
    const r = { i, d, y: +d.slice(0, 4), m: +d.slice(5, 7), k, c, g, z, kat: K[kat], ukat: U[ukat], art: A[art], v, t, n };
    r.s = norm(`${g} ${z} ${r.kat} ${r.ukat} ${konten[k].name} ${v} ${t} ${n}`);
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
  };
}

// ======================================================================= Filtern
// Prüffunktion für alle Filter; mitJahr = false lässt Jahr und Zeitangaben der Suche weg (für den Vorjahresvergleich)
function pruefer(conds, mitJahr = true) {
  const test = matcher(mitJahr ? conds : conds.filter((c) => c.kind !== 'zeit'));
  const jahr = mitJahr ? +S.jahr || 0 : 0, monat = +S.monat || 0;
  const konto = S.konto ? D.kontoIdx.get(S.konto) ?? -2 : -1;
  return (r) => (S.umb || r.art !== 'Umbuchung')
    && (!jahr || r.y === jahr) && (!monat || r.m === monat) && (konto === -1 || r.k === konto)
    && (!S.kat || r.kat === S.kat) && (!S.ukat || r.ukat === S.ukat)
    && (S.art === 'alle' || (S.art === 'aus' ? r.art === 'Ausgabe' : r.art === 'Einnahme'))
    && test(r);
}

let V = null;          // Vergleichszeitraum (ein Jahr früher) mit seinen Buchungen
function filtern() {
  const conds = parse(S.q);
  F = D.rows.filter(pruefer(conds));
  V = vergleich(conds);
  return conds;
}

// Gewählter Zeitraum (Jahr/Monat oder Zeitangaben in der Suche) → derselbe Zeitraum ein Jahr früher.
// Im laufenden Jahr wird nur bis zum selben Tag verglichen (01.01.–28.09. mit 01.01.–28.09. des Vorjahres).
function vergleich(conds) {
  const spans = conds.filter((c) => c.span);
  if (!S.jahr && !spans.length) return null;
  let a = '0000-00-00', b = '9999-99-99';
  if (S.jahr) { const mm = S.monat ? String(S.monat).padStart(2, '0') : ''; a = `${S.jahr}-${mm || '01'}-01`; b = `${S.jahr}-${mm || '12'}-31`; }
  for (const c of spans) { if (c.span[0] + '-01' > a) a = c.span[0] + '-01'; if (c.span[1] + '-31' < b) b = c.span[1] + '-31'; }
  const bVoll = b;
  if (b > D.bis) b = D.bis;
  if (a > b) return null;
  const zurueck = (iso) => `${+iso.slice(0, 4) - 1}${iso.slice(4)}`;
  const va = zurueck(a), vb = zurueck(b);
  if (vb < D.von) return null;
  const t = pruefer(conds, false);
  const rows = D.rows.filter((r) => r.d >= va && r.d <= vb && t(r));
  const y1 = +va.slice(0, 4), y2 = +vb.slice(0, 4);
  const ganzesJahr = va.slice(5) === '01-01' && bVoll === b && b.slice(5) === '12-31';
  const ganzerMonat = va.slice(5, 7) === vb.slice(5, 7) && va.slice(8) === '01' && bVoll === b;
  const tm = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
  const label = ganzesJahr ? (y1 === y2 ? String(y1) : `${y1}–${y2}`)
    : ganzerMonat && y1 === y2 ? `${MON[+va.slice(5, 7) - 1]} ${y1}`
      : `${tm(va)}–${tm(vb)}${y2}`;
  return { va, vb, rows, label, jahr: y1 === y2 ? y1 : 0 };
}

// Alle Treffer in einem Jahr? Dann zeigen Grafik und Übersicht Monate statt Jahre.
const proMonat = () => (S.jahr ? +S.jahr : F.length && F[0].y === F[F.length - 1].y ? F[0].y : 0);

function monatsSpanne(conds) {
  if (S.jahr && S.monat) return 1;
  const k = S.konto ? D.konten[D.kontoIdx.get(S.konto)] : null;
  let lo = (k?.von || D.von).slice(0, 7), hi = (k?.bis || D.bis).slice(0, 7);
  if (S.monat) return new Set(D.rows.filter((r) => r.m === +S.monat && r.d.slice(0, 7) >= lo && r.d.slice(0, 7) <= hi).map((r) => r.y)).size || 1;
  let a = lo, b = hi;
  if (S.jahr) { a = `${S.jahr}-01`; b = `${S.jahr}-12`; }
  for (const c of conds) if (c.span) { if (c.span[0] > a) a = c.span[0]; if (c.span[1] < b) b = c.span[1]; }
  if (a < lo) a = lo;
  if (b > hi) b = hi;
  const n = (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)) + 1;
  return Math.max(1, n);
}

// ======================================================================= Anzeige: Filterleiste
function selectsFuellen() {
  const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  $('#f-jahr').innerHTML = opt('', 'Alle Jahre') + [...D.jahre].reverse().map((y) => opt(y, y)).join('');
  $('#f-monat').innerHTML = opt('', 'Alle Monate') + MONAT.map((m, i) => opt(i + 1, m)).join('');
  $('#f-konto').innerHTML = opt('', 'Alle Konten') + D.konten.map((k) => opt(k.name, k.name)).join('');
  $('#f-kat').innerHTML = opt('', 'Alle Kategorien') + D.kats.map((k) => opt(k, k)).join('');
}

function filterZeigen(conds) {
  for (const [id, v] of [['#f-jahr', S.jahr], ['#f-monat', S.monat], ['#f-konto', S.konto], ['#f-kat', S.kat]]) {
    const el = $(id); el.value = v; el.classList.toggle('aktiv', !!v);
  }
  document.querySelectorAll('#f-art button').forEach((b) => b.classList.toggle('an', b.dataset.v === S.art));
  $('#f-umb').checked = S.umb;
  if ($('#q').value !== S.q) $('#q').value = S.q;
  const chips = conds.map((c, i) => `<button class="chip" data-cond="${i}" title="Aus der Suche entfernen">${esc(c.label)}<span class="x">×</span></button>`);
  if (S.ukat) chips.push(`<button class="chip" data-ukat="1" title="Unterkategorie-Filter entfernen">Unterkategorie <b>${esc(S.ukat)}</b><span class="x">×</span></button>`);
  $('#chips').innerHTML = chips.join('');
  $('#chips').querySelectorAll('[data-cond]').forEach((b) => b.onclick = () => {
    const raw = conds[+b.dataset.cond].raw;
    setze({ q: S.q.replace(raw, '').replace(/\s+/g, ' ').trim() });
  });
  $('#chips').querySelector('[data-ukat]')?.addEventListener('click', () => setze({ ukat: '' }));
  const aktiv = S.q || S.jahr || S.monat || S.konto || S.kat || S.ukat || S.art !== 'alle' || S.umb;
  $('#f-reset').hidden = !aktiv;
  $('#f-zurueck').hidden = !schritte.length;
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

function kennzahlen(conds) {
  const { ein, aus, erg } = summen(F);
  const vs = V ? summen(V.rows) : null;
  const mon = monatsSpanne(conds);
  const text = conds.some((c) => c.kind === 'text' || c.kind === 'betrag');
  const gesamt = !text && S.art === 'alle' && !S.kat;
  const quote = ein > 0 && gesamt ? Math.round((erg / ein) * 100) : null;
  const zr = F.length ? `${dde(F[0].d)} – ${dde(F[F.length - 1].d)}` : 'keine Treffer';
  const avg = (c) => (mon > 24 ? eur0((c / mon) * 12) : eur0(c / mon));
  const kpi = (l, v, c, s, d = '') => `<div class="kpi"><div class="l">${l}</div><div class="v ${c}">${v}</div><div class="s">${s}</div>${d}</div>`;
  const diffErg = () => {
    if (!V) return '';
    const d = erg - vs.erg;
    return `<div class="d ${cls(d)}" title="${V.label}: ${eur0(vs.erg)}">${d >= 0 ? '▲ +' : '▼ '}${eur0(d)} · ${V.label}: ${eur0(vs.erg)}</div>`;
  };
  $('#kpis').innerHTML = [
    kpi('Einnahmen', eur0(ein), 'pos', mon > 1 ? `Ø ${avg(ein)} pro ${mon > 24 ? 'Jahr' : 'Monat'}` : '&nbsp;', veraenderung(ein, vs?.ein, true)),
    kpi('Ausgaben', eur0(aus), 'neg', mon > 1 ? `Ø ${avg(aus)} pro ${mon > 24 ? 'Jahr' : 'Monat'}` : '&nbsp;', veraenderung(aus, vs?.aus, false)),
    gesamt ? kpi(erg >= 0 ? 'Überschuss' : 'Fehlbetrag', eur0(erg), cls(erg), quote === null ? 'Einnahmen minus Ausgaben' : quote >= 0 ? `${quote} % der Einnahmen übrig` : `${-quote} % mehr ausgegeben als eingenommen`, diffErg())
      : kpi('Summe der Treffer', eur0(erg), cls(erg), 'Einnahmen minus Ausgaben', diffErg()),
    kpi('Buchungen', NUM.format(F.length), '', zr, V ? `<div class="d muted">${V.label}: ${NUM.format(vs.n)}</div>` : ''),
  ].join('');
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

function verlauf() {
  const jahr = proMonat();
  let keys, label, key;
  if (jahr) { keys = MON.map((_, i) => i + 1); label = (k) => MON[k - 1]; key = (r) => r.m; }
  else {
    const a = F.length ? F[0].y : D.jahre[0], b = F.length ? F[F.length - 1].y : D.jahre[D.jahre.length - 1];
    keys = []; for (let y = a; y <= b; y++) keys.push(y);
    label = (k) => String(k); key = (r) => r.y;
  }
  const pos = new Map(keys.map((k, i) => [k, i]));
  const ein = keys.map(() => 0), aus = keys.map(() => 0);
  for (const r of F) {
    const i = pos.get(key(r));
    if (i === undefined) continue;
    if (r.art === 'Einnahme') ein[i] += r.c; else if (r.art === 'Ausgabe') aus[i] -= r.c;
  }
  $('#t-verlauf').textContent = jahr ? `Verlauf ${jahr} nach Monaten` : 'Verlauf nach Jahren';
  $('#h-verlauf').textContent = jahr && !S.monat ? 'Monat anklicken zum Filtern' : !jahr ? 'Jahr anklicken zum Filtern' : '';
  const cE = css('--ein'), cA = css('--aus');
  const ds = [];
  if (S.art !== 'aus') ds.push({ label: 'Einnahmen', data: ein.map((c) => c / 100), backgroundColor: alpha(cE, .85), hoverBackgroundColor: cE, borderRadius: 4, maxBarThickness: 34 });
  if (S.art !== 'ein') ds.push({ label: 'Ausgaben', data: aus.map((c) => c / 100), backgroundColor: alpha(cA, .85), hoverBackgroundColor: cA, borderRadius: 4, maxBarThickness: 34 });
  // Vorjahr als gestrichelte Linie (bei Monatsansicht)
  if (jahr && jahr - 1 >= D.jahre[0]) {
    const t = pruefer(parse(S.q), false), einVj = S.art === 'ein';
    const vj = keys.map(() => 0);
    for (const r of D.rows) if (r.y === jahr - 1 && (einVj ? r.art === 'Einnahme' : r.art === 'Ausgabe') && t(r)) vj[r.m - 1] += einVj ? r.c : -r.c;
    if (vj.some(Boolean)) {
      const cV = css('--muted');
      ds.push({ type: 'line', label: `${einVj ? 'Einnahmen' : 'Ausgaben'} ${jahr - 1}`, data: vj.map((c) => c / 100), borderColor: cV, backgroundColor: cV,
        borderDash: [5, 4], borderWidth: 2, pointRadius: 2.5, pointHoverRadius: 4, tension: 0.3, fill: false, order: -1 });
    }
  }
  const o = basis();
  o.interaction = { mode: 'index', intersect: false };
  o.plugins.legend = { display: ds.length > 1, position: 'top', align: 'end', labels: { color: css('--text-2'), usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, font: { size: 12 } } };
  o.plugins.tooltip.callbacks = {
    title: (it) => (jahr ? `${MONAT[keys[it[0].dataIndex] - 1]} ${jahr}` : String(keys[it[0].dataIndex])),
    label: (it) => ` ${it.dataset.label}: ${EUR0.format(it.raw)}`,
    footer: (it) => { const i = it[0].dataIndex, e = ein[i] - aus[i]; return S.art === 'alle' ? `${e >= 0 ? 'Überschuss' : 'Fehlbetrag'}: ${eur0(e)}` : ''; },
  };
  o.scales = { x: { ...achsenStil(), grid: { display: false } }, y: { ...achsenStil(), ticks: { ...achsenStil().ticks, callback: achse, maxTicksLimit: 6 } } };
  o.onClick = (_, el) => {
    if (!el.length) return;
    const k = keys[el[0].index];
    if (jahr) setze({ jahr: String(jahr), monat: S.monat === String(k) ? '' : String(k) });
    else setze({ jahr: String(k) });
  };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; };
  zeichne('c-verlauf', { type: 'bar', data: { labels: keys.map(label), datasets: ds }, options: o });
}

// Werte an die Balkenenden schreiben (ruhiger als eine Achse)
const wertLabels = {
  id: 'wertLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart, meta = chart.getDatasetMeta(0);
    ctx.save();
    ctx.font = '12px ' + css('--font');
    ctx.fillStyle = css('--text-2');
    ctx.textBaseline = 'middle';
    meta.data.forEach((bar, i) => ctx.fillText(EUR0.format(chart.data.datasets[0].data[i]), bar.x + 6, bar.y));
    ctx.restore();
  },
};

function kategorien() {
  const einMode = S.art === 'ein' || S.kat === 'Einnahmen';
  const unter = !!S.kat;
  const m = new Map();
  for (const r of F) {
    if (r.art === 'Umbuchung' || r.art === 'Sparen') continue;
    if (einMode ? r.art !== 'Einnahme' : (!S.kat && r.kat === 'Einnahmen')) continue;
    const k = unter ? r.ukat || '(ohne Unterkategorie)' : r.kat;
    m.set(k, (m.get(k) || 0) + (einMode ? r.c : -r.c));
  }
  let list = [...m].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const summe = list.reduce((s, [, v]) => s + v, 0);
  const MAX = 12;
  if (list.length > MAX) { const rest = list.slice(MAX - 1); list = [...list.slice(0, MAX - 1), [`Übrige (${rest.length})`, rest.reduce((s, [, v]) => s + v, 0)]]; }
  $('#t-kat').textContent = `${einMode ? 'Einnahmen' : 'Ausgaben'} nach ${unter ? 'Unterkategorie' : 'Kategorie'}`;
  $('#h-kat').textContent = unter ? S.kat : list.length ? 'Balken anklicken zum Filtern' : '';
  $('#chart-kat').style.height = `${Math.max(180, list.length * 28 + 30)}px`;
  if (!list.length) { charts['c-kat']?.destroy(); delete charts['c-kat']; return; }
  const c = css(einMode ? '--ein' : '--aus');
  const o = basis();
  o.indexAxis = 'y';
  o.layout = { padding: { right: 86 } };
  const vjKat = new Map();
  if (V) for (const r of V.rows) {
    if (r.art === 'Umbuchung' || r.art === 'Sparen') continue;
    if (einMode ? r.art !== 'Einnahme' : (!S.kat && r.kat === 'Einnahmen')) continue;
    const k = unter ? r.ukat || '(ohne Unterkategorie)' : r.kat;
    vjKat.set(k, (vjKat.get(k) || 0) + (einMode ? r.c : -r.c));
  }
  o.plugins.tooltip.callbacks = {
    label: (it) => ` ${EUR0.format(it.raw)} · ${NUM.format(Math.round((it.raw * 100 / summe) * 100))} %`,
    afterLabel: (it) => (V && vjKat.has(list[it.dataIndex][0]) ? ` ${V.label}: ${eur0(vjKat.get(list[it.dataIndex][0]))}` : ''),
  };
  o.scales = {
    x: { display: false, beginAtZero: true },
    y: { ...achsenStil(), grid: { display: false }, ticks: { color: css('--text-2'), font: { size: 12.5 }, autoSkip: false } },
  };
  o.onClick = (_, el) => {
    if (!el.length) return;
    const k = list[el[0].index][0];
    if (k.startsWith('Übrige (')) return;
    if (!unter) setze({ kat: k, ukat: '' });
    else if (k !== '(ohne Unterkategorie)') setze({ ukat: S.ukat === k ? '' : k });
  };
  o.onHover = (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; };
  zeichne('c-kat', {
    type: 'bar',
    data: { labels: list.map(([k]) => k), datasets: [{ data: list.map(([, v]) => v / 100), backgroundColor: list.map(([k]) => alpha(c, k === S.ukat || !S.ukat ? .85 : .35)), hoverBackgroundColor: c, borderRadius: 4, barThickness: 18 }] },
    options: o, plugins: [wertLabels],
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
  let h = `<div class="tab-scroll"><table class="t"><thead><tr>
    <th class="sort" data-sort="datum">Datum ${pf('datum')}</th><th class="sort" data-sort="wer">Empfänger / Zweck ${pf('wer')}</th>
    <th class="kat-sp">Kategorie</th><th class="konto-sp">Konto</th><th class="sort r" data-sort="betrag">Betrag ${pf('betrag')}</th></tr></thead><tbody>`;
  for (const r of rows.slice(0, limit)) {
    const auf = offen.has(r.i);
    h += `<tr class="klick${auf ? ' offen' : ''}" data-i="${r.i}"><td class="datum">${dde(r.d)}</td>
      <td><div class="wer">${mk(r.g || r.z || '–')}</div>${r.g && r.z ? `<div class="zweck">${mk(r.z)}</div>` : ''}</td>
      <td class="kat kat-sp">${esc(r.kat)}<small>${esc(r.ukat)}</small></td><td class="konto konto-sp">${esc(kn(r))}</td>
      <td class="r betrag ${cls(r.c)}">${eur(r.c)}</td></tr>`;
    if (auf) {
      const dd = [['Verwendungszweck', r.z], ['Kategorie', `${r.kat}${r.ukat ? ' · ' + r.ukat : ''}`], ['Konto', kn(r)], ['Art', r.art],
        ['Vertrag', r.v], ['Tags', r.t], ['Notiz', r.n]].filter(([, v]) => v);
      h += `<tr class="detail"><td colspan="5"><dl>${dd.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        ${r.g ? `<button class="btn sm" data-alle="${esc(r.g)}">Alle Buchungen von „${esc(r.g.length > 40 ? r.g.slice(0, 40) + '…' : r.g)}“</button>` : ''}
        <button class="btn sm" data-nurkat="${esc(r.kat)}">Nur ${esc(r.kat)}</button></td></tr>`;
    }
  }
  h += '</tbody></table></div>';
  if (rows.length > limit) h += `<div class="mehr">${NUM.format(limit)} von ${NUM.format(rows.length)} angezeigt <button class="btn sm" id="mehr">Weitere ${NUM.format(Math.min(500, rows.length - limit))} anzeigen</button></div>`;
  else if (rows.length > 20) h += `<div class="mehr">Alle ${NUM.format(rows.length)} Buchungen angezeigt</div>`;
  return h;
}

function pivotDaten() {
  const jahr = proMonat(), unter = !!S.kat;
  let cols;
  if (jahr) cols = MON.map((_, i) => i + 1);
  else { cols = []; const a = F.length ? F[0].y : D.jahre[0], b = F.length ? F[F.length - 1].y : a; for (let y = a; y <= b; y++) cols.push(y); }
  const pos = new Map(cols.map((c, i) => [c, i]));
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
  const label = (c) => (jahr ? MON[c - 1] : String(c));
  // Vorjahr (gleicher Zeitraum) je Zeile, nur in der Monatsansicht eines Jahres
  const vj = jahr && V ? new Map() : null;
  if (vj) {
    for (const r of V.rows) { const k = unter ? r.ukat || '(ohne Unterkategorie)' : r.kat; vj.set(k, (vj.get(k) || 0) + r.c); }
    for (const k of vj.keys()) if (!m.has(k)) rows.push({ key: k, v: cols.map(() => 0), sum: 0 });
    rows.sort((a, b) => order(a.key) - order(b.key) || a.sum - b.sum);
  }
  return { jahr, unter, cols, label, rows, sums, vj, vjTotal: vj ? [...vj.values()].reduce((a, b) => a + b, 0) : 0, total: rows.reduce((s, r) => s + r.sum, 0) };
}

function tabUebersicht() {
  const p = pivotDaten();
  if (!p.rows.length) return '<div class="leer">Keine Buchungen gefunden.</div>';
  const n = p.cols.length;
  const z = (c) => (c ? `<td class="r ${cls(c)}">${eur0(c)}</td>` : '<td class="r muted">–</td>');
  let h = `<div class="tab-scroll"><table class="t klein"><thead><tr><th class="erste">${p.unter ? 'Unterkategorie' : 'Kategorie'}</th>
    ${p.cols.map((c) => `<th class="r sort" data-spalte="${c}" title="${p.jahr ? 'Monat' : 'Jahr'} filtern">${p.label(c)}</th>`).join('')}
    <th class="r">Summe</th><th class="r" title="Durchschnitt je ${p.jahr ? 'Monat' : 'Jahr'}">Ø ${p.jahr ? 'Monat' : 'Jahr'}</th>
    ${p.vj ? `<th class="r vj" title="Gleicher Zeitraum ein Jahr früher">${esc(V.label)}</th><th class="r" title="Veränderung gegenüber ${esc(V.label)}">Veränderung</th>` : ''}</tr></thead><tbody>`;
  const vjZellen = (jetzt, vorher) => (p.vj ? `<td class="r vj">${vorher ? eur0(vorher) : '–'}</td><td class="r ${cls(jetzt - vorher)}">${jetzt - vorher ? (jetzt - vorher > 0 ? '+' : '') + eur0(jetzt - vorher) : '–'}</td>` : '');
  for (const r of p.rows) {
    h += `<tr class="klick" data-zeile="${esc(r.key)}"><td class="erste">${esc(r.key)}</td>${r.v.map(z).join('')}
      <td class="r ${cls(r.sum)}"><b>${eur0(r.sum)}</b></td><td class="r ${cls(r.sum)}">${eur0(r.sum / n)}</td>${vjZellen(r.sum, p.vj?.get(r.key) || 0)}</tr>`;
  }
  h += `</tbody><tfoot><tr><td class="erste">Ergebnis</td>${p.sums.map(z).join('')}<td class="r ${cls(p.total)}">${eur0(p.total)}</td><td class="r ${cls(p.total)}">${eur0(p.total / n)}</td>${vjZellen(p.total, p.vjTotal)}</tr></tfoot></table></div>`;
  return h;
}

function kontenDaten() {
  const m = D.konten.map((k) => ({ k, n: 0, ein: 0, aus: 0 }));
  for (const r of F) { const x = m[r.k]; x.n++; if (r.art === 'Einnahme') x.ein += r.c; else if (r.art === 'Ausgabe') x.aus += r.c; }
  return m.filter((x) => x.n || !(S.q || S.jahr || S.monat || S.kat || S.ukat || S.konto));
}

function tabKonten() {
  const m = kontenDaten();
  if (!m.length) return '<div class="leer">Keine Buchungen gefunden.</div>';
  const saldo = m.reduce((s, x) => s + (x.k.saldo != null ? Math.round(x.k.saldo * 100) : 0), 0);
  let h = `<div class="tab-scroll"><table class="t"><thead><tr><th class="erste">Konto</th><th class="r">Buchungen</th><th class="r">Einnahmen</th><th class="r">Ausgaben</th>
    <th class="r">Kontostand</th><th>Daten</th></tr></thead><tbody>`;
  for (const x of m) {
    const k = x.k;
    const daten = k.vollstaendig ? `<span class="ok" title="Alle Buchungen seit Kontoeröffnung vorhanden – bewiesen mit dem Kontostand der Bank">✓ lückenlos</span> seit ${dde(k.von)}`
      : `ab ${dde(k.von)}${k.saldo == null ? ` bis ${dde(k.bis)}` : ''}`;
    h += `<tr class="klick" data-konto="${esc(k.name)}"><td class="erste">${esc(k.name)}</td><td class="r">${NUM.format(x.n)}</td>
      <td class="r pos">${x.ein ? eur0(x.ein) : '–'}</td><td class="r neg">${x.aus ? eur0(x.aus) : '–'}</td>
      <td class="r">${k.saldo != null ? `${eur(k.saldo * 100)}<br><small class="muted">${dde(k.saldoAm)}</small>` : '<span class="muted">–</span>'}</td>
      <td class="klein">${daten}</td></tr>`;
  }
  h += `</tbody><tfoot><tr><td class="erste">Summe</td><td class="r">${NUM.format(m.reduce((s, x) => s + x.n, 0))}</td>
    <td class="r pos">${eur0(m.reduce((s, x) => s + x.ein, 0))}</td><td class="r neg">${eur0(m.reduce((s, x) => s + x.aus, 0))}</td>
    <td class="r">${eur(saldo)}</td><td class="klein muted">ohne Depot</td></tr></tfoot></table></div>`;
  return h;
}

function tabelle(conds) {
  document.querySelectorAll('#tabs button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === S.tab));
    if (b.dataset.tab === 'buchungen') b.innerHTML = `Buchungen<span class="n">${NUM.format(F.length)}</span>`;
  });
  const el = $('#tab-inhalt');
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
  $('#mehr')?.addEventListener('click', () => { limit += 500; tabelle(conds); });
  el.querySelectorAll('tr[data-zeile]').forEach((tr) => tr.onclick = () => {
    const k = tr.dataset.zeile;
    if (!S.kat) setze({ kat: k, ukat: '' }); else if (k !== '(ohne Unterkategorie)') setze({ ukat: S.ukat === k ? '' : k });
  });
  el.querySelectorAll('th[data-spalte]').forEach((th) => th.onclick = () => {
    const c = th.dataset.spalte, j = proMonat();
    if (j) setze({ jahr: String(j), monat: S.monat === c ? '' : c }); else setze({ jahr: c });
  });
  $('#fix-beendet')?.addEventListener('change', (e) => { fixBeendete = e.target.checked; tabelle(conds); });
  el.querySelectorAll('tr[data-fix]').forEach((tr) => tr.onclick = () => setze({ q: `"${tr.dataset.fix}"`, tab: 'buchungen' }));
  el.querySelectorAll('tr[data-konto]').forEach((tr) => tr.onclick = () => setze({ konto: S.konto === tr.dataset.konto ? '' : tr.dataset.konto, tab: 'buchungen' }));
}

// ======================================================================= Fixkosten und Abos
// Erkennung: gleicher Empfänger, ähnlicher Betrag (±15 %), regelmäßiger Abstand (monatlich … jährlich).
// „Läuft“ = die letzte Zahlung liegt höchstens anderthalb Rhythmen vor dem Datenstand.
const RHYTHMEN = [
  { name: 'monatlich', tage: 30.4, proJahr: 12, min: 3 },
  { name: 'alle 2 Monate', tage: 61, proJahr: 6, min: 3 },
  { name: 'vierteljährlich', tage: 91.3, proJahr: 4, min: 3 },
  { name: 'halbjährlich', tage: 182.6, proJahr: 2, min: 3 },
  { name: 'jährlich', tage: 365.25, proJahr: 1, min: 3 },
];
const VARIABEL_KAT = new Set(['Essen & Trinken', 'Lifestyle', 'Drogerie']);
const VARIABEL_UKAT = new Set(['Bargeld', 'Tanken', 'Parken', 'Taschengeld', 'Futter & Tierbedarf']);
const tageZwischen = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function fixkostenErkennen() {
  if (D.fix) return D.fix;
  const gruppen = new Map();
  for (const r of D.rows) {
    if (r.art !== 'Ausgabe' || !r.g) continue;
    const key = norm(r.g).replace(/\d{5,}/g, '').replace(/\s+/g, ' ').trim();
    let g = gruppen.get(key);
    if (!g) gruppen.set(key, (g = []));
    g.push(r);
  }
  const out = [];
  for (const rows of gruppen.values()) {
    if (rows.length < 2) continue;
    const buendel = [];
    for (const r of rows) {
      const a = -r.c;
      let best = null;
      for (const b of buendel) {
        const abw = Math.abs(a - b.letzter);
        if (abw <= Math.max(100, b.letzter * 0.15) && (!best || abw < Math.abs(a - best.letzter))) best = b;
      }
      if (best) { best.rows.push(r); best.letzter = a; } else buendel.push({ rows: [r], letzter: a });
    }
    for (const { rows: rs } of buendel) {
      const vertrag = rs.some((r) => r.v);
      // Einkäufe, Restaurants, Bargeld sind höchstens zufällig regelmäßig – außer Finanzguru kennt dafür einen Vertrag
      const z = rs[rs.length - 1];
      if (!vertrag && (VARIABEL_KAT.has(z.kat) || VARIABEL_UKAT.has(z.ukat))) continue;
      if (rs.length < (vertrag ? 2 : 3)) continue;
      const abst = [];
      for (let i = 1; i < rs.length; i++) abst.push(tageZwischen(rs[i - 1].d, rs[i].d));
      const med = median(abst);
      const rh = RHYTHMEN.find((x) => Math.abs(med - x.tage) <= x.tage * 0.16);
      if (!rh || rs.length < (vertrag ? 2 : rh.min)) continue;
      const passend = abst.filter((t) => Math.abs(t - rh.tage) <= rh.tage * 0.25).length / abst.length;
      if (passend < 0.6) continue;
      const erste = rs[0], letzte = rs[rs.length - 1];
      const aktiv = tageZwischen(letzte.d, D.bis) <= rh.tage * 1.5 + 7 && tageZwischen(D.konten[letzte.k].bis, D.bis) <= 45;
      const betrag = -letzte.c;
      out.push({
        name: letzte.g, kat: letzte.kat, ukat: letzte.ukat, k: letzte.k, v: rs.find((r) => r.v)?.v || '', rh, betrag,
        proMonat: (betrag * rh.proJahr) / 12, proJahr: betrag * rh.proJahr, seit: erste.d, zuletzt: letzte.d, n: rs.length,
        erster: -erste.c, aktiv, r: letzte,
      });
    }
  }
  out.sort((a, b) => b.proMonat - a.proMonat);
  return (D.fix = out);
}

let fixBeendete = false;
function fixkostenGefiltert(conds) {
  const t = matcher(conds.filter((c) => c.kind !== 'zeit'));
  const konto = S.konto ? D.kontoIdx.get(S.konto) : -1;
  return fixkostenErkennen().filter((f) => (konto === -1 || f.k === konto) && (!S.kat || f.kat === S.kat) && (!S.ukat || f.ukat === S.ukat)
    && S.art !== 'ein' && t(f.r));
}

function tabFixkosten(conds) {
  const alle = fixkostenGefiltert(conds);
  const aktiv = alle.filter((f) => f.aktiv), beendet = alle.filter((f) => !f.aktiv);
  const liste = fixBeendete ? alle : aktiv;
  const pm = aktiv.reduce((s, f) => s + f.proMonat, 0);
  const zeit = S.jahr || S.monat || conds.some((c) => c.kind === 'zeit') ? ' Der gewählte Zeitraum spielt hier keine Rolle, es zählt der aktuelle Stand.' : '';
  let h = `<div class="fix-kopf"><div><b>${eur0(-pm)}</b> pro Monat · <b>${eur0(-pm * 12)}</b> im Jahr · ${NUM.format(aktiv.length)} laufende Zahlungen</div>
    <div class="muted klein">Automatisch erkannt: gleicher Empfänger, ähnlicher Betrag, regelmäßiger Abstand. Stand ${dde(D.bis)}.${zeit}</div>
    ${beendet.length ? `<label class="chk"><input type="checkbox" id="fix-beendet"${fixBeendete ? ' checked' : ''}> ${NUM.format(beendet.length)} beendete zeigen</label>` : ''}</div>`;
  if (!liste.length) return h + '<div class="leer">Keine regelmäßigen Zahlungen gefunden.</div>';
  const hl = highlightWords(conds);
  const re = hl.length ? new RegExp('(' + hl.map(escRe).join('|') + ')', 'gi') : null;
  const mk = (s) => (re ? esc(s).replace(re, '<mark>$1</mark>') : esc(s));
  h += `<div class="tab-scroll"><table class="t"><thead><tr><th>Empfänger</th><th>Rhythmus</th><th class="r">Betrag</th><th class="r">pro Monat</th>
    <th class="r">pro Jahr</th><th class="kat-sp">seit</th><th>zuletzt</th><th class="r kat-sp" title="Letzter Betrag gegenüber dem ersten">Veränderung</th></tr></thead><tbody>`;
  for (const f of liste) {
    const vd = f.erster ? Math.round(((f.betrag - f.erster) / f.erster) * 100) : 0;
    h += `<tr class="klick${f.aktiv ? '' : ' beendet'}" data-fix="${esc(f.name)}" title="Alle Zahlungen anzeigen">
      <td><div class="wer">${mk(f.name)}</div><div class="zweck">${esc(f.kat)}${f.ukat ? ' · ' + esc(f.ukat) : ''} · ${esc(D.konten[f.k].name)}${f.v ? ' · ' + esc(f.v) : ''}</div></td>
      <td class="klein">${f.rh.name}${f.aktiv ? '' : '<br><small class="muted">beendet</small>'}</td>
      <td class="r">${eur(-f.betrag)}</td><td class="r neg"><b>${eur0(-f.proMonat)}</b></td><td class="r">${eur0(-f.proJahr)}</td>
      <td class="klein kat-sp">${dde(f.seit).slice(3)}</td><td class="klein">${dde(f.zuletzt)}</td>
      <td class="r klein kat-sp ${vd > 0 ? 'neg' : vd < 0 ? 'pos' : 'muted'}">${vd ? (vd > 0 ? '+' : '') + vd + ' %' : '–'}</td></tr>`;
  }
  return h + '</tbody></table></div>';
}

// ======================================================================= Herunterladen
function dateiname(teil) {
  const f = [S.jahr, S.monat && MON[+S.monat - 1], S.konto, S.kat, S.ukat, S.q && S.q.replace(/["|<>]/g, ' ')].filter(Boolean).join(' ');
  const heute = new Date().toISOString().slice(0, 10);
  return `Finanzen ${teil}${f ? ' – ' + f : ''} (${heute})`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function tabelleExport() {
  if (S.tab === 'uebersicht') {
    const p = pivotDaten();
    const spalten = [{ titel: p.unter ? 'Unterkategorie' : 'Kategorie', typ: 'text', breite: 28 }, ...p.cols.map((c) => ({ titel: p.label(c), typ: 'euro', breite: 12 })),
      { titel: 'Summe', typ: 'euro', breite: 14 }, { titel: `Ø ${p.jahr ? 'Monat' : 'Jahr'}`, typ: 'euro', breite: 12 },
      ...(p.vj ? [{ titel: V.label, typ: 'euro', breite: 16 }, { titel: 'Veränderung', typ: 'euro', breite: 13 }] : [])];
    const n = p.cols.length;
    const vjw = (jetzt, vorher) => (p.vj ? [vorher / 100, (jetzt - vorher) / 100] : []);
    const zeilen = [...p.rows.map((r) => [r.key, ...r.v.map((c) => c / 100), r.sum / 100, Math.round(r.sum / n) / 100, ...vjw(r.sum, p.vj?.get(r.key) || 0)]),
      ['Ergebnis', ...p.sums.map((c) => c / 100), p.total / 100, Math.round(p.total / n) / 100, ...vjw(p.total, p.vjTotal)]];
    return { name: dateiname(p.jahr ? `Kategorien ${p.jahr}` : 'Kategorien'), blatt: 'Kategorien', spalten, zeilen };
  }
  if (S.tab === 'fix') {
    const liste = fixkostenGefiltert(parse(S.q)).filter((f) => fixBeendete || f.aktiv);
    const spalten = [{ titel: 'Empfänger', typ: 'text', breite: 32 }, { titel: 'Kategorie', typ: 'text', breite: 16 }, { titel: 'Unterkategorie', typ: 'text', breite: 20 },
      { titel: 'Konto', typ: 'text', breite: 20 }, { titel: 'Rhythmus', typ: 'text', breite: 14 }, { titel: 'Betrag', typ: 'euro' }, { titel: 'pro Monat', typ: 'euro' },
      { titel: 'pro Jahr', typ: 'euro' }, { titel: 'seit', typ: 'datum' }, { titel: 'zuletzt', typ: 'datum' }, { titel: 'Zahlungen', typ: 'zahl', breite: 10 },
      { titel: 'erster Betrag', typ: 'euro' }, { titel: 'Status', typ: 'text', breite: 10 }, { titel: 'Vertrag', typ: 'text', breite: 20 }];
    const r2 = (c) => Math.round(c) / 100;
    const zeilen = liste.map((f) => [f.name, f.kat, f.ukat, D.konten[f.k].name, f.rh.name, r2(-f.betrag), r2(-f.proMonat), r2(-f.proJahr), f.seit, f.zuletzt, f.n,
      r2(-f.erster), f.aktiv ? 'läuft' : 'beendet', f.v]);
    return { name: dateiname('Fixkosten'), blatt: 'Fixkosten', spalten, zeilen };
  }
  if (S.tab === 'konten') {
    const spalten = [{ titel: 'Konto', typ: 'text', breite: 28 }, { titel: 'Buchungen', typ: 'zahl', breite: 11 }, { titel: 'Einnahmen', typ: 'euro' }, { titel: 'Ausgaben', typ: 'euro' },
      { titel: 'Kontostand', typ: 'euro' }, { titel: 'Kontostand am', typ: 'datum' }, { titel: 'Daten ab', typ: 'datum' }, { titel: 'Daten bis', typ: 'datum' }, { titel: 'Lückenlos seit Eröffnung', typ: 'text', breite: 22 }];
    const zeilen = kontenDaten().map((x) => [x.k.name, x.n, x.ein / 100, x.aus / 100, x.k.saldo ?? '', x.k.saldoAm || '', x.k.von, x.k.bis, x.k.vollstaendig ? 'ja' : 'nein']);
    return { name: dateiname('Konten'), blatt: 'Konten', spalten, zeilen };
  }
  const spalten = [{ titel: 'Datum', typ: 'datum', breite: 11 }, { titel: 'Konto', typ: 'text', breite: 20 }, { titel: 'Empfänger/Auftraggeber', typ: 'text', breite: 30 },
    { titel: 'Verwendungszweck', typ: 'text', breite: 50 }, { titel: 'Kategorie', typ: 'text', breite: 16 }, { titel: 'Unterkategorie', typ: 'text', breite: 20 },
    { titel: 'Art', typ: 'text', breite: 10 }, { titel: 'Betrag', typ: 'euro', breite: 13 }, { titel: 'Vertrag', typ: 'text' }, { titel: 'Tags', typ: 'text' }, { titel: 'Notiz', typ: 'text', breite: 24 }];
  const zeilen = sortiert().map((r) => [r.d, D.konten[r.k].name, r.g, r.z, r.kat, r.ukat, r.art, r.c / 100, r.v, r.t, r.n]);
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
  const titel = (id === 'c-verlauf' ? $('#t-verlauf') : $('#t-kat')).textContent;
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
// „Zurück“: frühere Filterzustände; beim Tippen zählt ein ganzes Suchwort als ein Schritt
const schritte = [];
let tippt = false;
const ZUSTAND = ['q', 'jahr', 'monat', 'konto', 'kat', 'ukat', 'art', 'umb', 'tab'];
const zustand = (x) => JSON.stringify(ZUSTAND.map((k) => x[k]));

function setze(p, { tippen = false } = {}) {
  const vorher = { ...S };
  Object.assign(S, p);
  if ('kat' in p && !('ukat' in p)) S.ukat = '';
  if (zustand(S) !== zustand(vorher) && !(tippen && tippt)) {
    schritte.push({ s: vorher, tab: 'tab' in p && p.tab !== vorher.tab });
    if (schritte.length > 60) schritte.shift();
  }
  tippt = tippen;
  limit = 150; offen.clear();
  aktualisieren();
}

function zurueck() {
  const x = schritte.pop();
  if (!x) return;
  S = { ...x.s, tab: x.tab ? x.s.tab : S.tab, sort: S.sort, dir: S.dir };
  tippt = false; limit = 150; offen.clear();
  aktualisieren();
}

function aktualisieren() {
  if (!D) return;
  const conds = filtern();
  hashSchreiben();
  filterZeigen(conds);
  kennzahlen(conds);
  verlauf();
  kategorien();
  tabelle(conds);
}

function hashSchreiben() {
  const p = new URLSearchParams();
  for (const k of ['q', 'jahr', 'monat', 'konto', 'kat', 'ukat']) if (S[k]) p.set(k, S[k]);
  if (S.art !== 'alle') p.set('art', S.art);
  if (S.umb) p.set('umb', '1');
  if (S.tab !== 'buchungen') p.set('tab', S.tab);
  const h = p.toString();
  history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
}
function hashLesen() {
  const p = new URLSearchParams(location.hash.slice(1));
  S = { ...S0 };
  for (const k of ['q', 'jahr', 'monat', 'konto', 'kat', 'ukat']) if (p.get(k)) S[k] = p.get(k);
  if (['aus', 'ein'].includes(p.get('art'))) S.art = p.get('art');
  S.umb = p.get('umb') === '1';
  if (['uebersicht', 'konten', 'fix'].includes(p.get('tab'))) S.tab = p.get('tab');
}

function standZeigen() {
  const j = D.j;
  $('#stand').textContent = `${NUM.format(D.rows.length)} Buchungen · ${dde(D.von)} – ${dde(D.bis)}`;
  const herkunft = { drive: 'aus Google Drive', datei: `aus der Datei ${quelle.name}`, lokal: 'lokale Testdaten' }[quelle.quelle] || '';
  const erstellt = j.erstellt ? `${dde(j.erstellt.slice(0, 10))}, ${j.erstellt.slice(11, 16)} Uhr` : '';
  $('#fuss').textContent = `Daten ${herkunft}, erstellt am ${erstellt}. Neue Daten: in „10 Finanzen“ aktualisieren.py starten, dann hier ↻.`;
  $('#menu-quelle').textContent = `Aktuell: ${NUM.format(D.rows.length)} Buchungen ${herkunft}, erstellt am ${erstellt}.`;
  $('#btn-neu').hidden = quelle.quelle !== 'drive';
}

function anzeigen(v) {
  const j = Q.pruefen(v.text);
  quelle = v;
  D = aufbereiten(j);
  chatDaten(D);
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
}

function themeSetzen(t) {
  if (t) { try { t === 'auto' ? localStorage.removeItem('fd.theme') : localStorage.setItem('fd.theme', t); } catch {} }
  let cur = 'auto';
  try { cur = localStorage.getItem('fd.theme') || 'auto'; } catch {}
  if (cur === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = cur;
  document.querySelectorAll('#m-theme button').forEach((b) => b.classList.toggle('an', b.dataset.v === cur));
  if (D) { verlauf(); kategorien(); }
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
    if (e.altKey && e.key === 'ArrowLeft' && schritte.length) { e.preventDefault(); zurueck(); return; }
    if ((e.key === '/' || (e.key === 'k' && (e.ctrlKey || e.metaKey))) && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      e.preventDefault(); $('#q').focus(); $('#q').select();
    }
  });
  $('#q-hilfe').onclick = () => $('#dlg-hilfe').showModal();
  $('#beispiele').querySelectorAll('button').forEach((b) => b.onclick = () => { $('#dlg-hilfe').close(); setze({ q: b.textContent }); });
  $('#f-jahr').onchange = (e) => setze({ jahr: e.target.value });
  $('#f-monat').onchange = (e) => setze({ monat: e.target.value });
  $('#f-konto').onchange = (e) => setze({ konto: e.target.value });
  $('#f-kat').onchange = (e) => setze({ kat: e.target.value, ukat: '' });
  $('#f-umb').onchange = (e) => setze({ umb: e.target.checked });
  document.querySelectorAll('#f-art button').forEach((b) => b.onclick = () => setze({ art: b.dataset.v }));
  $('#f-reset').onclick = () => setze({ ...S0, tab: S.tab, sort: S.sort, dir: S.dir });
  $('#f-zurueck').onclick = zurueck;
  document.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => { S.tab = b.dataset.tab; hashSchreiben(); tabelle(parse(S.q)); });
  $('#dl-xlsx').onclick = () => exportieren('xlsx');
  $('#dl-csv').onclick = () => exportieren('csv');
  document.querySelectorAll('[data-bild]').forEach((b) => b.onclick = () => bildSpeichern(b.dataset.bild));

  $('#btn-menu').onclick = () => $('#dlg-menu').showModal();
  $('#btn-neu').onclick = () => driveHolen(true).catch((e) => toast(e.message));
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
    startZeigen();
  };
  $('#start-drive').onclick = async () => {
    try { await Q.anmelden(); const v = await Q.driveLaden(null); anzeigen(v); }
    catch (e) { startZeigen(e.message); }
  };
  $('#start-datei').onclick = async () => { try { anzeigen(await Q.dateiWaehlen()); } catch (e) { startZeigen(e.message); } };
  window.addEventListener('hashchange', () => { if (D) { hashLesen(); aktualisieren(); } });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => themeSetzen());
}

async function start() {
  events();
  chatStart({ setze: (p) => setze(p), fixkosten: () => fixkostenErkennen() });
  themeSetzen();
  let v = null;
  if (LOKAL) v = await Q.lokalLaden().catch(() => null);
  if (!v) v = await Q.cacheLesen();
  if (v) {
    try { anzeigen(v); } catch (e) { return startZeigen(e.message); }
    if (v.quelle === 'drive') driveHolen(false).catch(() => {});
  } else startZeigen();
  if ('serviceWorker' in navigator && !LOKAL) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
