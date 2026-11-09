// Kreditverträge (D.j.kredite, gelesen von kredit_daten.py aus dem Vertrag als PDF): Tilgungsplan nach fester Regel,
// Restschuld, letzte Rate, gebuchte Raten. Werte laut Vertrag sind „gedruckt“, alles Gerechnete ist „berechnet“.
// Die ganze Rate bleibt eine Ausgabe (Fixkosten) – Zins und Tilgung werden nur zusätzlich gezeigt.
// Kredite, die von einem gemeinsamen oder Kinderkonto bezahlt werden, zählen in keiner Summe (nur zur Information).
// Keine Imports: alle Helfer kommen als H aus app.js. Geld in Cent, Datum ISO.

const wert = (v, f) => v.werte?.[f]?.wert ?? null;
const STOPP = new Set(['bank', 'gmbh', 'ag', 'kredit', 'darlehen', 'consumer', 'finanz', 'service', 'deutsche', 'deutschland', 'straße', 'strasse']);

// Annuitätenplan: Zins je Monat = Restschuld × Sollzins / 12 (auf Cent gerundet), Tilgung = Rate − Zins, die letzte Rate
// tilgt den Rest. Fehlt die Rate, wird sie aus Betrag, Sollzins und Anzahl gerechnet (gekennzeichnet).
export function tilgungsplan(v, H) {
  const P = Math.round((wert(v, 'nettobetrag') || 0) * 100), i = (wert(v, 'sollzins') ?? NaN) / 100 / 12, n = wert(v, 'anzahl') || 0, erste = wert(v, 'erste_rate');
  if (!P || !erste || !Number.isFinite(i)) return null;
  let R = wert(v, 'rate') != null ? Math.round(wert(v, 'rate') * 100) : null, rateBerechnet = false;
  if (R == null) {
    if (!n) return null;
    R = i ? Math.round((P * i) / (1 - Math.pow(1 + i, -n))) : Math.ceil(P / n);
    rateBerechnet = true;
  }
  const tag = +erste.slice(8), zeilen = [];
  let rest = P, k = erste.slice(0, 7);
  for (let j = 0; j < (n || 600) && rest > 0; j++) {
    const zins = Math.round(rest * i);
    let tilg = R - zins;
    if (tilg <= 0) return { fehler: 'Die Rate deckt nicht einmal den Zins – bitte die Werte des Vertrags prüfen.' };
    if (tilg > rest || (n && j === n - 1)) tilg = rest;
    rest -= tilg;
    zeilen.push({ am: `${k}-${String(Math.min(tag, H.tageImMonat(k))).padStart(2, '0')}`, zins, tilg, rate: zins + tilg, rest });
    k = H.mVor(k, 1);
  }
  return { P, R, i, n: zeilen.length, erste, ende: zeilen.at(-1).am, zeilen, rateBerechnet, schluss: zeilen.at(-1).rate,
    zinsGesamt: zeilen.reduce((t, z) => t + z.zins, 0), gesamt: zeilen.reduce((t, z) => t + z.rate, 0) };
}

// Restschuld nach allen Raten bis einschließlich Tag d (vor der ersten Rate: der ganze Betrag)
export function restAm(plan, d) {
  let r = plan.P;
  for (const z of plan.zeilen) { if (z.am > d) break; r = z.rest; }
  return r;
}

