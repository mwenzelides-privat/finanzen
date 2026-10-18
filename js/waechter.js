// Wächter „Was auffällt“ (Übersicht) und „Neu seit deinem letzten Besuch“ (Übersicht und Buchungen).
// Neu: Die App merkt sich je Gerät, welche Buchungen du schon gesehen hast – als kurzer Prüfwert (FNV-1a, 32 Bit) aus
// Datum|Konto|Cent|Gegenseite#n (n zählt gleiche Buchungen durch, damit echte Doppelbuchungen beide als neu gelten).
// Wächter: feste Regeln, nichts geschätzt – (1) doppelt abgebucht (mit Erstattung danach), (2) neue Preisstufe eines
// laufenden Vertrags, (3) neue Lastschrift-Gläubiger. Was du mit „passt so“ oder „erledigt“ abhakst, bleibt abgehakt.
// Gespeichert in der IndexedDB unter „waechter“: { gesehen: { seit, h: [Prüfwerte] }, ok: { Schlüssel: { s, zeit } } }.
// Alle Helfer kommen als H aus app.js (keine Imports); Kinder- und gemeinsame Konten zählen nie in Summen.

const KV = 'waechter';
const FREMD_ART = new Set(['Kinderkonto', 'Gemeinschaftskonto']);
const TAGE = 90;             // Zeitraum der Prüfungen
const OFFEN_TAGE = 365;      // nicht (voll) erstattete Doppelbuchungen bleiben so lange stehen, bis du sie abhakst
const KARTE_N = 4;           // Treffer direkt in der Karte, der Rest unter „+ N weitere“
const NEU_LISTE = 5;         // neue Buchungen als Zeilen in der Karte
const NEU_VIELE = 60;        // darüber (lange Pause): nur Zahl und Link, keine Liste
const MANDAT_VERFALL = 36;   // Monate: ein SEPA-Mandat verfällt, wenn es so lange nicht genutzt wurde

let H = null;                // Helfer aus app.js
let W = null;                // gespeicherter Stand
let GES = null;              // Set der gesehenen Prüfwerte (null = Neu-Funktion aus oder noch nicht geladen)
let aus = false;             // Gerätespeicher nicht verfügbar
let erstmals = false;        // gerade zum ersten Mal alles als gesehen gespeichert
let C = null;                // Cache je Datenstand: { D, h: Prüfwerte je Buchung, t: Treffer, je: Buchung → Treffer }

const heute = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const tage = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };
const ddeKurz = (iso) => `${+iso.slice(8, 10)}.${+iso.slice(5, 7)}.`;
// eigene Konten: nicht die der Kinder, nicht die gemeinsamen; Umbuchungen zählen nirgends
const eigen = (r, D) => !H.fremd(D.konten[r.k]) && !H.istGemeinsam(r.k) && !FREMD_ART.has(r.art) && r.art !== 'Umbuchung';
const zweckNorm = (z) => H.norm(z).replace(/\s+/g, ' ').trim();
// Referenz im Verwendungszweck: Wort aus Buchstaben und Ziffern (Bindestriche/Punkte zählen nicht), mindestens 6 Zeichen,
// z. B. Bestellnummer „VMSK-BRRR-ZPNC“ oder „20260130-BY111“ – reine Wörter und reine Zahlen sind keine Referenz
function referenzen(z) {
  const out = new Set();
  for (const w of String(z || '').split(/[\s/:;,()|]+/)) {
    const t = w.replace(/[-.]/g, '').toUpperCase();
    if (t.length >= 6 && /^[A-Z0-9]+$/.test(t) && (/\d/.test(t) && /[A-Z]/.test(t) || /^[A-Z0-9]{3,}(-[A-Z0-9]{3,})+$/.test(w.toUpperCase()))) out.add(t);
  }
  return out;
}

// ---------------------------------------------------------------- Prüfwerte je Buchung (je Datenstand einmal)
function cache() {
  const D = H?.D();
  if (!D) return null;
  if (C?.D === D) return C;
  const n = new Map(), h = [];
  for (const r of D.rows) {
    const k = `${r.d}|${D.konten[r.k].name}|${r.c}|${H.norm(r.g)}`, i = (n.get(k) || 0) + 1;
    n.set(k, i);
    h[r.i] = fnv(`${k}#${i}`);
  }
  return (C = { D, h, t: null, je: null });
}

