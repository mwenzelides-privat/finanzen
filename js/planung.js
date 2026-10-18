// Planung: ehrlichere Prognose (Plan-Gehalt aus den Abrechnungen, Saisonprofil der Lebenshaltung) und dein
// Ausgabenrahmen für die frei gestaltbaren Kategorien. Keine Imports – alle Helfer kommen über H aus app.js.
// Geld immer in Cent. Die Rahmenwerte trägst du selbst ein; sie bleiben nur in diesem Browser (localStorage 'fd.rahmen').

// ======================================================================= Prognose
// Plan-Gehalt eines Monats (Cent): nur, wenn es für den Monat ausschließlich eine Plan-Zeile gibt (noch keine geprüfte
// Abrechnung) – sonst null, dann rechnet die Prognose mit dem aktuellen Gehalt
export function planGehalt(H, k) {
  const l = (H.D().j.gehalt?.monate || []).filter((z) => z.m === k);
  if (!l.length || l.some((z) => z.quelle !== 'plan')) return null;
  const a = l[0].auszahlung;
  return typeof a === 'number' && Number.isFinite(a) ? Math.round(a * 100) : null;
}

// Saisonprofil der Lebenshaltung: je Kalendermonat ein Faktor (Σ = 12). Regel: bis zu 5 letzte volle Kalenderjahre
// bis zum letzten abgeschlossenen Monat; je Jahr Monat ÷ Jahresmittel, davon der Median über die Jahre, normiert.
// Lebenshaltung wie lebenshaltung(): Ausgaben ohne Verträge, ohne gemeinsame und Kinderkonten. Unter 3 Jahren: alle 1.
export function saison(H) {
  const D = H.D();
  if (D._saison) return D._saison;
  const bis = H.abgeschlosseneMonate().at(-1) || '', von = D.von.slice(0, 7), fx = H.fixIds(), mon = new Map();
  for (const r of D.rows) {
    if (r.art !== 'Ausgabe' || fx.has(r.i) || H.istGemeinsam(r.k) || H.fremd(D.konten[r.k])) continue;
    const k = r.d.slice(0, 7);
    mon.set(k, (mon.get(k) || 0) - r.c);
  }
  const kandidaten = [];
  for (let y = +bis.slice(0, 4); bis && kandidaten.length < 5 && `${y}-01` >= von; y--) if (`${y}-12` <= bis) kandidaten.unshift(y);
  const jahre = [], ratio = [];
  for (const y of kandidaten) {
    const w = Array.from({ length: 12 }, (_, i) => mon.get(H.mkey(y, i + 1)) || 0), mittel = w.reduce((t, x) => t + x, 0) / 12;
    if (mittel <= 0) continue;   // Jahr ohne Lebenshaltung: kein Profil daraus
    jahre.push(y); ratio.push(w.map((x) => x / mittel));
  }
  if (jahre.length < 3) return (D._saison = { f: Array(12).fill(1), jahre, ok: false });
  const roh = Array.from({ length: 12 }, (_, i) => H.median(ratio.map((r) => r[i]))), s = roh.reduce((t, x) => t + x, 0);
  return (D._saison = { f: s > 0 ? roh.map((x) => (x * 12) / s) : Array(12).fill(1), jahre, ok: s > 0 });
}

// „2021–2025“ bei lückenlosen Jahren, sonst „2019, 2021, 2022“
const jahrText = (j) => (j.length > 1 && j.at(-1) - j[0] === j.length - 1 ? `${j[0]}–${j.at(-1)}` : j.join(', '));

// Erklärung für Grafiken mit Prognose – sagt ehrlich, was davon wirklich eingeflossen ist
export function prognoseText(H) {
  const D = H.D(), s = saison(H), jetzt = D.bis.slice(0, 7);
  const plan = (D.j.gehalt?.monate || []).some((z) => z.m > jetzt && z.quelle === 'plan');
  return `berechnet: ${plan ? 'Plan-Gehalt aus den Abrechnungen' : 'aktuelles Gehalt'} + ${s.ok ? `Saisonprofil (Median ${jahrText(s.jahre)})` : 'Lebenshaltung ohne Saisonprofil (dafür fehlen 3 volle Jahre)'}`;
}

