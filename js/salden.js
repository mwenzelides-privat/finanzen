// Kontostände zu einem Stichtag (Stand am Ende des Tages).
// Ausgangspunkt ist der letzte Bank-Kontostand je Konto; von dort wird mit den Buchungen der Liste
// zum Stichtag zurück- (oder vor-)gerechnet. Wie verlässlich das je Konto ist, hat dashboard_daten.py
// an jedem Tag mit Finanzguru-Kontostand geprüft (Feld „genauigkeit“, „pruefung“).
//   exakt           – stimmt mit den Bank-Kontoständen überein
//   ungefaehr       – kann um bis zu pruefung.maxAbw € abweichen (nur bis pruefung.abwBis, danach exakt)
//   unsicher        – für dieses Konto lassen sich frühere Stände nicht verlässlich berechnen (PayPal)
//   geschaetzt      – kein Bank-Kontostand bekannt, ab 0 € aufsummiert
//   nicht_eroeffnet – Konto gab es am Stichtag noch nicht (0 €)
//   unbekannt       – Stichtag liegt vor Beginn der Daten eines Kontos, das schon vorher Geld hatte
//   geschlossen     – Konto hatte zum Stichtag schon keine Buchungen mehr (letzte Buchung > 60 Tage vor Datenende)
export function kontostaende(D, datum) {
  const aktivBis = new Date(Date.parse(D.bis) - 60 * 864e5).toISOString().slice(0, 10);
  return D.konten.map((k, i) => {
    const rs = D.proKonto[i];
    const summe = (von, bis) => rs.reduce((s, r) => (r.d > von && r.d <= bis ? s + r.c : s), 0);
    const zu = k.bis < aktivBis;
    if (zu && datum > k.bis) return { k, i, c: null, status: 'geschlossen' };
    if (datum < k.von) {
      if (k.saldo == null || k.vollstaendig) return { k, i, c: 0, status: 'nicht_eroeffnet' };
      return { k, i, c: null, status: 'unbekannt' };
    }
    if (k.saldo == null) return { k, i, c: rs.reduce((s, r) => (r.d <= datum ? s + r.c : s), 0), status: 'geschaetzt' };
    // nach dem letzten bekannten Kontostand eines inzwischen geschlossenen Kontos: nur aus den Buchungen gerechnet
    if (zu && datum > k.saldoAm) return { k, i, c: Math.round(k.saldo * 100) + summe(k.saldoAm, datum), status: 'geschaetzt' };
    const s = Math.round(k.saldo * 100);
    const c = datum <= k.saldoAm ? s - summe(datum, k.saldoAm) : s + summe(k.saldoAm, datum);
    let status = 'exakt';
    if (datum < k.saldoAm && !k.vollstaendig) {
      const p = k.pruefung;
      if (k.genauigkeit === 'unsicher') status = 'unsicher';
      else if (k.genauigkeit === 'ungefaehr' && (!p?.abwBis || datum <= p.abwBis)) status = 'ungefaehr';
    }
    return { k, i, c: status === 'unsicher' ? null : c, status, abw: k.pruefung?.maxAbw };
  });
}

// Zählt der Wert in der Summe mit?
export const inSumme = (x) => x.c != null;

export const STATUS_TEXT = {
  exakt: 'exakt: stimmt mit den Bank-Kontoständen überein',
  ungefaehr: 'ungefähr: die Quellen weichen hier leicht voneinander ab',
  unsicher: 'nicht berechenbar: für dieses Konto liefert Finanzguru keine verlässlichen Kontostände',
  geschaetzt: 'geschätzt: kein Bank-Kontostand bekannt, ab 0 € aufsummiert',
  nicht_eroeffnet: 'Konto noch nicht eröffnet',
  geschlossen: 'Konto zum Stichtag nicht mehr in Gebrauch',
  unbekannt: 'unbekannt: Stichtag liegt vor Beginn der Daten dieses Kontos',
};
