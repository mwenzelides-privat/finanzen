// Kontostände zu einem Stichtag (Stand am Ende des Tages).
// Ausgangspunkt ist der letzte Bank-Kontostand je Konto; von dort wird mit den Buchungen der Liste
// zum Stichtag zurück- (oder vor-)gerechnet. Wie verlässlich das je Konto ist, hat dashboard_daten.py
// an jedem Tag mit Finanzguru-Kontostand geprüft (Feld „genauigkeit“, „pruefung“).
//   exakt           – stimmt mit den Bank-Kontoständen überein
//   ungefaehr       – kann um bis zu pruefung.maxAbw € abweichen (nur bis pruefung.abwBis, danach exakt)
//   unsicher        – für dieses Konto lassen sich frühere Stände nicht verlässlich berechnen (PayPal; nur bis pruefung.abwBis, danach exakt)
//   geschaetzt      – kein Bank-Kontostand bekannt, ab 0 € aufsummiert
//   nicht_eroeffnet – Konto gab es am Stichtag noch nicht (0 €)
//   unbekannt       – Stichtag liegt vor Beginn der Daten eines Kontos, das schon vorher Geld hatte
//   geschlossen     – Konto hatte zum Stichtag schon keine Buchungen mehr (siehe zu())
export function kontostaende(D, datum) {
  return D.konten.map((k, i) => {
    const rs = D.proKonto[i];
    const summe = (von, bis) => rs.reduce((s, r) => (r.d > von && r.d <= bis ? s + r.c : s), 0);
    const istZu = zu(D, i);
    if (istZu && datum > k.bis) return { k, i, c: null, status: 'geschlossen' };
    if (datum < k.von) {
      if (k.saldo == null || k.vollstaendig) return { k, i, c: 0, status: 'nicht_eroeffnet' };
      return { k, i, c: null, status: 'unbekannt' };
    }
    if (k.saldo == null) return { k, i, c: rs.reduce((s, r) => (r.d <= datum ? s + r.c : s), 0), status: 'geschaetzt' };
    // nach dem letzten bekannten Kontostand eines inzwischen geschlossenen Kontos: nur aus den Buchungen gerechnet
    if (istZu && datum > k.saldoAm) return { k, i, c: Math.round(k.saldo * 100) + summe(k.saldoAm, datum), status: 'geschaetzt' };
    const s = Math.round(k.saldo * 100);
    const c = datum <= k.saldoAm ? s - summe(datum, k.saldoAm) : s + summe(k.saldoAm, datum);
    let status = 'exakt';
    if (datum < k.saldoAm && !k.vollstaendig) {
      const p = k.pruefung, bisAbw = !p?.abwBis || datum <= p.abwBis;   // nach der letzten Abweichung stimmt jeder geprüfte Tag
      if (k.genauigkeit === 'unsicher' && bisAbw) status = (p?.maxAbw ?? Infinity) <= UNSICHER_KLEIN ? 'ungefaehr' : 'unsicher';
      else if (k.genauigkeit === 'ungefaehr' && bisAbw) status = 'ungefaehr';
    }
    return { k, i, c: status === 'unsicher' ? null : c, status, abw: k.pruefung?.maxAbw };
  });
}

// Ist ein Konto nicht mehr in Gebrauch? Seine letzte Buchung liegt länger zurück als 60 Tage und als das Doppelte seines
// üblichen Buchungsabstands (Median der Abstände zwischen Buchungstagen). So bleibt ein Konto mit nur vierteljährlichen
// Zinsbuchungen (Mietkaution, Abstand ≈ 91 Tage) bis rund 182 Tage nach der letzten Buchung offen, statt jedes Quartal
// einen Monat lang aus den Summen zu fallen.
const ABSTAND = new WeakMap();
function ueblicherAbstand(rs) {
  if (ABSTAND.has(rs)) return ABSTAND.get(rs);
  const tage = [...new Set(rs.map((r) => r.d))].sort().map((d) => Date.parse(d) / 864e5);
  const abst = tage.slice(1).map((t, j) => t - tage[j]).sort((a, b) => a - b), m = abst.length >> 1;
  const med = !abst.length ? 0 : abst.length % 2 ? abst[m] : (abst[m - 1] + abst[m]) / 2;
  ABSTAND.set(rs, med);
  return med;
}
function zu(D, i) {
  const ruhe = Math.max(60, 2 * ueblicherAbstand(D.proKonto[i]));
  return D.konten[i].bis < new Date(Date.parse(D.bis) - ruhe * 864e5).toISOString().slice(0, 10);
}

// Zählt der Wert in der Summe mit?
export const inSumme = (x) => x.c != null;

// Bis zu dieser möglichen Abweichung (in €) gilt ein „unsicheres“ Konto doch als „ungefähr“ und zählt mit (mit ±).
// Es ist dieselbe Grenze, bis zu der dashboard_daten.py ein Konto „ungefähr“ statt „unsicher“ nennt. Mehr würde die
// Veränderungen („seit 1. Januar“, Monatsenden) schon spürbar verfälschen. PayPal liegt mit über 4.000 € weit darüber –
// seine Stände vor der letzten Abweichung (pruefung.abwBis) fehlen deshalb, danach ist es exakt und zählt normal.
export const UNSICHER_KLEIN = 500;

// Summe mehrerer Kontostände (Ergebnis von kontostaende, schon auf die gewünschten Konten beschränkt).
// Nicht eröffnete und geschlossene Konten zählen 0 – ihr Stand ist sicher. Fehlt der Stand eines Kontos (nicht berechenbar
// oder vor Beginn seiner Daten), ist die Summe unvollständig: c ist dann nur die Summe der übrigen, fehlt nennt diese
// Konten. Ein fehlender Stand wird nie still als 0 gerechnet.
// abw = mögliche Abweichung in Cent (ungefähre Konten), geschaetzt = enthält Konten ohne Bank-Kontostand.
export function summeKonten(liste) {
  let c = 0, abw = 0, geschaetzt = false;
  const fehlt = [];
  for (const x of liste) {
    if (x.status === 'geschlossen' || x.status === 'nicht_eroeffnet') continue;
    if (x.c == null) { fehlt.push(x); continue; }
    c += x.c;
    if (x.status === 'ungefaehr') abw += Math.round((x.abw || 0) * 100);
    if (x.status === 'geschaetzt') geschaetzt = true;
  }
  return { c, fehlt, abw, geschaetzt, voll: !fehlt.length };
}

export const STATUS_TEXT = {
  exakt: 'exakt: stimmt mit den Bank-Kontoständen überein',
  ungefaehr: 'ungefähr: die Quellen weichen hier leicht voneinander ab',
  unsicher: 'nicht berechenbar: für dieses Konto liefert Finanzguru keine verlässlichen Kontostände',
  geschaetzt: 'geschätzt: kein Bank-Kontostand bekannt, ab 0 € aufsummiert',
  nicht_eroeffnet: 'Konto noch nicht eröffnet',
  geschlossen: 'Konto zum Stichtag nicht mehr in Gebrauch',
  unbekannt: 'unbekannt: Stichtag liegt vor Beginn der Daten dieses Kontos',
};
