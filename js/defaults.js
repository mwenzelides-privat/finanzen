// Standard-Kategorien, -Regeln und Steuer-Stammdaten.
// Feste IDs, damit ein neues Gerät vor dem ersten Sync keine Duplikate erzeugt.

export const GROUPS = ['Einnahmen', 'Wohnen', 'Lebenshaltung', 'Mobilität', 'Freizeit', 'Finanzen', 'Sonstiges', 'Umbuchungen'];

export const DEFAULT_CATEGORIES = [
  ['gehalt', 'Gehalt & Lohn', 'Einnahmen', 'income'],
  ['zinsen', 'Zinsen & Dividenden', 'Einnahmen', 'income'],
  ['erstattung', 'Erstattungen', 'Einnahmen', 'income'],
  ['einnahmen-sonst', 'Sonstige Einnahmen', 'Einnahmen', 'income'],
  ['miete', 'Miete & Wohnkredit', 'Wohnen', 'expense'],
  ['energie', 'Strom, Gas & Nebenkosten', 'Wohnen', 'expense'],
  ['internet', 'Internet & Telefon', 'Wohnen', 'expense'],
  ['haushalt', 'Haushalt & Einrichtung', 'Wohnen', 'expense'],
  ['lebensmittel', 'Lebensmittel', 'Lebenshaltung', 'expense'],
  ['drogerie', 'Drogerie', 'Lebenshaltung', 'expense'],
  ['kleidung', 'Kleidung', 'Lebenshaltung', 'expense'],
  ['gesundheit', 'Gesundheit & Apotheke', 'Lebenshaltung', 'expense'],
  ['tanken', 'Tanken & Laden', 'Mobilität', 'expense'],
  ['auto', 'Auto (Werkstatt, Steuer)', 'Mobilität', 'expense'],
  ['oepnv', 'ÖPNV & Bahn', 'Mobilität', 'expense'],
  ['restaurant', 'Restaurant & Café', 'Freizeit', 'expense'],
  ['freizeit', 'Freizeit & Hobby', 'Freizeit', 'expense'],
  ['abos', 'Abos & Streaming', 'Freizeit', 'expense'],
  ['urlaub', 'Urlaub & Reisen', 'Freizeit', 'expense'],
  ['versicherung', 'Versicherungen', 'Finanzen', 'expense'],
  ['steuern', 'Steuern & Abgaben', 'Finanzen', 'expense'],
  ['gebuehren', 'Bankgebühren', 'Finanzen', 'expense'],
  ['bargeld', 'Bargeld', 'Sonstiges', 'expense'],
  ['geschenke', 'Geschenke & Spenden', 'Sonstiges', 'expense'],
  ['bildung', 'Bildung & Bücher', 'Sonstiges', 'expense'],
  ['sonstiges', 'Sonstige Ausgaben', 'Sonstiges', 'expense'],
  ['umbuchung', 'Umbuchung / Sparen', 'Umbuchungen', 'transfer'],
  ['kreditkarte', 'Kreditkartenabrechnung', 'Umbuchungen', 'transfer'],
].map(([id, name, group, type], i) => ({ id: 'cat-' + id, name, group, type, order: i, updatedAt: 1 }));

// match: Suchbegriffe, mit | getrennt (Groß-/Kleinschreibung egal)
export const DEFAULT_RULES = [
  ['gehalt', 'lohn/gehalt|gehalt|bezüge|bezuege|entgelt ', 'in'],
  ['zinsen', 'zinsen|dividende|ausschüttung|ertragsgutschrift', 'in'],
  ['umbuchung', 'umbuchung|übertrag|uebertrag|sparplan|dauerauftrag an eigenes', 'any'],
  ['kreditkarte', 'kreditkartenabrechnung|kreditkarte abrechnung|visa abrechnung|mastercard abrechnung', 'any'],
  ['lebensmittel', 'rewe|edeka|aldi|lidl|netto|penny|kaufland|norma|tegut|globus|real ,|hit markt|marktkauf|bäckerei|baeckerei', 'out'],
  ['drogerie', 'dm-drogerie|dm drogerie|dm fil|rossmann|budni|mueller drogerie', 'out'],
  ['tanken', 'shell|aral|esso|jet tankstelle|totalenergies|tankstelle|agip|ionity|enbw mobility|avia', 'out'],
  ['abos', 'netflix|spotify|disney plus|disney+|amazon prime|dazn|youtube premium|apple.com/bill|audible|sky deutschland|rtl+', 'out'],
  ['miete', 'miete|hausgeld|wohnungsbau', 'out'],
  ['energie', 'stadtwerke|e.on|eon energie|vattenfall|stromrechnung|abschlag strom|abschlag gas|entega|mainova|rheinenergie|naturstrom', 'out'],
  ['internet', 'telekom|vodafone|telefonica|1&1|congstar|o2 germany|freenet|unitymedia|pyur', 'out'],
  ['oepnv', 'deutsche bahn|db vertrieb|bahn.de|flixbus|deutschlandticket|mvv|hvv|bvg|rmv|vrr|kvb', 'out'],
  ['gesundheit', 'apotheke|zahnarzt|arztpraxis|praxis dr|klinikum|optiker|fielmann', 'out'],
  ['versicherung', 'versicherung|allianz|huk-coburg|huk coburg|ergo |axa |devk|debeka|signal iduna|r+v|generali|barmenia', 'out'],
  ['steuern', 'finanzamt|kfz-steuer|bundeskasse|rundfunk|gez|ard zdf', 'out'],
  ['restaurant', 'restaurant|lieferando|wolt|mcdonald|burger king|starbucks|cafe |café|pizzeria|gastro', 'out'],
  ['haushalt', 'ikea|obi |bauhaus|hornbach|toom|hagebau|poco|xxxlutz|dänisches bettenlager|jysk', 'out'],
  ['kleidung', 'zalando|h&m|c&a|primark|zara|deichmann|about you|peek & cloppenburg', 'out'],
  ['bargeld', 'bargeldauszahlung|geldautomat|auszahlung gaa|atm |bargeld', 'out'],
  ['gebuehren', 'kontoführung|kontofuehrung|entgelt kontof|abschluss|kartengebühr|kartenpreis', 'out'],
  ['urlaub', 'booking.com|airbnb|lufthansa|ryanair|eurowings|condor|tui |expedia|check24 reise|holidaycheck|fewo', 'out'],
  ['geschenke', 'spende|unicef|ärzte ohne grenzen|aerzte ohne grenzen|caritas|diakonie|greenpeace|wwf', 'out'],
  ['bildung', 'thalia|hugendubel|udemy|volkshochschule|vhs ', 'out'],
].map(([cat, match, sign]) => ({
  id: 'rule-' + cat, match, field: 'any', sign, categoryId: 'cat-' + cat,
  taxCategory: cat === 'geschenke' ? 'so_spenden' : null, prio: 0, updatedAt: 1,
}));

