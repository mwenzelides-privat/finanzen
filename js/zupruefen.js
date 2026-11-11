// Arbeitsmodus „Zu prüfen“: alle neuen Buchungen seit dem letzten Prüfen (wie „Neu seit deinem letzten Besuch“) mit
// vorbelegter Kategorie und Steuer-Zuordnung. Vorbelegt ist, was die App schon weiß: die Kategorie der Bank bzw. deiner
// Regeln, bei Buchungen ohne Kategorie der Vorschlag der Prüfliste (gleiche IBAN, frühere Buchungen, Stichwörter); die
// Steuer wie im Reiter Steuer (WISO/Buhl, offizielle Unterlagen, Regeln). Nichts ändert sich ohne Klick:
// „Übernehmen“ speichert genau, was in der Zeile steht, und hakt die Buchung ab; „Alle übernehmen“ macht das für alle.
// Entscheidungen landen dort, wo sie auch sonst landen (Kategorie-Entscheidungen bzw. Steuer-Entscheidungen) – sie wirken
// also überall in der App und beim nächsten Aufbau am PC. Keine Imports von app.js: Helfer kommen als H.
import { neueBuchungen, alsGesehen, neuSeit } from './waechter.js';
import { pruefHelfer, kategorieOffen, kategorieVorschlag, kategorieOptionen, kategorieEntscheiden } from './pruefen.js';
import { steuerPosten, steuerZuordnen, postenOptionen, steuerEigen, steuerGeladen } from './steuer.js';

const ZEIGEN = 40;            // so viele Zeilen auf einmal, der Rest mit „weitere“
let H = null, zeig = ZEIGEN;
const wahl = new Map();       // Buchung (Index) → { kat, st } – was du in der Zeile eingestellt, aber noch nicht übernommen hast

const fremdK = (D, r) => { const k = D.konten[r.k]; return !!(k.kind || k.gemeinsam); };
const nebenbei = (r) => r.art === 'Umbuchung' || r.art === 'Sparen';
const katWert = (r) =>(r.art === 'Umbuchung' ? 'umb' : `${r.kat || ''}|${r.ukat || ''}`);

// Zahl für die Navigation: neue Buchungen auf deinen eigenen Konten (null = Neu-Funktion aus)
export function zuPruefenZahl(h) {
  H = h || H;
  const l = neueBuchungen(H);
  if (!l) return null;
  const D = H.D();
  return l.filter((r) => !fremdK(D, r)).length;
}

// Vorbelegung einer Zeile: Kategorie und Steuer, je mit Herkunft
function vorbelegt(r) {
  const offen = kategorieOffen(r), v = offen ? kategorieVorschlag(r) : null;
  const kat = v ? (v.umb ? 'umb' : `${v.kat}|${v.ukat}`) : katWert(r);
  const katHer = v ? `Vorschlag: ${v.grund}` : offen ? 'noch ohne Kategorie' : r.ent ? 'deine Entscheidung' : 'laut Bank bzw. Regel';
  const steuerArt = r.art === 'Ausgabe' || r.art === 'Einnahme';
  const eig = steuerArt ? steuerEigen(r) : null, p = steuerArt && steuerGeladen() ? steuerPosten(r) : '';
  const st = p || '';
  const stHer = !steuerArt ? '' : eig && (eig.ok || eig.x) ? 'deine Entscheidung' : p && p !== 'x' ? 'Vorschlag' : '';
  return { offen, v, kat, katHer, st, stHer, steuerArt };
}

