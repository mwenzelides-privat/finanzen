import { store } from '../store.js';
import { esc, fmtDate, money, ls } from '../util.js';
import { icon } from '../icons.js';
import { bindActions, toast, confirmDialog, catChip, amountCell, rerender } from '../ui.js';
import {
  readFile, findHeaderRow, guessMapping, buildItems, markDuplicates, commitImport, undoImport,
  FIELDS, headerSignature, metaIban, guessCategory, accountResolver, categoryFinder, isFinanzguru, guessAccountType,
} from '../importer.js';
import { compileRules } from '../categorize.js';
import { ACCOUNT_TYPES } from '../defaults.js';
import { isDepotExport, parseDepot, commitDepot, linkedTrades } from '../depot.js';

export const title = 'Import';

// Zustand des laufenden Imports (bleibt bei Neuaufbau der Seite erhalten)
let job = null;

export function render(root, { params }) {
  const presetAccount = params?.get('account') || '';
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Import</h1><p class="sub">Kontoauszüge als CSV oder Excel, auch Finanzguru-Exporte. Duplikate werden automatisch erkannt.</p></div>
    </div>
    ${job ? '' : `
    <section class="card">
      <label class="dropzone" id="drop">
        <input type="file" accept=".csv,.txt,.xlsx,.xls,.xlsm,.ods" hidden>
        ${icon('upload')}
        <b>Datei hierher ziehen oder klicken</b>
        <span class="muted small">CSV-Export deiner Bank (Sparkasse, Volksbank, ING, DKB, comdirect, Postbank …), Finanzguru-Export oder eine Excel-Liste</span>
      </label>
    </section>
    <section class="card">
      <details class="help-box"><summary>${icon('info')} So bekommst du die Datei</summary>
        <ul>
          <li><b>Sparkasse:</b> Umsätze → Zeitraum wählen → Export → „CSV-CAMT“.</li>
          <li><b>Volksbank / Raiffeisen:</b> Umsätze → Exportieren → CSV.</li>
          <li><b>ING:</b> Umsätze → Zeitraum → „Exportieren“ (CSV).</li>
          <li><b>DKB:</b> Umsätze → Download-Symbol → CSV.</li>
          <li><b>comdirect:</b> Umsätze → „Umsätze exportieren“ → CSV.</li>
          <li><b>Finanzguru:</b> Export „Alle Buchungen“ (Excel). Alle Konten, Kategorien, Umbuchungen, Tags und Kontostände werden übernommen.</li>
          <li><b>Eigene Excel-Liste:</b> Spalten wie Datum, Betrag, Beschreibung, Kategorie, Konto werden erkannt. Fehlende Kategorien und Konten werden angelegt.</li>
        </ul>
        <p class="small muted">Die Datei wird nur in deinem Browser gelesen und nirgendwohin hochgeladen. Mehrfach importierte Zeiträume sind kein Problem, bereits vorhandene Buchungen werden übersprungen.</p>
      </details>
    </section>`}
    <div id="job"></div>
    ${history()}`;

  if (!job) {
    const drop = root.querySelector('#drop');
    const input = drop.querySelector('input');
    input.addEventListener('change', () => input.files[0] && start(input.files[0], presetAccount));
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) start(f, presetAccount); });
  } else if (job.kind === 'depot') {
    renderDepotJob(root.querySelector('#job'));
  } else {
    renderJob(root.querySelector('#job'));
  }

  bindActions(root, {
    undo: async (el) => {
      const imp = store.get('imports', el.dataset.id);
      const extra = imp?.created ? ' Dabei angelegte Konten, Kategorien und Regeln werden ebenfalls entfernt.' : '';
      if (!(await confirmDialog(`Import „${imp?.fileName}“ rückgängig machen? ${imp?.count} Buchungen werden gelöscht.${extra}`, { ok: 'Rückgängig machen' }))) return;
      toast(`${undoImport(el.dataset.id)} Buchungen entfernt`);
    },
    cancel: () => { job = null; rerender(); },
    commit: (el) => {
      el.disabled = true;
      el.textContent = 'Importiere …';
      // kurz warten, damit der Button-Zustand sichtbar wird (große Dateien)
      setTimeout(() => {
        const res = commitImport(job.items, {
          accountId: job.accountId === '_new' ? null : job.accountId,
          newAccount: job.accountId === '_new' ? { name: job.newName.trim() || job.fileName, iban: job.iban, type: guessAccountType(job.newName) } : null,
          fileName: job.fileName, autoCat: job.autoCat, rows: job.rows, headerIdx: job.headerIdx, map: job.map,
          learnRules: job.learnRules, cleanupDefaults: job.cleanupDefaults, format: job.format,
        });
        if (!job.multi) {
          const presets = ls.json('fv.importPresets', {});
          const acc = store.all('accounts').find((a) => a.id === job.accountId) || store.all('accounts').find((a) => a.name === (job.newName.trim() || job.fileName));
          presets[job.sig] = { map: job.map, invert: job.invert, accountId: acc?.id || null };
          ls.setJSON('fv.importPresets', presets);
        }
        job = null;
        const parts = [`${res.imported} Buchungen importiert`];
        if (res.dup) parts.push(`${res.dup} schon vorhanden`);
        if (res.accounts) parts.push(`${res.accounts} Konten angelegt`);
        if (res.categories) parts.push(`${res.categories} Kategorien angelegt`);
        if (res.rules) parts.push(`${res.rules} Regeln gelernt`);
        toast(parts.join(' · '), 'success', 7000);
        location.hash = res.imported ? `#/buchungen?batch=${res.batchId}&period=all` : '#/import';
      }, 30);
    },
  });
}