export const ACCOUNT_TYPES = {
  giro: 'Girokonto',
  spar: 'Tagesgeld / Sparkonto',
  kredit: 'Kreditkarte',
  bar: 'Bargeld',
  depot: 'Depot',
  paypal: 'PayPal',
  sonstig: 'Sonstiges',
};

export const TAX_CATEGORIES = [
  { id: 'wk_fahrt', label: 'Fahrt- und Reisekosten', group: 'Werbungskosten (Anlage N)', short: 'WK Fahrt' },
  { id: 'wk_arbeitsmittel', label: 'Arbeitsmittel (PC, Werkzeug, Fachliteratur)', group: 'Werbungskosten (Anlage N)', short: 'WK Arbeitsmittel' },
  { id: 'wk_fortbildung', label: 'Fortbildung', group: 'Werbungskosten (Anlage N)', short: 'WK Fortbildung' },
  { id: 'wk_sonstige', label: 'Sonstige (Bewerbung, Umzug, Gewerkschaft, Kontoführung)', group: 'Werbungskosten (Anlage N)', short: 'WK Sonstige' },
  { id: 'so_vorsorge', label: 'Versicherungen (Kranken-, Pflege-, Haftpflicht, BU …)', group: 'Vorsorgeaufwand', short: 'Vorsorge' },
  { id: 'so_rente', label: 'Altersvorsorge (Rürup, Riester, bAV-Eigenanteil)', group: 'Vorsorgeaufwand', short: 'Altersvorsorge' },
  { id: 'so_kirche', label: 'Kirchensteuer (gezahlt)', group: 'Sonderausgaben', short: 'Kirchensteuer' },
  { id: 'so_spenden', label: 'Spenden & Mitgliedsbeiträge', group: 'Sonderausgaben', short: 'Spenden' },
  { id: 'so_kinder', label: 'Kinderbetreuung', group: 'Sonderausgaben', short: 'Kinderbetreuung' },
  { id: 'ag_krank', label: 'Krankheitskosten (Zuzahlungen, Brille, Zahnersatz)', group: 'Außergewöhnliche Belastungen', short: 'Krankheit' },
  { id: 'hh_dienst', label: 'Haushaltsnahe Dienstleistungen (§35a)', group: 'Steuerermäßigung §35a', short: '§35a Dienstl.' },
  { id: 'hh_handwerker', label: 'Handwerkerleistungen – nur Arbeitskosten (§35a)', group: 'Steuerermäßigung §35a', short: '§35a Handwerker' },
  { id: 'kap', label: 'Kapitalerträge', group: 'Kapitalerträge (Anlage KAP)', short: 'Kapitalerträge' },
];
export const taxCat = (id) => TAX_CATEGORIES.find((t) => t.id === id);

// Werte ohne Gewähr – bitte jährlich prüfen. Beträge in Cent.
export function taxRates(year) {
  const y = Number(year);
  return {
    pendlerFirst20: y >= 2026 ? 38 : 30, // Cent pro km (erste 20 km)
    pendlerAbove20: y >= 2022 ? 38 : 35, // Cent pro km ab km 21
    homeofficeDay: y >= 2023 ? 600 : 500,
    homeofficeMax: y >= 2023 ? 126000 : 60000,
    anPausch: y >= 2023 ? 123000 : y === 2022 ? 120000 : 100000, // Arbeitnehmer-Pauschbetrag
    soPausch: 3600, // Sonderausgaben-Pauschbetrag
    hhDienstRate: 0.2, hhDienstMax: 400000, // Steuerermäßigung max. 4.000 €
    hhHandwerkerRate: 0.2, hhHandwerkerMax: 120000, // max. 1.200 €
  };
}

export const TAX_CHECKLIST = [
  ['lstb', 'Lohnsteuerbescheinigung(en)'],
  ['kv', 'Bescheinigung Kranken-/Pflegeversicherung'],
  ['rente', 'Renten-/Riester-/Rürup-Bescheinigungen'],
  ['kap', 'Jahressteuerbescheinigungen der Banken'],
  ['spenden', 'Spendenquittungen'],
  ['nk', 'Nebenkostenabrechnung (für §35a)'],
  ['handwerker', 'Handwerkerrechnungen mit Überweisungsbeleg'],
  ['fahrt', 'Arbeitstage & Entfernung zur Arbeit'],
  ['arbeitsmittel', 'Belege für Arbeitsmittel & Fortbildung'],
  ['krank', 'Belege Krankheitskosten'],
];