// ---------------------------------------------------------------- Laden und Speichern
export async function waechterLaden(h) {
  H = h; erstmals = false; aus = false; GES = null;
  const c = cache();
  if (!c) return;
  let v = null;
  try { v = await H.kvLesen(KV); } catch { v = null; }
  W = v && typeof v === 'object' ? v : { ok: {} };
  if (!W.ok || typeof W.ok !== 'object') W.ok = {};
  if (Array.isArray(W.gesehen?.h)) { GES = new Set(W.gesehen.h); return; }
  // erster Besuch: alles, was jetzt da ist, gilt als gesehen
  W.gesehen = { seit: heute(), h: [...new Set(c.h)] };
  try { await H.kvSchreiben(KV, W); GES = new Set(W.gesehen.h); erstmals = true; } catch { aus = true; W.gesehen = null; }
}
async function sichern() {
  if (GES) W.gesehen = { seit: W.gesehen?.seit || heute(), h: [...GES] };
  try { await H.kvSchreiben(KV, W); } catch { H.toast('Konnte auf diesem Gerät nicht gespeichert werden.'); }
}
function gesehen(hs) {
  if (!GES) return;
  for (const x of hs) GES.add(x);
  sichern();
  H.neuZeichnen();
}
function alleGesehen() {
  const c = cache();
  if (!c || !GES) return;
  GES = new Set(c.h);
  W.gesehen = { seit: heute(), h: [...GES] };
  sichern();
  H.toast('Alle Buchungen als gesehen markiert.');
  H.neuZeichnen();
}

// ---------------------------------------------------------------- Neu seit dem letzten Besuch
export function istNeu(r) {
  const c = GES && cache();
  return !!c && !GES.has(c.h[r.i]);
}
function neuStand() {
  const c = cache(), D = c.D;
  const rows = D.rows.filter(istNeu).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.c - b.c));
  let minus = 0, plus = 0, nEigen = 0;
  for (const r of rows) {
    if (!eigen(r, D)) continue;
    nEigen++;
    if (r.c < 0) minus -= r.c; else plus += r.c;
  }
  return { rows, minus, plus, nEigen, seit: W?.gesehen?.seit || heute() };
}
const summenText = (s) => `<span class="neg">−${H.eur0(s.minus)}</span> / <span class="pos">+${H.eur0(s.plus)}</span>`;
function neuZeile(r) {
  const D = H.D(), c = cache();
  return `<div class="wa-nz">
    <span class="wa-nz-d">${ddeKurz(r.d)}</span>
    <span class="wa-nz-n"><b>${H.esc(r.g || r.z || '–')}</b><small>${H.esc(r.kat || 'ohne Kategorie')}${r.ukat ? ` · ${H.esc(r.ukat)}` : ''}${eigen(r, D) ? '' : ` · ${H.esc(D.konten[r.k].name)}`}</small></span>
    <b class="wa-nz-b ${r.c < 0 ? 'neg' : r.c > 0 ? 'pos' : ''}">${H.eur(r.c)}</b>
    <span class="wa-nz-k"><button class="btn sm" data-wneu="${c.h[r.i]}" title="Als gesehen markieren">passt</button><button class="btn sm"${H.geh({ tab: 'uebersicht', kart: 'pruefen', wahl: H.gruppenSchluessel(r) })}>Kategorie ändern →</button></span>
  </div>`;
}
function neuTeil() {
  if (aus) return `<p class="wa-hinweis">Dieses Gerät kann sich gerade nichts merken (z. B. privates Fenster) – „Neu seit deinem letzten Besuch“ ist deshalb aus.</p>`;
  if (!GES) return '<p class="muted klein">Wird geladen …</p>';
  const s = neuStand(), n = s.rows.length;
  if (erstmals && !n) return '<p class="wa-hinweis">Ab jetzt merkt sich die App, was du schon gesehen hast. Neue Buchungen erscheinen nach dem nächsten Einlesen hier.</p>';
  if (!n) return `<p class="wa-ruhig">Keine neuen Buchungen seit ${H.dde(s.seit)}.</p>`;
  const kopf = `<p class="wa-neu-satz">${H.zl(`<b>${n === 1 ? '1 neue Buchung' : `${n} neue Buchungen`}</b> seit ${H.dde(s.seit)}`, H.zuBuchungen({ neu: '1', konto: '' }))} · ${summenText(s)}</p>
    ${n > s.nEigen ? `<p class="muted klein">${n - s.nEigen} davon auf Kinder- oder gemeinsamen Konten bzw. Umbuchungen – gezählt, aber nicht summiert.</p>` : ''}`;
  const liste = n > NEU_VIELE ? `<p class="muted klein">Nach längerer Pause sind es viele – die Liste steht in den ${H.zl('Buchungen', H.zuBuchungen({ neu: '1', konto: '' }))}.</p>`
    : `<div class="wa-nl">${s.rows.slice(0, NEU_LISTE).map(neuZeile).join('')}</div>${n > NEU_LISTE ? `<p class="klein">${H.zl(`alle ${n} neuen Buchungen →`, H.zuBuchungen({ neu: '1', konto: '' }))}</p>` : ''}`;
  return `${kopf}${liste}<div class="wa-knoepfe"><button class="btn sm" data-walle>Alle als gesehen markieren</button></div>`;
}