async function start(file, presetAccount) {
  try {
    const data = await readFile(file);
    const sheet = data.sheets[0];
    if (!sheet || !sheet.rows.length) throw new Error('Die Datei enthält keine lesbaren Zeilen.');
    // Depotübersicht (Wertpapiere mit ISIN und Kurswert) statt Kontoumsätzen?
    if (isDepotExport(sheet.rows)) {
      const parsed = parseDepot(sheet.rows);
      if (!parsed.positions.length) throw new Error('In der Depotübersicht wurden keine Wertpapiere mit ISIN und Kurswert gefunden.');
      const depots = store.all('accounts').filter((a) => a.type === 'depot' && !a.archived);
      const match = depots.find((a) => parsed.depotNo && a.ref === parsed.depotNo) || depots.find((a) => (a.isins || []).some((i) => parsed.positions.some((p) => p.isin === i))) || depots[0];
      const allRows = sheet.rows.slice(0, 15).map((r) => r.join(' ')).join(' ') + ' ' + file.name;
      const bank = /\bING\b|diba/i.test(allRows) ? 'ING' : '';
      job = { kind: 'depot', fileName: file.name, parsed, accountId: match?.id || '_new', newName: bank ? `${bank} Depot` : 'Depot', bank };
      rerender();
      return;
    }
    const headerIdx = findHeaderRow(sheet.rows);
    const header = sheet.rows[headerIdx] || [];
    const sig = headerSignature(header);
    const preset = ls.json('fv.importPresets', {})[sig];
    const iban = metaIban(sheet.rows, headerIdx);
    const byIban = iban && store.all('accounts').find((a) => a.iban === iban);
    const fg = isFinanzguru(header);
    const accountId = presetAccount || byIban?.id || (preset?.accountId && store.get('accounts', preset.accountId) ? preset.accountId : '') || store.all('accounts').find((a) => !a.archived)?.id || '_new';
    // Standardkategorien nur dann aufräumen, wenn noch keine eigenen Buchungen darauf liegen
    const hasOwnData = store.all('transactions').some((t) => !t.demo);
    job = {
      fileName: file.name, data, sheet: 0, rows: sheet.rows, headerIdx, sig, iban,
      format: fg ? 'finanzguru' : data.kind,
      map: preset?.map || guessMapping(header), invert: !!preset?.invert, autoCat: true,
      learnRules: fg, cleanupDefaults: fg && !hasOwnData,
      accountId, newName: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 40),
    };
    rerender();
  } catch (e) {
    console.error(e);
    toast(e.message || 'Datei konnte nicht gelesen werden', 'error', 6000);
  }
}