// Gebuchte Raten: Abbuchung in Höhe der Rate (± 1 %, mindestens 1 €) ab 10 Tage vor der ersten Rate, Empfänger oder
// Verwendungszweck nennt den Kreditgeber oder die Vertragsnummer
function gebucht(H, v, plan) {
  const D = H.D(), tol = Math.max(100, Math.round(plan.R * 0.01)), ab = H.plusTage(plan.erste, -10);
  const worte = H.norm(String(wert(v, 'kreditgeber') || '').split(/[,;(]/)[0]).split(/[^a-z0-9äöüß]+/).filter((w) => w.length >= 3 && !STOPP.has(w));
  const nr = H.norm(String(wert(v, 'vertragsnummer') || '')).replace(/[^a-z0-9]/g, '');
  return D.rows.filter((r) => {
    if (r.c >= 0 || r.d < ab || (Math.abs(-r.c - plan.R) > tol && Math.abs(-r.c - plan.schluss) > tol)) return false;
    const t = H.norm(`${r.g || ''} ${r.ga || ''} ${r.z || ''}`);
    return (nr.length >= 5 && t.replace(/[^a-z0-9]/g, '').includes(nr)) || (worte.length && worte.every((w) => t.includes(w)));
  });
}

// Alle Kredite, einmal je Datenstand gerechnet
export function kredite(H) {
  const D = H.D();
  if (D.kr) return D.kr;
  const out = [];
  for (const v of D.j.kredite?.vertraege || []) {
    const plan = tilgungsplan(v, H), geber = String(wert(v, 'kreditgeber') || v.datei.replace(/\.pdf$/i, '')).split(',')[0].trim();
    const x = { v, datei: v.datei, geber, nr: wert(v, 'vertragsnummer') || '', status: v.status, fehlt: v.fehlt || [], plan: plan && !plan.fehler ? plan : null, fehler: plan?.fehler || '' };
    if (x.plan) {
      const p = x.plan, heute = D.bis, jahr = heute.slice(0, 4);
      x.rows = gebucht(H, v, p);
      const kontoName = wert(v, 'konto') || (x.rows.length ? D.konten[x.rows.at(-1).k].name : '');
      const ki = D.konten.findIndex((k) => k.name === kontoName);
      x.konto = kontoName;
      x.fremd = ki >= 0 && H.fremd(ki);
      x.rest = restAm(p, heute);
      x.getilgt = p.P - x.rest;
      x.planBisHeute = p.zeilen.filter((z) => z.am <= heute).length;
      x.imJahr = p.zeilen.filter((z) => z.am.startsWith(jahr));
      x.zinsJahr = x.imJahr.reduce((t, z) => t + z.zins, 0);
      x.tilgJahr = x.imJahr.reduce((t, z) => t + z.tilg, 0);
      x.offen = x.rest > 0;
      x.naechste = p.zeilen.find((z) => z.am > heute) || null;
      const gb = wert(v, 'gesamtbetrag');
      x.gesamtGedruckt = gb != null ? Math.round(gb * 100) : null;
      // Vertrag in den Fixkosten (erkannt aus den Buchungen): gleiche Rate und dieselben Buchungen
      const ids = new Set(x.rows.map((r) => r.i)), tol = Math.max(100, Math.round(p.R * 0.01));
      x.vertrag = H.fixkostenErkennen().find((f) => Math.abs(f.betrag - p.R) <= tol && f.rows.some((r) => ids.has(r.i))) || null;
    }
    out.push(x);
  }
  return (D.kr = out);
}
export const eigeneKredite = (H) => kredite(H).filter((x) => x.plan && !x.fremd && x.offen);
export const schuldenSumme = (H) => eigeneKredite(H).reduce((t, x) => t + x.rest, 0);

// Letzte Rate eines Fixkosten-Vertrags, der zu einem Kredit gehört (danach ist er nicht mehr fällig) – sonst ''
export function kreditEnde(H, f) {
  const x = kredite(H).find((k) => k.vertrag === f);
  return x ? x.plan.ende : '';
}
// Raten eigener Kredite, die noch keine Buchung haben (neu abgeschlossen, als Vertrag noch nicht erkannt), zwischen
// von und bis – für Prognose und die nächsten 30 Tage
export function neueRaten(H, von, bis) {
  const D = H.D();
  return kredite(H).filter((x) => x.plan && !x.fremd && !x.vertrag && !x.rows.length)
    .flatMap((x) => x.plan.zeilen.filter((z) => z.am > D.bis && z.am >= von && z.am <= bis).map((z) => ({ x, am: z.am, c: z.rate })));
}

// ---------------------------------------------------------------- Anzeige (Seite Vermögen)
const FELD_NAME = { kreditgeber: 'Kreditgeber', vertragsnummer: 'Vertragsnummer', vertragsdatum: 'Vertragsdatum', nettobetrag: 'Nettodarlehensbetrag', sollzins: 'Sollzins',
  effzins: 'effektiver Jahreszins', rate: 'monatliche Rate', anzahl: 'Anzahl der Raten', erste_rate: 'erste Rate', schlussrate: 'Schlussrate', gesamtbetrag: 'Gesamtbetrag', konto: 'Lastschrift von' };
const pz = (H, x) => `${H.NUM.format(x)} %`;

function verlaufSvg(H, x) {
  const p = x.plan, W = 300, HH = 64, n = p.zeilen.length, y = (c) => (HH - 4 - (c / p.P) * (HH - 10)).toFixed(1), xx = (j) => ((j / n) * W).toFixed(1);
  const pfad = `M0 ${y(p.P)}${p.zeilen.map((z, j) => `L${xx(j + 1)} ${y(z.rest)}`).join('')}`;
  const jH = p.zeilen.filter((z) => z.am <= H.D().bis).length;
  return `<svg class="kr-svg" viewBox="0 0 ${W} ${HH}" preserveAspectRatio="none" aria-hidden="true"><path class="kr-flaeche" d="${pfad}L${W} ${HH}L0 ${HH}Z"/><path class="kr-linie" d="${pfad}"/>`
    + `<path class="kr-heute" d="M${xx(jH)} 0V${HH}"/></svg>`;
}

export function kreditKarte(H) {
  const { esc, eur0, eur, dde } = H, l = kredite(H);
  if (!l.length) return '';
  const zeile = (x) => {
    if (!x.plan) {
      return `<div class="kr-z kr-unvoll"><div class="kr-k"><b>${esc(x.geber)}</b><small>${esc(x.datei)} · ${esc(x.fehler || x.status)}</small></div>
        <p class="bx-u">Ohne ${esc(x.fehlt.map((f) => FELD_NAME[f] || f).join(', ')) || 'alle Werte'} lässt sich kein Tilgungsplan rechnen. Sag Claude Bescheid, dann wird der Vertrag ausgelesen und die fehlenden Werte werden in „Kredite-abgeschrieben.json“ nachgetragen.</p></div>`;
    }
    const p = x.plan, anteil = Math.round((x.getilgt / p.P) * 100), ziel = x.rows.length ? H.zuBuchungen({ q: `"${x.geber.split(' ')[0]}"`, konto: '' }) : null;
    const dG = p.gesamt - (x.gesamtGedruckt ?? 0);
    const pruef = x.gesamtGedruckt != null ? (Math.abs(dG) <= Math.max(100, p.n * 2)
      ? (dG === 0 ? `Plan geprüft: Summe aller Raten ${eur(p.gesamt)} = Gesamtbetrag laut Vertrag` : `Plan geprüft: Summe aller Raten ${eur(p.gesamt)}, Gesamtbetrag laut Vertrag ${eur(x.gesamtGedruckt)} – ${eur(Math.abs(dG))} Unterschied durch Rundung der Schlussrate`) :`Achtung: Summe aller Raten ${eur(p.gesamt)}, laut Vertrag ${eur(x.gesamtGedruckt)} – die Bank rechnet anders, Restschuld daher nur ungefähr`) : 'Gesamtbetrag nicht im Vertrag gefunden – Plan nicht gegengeprüft';
    const buch = x.planBisHeute ? `${x.rows.length} von ${x.planBisHeute} fälligen Raten in deinen Buchungen gefunden` : `erste Rate am ${dde(p.erste)}`;
    const belege = Object.entries(x.v.werte || {}).map(([f, w]) => `<tr><td>${esc(FELD_NAME[f] || f)}</td><td class="r">${esc(typeof w.wert === 'number' ? (f === 'sollzins' || f === 'effzins' ? pz(H, w.wert) : f === 'anzahl' ? String(w.wert) : eur(Math.round(w.wert * 100))) : /^\d{4}-\d{2}-\d{2}$/.test(w.wert) ? dde(w.wert) : w.wert)}</td><td><small>${w.quelle === 'gedruckt' ? `laut Vertrag: „${esc(w.beleg)}“` : esc(w.quelle)}</small></td></tr>`).join('');
    return `<div class="kr-z${x.fremd ? ' fremd' : ''}">
      <div class="kr-k"${ziel ? H.geh(ziel) : ''}${ziel ? ' role="button" tabindex="0" title="Anklicken: die gebuchten Raten"' : ''}><b>${esc(x.geber)}${x.nr ? ` <small>Nr. ${esc(x.nr)}</small>` : ''}</b>
        <small>${eur0(p.P)} zu ${pz(H, wert(x.v, 'sollzins'))} Sollzins · Rate ${eur(p.R)}${p.rateBerechnet ? ' (berechnet)' : ''} · ${x.konto ? `von ${esc(x.konto)}` : 'Konto unbekannt'}${x.fremd ? ' · zählt nicht in deine Summen' : ''}</small></div>
      <div class="kr-rest"><span>Restschuld heute <em class="marke">berechnet</em></span><b class="neg">${x.offen ? '−' : ''}${eur0(x.rest)}</b><small>${x.offen ? `letzte Rate ${dde(p.ende)}` : `abbezahlt seit ${dde(p.ende)}`}</small></div>
      <div class="kr-fort"><div class="kr-bar" title="${anteil} % getilgt"><i style="width:${anteil}%"></i></div><small>${anteil} % getilgt · ${eur0(x.getilgt)} von ${eur0(p.P)}</small>${verlaufSvg(H, x)}</div>
      <dl class="kr-dl" title="laut Tilgungsplan, ganzes Jahr ${H.D().bis.slice(0, 4)}"><div><dt>Zins ${H.D().bis.slice(0, 4)}</dt><dd>${eur0(x.zinsJahr)}</dd></div><div><dt>Tilgung ${H.D().bis.slice(0, 4)}</dt><dd>${eur0(x.tilgJahr)}</dd></div>
        <div><dt>Zins insgesamt</dt><dd>${eur0(p.zinsGesamt)}</dd></div><div><dt>nächste Rate</dt><dd>${x.naechste ? `${dde(x.naechste.am)}` : '–'}</dd></div></dl>
      <p class="kr-pruef">${esc(buch)} · ${esc(pruef)}${x.vertrag ? ` · läuft bei den Fixkosten als „${esc(H.vertragName(x.vertrag))}“` : ''}</p>
      <details class="kr-belege"><summary>Werte aus dem Vertrag (${esc(x.datei)})</summary><table class="t3 t3-eng"><tbody>${belege}</tbody></table></details>
    </div>`;
  };
  // Kopf = Summe der gezeigten (auf Euro gerundeten) Restschulden eigener Kredite
  const eig = eigeneKredite(H), sum = eig.reduce((t, x) => t + Math.round(x.rest / 100) * 100, 0);
  return `<section class="card cp-karte bx-karte bx-ganz" id="kr-karte"><div class="cp-kt"><h2>Kredite</h2>${eig.length ? `<b class="bx-wert neg">−${eur0(sum)}</b>` : ''}</div>
    <div class="kr-l">${l.map(zeile).join('')}</div>
    <p class="cp-fuss">Werte laut Vertrag · Restschuld, Zins und Tilgung berechnet nach fester Regel (Annuität, Sollzins ÷ 12 je Monat) · die ganze Rate zählt weiter als Ausgabe bei den Fixkosten · Kredite von gemeinsamen Konten zählen nicht mit</p></section>`;
}