// Leiste über der Buchungsliste, solange der Filter „neu“ aktiv ist
export function neuLeiste(h) {
  H = h || H;
  if (!H || H.S().neu !== '1') return '';
  if (aus) return `<div class="wa-leiste"><span>Dieses Gerät kann sich nicht merken, was du gesehen hast – der Filter „neu“ wirkt hier nicht.</span><button class="btn sm" data-wnf>Filter aufheben</button></div>`;
  if (!GES) return '';
  const s = neuStand(), n = s.rows.length;
  const versteckt = s.rows.filter((r) => r.art === 'Umbuchung' || FREMD_ART.has(r.art)).length;
  return `<div class="wa-leiste"><span><b>${n ? (n === 1 ? '1 neue Buchung' : `${n} neue Buchungen`) : 'Keine neuen Buchungen'}</b> seit ${H.dde(s.seit)}${n ? ` · ${summenText(s)}` : ''}${versteckt && !H.S().umb ? `<small>${versteckt} davon Umbuchungen oder Buchungen der Kinder-/gemeinsamen Konten – nur mit dem passenden Filter sichtbar</small>` : ''}</span>
    <span class="wa-knoepfe">${n ? '<button class="btn sm" data-walle>Alle als gesehen markieren</button>' : ''}<button class="btn sm" data-wnf>Filter aufheben</button></span></div>`;
}

// ---------------------------------------------------------------- Wächter: feste Regeln
const buchZiel = (g, von, bis = von) => H.zuBuchungen({ q: g ? `"${g}"` : '', zr: `${von.slice(0, 7)}_${bis.slice(0, 7)}`, konto: '' });

