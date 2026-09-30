# Finanzen – private Finanzverwaltung

Schlichtes Dashboard für alle Buchungen: eine Suche, zwei Grafiken, Tabellen zum Herunterladen, Fixkosten, Vorjahresvergleich und ein Chat für Fragen in eigenen Worten.

Die App **zeigt nur an**. Sie ändert keine Daten. Die Buchungsliste entsteht in Google Drive unter `10 Finanzen` mit `Auswertung/_Programm/aktualisieren.py`. Das Skript schreibt `Finanzen.xlsx` und `Finanzen-Daten.json`, und die App liest die JSON-Datei.

## Bedienung

| Bereich | Was es kann |
|---|---|
| **Suche** | `rewe`, `rewe\|edeka`, `"dm drogerie"`, `-storno`, `49,99`, `>500`, `100-250`, `2024`, `2019-2021`, `03.2025`, `12.03.2025`, frei kombinierbar. Groß-/Kleinschreibung und Umlaute spielen keine Rolle. Vorschläge für Empfänger, Kategorien und Konten. |
| **Filter** | Jahr, Monat, Konto, Kategorie, Ausgaben/Einnahmen, Umbuchungen. **Zurück** (Alt + ←) macht den letzten Schritt rückgängig. |
| **Kennzahlen** | Einnahmen, Ausgaben, Überschuss, Buchungen, jeweils mit Vergleich zum gleichen Zeitraum des Vorjahres. |
| **Grafiken** | Verlauf nach Jahren oder Monaten (mit Vorjahreslinie), Kategorien → Unterkategorien. Ein Klick filtert. Die Grafik lässt sich als Bild speichern. |
| **Tabellen** | Buchungen, Kategorien × Jahre/Monate (mit Vorjahr), Fixkosten (automatisch erkannte Verträge und Abos), Konten mit Kontostand. Download als **Excel** oder **CSV**. |
| **Fragen** | Chat mit Claude, z. B. „Wie waren meine Kontostände am 31.12.2024?“ oder „Welche steuerlich relevanten Buchungen hatte ich 2025?“. Die Antworten kommen mit Tabellen, Grafiken und einem Knopf, der die passenden Buchungen im Dashboard öffnet. |

Jede Ansicht hat ihre eigene Adresse, z. B. `#jahr=2025&kat=Wohnen`, und lässt sich als Lesezeichen speichern.

## Datenschutz

- Der Code liegt öffentlich auf GitHub Pages und enthält **keine Daten**.
- Die Daten liest die App aus deinem Google Drive (Berechtigung `drive.readonly`, sie sucht nur nach `Finanzen-Daten.json`) oder aus einer Datei, die du auswählst. Die Kopie liegt nur im Browser des Geräts. Löschen: ⋮ → „Abmelden und Daten löschen“.
- **Chat:** Er nutzt deinen eigenen Anthropic-API-Schlüssel ([console.anthropic.com](https://console.anthropic.com/settings/keys)). Der Schlüssel wird nur auf dem Gerät gespeichert. An Anthropic gehen die Frage und die Zwischenergebnisse, die die KI über Werkzeuge abruft (Summen, Gruppen, einzelne Buchungen), nicht die ganze Datei. Die Antworten werden als reiner Text angezeigt, ohne Bilder und Links.

## Aufbau

`index.html`, `css/app.css`, `js/app.js` (Dashboard), `js/suche.js` (Suchsprache), `js/quelle.js` (Google Drive, Datei, Gerätespeicher), `js/export.js` (Excel/CSV), `js/chat.js` (Chat und Werkzeuge), `sw.js` (offline). Zum Testen auf dem eigenen Rechner: `Finanzen-Daten.json` nach `daten/` legen (wird nie hochgeladen) und `python -m http.server` starten.