function computeItems() {
  job.items = buildItems(job.rows, job.headerIdx, job.map, { invert: job.invert });
  const target = job.accountId === '_new' ? '_new' : job.accountId;
  const resolve = accountResolver(null);
  markDuplicates(job.items, (it) => resolve(it) || target);
  const compiled = compileRules();
  const findCat = categoryFinder();
  for (const it of job.items) if (it.valid) it.guess = job.autoCat || it.category ? guessCategory(it, job.autoCat ? compiled : [], findCat) : null;
  // Konten-Übersicht (bei Dateien mit Konto-Spalte)
  const accs = new Map();
  for (const it of job.items) {
    if (!it.valid || !it.accountId || it.accountId === '_new' || it.accountId === target && !it.account) continue;
    const e = accs.get(it.accountId) || { id: it.accountId, name: it.account, ref: it.accountRef, n: 0, fresh: 0, last: '', balance: null };
    e.n++;
    if (!it.dup) e.fresh++;
    if (it.date > e.last) { e.last = it.date; if (it.balance != null) e.balance = it.balance; }
    accs.set(it.accountId, e);
  }
  job.accounts = [...accs.values()].sort((a, b) => b.n - a.n);
  job.multi = job.accounts.length > 1 || (job.map.account != null && job.items.filter((i) => i.valid).every((i) => i.account));
}

