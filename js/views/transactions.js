import { store } from '../store.js';
import { esc, fmtDate, money, toCSV, download, todayISO, debounce } from '../util.js';
import { filterTx, totals, PERIODS, periodRange, kind, cats } from '../calc.js';
import { icon } from '../icons.js';
import {
  bindActions, catOptions, accountOptions, taxOptions, vacationOptions, amountCell,
  confirmDialog, toast, emptyState, rerender,
} from '../ui.js';
import { openTxForm } from '../forms.js';
import { taxCat } from '../defaults.js';

export const title = 'Buchungen';

const DEFAULTS = { period: '12m', from: '', to: '', account: '', cat: '', kind: '', q: '', tax: '', vacation: '', min: '', max: '', tag: '', batch: '' };
const F = { ...DEFAULTS };
let limit = 100;
let showMore = false;
const selected = new Set();

export function render(root, { params, fresh }) {
  if (fresh && params && [...params.keys()].length) {
    Object.assign(F, DEFAULTS);
    for (const [k, v] of params) if (k in F) F[k] = v;
    if (params.has('period') === false && (params.has('from') || params.has('to'))) F.period = 'custom';
    if (F.min || F.max || F.tax || F.vacation || F.tag) showMore = true;
    selected.clear();
    limit = 100;
  }

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Buchungen</h1><p class="sub" id="tx-sub"></p></div>
      <div class="actions">
        <button class="btn" data-action="export">${icon('download')}<span>CSV</span></button>
        <button class="btn btn-primary" data-action="add">${icon('plus')}<span>Buchung</span></button>
      </div>
    </div>
    <section class="card filters no-print">
      <div class="filter-row">
        <label class="search">${icon('search')}<input type="search" name="q" placeholder="Suchen: Empfänger, Zweck, Betrag …" value="${esc(F.q)}"></label>
        <select name="period" aria-label="Zeitraum">${PERIODS.map(([k, l]) => `<option value="${k}" ${F.period === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span class="custom-range" ${F.period === 'custom' ? '' : 'hidden'}>
          <input type="date" name="from" value="${F.from}" aria-label="Von"><span class="muted">–</span><input type="date" name="to" value="${F.to}" aria-label="Bis">
        </span>
        <select name="account" aria-label="Konto">${accountOptions(F.account, { all: 'Alle Konten', includeArchived: true })}</select>
        <select name="cat" aria-label="Kategorie"><option value="">Alle Kategorien</option><option value="_none" ${F.cat === '_none' ? 'selected' : ''}>Unkategorisiert</option>${catOptions(F.cat, { withNone: false })}</select>
        <select name="kind" aria-label="Art">
          <option value="">Alle Arten</option>
          <option value="expense" ${F.kind === 'expense' ? 'selected' : ''}>Ausgaben</option>
          <option value="income" ${F.kind === 'income' ? 'selected' : ''}>Einnahmen</option>
          <option value="transfer" ${F.kind === 'transfer' ? 'selected' : ''}>Umbuchungen</option>
        </select>
        <button class="btn btn-ghost btn-sm" data-action="more">${showMore ? 'Weniger Filter' : 'Mehr Filter'}</button>
        <button class="btn btn-ghost btn-sm" data-action="reset">Zurücksetzen</button>
      </div>
      <div class="filter-row" ${showMore ? '' : 'hidden'} id="more-filters">
        <label class="inline">Betrag ab <input name="min" inputmode="decimal" value="${esc(F.min)}" placeholder="0"></label>
        <label class="inline">bis <input name="max" inputmode="decimal" value="${esc(F.max)}" placeholder="∞"></label>
        <select name="tax" aria-label="Steuer"><option value="">Steuer: alle</option><option value="1" ${F.tax === '1' ? 'selected' : ''}>nur steuerrelevante</option>${taxOptions(F.tax, { none: '' }).replace('<option value=""></option>', '')}</select>
        <select name="vacation" aria-label="Urlaubskasse">${vacationOptions(F.vacation, { none: 'Urlaubskasse: alle' })}</select>
        <label class="inline">Tag <input name="tag" value="${esc(F.tag)}" placeholder="z. B. Garten"></label>
        ${F.batch ? `<span class="chip">Import-Stapel <button class="link-btn" data-action="clearBatch">entfernen</button></span>` : ''}
      </div>
    </section>
    <div class="summary-bar" id="tx-summary"></div>
    <div class="bulk-bar" id="bulk" hidden></div>
    <section class="card flush"><div class="table-wrap" id="tx-list"></div></section>`;

  const list = root.querySelector('#tx-list');
  const renderList = () => {
    const r = F.period === 'custom' ? { from: F.from, to: F.to } : periodRange(F.period);
    const rows = filterTx({ ...F, from: r.from, to: r.to });
    const t = totals(rows);
    const cm = cats();
    root.querySelector('#tx-sub').textContent = F.period === 'custom' ? (F.from || F.to ? `${fmtDate(F.from) || '…'} – ${fmtDate(F.to) || '…'}` : 'Gesamter Zeitraum') : periodRange(F.period).label;
    root.querySelector('#tx-summary').innerHTML = `
      <span><b>${rows.length.toLocaleString('de-DE')}</b> Buchungen</span>
      <span>Einnahmen <b class="amt-in">${money(t.income)}</b></span>
      <span>Ausgaben <b class="amt-out">${money(t.expense)}</b></span>
      <span>Saldo <b>${money(t.net)}</b></span>`;
    if (!rows.length) {
      list.innerHTML = emptyState('search', 'Keine Buchungen gefunden', store.all('transactions').length ? 'Passe die Filter an oder setze sie zurück.' : 'Importiere einen Kontoauszug oder lege eine Buchung an.', `<a class="btn" href="#/import">${icon('upload')} Import</a>`);
      renderBulk();
      return;
    }
    const shown = rows.slice(0, limit);
    list.innerHTML = `<table class="table tx-table">
      <thead><tr>
        <th class="w-check"><input type="checkbox" data-all aria-label="Alle auswählen" ${shown.every((x) => selected.has(x.id)) ? 'checked' : ''}></th>
        <th>Datum</th><th>Empfänger / Zweck</th><th class="hide-sm">Kategorie</th><th class="hide-md">Konto</th><th class="num">Betrag</th>
      </tr></thead>
      <tbody>${shown.map((x) => row(x, cm)).join('')}</tbody></table>
      ${rows.length > limit ? `<div class="load-more"><button class="btn" data-action="loadMore">Weitere ${Math.min(200, rows.length - limit)} von ${rows.length - limit} anzeigen</button></div>` : ''}`;
    list._rows = rows;
    renderBulk();
  };

  const renderBulk = () => {
    const bar = root.querySelector('#bulk');
    for (const id of [...selected]) if (!store.get('transactions', id)) selected.delete(id);
    if (!selected.size) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = `<b>${selected.size} ausgewählt</b>
      <select data-bulk="categoryId" aria-label="Kategorie setzen"><option value="">Kategorie setzen …</option><option value="_clear">– ohne Kategorie –</option>${catOptions(null, { withNone: false })}</select>
      <select data-bulk="taxCategory" aria-label="Steuer setzen"><option value="">Steuer setzen …</option><option value="_clear">– nicht steuerrelevant –</option>${taxOptions(null).replace(/<option value="">[^<]*<\/option>/, '')}</select>
      <select data-bulk="vacationId" aria-label="Urlaubskasse"><option value="">Urlaubskasse …</option><option value="_clear">– keine –</option>${vacationOptions(null).replace(/<option value="">[^<]*<\/option>/, '')}</select>
      <button class="btn btn-sm btn-ghost danger" data-action="bulkDelete">${icon('trash')} Löschen</button>
      <button class="btn btn-sm btn-ghost" data-action="clearSel">Auswahl aufheben</button>`;
  };

  // Filter-Eingaben
  const onFilter = (e) => {
    const el = e.target;
    if (!el.name || !(el.name in F)) return;
    // „change“ beim Verlassen des Suchfelds nicht erneut rendern – sonst geht der Klick verloren
    if (F[el.name] === el.value) return;
    F[el.name] = el.value;
    if (el.name === 'period') {
      root.querySelector('.custom-range').hidden = el.value !== 'custom';
      if (el.value === 'custom' && !F.from) { const r = periodRange('month'); F.from = r.from; F.to = todayISO(); root.querySelector('[name=from]').value = F.from; root.querySelector('[name=to]').value = F.to; }
    }
    limit = 100;
    renderList();
  };
  const filters = root.querySelector('.filters');
  filters.addEventListener('change', onFilter);
  filters.addEventListener('input', debounce((e) => { if (['q', 'min', 'max', 'tag'].includes(e.target.name)) onFilter(e); }, 200));

  // Tabelle: Auswahl, Inline-Kategorie, Bearbeiten
  list.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-all]')) {
      const shown = (list._rows || []).slice(0, limit);
      shown.forEach((x) => (el.checked ? selected.add(x.id) : selected.delete(x.id)));
      list.querySelectorAll('[data-sel]').forEach((c) => (c.checked = el.checked));
      renderBulk();
    } else if (el.matches('[data-sel]')) {
      el.checked ? selected.add(el.dataset.sel) : selected.delete(el.dataset.sel);
      renderBulk();
    } else if (el.matches('[data-cat]')) {
      const t = store.get('transactions', el.dataset.cat);
      store.put('transactions', { ...t, categoryId: el.value || null, catManual: true });
    }
  });
  list.addEventListener('click', (e) => {
    if (e.target.closest('input, select, button, a, label')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) openTxForm(store.get('transactions', tr.dataset.id));
  });
  root.querySelector('#bulk').addEventListener('change', (e) => {
    const el = e.target;
    if (!el.dataset.bulk || !el.value) return;
    const val = el.value === '_clear' ? null : el.value;
    const field = el.dataset.bulk;
    const recs = [...selected].map((id) => store.get('transactions', id)).filter(Boolean)
      .map((t) => ({ ...t, [field]: val, ...(field === 'categoryId' ? { catManual: true } : {}) }));
    store.putMany('transactions', recs);
    toast(`${recs.length} Buchungen aktualisiert`, 'success');
  });

  bindActions(root, {
    add: () => openTxForm(),
    more: (el) => { showMore = !showMore; root.querySelector('#more-filters').hidden = !showMore; el.textContent = showMore ? 'Weniger Filter' : 'Mehr Filter'; },
    reset: () => { Object.assign(F, DEFAULTS); selected.clear(); rerender(); },
    clearBatch: () => { F.batch = ''; rerender(); },
    loadMore: () => { limit += 200; renderList(); },
    clearSel: () => { selected.clear(); renderList(); },
    bulkDelete: async () => {
      if (!(await confirmDialog(`${selected.size} Buchungen löschen?`, { ok: 'Löschen' }))) return;
      store.removeMany('transactions', [...selected]);
      toast(`${selected.size} Buchungen gelöscht`);
      selected.clear();
    },
    export: () => {
      const rows = list._rows || [];
      const cm = cats();
      const acc = store.byId('accounts');
      download(`buchungen-${todayISO()}.csv`, toCSV([
        ['Datum', 'Konto', 'Empfänger/Auftraggeber', 'Verwendungszweck', 'Kategorie', 'Gruppe', 'Betrag', 'Steuer', 'Tags', 'Notiz'],
        ...rows.map((t) => [fmtDate(t.date), acc.get(t.accountId)?.name || '', t.payee, t.purpose, cm.get(t.categoryId)?.name || '', cm.get(t.categoryId)?.group || '',
          (t.amount / 100).toFixed(2).replace('.', ','), taxCat(t.taxCategory)?.label || '', (t.tags || []).join(', '), t.note || '']),
      ]), 'text/csv;charset=utf-8');
    },
  });

  renderList();
}