// (1) Doppelt abgebucht: gleiche Gegenseite, gleicher Betrag, höchstens 3 Tage auseinander, kein fester Vertrag, und
// gleicher Verwendungszweck (mit Ziffern, also eine Bestellung o. Ä. – nicht „VISA Debitkartenumsatz“) oder gemeinsame
// Referenz. Danach: Gutschriften derselben Gegenseite in den 30 Tagen nach der zweiten Buchung.
function doppelt(D, fix) {
  const von90 = H.plusTage(D.bis, -TAGE), von = H.plusTage(D.bis, -OFFEN_TAGE - 40);
  const gr = new Map(), gut = new Map();
  for (const r of D.rows) {
    if (r.d < von || !eigen(r, D) || !r.g) continue;
    const g = H.norm(r.g);
    if (r.c > 0) { if (!gut.has(g)) gut.set(g, []); gut.get(g).push(r); continue; }
    if (r.c === 0 || fix.has(r.i)) continue;
    const k = `${g}|${r.c}`;
    if (!gr.has(k)) gr.set(k, []);
    gr.get(k).push(r);
  }
  const out = [];
  for (const l of gr.values()) {
    if (l.length < 2) continue;
    l.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.i - b.i));
    for (let i = 1; i < l.length; i++) {
      const a = l[i - 1], b = l[i];
      if (tage(a.d, b.d) > 3) continue;
      const za = zweckNorm(a.z), ra = referenzen(a.z);
      const gleich = za && za === zweckNorm(b.z) && /\d/.test(za);
      const ref = [...referenzen(b.z)].find((t) => ra.has(t));
      if (!gleich && !ref) continue;
      i++;   // eine Buchung gehört nur zu einem Paar
      const betrag = -a.c, bis30 = H.plusTage(b.d, 30);
      const erst = (gut.get(H.norm(a.g)) || []).filter((r) => r.d >= b.d && r.d <= bis30);
      const zurueck = erst.reduce((t, r) => t + r.c, 0), fehlt = Math.max(0, betrag - zurueck);
      const status = !zurueck ? 'nicht' : fehlt ? 'teilweise' : 'voll';
      if (status === 'voll' ? b.d < von90 : b.d < H.plusTage(D.bis, -OFFEN_TAGE)) continue;
      const tagText = a.d === b.d ? `2× am ${H.dde(a.d)}` : `am ${ddeKurz(a.d)} und ${H.dde(b.d)}`;
      const stand = status === 'nicht' ? `<b class="neg">nicht erstattet</b>${bis30 > D.bis ? ' (bisher)' : ''}`
        : status === 'teilweise' ? `<b class="neg">teilweise erstattet – es fehlen ${H.eur(fehlt)}</b>`
          : `voll erstattet (${erst.map((r) => H.dde(r.d)).join(', ')})`;
      const ende = erst.length ? erst[erst.length - 1].d : b.d;
      out.push({
        key: `dop|${a.d}|${b.d}|${D.konten[a.k].name}|${a.c}|${H.norm(a.g)}`, art: 'doppelt', offen: status !== 'voll', status,
        text: `${H.zl(`<b>${H.esc(a.g)}</b>: ${H.eur(betrag)} ${tagText} abgebucht`, buchZiel(a.g, a.d, ende))} – ${stand}`,
        grund: `Gleicher Betrag ${ref ? `und gleiche Referenz ${ref}` : 'und gleicher Verwendungszweck'} innerhalb von ${tage(a.d, b.d)} ${tage(a.d, b.d) === 1 ? 'Tag' : 'Tagen'}${zurueck ? ` · zurück: ${H.eur(zurueck)}` : ''}`,
        rows: [a, b], erst, diff: status === 'voll' ? 0 : fehlt || betrag, d: b.d,
      });
    }
  }
  return out;
}

// (2) Preiserhöhung: laufender eigener Vertrag, dessen letzte Preisstufe in den letzten 90 Tagen beginnt und mehr als 2 %
// über der vorigen regelmäßigen Stufe liegt. Wirkung aufs Jahr = Differenz × Zahlungen im Jahr.
function preise(D) {
  const von90 = H.plusTage(D.bis, -TAGE), out = [];
  for (const f of H.fixkostenErkennen()) {
    if (!f.aktiv || f.gemeinsam || f.beitrag || (f.stufen?.length || 0) < 2) continue;
    const s = f.stufen, neu = s[s.length - 1];
    const vor = [...s.slice(0, -1)].reverse().find((x) => x.n > 1) || s[s.length - 2];
    if (neu.von < von90 || neu.betrag <= vor.betrag * 1.02) continue;
    const d = neu.betrag - vor.betrag, jahr = d * f.rh.proJahr;
    const rows = f.rows.filter((r) => r.d >= neu.von);
    out.push({
      key: `preis|${H.vertragsKey(f)}|${neu.von}`, art: 'preis', offen: true, status: 'preis',
      text: `${H.zl(`<b>${H.esc(H.vertragName(f))}</b>`, buchZiel(f.name, neu.von))}: ${H.eur(vor.betrag)} → ${H.eur(neu.betrag)} seit ${H.dde(neu.von)}, <b class="neg">+ ${H.eur0(jahr)} im Jahr</b>`,
      grund: `Neue Preisstufe (+${H.eur(d)} je Zahlung, ${f.rh.proJahr}× im Jahr)`, chipText: `Preis +${H.eur(d)}`,
      rows, diff: jahr, d: neu.von,
    });
  }
  return out;
}

