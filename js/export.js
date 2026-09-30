// Tabellen herunterladen: Excel (.xlsx) oder CSV (Semikolon, deutsches Zahlenformat, öffnet direkt in Excel)
const XLSX_SRC = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = Object.assign(document.createElement('script'), { src: XLSX_SRC, async: true });
    s.onload = res;
    s.onerror = () => rej(new Error('Excel-Export konnte nicht geladen werden (keine Internetverbindung?). CSV geht auch offline.'));
    document.head.append(s);
  });
}

// spalten: [{ titel, typ: 'text' | 'datum' | 'euro' | 'zahl', breite }]; zeilen: Arrays (Datum als 'YYYY-MM-DD', Euro als Zahl)
export async function alsExcel(dateiname, blatt, spalten, zeilen) {
  return alsExcelMappe(dateiname, [{ blatt, spalten, zeilen }]);
}

// Mehrere Tabellenblätter in einer Datei: blaetter = [{ blatt, spalten, zeilen }]
export async function alsExcelMappe(dateiname, blaetter) {
  await loadXlsx();
  const X = window.XLSX;
  const wb = X.utils.book_new();
  for (const { blatt, spalten, zeilen } of blaetter) X.utils.book_append_sheet(wb, blattBauen(X, spalten, zeilen), blatt.slice(0, 31));
  X.writeFile(wb, dateiname + '.xlsx', { compression: true });
}

function blattBauen(X, spalten, zeilen) {
  const aoa = [spalten.map((s) => s.titel), ...zeilen.map((z) => z.map((v, i) => {
    if (v === '' || v == null) return null;
    if (spalten[i].typ === 'datum') { const [y, m, d] = v.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); }
    return v;
  }))];
  const ws = X.utils.aoa_to_sheet(aoa, { cellDates: true });
  const range = X.utils.decode_range(ws['!ref']);
  for (let c = 0; c < spalten.length; c++) {
    const z = { euro: '#,##0.00 "€";[Red]-#,##0.00 "€"', datum: 'dd.mm.yyyy', zahl: '0' }[spalten[c].typ];
    if (!z) continue;
    for (let r = 1; r <= range.e.r; r++) { const cell = ws[X.utils.encode_cell({ r, c })]; if (cell) cell.z = z; }
  }
  ws['!cols'] = spalten.map((s) => ({ wch: s.breite || 14 }));
  ws['!autofilter'] = { ref: ws['!ref'] };
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  return ws;
}

export function alsCsv(dateiname, spalten, zeilen) {
  const q = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const f = (v, s) => {
    if (v === '' || v == null) return '';
    if (s.typ === 'euro') return v.toFixed(2).replace('.', ',');
    if (s.typ === 'datum') return `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)}`;
    return q(v);
  };
  const text = [spalten.map((s) => q(s.titel)).join(';'), ...zeilen.map((z) => z.map((v, i) => f(v, spalten[i])).join(';'))].join('\r\n');
  herunterladen(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }), dateiname + '.csv');
}

export function herunterladen(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