function zeileHtml(r, D) {
  const b = vorbelegt(r), w = wahl.get(r.i) || {}, kat = w.kat ?? b.kat, st = w.st ?? b.st;
  let opts = kategorieOptionen();
  const hat = (val) => opts.includes(`value="${H.esc(val)}"`);
  if (kat !== 'umb' && !hat(kat)) opts = `<option value="${H.esc(kat)}">${H.esc(kat.split('|')[0] ? H.schoen(kat.split('|')[1] || kat.split('|')[0]) : '– noch keine Kategorie –')}</option>${opts}`;
  opts = opts.replace(`value="${H.esc(kat)}"`, `value="${H.esc(kat)}" selected`);
  const umb = `<option value="umb"${kat === 'umb' ? ' selected' : ''}>↔ Umbuchung (eigenes Geld, zählt nicht)</option>`;
  const geaendert = (w.kat != null && w.kat !== b.kat) || (w.st != null && w.st !== b.st);
  return `<div class="zp-z${b.offen ? ' offen' : ''}" data-zp="${r.i}">
    <span class="zp-d">${H.dde(r.d).slice(0, 6)}</span>
    <span class="zp-n"><b>${H.esc(r.g || r.z || '–')}</b><small>${H.esc((r.g ? r.z : '') || '')}</small><small class="zp-k">${H.esc(D.konten[r.k].name)}</small></span>
    <b class="zp-b ${r.c < 0 ? 'neg' : 'pos'}">${H.eur(r.c)}</b>
    <label class="zp-f"><span>Kategorie <em class="${b.v ? 'zp-vor' : b.offen ? 'zp-offen' : ''}">${H.esc(b.katHer)}</em></span>
      <select data-zp-kat="${r.i}">${umb}${opts}</select></label>
    <label class="zp-f"><span>Steuer ${b.stHer ? `<em class="${b.stHer === 'Vorschlag' ? 'zp-vor' : ''}">${b.stHer}</em>` : ''}</span>
      ${b.steuerArt ? `<select data-zp-st="${r.i}">${postenOptionen(st, true).replace('– nicht zugeordnet –', 'nicht steuerlich')}</select>` : '<span class="muted klein">– (Umbuchung/Sparen)</span>'}</label>
    <span class="zp-a"><button class="btn sm${geaendert || b.v || b.stHer === 'Vorschlag' ? ' primary' : ''}" data-zp-ok="${r.i}" title="Kategorie und Steuer so übernehmen und abhaken">✓ Übernehmen</button></span>
  </div>`;
}

export function zuPruefenSeite(h, einlesenLeiste) {
  H = h; pruefHelfer(h);
  const D = H.D(), l = neueBuchungen(H);
  if (!l) return `${H.kopf5('Zu prüfen', 'Die App merkt sich auf diesem Gerät, welche Buchungen du schon geprüft hast. Das ist gerade nicht möglich (z. B. privates Fenster) oder wird noch geladen.')}${einlesenLeiste}`;
  const eigen = l.filter((r) => !fremdK(D, r)), fremd = l.length - eigen.length;
  const seit = neuSeit();
  const satz = eigen.length
    ? `<b>${eigen.length === 1 ? '1 neue Buchung' : `${eigen.length} neue Buchungen`}</b>${seit ? ` seit ${H.dde(seit)}` : ''}. Kategorie und Steuer sind vorbelegt – prüfen, bei Bedarf ändern, übernehmen. Nichts ändert sich ohne deinen Klick.`
    : `Alles geprüft – keine neuen Buchungen${seit ? ` seit ${H.dde(seit)}` : ''}. Nach dem nächsten Einlesen stehen neue hier.`;
  const nOffen = eigen.filter((r) => kategorieOffen(r)).length;
  const knoepfe = eigen.length ? `<div class="zp-kopf-k">
      <button class="btn primary" data-zp-alle>Alle ${eigen.length} übernehmen</button>
      ${nOffen ? `<span class="klein muted">${nOffen} ohne Kategorie – dort steht der Vorschlag, sonst „noch keine Kategorie“</span>` : ''}</div>` : '';
  // Einnahmen und Ausgaben zuerst; Umbuchungen und Sparpläne (zählen nicht als Ausgabe) zugeklappt darunter
  const haupt = eigen.filter((r) => !nebenbei(r)), neben = eigen.filter(nebenbei);
  const kopfZ = '<div class="zp-z zp-kopf"><span>Datum</span><span>Empfänger · Verwendungszweck</span><span class="r">Betrag</span><span>Kategorie</span><span>Steuer</span><span></span></div>';
  const liste = (haupt.length ? `<section class="card zp-liste">${kopfZ}
      ${haupt.slice(0, zeig).map((r) => zeileHtml(r, D)).join('')}
      ${haupt.length > zeig ? `<div class="zp-mehr"><button class="btn sm" data-zp-mehr>weitere ${Math.min(ZEIGEN, haupt.length - zeig)} von ${haupt.length - zeig} zeigen</button></div>` : ''}
    </section>` : '')
    + (neben.length ? `<details class="card zp-liste zp-neben"><summary><b>${neben.length} Umbuchungen und Sparpläne</b> <span class="klein muted">Geld zwischen deinen Konten bzw. ins Depot – zählt nicht als Ausgabe</span>
        <button class="btn sm" data-zp-neben>alle ${neben.length} abhaken</button></summary>${kopfZ}${neben.map((r) => zeileHtml(r, D)).join('')}</details>` : '');
  const fremdHtml = fremd ? `<p class="klein muted">${fremd} neue ${fremd === 1 ? 'Buchung' : 'Buchungen'} auf Kinder- oder gemeinsamen Konten – zählen nicht in deine Summen, keine Prüfung nötig. <button class="link" data-zp-fremd>als geprüft abhaken</button></p>` : '';
  return `${H.kopf5('Zu prüfen', satz)}${einlesenLeiste}${knoepfe}${liste}${fremdHtml}
    <p class="klein muted zp-fuss">Vorschläge: Kategorie aus gleicher IBAN, früheren Buchungen desselben Empfängers und Stichwörtern; Steuer wie im Reiter Steuer (Kategorie aus WISO/Buhl, offizielle Unterlagen, Regeln). Gespeichert wird wie in „Kategorien › Prüfen“ und im Reiter Steuer – es gilt sofort überall. Der Stand „geprüft“ gilt je Gerät.</p>`;
}