// (3) Neuer Lastschrift-Gläubiger: Gläubiger-ID (aus den Bankdetails), die in den letzten 90 Tagen zum ersten Mal von
// einem deiner Konten abgebucht hat. Dazu: Mandate, die seit über 12 Monaten ruhen (nach 36 Monaten verfallen sie ohnehin).
function glaeubiger(D) {
  if (!D.j?.details) return { neu: [], ruhend: [] };
  const von90 = H.plusTage(D.bis, -TAGE), m = new Map();
  for (const r of D.rows) {
    if (r.c >= 0 || !eigen(r, D)) continue;
    const gid = H.det(r, D.j).gid;
    if (!gid) continue;
    let x = m.get(gid);
    if (!x) m.set(gid, (x = { gid, rows: [] }));
    x.rows.push(r);
  }
  const neu = [], ruhend = [];
  const vorJahr = H.plusTage(D.bis, -365), verfall = H.plusTage(D.bis, -Math.round(MANDAT_VERFALL * 30.44));
  for (const x of m.values()) {
    x.rows.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    const erste = x.rows[0], letzte = x.rows[x.rows.length - 1];
    if (erste.d >= von90) {
      const summe = x.rows.reduce((t, r) => t + r.c, 0);
      neu.push({
        key: `gid|${x.gid}`, art: 'gid', offen: true, status: 'gid',
        text: `${H.zl(`Neue Lastschrift von <b>${H.esc(erste.g || 'unbekannt')}</b>`, buchZiel(erste.g, erste.d, letzte.d))} <span class="wa-gid">(Gläubiger-ID ${H.esc(x.gid)})</span> · <span class="neg">${H.eur(summe)}</span>${x.rows.length > 1 ? ` in ${x.rows.length} Buchungen` : ` am ${H.dde(erste.d)}`}`,
        grund: `Diese Gläubiger-ID hat am ${H.dde(erste.d)} zum ersten Mal abgebucht`, rows: x.rows, diff: summe, d: erste.d,
      });
    } else if (x.rows.length >= 2 && letzte.d < vorJahr && letzte.d >= verfall && H.D().konten[letzte.k].bis >= H.plusTage(D.bis, -45)) {
      ruhend.push({ gid: x.gid, g: letzte.g, d: letzte.d, n: x.rows.length, ziel: buchZiel(letzte.g, letzte.d) });
    }
  }
  ruhend.sort((a, b) => (a.d < b.d ? 1 : -1));
  return { neu, ruhend };
}

// Alle Treffer (auch abgehakte und voll erstattete; offen = gehört in die Karte, s = deine Entscheidung)
// Reihenfolge: offene Doppelbuchungen, neue Gläubiger, Preise – jeweils neueste zuerst
export function treffer(h) {
  H = h || H;
  const c = cache();
  if (!c) return [];
  if (!c.t) {
    const D = c.D, g = glaeubiger(D), neuste = (a, b) => (a.d < b.d ? 1 : -1);
    const dop = doppelt(D, H.fixIds()).sort(neuste);
    c.t = [...dop.filter((t) => t.offen), ...g.neu.sort(neuste), ...preise(D).sort(neuste), ...dop.filter((t) => !t.offen)];
    c.ruhend = g.ruhend;
    c.je = new Map();
    for (const t of c.t) for (const r of t.rows) { if (!c.je.has(r.i)) c.je.set(r.i, []); c.je.get(r.i).push(t); }
  }
  for (const t of c.t) t.s = W?.ok?.[t.key]?.s || '';
  return c.t;
}