function renderJob(host) {
  computeItems();
  const header = job.rows[job.headerIdx] || [];
  const colOpts = (sel) => `<option value="">–</option>` + header.map((h, i) => `<option value="${i}" ${String(sel) === String(i) ? 'selected' : ''}>${esc(String(h || `Spalte ${i + 1}`))}</option>`).join('');
  const valid = job.items.filter((i) => i.valid);
  const fresh = valid.filter((i) => !i.dup);
  const dups = valid.length - fresh.length;
  const splits = job.items.filter((i) => i.splitOriginal).length;
  const invalid = job.items.length - valid.length - splits;
  const transfers = fresh.filter((i) => i.transfer).length;
  const newCats = new Set(fresh.filter((i) => i.guess?.source === 'new').map((i) => i.guess.newName));
  const cm = store.byId('categories');
  const hasAmount = job.map.amount != null || job.map.debit != null || job.map.credit != null;
  const needsTarget = !job.multi;
  const ready = job.map.date != null && hasAmount && fresh.length > 0 && (!needsTarget || job.accountId !== '_new' || job.newName.trim());
  const sumIn = fresh.filter((i) => i.amount > 0 && !i.transfer).reduce((s, i) => s + i.amount, 0);
  const sumOut = fresh.filter((i) => i.amount < 0 && !i.transfer).reduce((s, i) => s - i.amount, 0);
  const dates = valid.map((i) => i.date).sort();

  host.innerHTML = `
    <section class="card">
      <div class="card-h"><h2>${icon('file')} ${esc(job.fileName)}</h2><button class="btn btn-ghost btn-sm" data-action="cancel">${icon('x')} Abbrechen</button></div>
      ${job.format === 'finanzguru' ? `<div class="notice static">${icon('check')}<span><b>Finanzguru-Export erkannt</b> · ${valid.length.toLocaleString('de-DE')} Buchungen${dates.length ? ` von ${fmtDate(dates[0])} bis ${fmtDate(dates[dates.length - 1])}` : ''} · ${job.accounts.length} Konten · ${splits ? `${splits} Split-Originale werden übersprungen (ihre Teilbuchungen werden importiert)` : ''}</span></div>` : ''}
      <div class="form-grid cols-3">
        ${job.data.sheets.length > 1 ? `<label class="field"><span class="field-label">Tabellenblatt</span><select data-j="sheet">${job.data.sheets.map((s, i) => `<option value="${i}" ${i === job.sheet ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : ''}
        ${needsTarget ? `<label class="field"><span class="field-label">Zielkonto</span>
          <select data-j="accountId">${store.all('accounts').filter((a) => !a.archived).map((a) => `<option value="${a.id}" ${a.id === job.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}<option value="_new" ${job.accountId === '_new' ? 'selected' : ''}>+ Neues Konto anlegen …</option></select></label>
        ${job.accountId === '_new' ? `<label class="field"><span class="field-label">Name des neuen Kontos</span><input data-j="newName" value="${esc(job.newName)}"></label>` : ''}` : ''}
        <label class="field"><span class="field-label">Kopfzeile ist Zeile</span><input type="number" min="1" max="${job.rows.length}" data-j="headerIdx" value="${job.headerIdx + 1}"></label>
      </div>
      <details class="mapping" ${job.map.date == null || !hasAmount ? 'open' : ''}>
        <summary>Spaltenzuordnung ${job.map.date != null && hasAmount ? `<span class="badge good">${icon('check')} erkannt</span>` : '<span class="badge bad">bitte prüfen</span>'}</summary>
        <div class="form-grid cols-4">${FIELDS.map((f) => `<label class="field"><span class="field-label">${esc(f.label)}${f.required ? ' *' : ''}</span><select data-map="${f.key}">${colOpts(job.map[f.key])}</select></label>`).join('')}</div>
        <p class="small muted">Betrag entweder als eine Spalte (mit Vorzeichen) oder als getrennte Soll/Haben-Spalten.</p>
      </details>
      <div class="check-row">
        <label class="check"><input type="checkbox" data-j="autoCat" ${job.autoCat ? 'checked' : ''}> Buchungen ohne Kategorie per Regeln kategorisieren</label>
        <label class="check"><input type="checkbox" data-j="invert" ${job.invert ? 'checked' : ''}> Vorzeichen umkehren (z. B. bei Kreditkarten-Exporten)</label>
        ${job.map.category != null ? `<label class="check"><input type="checkbox" data-j="learnRules" ${job.learnRules ? 'checked' : ''}> Aus der Historie Regeln lernen (künftige Bank-Importe werden genauso kategorisiert)</label>
        <label class="check"><input type="checkbox" data-j="cleanupDefaults" ${job.cleanupDefaults ? 'checked' : ''}> Ungenutzte Standardkategorien entfernen</label>` : ''}
      </div>
    </section>

    ${job.accounts.length ? `<section class="card">
      <div class="card-h"><h2>${icon('wallet')} Konten in der Datei</h2><span class="muted small">Vorhandene Konten werden über IBAN oder Namen erkannt, fehlende angelegt</span></div>
      <div class="table-wrap"><table class="table compact">
        <thead><tr><th>Konto</th><th class="hide-sm">Kennung</th><th>Art</th><th class="num">Buchungen</th><th class="num">neu</th><th class="num">Kontostand</th><th>Status</th></tr></thead>
        <tbody>${job.accounts.map((a) => {
          const ex = !a.id.startsWith('_new');
          const acc = ex ? store.get('accounts', a.id) : null;
          return `<tr><td><b>${esc(acc?.name || a.name)}</b></td><td class="hide-sm mono muted">${esc(mask(a.ref))}</td>
            <td class="small">${esc(ACCOUNT_TYPES[acc?.type || guessAccountType(a.name)])}</td>
            <td class="num">${a.n.toLocaleString('de-DE')}</td><td class="num">${a.fresh.toLocaleString('de-DE')}</td>
            <td class="num">${a.balance != null ? money(a.balance) : '–'}${a.last ? `<div class="tx-sub">${fmtDate(a.last)}</div>` : ''}</td>
            <td>${ex ? '<span class="badge">vorhanden</span>' : '<span class="badge good">wird angelegt</span>'}</td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="small muted">Kontoart (Giro, Tagesgeld, Kreditkarte …) ist geschätzt und lässt sich danach unter <b>Konten</b> ändern. Kinderkonten o. Ä. kannst du dort archivieren, dann zählen sie nicht zum Vermögen.</p>
    </section>` : ''}

    <section class="card">
      <div class="card-h"><h2>Vorschau</h2>
        <div class="import-stats">
          <span class="badge good">${fresh.length.toLocaleString('de-DE')} neu</span>
          ${dups ? `<span class="badge">${dups.toLocaleString('de-DE')} schon vorhanden</span>` : ''}
          ${transfers ? `<span class="badge" title="Zählen nicht als Einnahme/Ausgabe">${icon('repeat')} ${transfers.toLocaleString('de-DE')} Umbuchungen</span>` : ''}
          ${newCats.size ? `<span class="badge">${newCats.size} neue Kategorien</span>` : ''}
          ${invalid ? `<span class="badge bad" title="Ohne gültiges Datum/Betrag oder vorgemerkt">${invalid} übersprungen</span>` : ''}
        </div>
      </div>
      <div class="table-wrap preview"><table class="table compact">
        <thead><tr><th>Datum</th><th>Empfänger / Zweck</th><th class="hide-sm">Kategorie</th>${job.multi ? '<th class="hide-md">Konto</th>' : ''}<th class="num">Betrag</th><th>Status</th></tr></thead>
        <tbody>${job.items.slice(0, 60).map((it) => `<tr class="${!it.valid ? 'row-invalid' : it.dup ? 'row-dup' : ''}">
          <td class="nowrap">${it.date ? fmtDate(it.date) : '<span class="muted">?</span>'}</td>
          <td class="grow"><div class="tx-main">${esc(it.payee || it.purpose || it.text || '–')}</div><div class="tx-sub">${esc(it.payee ? it.purpose : '')}</div></td>
          <td class="hide-sm">${it.guess?.categoryId ? catChip(cm.get(it.guess.categoryId)) : it.guess?.newName ? `<span class="chip">${esc(it.guess.newName)} <span class="muted">(neu)</span></span>` : '<span class="muted small">–</span>'}</td>
          ${job.multi ? `<td class="hide-md small muted">${esc(store.get('accounts', it.accountId)?.name || it.account || '')}</td>` : ''}
          <td class="num">${it.amount != null ? amountCell(it.amount, it.transfer ? 'transfer' : undefined) : '<span class="muted">?</span>'}</td>
          <td class="nowrap">${it.splitOriginal ? '<span class="badge" title="Wird durch seine Teilbuchungen ersetzt">Split-Original</span>' : !it.valid ? `<span class="badge bad">${it.pending ? 'vorgemerkt' : 'ungültig'}</span>` : it.dup ? '<span class="badge">vorhanden</span>' : `<span class="badge good">neu</span>${it.transfer ? ` <span class="badge">${icon('repeat')}</span>` : ''}`}</td>
        </tr>`).join('')}</tbody></table>
        ${job.items.length > 60 ? `<p class="muted small center">… und ${(job.items.length - 60).toLocaleString('de-DE')} weitere Zeilen</p>` : ''}
      </div>
      <div class="row-between import-foot">
        <span class="small muted">Neu (ohne Umbuchungen): Eingänge <b class="amt-in">${money(sumIn)}</b> · Ausgänge <b class="amt-out">${money(sumOut)}</b></span>
        <button class="btn btn-primary" data-action="commit" ${ready ? '' : 'disabled'}>${icon('check')} ${fresh.length.toLocaleString('de-DE')} Buchungen importieren</button>
      </div>
    </section>`;

  host.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.map) {
      if (el.value === '') delete job.map[el.dataset.map]; else job.map[el.dataset.map] = +el.value;
    } else if (el.dataset.j) {
      const k = el.dataset.j;
      if (['autoCat', 'invert', 'learnRules', 'cleanupDefaults'].includes(k)) job[k] = el.checked;
      else if (k === 'headerIdx') { job.headerIdx = Math.max(0, Math.min(job.rows.length - 1, (+el.value || 1) - 1)); job.map = guessMapping(job.rows[job.headerIdx] || []); }
      else if (k === 'sheet') { job.sheet = +el.value; job.rows = job.data.sheets[job.sheet].rows; job.headerIdx = findHeaderRow(job.rows); job.map = guessMapping(job.rows[job.headerIdx] || []); }
      else job[k] = el.value;
    } else return;
    rerender();
  });
}

function renderDepotJob(host) {
  const p = job.parsed;
  const gain = p.cost != null ? p.value - p.cost : null;
  const trades = linkedTrades(p.positions.map((x) => x.isin));
  const buys = trades.filter((t) => t.amount < 0);
  const tradeAccs = [...new Set(trades.map((t) => store.get('accounts', t.accountId)?.name).filter(Boolean))];
  const depots = store.all('accounts').filter((a) => a.type === 'depot' && !a.archived);
  const existing = job.accountId !== '_new' ? store.get('accounts', job.accountId) : null;
  const pct = (a, b) => (b ? `${a >= 0 ? '+' : ''}${((a / b) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %` : '');
  host.innerHTML = `
    <section class="card">
      <div class="card-h"><h2>${icon('chart')} ${esc(job.fileName)}</h2><button class="btn btn-ghost btn-sm" data-action="cancel">${icon('x')} Abbrechen</button></div>
      <div class="notice static">${icon('check')}<span><b>Depotübersicht erkannt</b> · ${p.positions.length} Wertpapiere · Stand ${fmtDate(p.date)}${p.depotNo ? ` · Depot ${esc(mask(p.depotNo))}` : ''}</span></div>
      <section class="stats stats-3">
        <div class="card stat"><div class="stat-label">Depotwert</div><div class="stat-value">${money(p.value)}</div></div>
        <div class="card stat"><div class="stat-label">Einstandswert</div><div class="stat-value">${p.cost != null ? money(p.cost) : '–'}</div></div>
        <div class="card stat"><div class="stat-label">Gewinn / Verlust</div><div class="stat-value ${gain < 0 ? 'text-bad' : gain > 0 ? 'text-good' : ''}">${gain != null ? money(gain) : '–'}</div><div class="muted small">${gain != null ? pct(gain, p.cost) : ''}</div></div>
      </section>
      <div class="form-grid cols-3">
        <label class="field"><span class="field-label">Depot-Konto</span>
          <select data-j="accountId">${depots.map((a) => `<option value="${a.id}" ${a.id === job.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}<option value="_new" ${job.accountId === '_new' ? 'selected' : ''}>+ Neues Depot anlegen …</option></select></label>
        ${job.accountId === '_new' ? `<label class="field"><span class="field-label">Name des Depots</span><input data-j="newName" value="${esc(job.newName)}"></label>` : ''}
      </div>
      ${existing?.valueHistory?.length ? `<p class="small muted">Bisher gespeicherte Stände: ${existing.valueHistory.length}, zuletzt ${fmtDate(existing.valueHistory[existing.valueHistory.length - 1].date)} mit ${money(existing.valueHistory[existing.valueHistory.length - 1].value)}. Ein Stand für denselben Stichtag wird ersetzt.</p>` : ''}
      ${buys.length ? `<p class="small">${icon('link')} <b>${buys.length} Wertpapierkäufe</b> über zusammen <b>${money(-buys.reduce((s, t) => s + t.amount, 0))}</b> gefunden (${esc(tradeAccs.join(', '))}). Damit schätzt die App den Depotwert auch für die Zeit vor diesem Stichtag, und der Vermögensverlauf bleibt stimmig.</p>` : ''}
    </section>
    <section class="card">
      <div class="card-h"><h2>Positionen</h2></div>
      <div class="table-wrap"><table class="table compact">
        <thead><tr><th>Wertpapier</th><th class="num hide-sm">Stück</th><th class="num hide-sm">Kurs</th><th class="num">Kurswert</th><th class="num hide-sm">Einstand</th><th class="num">G/V</th></tr></thead>
        <tbody>${p.positions.sort((a, b) => b.value - a.value).map((x) => {
          const g = x.cost != null ? x.value - x.cost : null;
          return `<tr><td class="grow"><div class="tx-main">${esc(x.name)}</div><div class="tx-sub mono">${esc(x.isin)}</div></td>
            <td class="num hide-sm">${x.qty != null ? x.qty.toLocaleString('de-DE', { maximumFractionDigits: 4 }) : '–'}</td>
            <td class="num hide-sm">${x.price != null ? money(x.price) : '–'}</td>
            <td class="num"><b>${money(x.value)}</b></td>
            <td class="num hide-sm muted">${x.cost != null ? money(x.cost) : '–'}</td>
            <td class="num ${g < 0 ? 'text-bad' : g > 0 ? 'text-good' : 'muted'}">${g != null ? `${money(g)}<div class="tx-sub">${pct(g, x.cost)}</div>` : '–'}</td></tr>`;
        }).join('')}</tbody></table></div>
      <div class="row-between import-foot">
        <span class="small muted">Tipp: Die Übersicht regelmäßig neu importieren (z. B. monatlich). Jeder Stichtag wird gespeichert und ergibt den Wertverlauf.</span>
        <button class="btn btn-primary" data-action="commitDepot" ${job.accountId !== '_new' || job.newName.trim() ? '' : 'disabled'}>${icon('check')} Depotstand übernehmen</button>
      </div>
    </section>`;
  host.addEventListener('change', (e) => {
    const k = e.target.dataset.j;
    if (!k) return;
    job[k] = e.target.value;
    rerender();
  });
  host.querySelector('[data-action=commitDepot]').addEventListener('click', () => {
    const id = commitDepot(p, {
      accountId: job.accountId === '_new' ? null : job.accountId,
      newAccount: { name: job.newName.trim() || 'Depot', bank: job.bank, ref: p.depotNo || '' },
    });
    job = null;
    toast(`Depotstand vom ${fmtDate(p.date)} übernommen: ${money(p.value)}`, 'success', 6000);
    location.hash = `#/konten?focus=${id}`;
  });
}

const mask = (ref) => (!ref ? '' : ref.length > 10 ? `${ref.slice(0, 4)} … ${ref.slice(-4)}` : ref);

function history() {
  const imps = store.all('imports').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 15);
  if (!imps.length) return '';
  const acc = store.byId('accounts');
  return `<section class="card">
    <div class="card-h"><h2>Letzte Importe</h2></div>
    <div class="table-wrap"><table class="table compact"><tbody>${imps.map((i) => `
      <tr><td class="nowrap muted">${fmtDate(i.date)}</td>
        <td class="grow">${esc(i.fileName)}<div class="tx-sub">${i.accounts > 1 ? `${i.accounts} Konten` : esc(acc.get(i.accountId)?.name || '')}</div></td>
        <td class="num">${i.count.toLocaleString('de-DE')} neu${i.dup ? ` · ${i.dup.toLocaleString('de-DE')} dopp.` : ''}</td>
        <td class="nowrap"><a class="btn btn-sm btn-ghost" href="#/buchungen?batch=${i.id}&period=all">Ansehen</a>
          <button class="btn btn-sm btn-ghost danger" data-action="undo" data-id="${i.id}">Rückgängig</button></td></tr>`).join('')}</tbody></table></div>
  </section>`;
}