function row(t, cm) {
  const acc = store.get('accounts', t.accountId);
  const k = kind(t, cm);
  const badges = [
    t.taxCategory ? `<span class="badge" title="${esc(taxCat(t.taxCategory)?.label || '')}">${icon('file')}${esc(taxCat(t.taxCategory)?.short || 'Steuer')}</span>` : '',
    t.vacationId ? `<span class="badge">${icon('plane')}${esc(store.get('vacations', t.vacationId)?.name || 'Urlaub')}</span>` : '',
    ...(t.tags || []).map((g) => `<span class="badge">${icon('tag')}${esc(g)}</span>`),
  ].join('');
  return `<tr data-id="${t.id}" class="clickable ${selected.has(t.id) ? 'selected' : ''}">
    <td class="w-check"><input type="checkbox" data-sel="${t.id}" ${selected.has(t.id) ? 'checked' : ''} aria-label="Auswählen"></td>
    <td class="nowrap muted">${fmtDate(t.date)}</td>
    <td class="grow"><div class="tx-main">${esc(t.payee || t.purpose || '–')}</div>
      <div class="tx-sub">${esc(t.payee ? t.purpose : t.bookingText || '')}</div>${badges ? `<div class="badges">${badges}</div>` : ''}</td>
    <td class="hide-sm"><select class="inline-select ${t.categoryId ? '' : 'empty'}" data-cat="${t.id}" aria-label="Kategorie">${catOptions(t.categoryId, { none: 'Unkategorisiert' })}</select></td>
    <td class="hide-md muted small">${esc(acc?.name || '')}</td>
    <td class="num">${amountCell(t.amount, k)}</td>
  </tr>`;
}