function trefferZeile(t, erledigt = false) {
  const knoepfe = erledigt
    ? `<button class="btn sm" data-wweg="${H.esc(t.key)}">wieder zeigen</button>`
    : `<button class="btn sm" data-wok="${H.esc(t.key)}" data-ws="passt">passt so</button><button class="btn sm" data-wok="${H.esc(t.key)}" data-ws="erledigt">erledigt</button>`;
  return `<div class="wa-t wa-${t.art}">
    <div class="wa-t-text">${t.text}<small>${H.esc(t.grund)}${t.s ? ` · ${t.s === 'passt' ? 'passt so' : 'erledigt'}` : ''}</small></div>
    ${t.offen || t.s ? `<div class="wa-knoepfe">${knoepfe}</div>` : ''}
  </div>`;
}
function waechterTeil() {
  const D = H.D(), alle = treffer(H), c = cache();
  const offen = alle.filter((t) => t.offen && !t.s), sonst = alle.filter((t) => !t.offen || t.s);
  let h = !offen.length ? `<p class="wa-ruhig">Nichts Auffälliges in den letzten ${TAGE} Tagen.</p>`
    : `<div class="wa-tl">${offen.slice(0, KARTE_N).map((t) => trefferZeile(t)).join('')}</div>`
      + (offen.length > KARTE_N ? `<details class="wa-mehr"><summary>+ ${offen.length - KARTE_N} weitere</summary><div class="wa-tl">${offen.slice(KARTE_N).map((t) => trefferZeile(t)).join('')}</div></details>` : '');
  if (sonst.length) h += `<details class="wa-mehr"><summary>Alle anzeigen: abgehakt und voll erstattet (${sonst.length})</summary><div class="wa-tl">${sonst.map((t) => trefferZeile(t, !!t.s)).join('')}</div></details>`;
  if (!D.j?.details) h += '<p class="wa-hinweis">Neue Lastschrift-Gläubiger: In diesen Daten fehlen die Bankdetails (Gläubiger-ID) – die Prüfung kommt mit dem nächsten Aufbau am PC.</p>';
  if (c.ruhend?.length) {
    h += `<details class="wa-mehr"><summary>Mandate, die seit über 12 Monaten ruhen (${c.ruhend.length})</summary>
      <p class="muted klein">Brauchst du sie nicht mehr, kannst du das Mandat bei der Bank widerrufen. Nach ${MANDAT_VERFALL} Monaten ohne Abbuchung verfällt ein SEPA-Mandat von selbst.</p>
      <div class="wa-tl">${c.ruhend.map((x) => `<div class="wa-t"><div class="wa-t-text">${H.zl(`<b>${H.esc(x.g || 'unbekannt')}</b>`, x.ziel)} – zuletzt am ${H.dde(x.d)}, ${x.n}× genutzt<small class="wa-gid">Gläubiger-ID ${H.esc(x.gid)}</small></div></div>`).join('')}</div></details>`;
  }
  return h;
}

// Karte für die Übersicht (immer da, damit das Raster gleich bleibt)
export function waechterKarte(h) {
  H = h || H;
  if (!H?.D()) return '';
  const offen = treffer(H).filter((t) => t.offen && !t.s).length;
  const rechts = offen ? `<span class="wa-zahl neg">${offen} ${offen === 1 ? 'Hinweis' : 'Hinweise'}</span>` : '';
  return H.karte5('Was auffällt', `Neue Buchungen seit deinem letzten Besuch und feste Prüfungen der letzten ${TAGE} Tage: doppelte Abbuchungen, neue Lastschriften, Preiserhöhungen. Summen nur deine eigenen Konten, ohne Umbuchungen.`,
    `<div class="wa-raster"><div class="wa-teil"><h3>Neu seit deinem letzten Besuch</h3>${neuTeil()}</div><div class="wa-teil"><h3>Wächter</h3>${waechterTeil()}</div></div>`,
    'wa-karte', rechts, 'waechter');
}

// Chips je Buchungszeile: „neu“ (Klick = gesehen) und offene Treffer des Wächters
export function chip(r) {
  if (!H?.D()) return '';
  const c = cache(), out = [];
  if (istNeu(r)) out.push(`<button class="wa-chip neu" data-wneu="${c.h[r.i]}" title="Neu seit deinem letzten Besuch – anklicken: gesehen">neu</button>`);
  treffer(H);
  for (const t of c.je?.get(r.i) || []) {
    if (!t.offen || t.s) continue;
    const text = t.art === 'doppelt' ? 'doppelt?' : t.art === 'gid' ? 'neuer Gläubiger' : t.chipText;
    out.push(`<span class="wa-chip warn" title="${H.esc(t.grund.replace(/<[^>]+>/g, ''))}">${H.esc(text)}</span>`);
  }
  return out.length ? `<span class="wa-chips">${out.join('')}</span>` : '';
}

// Klicks in Karte, Leiste und Chips
export function waechterBinden(el, h) {
  H = h || H;
  if (!el || !H) return;
  el.querySelectorAll('[data-wneu]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); gesehen([b.dataset.wneu]); });
  el.querySelectorAll('[data-walle]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); alleGesehen(); });
  el.querySelectorAll('[data-wnf]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); H.setze({ neu: '' }); });
  el.querySelectorAll('[data-wok]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    W.ok[b.dataset.wok] = { s: b.dataset.ws, zeit: new Date().toISOString().slice(0, 19) };
    sichern(); H.neuZeichnen();
  });
  el.querySelectorAll('[data-wweg]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); delete W.ok[b.dataset.wweg]; sichern(); H.neuZeichnen(); });
  el.querySelectorAll('.wa-chip.warn').forEach((s) => s.onclick = (e) => e.stopPropagation());
  H.gehBinden(el);
}