// ======================================================================= Ausgabenrahmen
const rahmenLesen = () => {
  try { const r = JSON.parse(localStorage.getItem('fd.rahmen')); if (r && typeof r === 'object' && !Array.isArray(r)) return r; } catch {}
  return {};
};
const rahmenSpeichern = (r) => { try { localStorage.setItem('fd.rahmen', JSON.stringify(r)); } catch {} };
// Eingabe „340“, „1.250“ oder „89,50“ → Cent; leer = 0 (kein Rahmen); unlesbar = null
function euroCent(t) {
  const s = String(t).replace(/[\s€]/g, '');
  if (!s) return 0;
  const n = Number(s.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : null;
}
const euroText = (c) => (c > 0 ? String(c / 100).replace('.', ',') : '');

// Ausgaben je Kategorie: die letzten 12 abgeschlossenen Monate (für „frei gestaltbar“ und den Vorschlag) und der
// laufende Monat (Monat des Datenstands). Immer alle eigenen Konten – die Kontoauswahl oben gilt hier nicht.
// Frei gestaltbar wie im Block der Kategorien: weniger als die Hälfte der Ausgaben sind Verträge.
function rahmenDaten(H) {
  const D = H.D();
  if (D._rahmen) return D._rahmen;
  const L = H.lebenshaltung(), set = new Set(L.monate), n = L.monate.length, fx = H.fixIds();
  const k = D.bis.slice(0, 7), ende = H.monatsletzter(`${k}-01`), g = new Map();
  const zu = (kat) => g.get(kat) || g.set(kat, { kat, c: 0, fest: 0, jetzt: 0 }).get(kat);
  for (const r of D.rows) {
    if (r.art !== 'Ausgabe' || H.istGemeinsam(r.k) || H.fremd(D.konten[r.k])) continue;
    const m = r.d.slice(0, 7), kat = r.kat || 'Sonstiges';
    if (set.has(m)) { const x = zu(kat); x.c -= r.c; if (fx.has(r.i)) x.fest -= r.c; }
    if (m === k && !fx.has(r.i)) zu(kat).jetzt -= r.c;   // Erstattungen (positive Beträge) mindern
  }
  const frei = [...g.values()].filter((x) => x.c > 0 && x.fest < x.c * 0.5)
    .map((x) => ({ ...x, vorschlag: n ? Math.round((x.c - x.fest) / n / 1000) * 1000 : 0 }))   // Ø ohne Verträge, auf 10 € gerundet
    .sort((a, b) => b.c - b.fest - (a.c - a.fest));
  return (D._rahmen = { k, tag: +D.bis.slice(8, 10), tage: +ende.slice(8, 10), n, frei, alle: g });
}

// Zeilen mit deinen Rahmen; Summen nur über frei gestaltbare Kategorien mit Rahmen (Rahmen 0 = kein Rahmen)
function rahmenStand(H) {
  const R = rahmenDaten(H), rw = rahmenLesen(), wert = (kat) => (Number.isFinite(rw[kat]) && rw[kat] > 0 ? Math.round(rw[kat]) : 0);
  const z = R.frei.map((x) => ({ kat: x.kat, aus: x.jetzt, vorschlag: x.vorschlag, rahmen: wert(x.kat), frei: true }));
  // gespeicherter Rahmen einer Kategorie, die nicht mehr frei gestaltbar ist: bleibt stehen, mit Hinweis, ohne Summe
  for (const kat of Object.keys(rw)) {
    if (!wert(kat) || R.frei.some((x) => x.kat === kat)) continue;
    const x = R.alle.get(kat);
    z.push({ kat, aus: x?.jetzt || 0, vorschlag: 0, rahmen: wert(kat), frei: false, warum: x && x.c > 0 ? 'fest' : 'leer' });
  }
  const mit = z.filter((x) => x.frei && x.rahmen);
  const sum = { n: mit.length, rahmen: mit.reduce((t, x) => t + x.rahmen, 0), aus: mit.reduce((t, x) => t + x.aus, 0),
    ohne: z.filter((x) => x.frei && !x.rahmen).reduce((t, x) => t + x.aus, 0) };
  return { R, z, sum };
}

// Tempo-Balken: gefüllt = ausgegeben ÷ Rahmen, Strich = Tag ÷ Tage im Monat; über dem Rahmen rot
const tempo = (aus, rahmen, R) => {
  const p = Math.max(0, Math.min(100, (aus / rahmen) * 100)), heute = (R.tag / R.tage) * 100;
  return `<span class="pl-b${aus > rahmen ? ' ueber' : ''}" title="${Math.round((aus / rahmen) * 100)} % des Rahmens ausgegeben · Tag ${R.tag} von ${R.tage} (${Math.round(heute)} % des Monats)"><i style="width:${p}%"></i><b style="left:${heute}%"></b></span>`;
};

// Karte im Reiter Kategorien (Ansicht Ausgaben), unter den Blöcken
export function rahmenKarte(H) {
  const { esc, eur0, schoen } = H, { R, z, sum } = rahmenStand(H);
  const monatJ = `${H.MONAT[+R.k.slice(5) - 1]} ${R.k.slice(0, 4)}`, nM = R.n === 12 ? '12 Monate' : `${R.n} Monate`;
  const erkl = `Gilt immer für ${monatJ} und alle deine eigenen Konten – unabhängig von Zeitraum und Kontoauswahl oben. Gezählt werden Ausgaben ohne Verträge; Erstattungen mindern sie. Den Rahmen legst du selbst fest. Strich im Balken = heute (Tag ${R.tag} von ${R.tage}).`;
  if (!z.length) return H.karte5(`Dein Ausgabenrahmen – ${monatJ}`, erkl, '<div class="leer klein">In den letzten 12 Monaten gab es keine frei gestaltbaren Ausgaben.</div>', 'pl-karte', '', 'pl-rahmen');
  const ziel = (kat) => H.zuBuchungen({ konto: '', art: 'aus', kat, nf: '1', ...H.monatZiel(R.k) });
  const rest = (c) => `<b class="pl-r ${c < 0 ? 'neg' : ''}">${eur0(c)}</b>`;
  const zeile = (x) => {
    const hinweis = x.frei ? '' : `<small class="pl-hinweis">${x.warum === 'fest' ? 'zählt jetzt zu den überwiegend festen Kosten' : 'in den letzten 12 Monaten keine Ausgaben'} – Rahmen bleibt gespeichert, zählt nicht in der Summe</small>`;
    const vs = x.vorschlag > 0 ? `<small>Vorschlag (Ø ${nM}): ${eur0(x.vorschlag)}${x.rahmen !== x.vorschlag ? ` · <button class="pl-knopf" data-pl-vs="${esc(x.kat)}" data-pl-c="${x.vorschlag}">Vorschlag übernehmen</button>` : ''}</small>` : '';
    return `<div class="pl-z${x.frei ? '' : ' pl-alt'}">
      <span class="pl-n">${H.zl(esc(schoen(x.kat)), ziel(x.kat))}${vs}${hinweis}</span>
      <label class="pl-e"><input type="text" inputmode="decimal" autocomplete="off" data-pl-kat="${esc(x.kat)}" value="${euroText(x.rahmen)}" placeholder="kein" aria-label="Rahmen für ${esc(schoen(x.kat))} in Euro"><span>€</span></label>
      ${x.rahmen ? tempo(x.aus, x.rahmen, R) : '<span class="pl-b pl-ohne muted">kein Rahmen</span>'}
      <b class="pl-w${x.aus < 0 ? ' pos' : ''}">${eur0(x.aus)}</b>${x.rahmen ? rest(x.rahmen - x.aus) : '<span class="pl-r muted">–</span>'}</div>`;
  };
  const kopf = `<div class="pl-z pl-kopf"><span>Kategorie</span><span>Rahmen</span><span>Tempo</span><span>ausgegeben</span><span>noch frei</span></div>`;
  const summe = sum.n ? `<div class="pl-z pl-summe"><span class="pl-n"><b>Summe</b><small>${sum.n} ${sum.n === 1 ? 'Kategorie' : 'Kategorien'} mit Rahmen${sum.ohne > 0 ? ` · ohne Rahmen ${eur0(sum.ohne)} ausgegeben` : ''}</small></span>
      <b class="pl-e">${eur0(sum.rahmen)}</b>${tempo(sum.aus, sum.rahmen, R)}<b class="pl-w">${eur0(sum.aus)}</b>${rest(sum.rahmen - sum.aus)}</div>`
    : `<div class="pl-leer muted klein">Noch kein Rahmen festgelegt. Trag einen Betrag ein oder übernimm die Vorschläge – sie sind dein Ø der letzten ${nM} ohne Verträge, auf 10 € gerundet.</div>`;
  const alle = z.some((x) => x.frei && x.vorschlag > 0 && x.rahmen !== x.vorschlag) ? `<button class="btn sm" data-pl-alle title="Setzt bei allen frei gestaltbaren Kategorien den Vorschlag (Ø ${nM}) ein">Alle Vorschläge übernehmen</button>` : '';
  return H.karte5(`Dein Ausgabenrahmen – ${monatJ}`, erkl, `<div class="pl-liste">${kopf}${summe}${z.map(zeile).join('')}</div>`, 'pl-karte', alle, 'pl-rahmen');
}

// Zeile für die Karte „<Monat> bisher“ der Übersicht (in <dl class="s5-dl">)
export function freiZeile(H) {
  const { sum } = rahmenStand(H), ziel = { tab: 'uebersicht', kart: 'aus', _springe: '#pl-rahmen' };
  if (!sum.n) return `<div class="klick"${H.geh(ziel)} title="Anklicken: Rahmen für frei gestaltbare Ausgaben festlegen"><dt>Frei gestaltbare Ausgaben</dt><dd><span class="pl-link">Ausgabenrahmen festlegen →</span></dd></div>`;
  const rest = sum.rahmen - sum.aus;
  return `<div class="klick"${H.geh(ziel)} title="Anklicken: dein Ausgabenrahmen je Kategorie"><dt>Rahmen: noch frei</dt><dd class="${rest < 0 ? 'neg' : ''}">${H.eur0(rest)} von ${H.eur0(sum.rahmen)}</dd></div>`;
}

// Eingaben der Rahmen-Karte; el = Seite oder die Karte selbst. Speichern beim Verlassen des Feldes oder mit Enter.
export function rahmenBinden(el, H) {
  const k = el.id === 'pl-rahmen' ? el : el.querySelector('#pl-rahmen');
  if (!k) return;
  H.gehBinden(k);
  const aendern = (f) => { const r = rahmenLesen(); f(r); rahmenSpeichern(r); H.neuZeichnen(); };
  k.querySelectorAll('[data-pl-kat]').forEach((i) => {
    const vorher = i.value;
    i.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); i.blur(); } };
    i.onchange = () => {
      const c = euroCent(i.value);
      if (c == null) { i.value = vorher; return; }   // unlesbar: alter Wert bleibt
      aendern((r) => { if (c > 0) r[i.dataset.plKat] = c; else delete r[i.dataset.plKat]; });
    };
  });
  k.querySelectorAll('[data-pl-vs]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); aendern((r) => { r[b.dataset.plVs] = +b.dataset.plC; }); });
  const alle = k.querySelector('[data-pl-alle]');
  if (alle) alle.onclick = () => aendern((r) => { for (const x of rahmenDaten(H).frei) if (x.vorschlag > 0) r[x.kat] = x.vorschlag; });
}
