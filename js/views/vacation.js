import { store } from '../store.js';
import { esc, money, fmtDate, todayISO, monthKey } from '../util.js';
import { vacationStats, byDateDesc, cats, kind } from '../calc.js';
import { icon } from '../icons.js';
import { bindActions, progress, emptyState, amountCell, rerender, toast } from '../ui.js';
import { openVacationForm, openVacationEntryForm, openTxForm } from '../forms.js';

export const title = 'Urlaubskasse';
let openId = null;

export function render(root, { params }) {
  if (params?.get('id')) openId = params.get('id');
  const all = store.all('vacations');
  const active = all.filter((v) => !v.archived);
  const archived = all.filter((v) => v.archived);
  const stats = new Map(all.map((v) => [v.id, vacationStats(v)]));
  const total = active.reduce((s, v) => s + stats.get(v.id).balance, 0);
  const monthly = active.reduce((s, v) => s + (v.monthlyRate || 0), 0);
  const goals = active.reduce((s, v) => s + (v.goal || 0), 0);
  if (!openId || !store.get('vacations', openId)) openId = active[0]?.id || null;
  const sel = openId ? store.get('vacations', openId) : null;

  const card = (v) => {
    const s = stats.get(v.id);
    const days = v.targetDate ? Math.round((new Date(v.targetDate) - new Date(todayISO())) / 86400000) : null;
    const onTrack = s.needed == null || !v.monthlyRate || v.monthlyRate >= s.needed;
    return `<article class="card vac-card ${v.id === openId ? 'active' : ''}" data-action="open" data-id="${v.id}" tabindex="0">
      <div class="row-between"><h3>${icon('plane')} ${esc(v.name)}</h3>${days != null && days >= 0 ? `<span class="badge">${days === 0 ? 'heute' : `in ${days} Tagen`}</span>` : v.targetDate ? '<span class="badge">vorbei</span>' : ''}</div>
      <div class="vac-bal">${money(s.balance)}</div>
      ${v.goal ? `${progress(s.progress, s.progress >= 1 ? 'good' : 'accent', 'Sparziel')}
        <div class="row-between small"><span class="muted">${money(s.saved)} von ${money(v.goal)} gespart</span><b>${Math.round(s.progress * 100)} %</b></div>` : '<div class="muted small">Kein Sparziel festgelegt</div>'}
      ${s.needed != null && s.saved < (v.goal || 0) ? `<div class="small ${onTrack ? 'muted' : 'text-warn'}">${onTrack ? icon('check') : icon('alert')} Nötig: ${money(s.needed)}/Monat${v.monthlyRate ? ` · Sparrate ${money(v.monthlyRate)}` : ''}</div>` : ''}
      ${s.spent ? `<div class="small muted">Bereits ausgegeben: ${money(s.spent)}</div>` : ''}
    </article>`;
  };

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Urlaubskasse</h1><p class="sub">Sparen für Reisen und Reisekosten im Blick</p></div>
      <div class="actions"><button class="btn btn-primary" data-action="add">${icon('plus')}<span>Neue Kasse</span></button></div>
    </div>
    ${active.length ? `
      <section class="stats stats-3">
        <div class="card stat"><div class="stat-label">Guthaben gesamt</div><div class="stat-value">${money(total)}</div></div>
        <div class="card stat"><div class="stat-label">Sparraten pro Monat</div><div class="stat-value">${money(monthly)}</div></div>
        <div class="card stat"><div class="stat-label">Sparziele gesamt</div><div class="stat-value">${money(goals)}</div></div>
      </section>
      <div class="card-grid">${active.map(card).join('')}</div>` : `<section class="card">${emptyState('plane', 'Noch keine Urlaubskasse', 'Lege eine Kasse für deine nächste Reise an: Sparziel, Reisedatum und monatliche Sparrate. Bankbuchungen kannst du der Reise zuordnen, dann siehst du die tatsächlichen Reisekosten.', `<button class="btn btn-primary" data-action="add">${icon('plus')} Urlaubskasse anlegen</button>`)}</section>`}
    ${sel ? detail(sel, stats.get(sel.id)) : ''}
    ${archived.length ? `<h2 class="section-title">Abgeschlossen</h2><div class="card-grid">${archived.map(card).join('')}</div>` : ''}`;

  bindActions(root, {
    add: () => openVacationForm(),
    open: (el) => { openId = el.dataset.id; rerender(); },
    edit: () => openVacationForm(sel),
    deposit: () => openVacationEntryForm(sel, 'in'),
    spend: () => openVacationEntryForm(sel, 'out'),
    rate: () => {
      const mk = monthKey(todayISO());
      const s = stats.get(sel.id);
      if (s.entries.some((e) => e.amount > 0 && e.date.startsWith(mk) && e.note === 'Sparrate')) return toast('Die Sparrate für diesen Monat ist schon gebucht.', 'warn');
      store.put('vacationEntries', { vacationId: sel.id, date: todayISO(), amount: sel.monthlyRate, note: 'Sparrate' });
      toast(`Sparrate ${money(sel.monthlyRate)} gebucht`, 'success');
    },
    editEntry: (el) => openVacationEntryForm(sel, 'in', store.get('vacationEntries', el.dataset.id)),
    editTx: (el) => openTxForm(store.get('transactions', el.dataset.id)),
  });
}

function detail(v, s) {
  const cm = cats();
  const acc = store.byId('accounts');
  const rows = [
    ...s.entries.map((e) => ({ date: e.date, text: e.note || (e.amount >= 0 ? 'Einzahlung' : 'Ausgabe'), sub: 'Eintrag', amount: e.amount, action: 'editEntry', id: e.id })),
    ...s.linked.map((t) => ({ date: t.date, text: t.payee || t.purpose, sub: `Bankbuchung · ${acc.get(t.accountId)?.name || ''}`, amount: t.amount, action: 'editTx', id: t.id, k: kind(t, cm) })),
  ].sort(byDateDesc);
  return `<section class="card vac-detail">
    <div class="card-h"><h2>${esc(v.name)}</h2>
      <div class="actions">
        ${v.monthlyRate ? `<button class="btn btn-sm" data-action="rate">${icon('repeat')} Sparrate buchen</button>` : ''}
        <button class="btn btn-sm" data-action="deposit">${icon('plus')} Einzahlung</button>
        <button class="btn btn-sm" data-action="spend">${icon('minus')} Ausgabe</button>
        <button class="btn btn-sm btn-ghost" data-action="edit">${icon('edit')} Bearbeiten</button>
      </div></div>
    <dl class="kv kv-row">
      <div><dt>Startguthaben</dt><dd>${money(v.startBalance || 0)}</dd></div>
      <div><dt>Einzahlungen</dt><dd>${money(s.deposits)}</dd></div>
      <div><dt>Ausgaben</dt><dd>${money(s.spent)}</dd></div>
      <div><dt>Guthaben</dt><dd><b>${money(s.balance)}</b></dd></div>
      ${v.targetDate ? `<div><dt>Reisedatum</dt><dd>${fmtDate(v.targetDate)}</dd></div>` : ''}
    </dl>
    ${v.note ? `<p class="muted">${esc(v.note)}</p>` : ''}
    <p class="muted small">Bankbuchungen ordnest du über „Buchung bearbeiten → Urlaubskasse“ zu, oder mehrere auf einmal in der Buchungsliste.</p>
    ${rows.length ? `<div class="table-wrap"><table class="table"><tbody>${rows.map((r) => `
      <tr class="clickable" data-action="${r.action}" data-id="${r.id}">
        <td class="nowrap muted">${fmtDate(r.date)}</td>
        <td class="grow"><div class="tx-main">${esc(r.text)}</div><div class="tx-sub">${esc(r.sub)}</div></td>
        <td class="num">${amountCell(r.amount, r.k)}</td>
      </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Noch keine Einträge.</p>'}
  </section>`;
}