// Was übernehmen bedeutet: genau das, was die Zeile zeigt
function uebernehmen(rows) {
  const D = H.D(), jeKat = new Map();
  for (const r of rows) {
    const b = vorbelegt(r), w = wahl.get(r.i) || {}, kat = w.kat ?? b.kat, st = w.st ?? b.st;
    // Steuer: Vorschlag bestätigen, Änderung speichern; „nicht steuerlich“ gegen einen Vorschlag = ausschließen
    if (b.steuerArt) {
      const eig = steuerEigen(r);
      if (st === '' && b.st && b.st !== 'x') steuerZuordnen(r, 'x');
      else if (st && (st !== b.st || !(eig && (eig.ok || eig.x)))) steuerZuordnen(r, st);
    }
    // Kategorie: nur speichern, wenn sie sich ändert oder ein Vorschlag übernommen wird (sonst bleibt alles, wie es ist)
    if (kat !== katWert(r) || (b.offen && b.v)) {
      const [k, u] = kat.split('|');
      const e = kat === 'umb' ? { kat: 'Umbuchung', ukat: '', umb: true } : k && k !== 'Nicht zugeordnet' ? { kat: k, ukat: u || '', umb: false } : null;
      if (e) { const key = JSON.stringify(e); if (!jeKat.has(key)) jeKat.set(key, { e, rows: [] }); jeKat.get(key).rows.push(D.rows[r.i]); }
    }
    wahl.delete(r.i);
  }
  for (const { e, rows: rs } of jeKat.values()) kategorieEntscheiden(rs, e);
  alsGesehen(rows);
}

export function zuPruefenBinden(el) {
  if (!H) return;
  const D = H.D(), row = (i) => D.rows[+i];
  el.querySelectorAll('[data-zp-kat]').forEach((s) => s.onchange = () => { const w = wahl.get(+s.dataset.zpKat) || {}; w.kat = s.value; wahl.set(+s.dataset.zpKat, w); });
  el.querySelectorAll('[data-zp-st]').forEach((s) => s.onchange = () => { const w = wahl.get(+s.dataset.zpSt) || {}; w.st = s.value; wahl.set(+s.dataset.zpSt, w); });
  el.querySelectorAll('[data-zp-ok]').forEach((b) => b.onclick = () => { uebernehmen([row(b.dataset.zpOk)]); H.toast('Übernommen und abgehakt.'); });
  el.querySelector('[data-zp-alle]')?.addEventListener('click', () => {
    const l = (neueBuchungen(H) || []).filter((r) => !fremdK(D, r));
    if (!l.length) return;
    uebernehmen(l);
    H.toast(`${l.length} ${l.length === 1 ? 'Buchung' : 'Buchungen'} übernommen und abgehakt.`);
  });
  el.querySelector('[data-zp-neben]')?.addEventListener('click', (e) => {
    e.preventDefault();
    const l = (neueBuchungen(H) || []).filter((r) => !fremdK(D, r) && nebenbei(r));
    uebernehmen(l);
    H.toast(`${l.length} Umbuchungen und Sparpläne abgehakt.`);
  });
  el.querySelector('[data-zp-fremd]')?.addEventListener('click',() => alsGesehen((neueBuchungen(H) || []).filter((r) => fremdK(D, r))));
  el.querySelector('[data-zp-mehr]')?.addEventListener('click', () => { zeig += ZEIGEN; H.neuZeichnen(); });
}
