// Formulare (Dialoge) für alle Datensätze
import { store } from './store.js';
import { esc, todayISO, parseMoney, centsToInput, money, norm } from './util.js';
import {
  modal, confirmDialog, toast, field, catOptions, accountOptions, taxOptions,
  vacationOptions, accountTypeOptions,
} from './ui.js';
import { icon } from './icons.js';
import { learnRule, applyRules } from './categorize.js';
import { currentBalance, avgMonthlyExpense } from './calc.js';
import { GROUPS, TAX_CATEGORIES } from './defaults.js';

const money$ = (v, { required = true, allowZero = false } = {}) => {
  const c = parseMoney(v);
  if (c == null) { if (required) throw new Error('Bitte einen gültigen Betrag eingeben (z. B. 12,50).'); return 0; }
  if (!allowZero && c === 0 && required) throw new Error('Der Betrag darf nicht 0 sein.');
  return c;
};

// ---------- Buchung ----------
export function openTxForm(tx = null, preset = {}) {
  if (!store.all('accounts').length) {
    toast('Bitte zuerst ein Konto anlegen.', 'warn');
    return openAccountForm();
  }
  const t = tx || { date: todayISO(), accountId: store.all('accounts').find((a) => !a.archived)?.id, ...preset };
  const out = tx ? tx.amount < 0 : (preset.amount ?? -1) <= 0;
  modal({
    title: tx ? 'Buchung bearbeiten' : 'Neue Buchung',
    wide: true,
    body: `
      <div class="seg" role="radiogroup" aria-label="Richtung">
        <label><input type="radio" name="dir" value="out" ${out ? 'checked' : ''}><span>Ausgabe</span></label>
        <label><input type="radio" name="dir" value="in" ${!out ? 'checked' : ''}><span>Einnahme</span></label>
      </div>
      <div class="form-grid">
        ${field('Datum', `<input type="date" name="date" required value="${esc(t.date)}">`)}
        ${field('Betrag (€)', `<input name="amount" inputmode="decimal" required autofocus value="${tx ? centsToInput(Math.abs(tx.amount)) : preset.amount ? centsToInput(Math.abs(preset.amount)) : ''}" placeholder="0,00">`)}
        ${field('Konto', `<select name="accountId">${accountOptions(t.accountId)}</select>`)}
        ${field('Kategorie', `<select name="categoryId">${catOptions(t.categoryId)}</select>`)}
        ${field('Empfänger / Auftraggeber', `<input name="payee" value="${esc(t.payee || '')}" autocomplete="off">`, '', 'span-2')}
        ${field('Verwendungszweck', `<input name="purpose" value="${esc(t.purpose || '')}" autocomplete="off">`, '', 'span-2')}
        ${field('Steuererklärung', `<select name="taxCategory">${taxOptions(t.taxCategory)}</select>`)}
        ${field('Urlaubskasse', `<select name="vacationId">${vacationOptions(t.vacationId)}</select>`, 'Ordnet die Ausgabe einer Reise zu')}
        ${field('Tags', `<input name="tags" value="${esc((t.tags || []).join(', '))}" placeholder="z. B. Garten, Hochzeit">`, 'Mit Komma trennen')}
        ${field('Notiz', `<input name="note" value="${esc(t.note || '')}">`)}
        <label class="check span-2"><input type="checkbox" name="transfer" ${t.transfer ? 'checked' : ''}> Umbuchung zwischen eigenen Konten (zählt nicht als Einnahme oder Ausgabe)</label>
      </div>
      ${tx && tx.bookingText ? `<p class="muted small">Buchungstext der Bank: ${esc(tx.bookingText)}</p>` : ''}
      ${tx ? '<label class="check"><input type="checkbox" name="learn"> Kategorie für ähnliche Buchungen merken (Regel anlegen und anwenden)</label>' : ''}`,
    extraFooter: tx ? `<button type="button" class="btn btn-ghost danger" data-del>${icon('trash')} Löschen</button>` : '',
    onOpen: (d) => {
      d.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (await confirmDialog('Diese Buchung wirklich löschen?', { ok: 'Löschen' })) {
          store.remove('transactions', tx.id);
          d.close();
          toast('Buchung gelöscht');
        }
      });
    },
    onSubmit: (v) => {
      const cents = Math.abs(money$(v.amount));
      const rec = {
        ...(tx || { source: 'manual' }),
        date: v.date || todayISO(),
        amount: v.dir === 'out' ? -cents : cents,
        accountId: v.accountId,
        categoryId: v.categoryId || null,
        payee: v.payee.trim(), purpose: v.purpose.trim(),
        taxCategory: v.taxCategory || null,
        vacationId: v.vacationId || null,
        tags: v.tags.split(',').map((s) => s.trim()).filter(Boolean),
        note: v.note.trim(),
        transfer: v.transfer || undefined,
      };
      if (!tx || tx.categoryId !== rec.categoryId) rec.catManual = true;
      store.put('transactions', rec);
      if (v.learn && rec.categoryId) {
        const n = learnRule(rec);
        toast(`Regel gespeichert – ${n} weitere Buchung(en) zugeordnet`, 'success');
      } else toast('Gespeichert', 'success');
    },
  });
}

// ---------- Konto ----------
export function openAccountForm(acc = null) {
  const bal = acc ? currentBalance(acc) : 0;
  modal({
    title: acc ? 'Konto bearbeiten' : 'Neues Konto',
    body: `<div class="form-grid">
      ${field('Name', `<input name="name" required autofocus value="${esc(acc?.name || '')}" placeholder="z. B. Girokonto Sparkasse">`, '', 'span-2')}
      ${field('Kontoart', `<select name="type">${accountTypeOptions(acc?.type || 'giro')}</select>`)}
      ${field('Bank', `<input name="bank" value="${esc(acc?.bank || '')}">`)}
      ${field('IBAN (optional)', `<input name="iban" value="${esc(acc?.iban || '')}" autocomplete="off">`, '', 'span-2')}
      ${field(acc?.type === 'depot' ? 'Depotwert (€)' : 'Kontostand (€)', `<input name="balance" inputmode="decimal" value="${centsToInput(bal)}">`, acc?.type === 'depot' ? 'Aktueller Kurswert laut Bank. Oder bequemer: Depotübersicht importieren.' : 'So wie ihn die Bank anzeigt')}
      ${field('Stand vom', `<input type="date" name="balanceDate" value="${todayISO()}">`, 'Inklusive aller Buchungen dieses Tages')}
      ${acc ? '<label class="check span-2"><input type="checkbox" name="archived" ' + (acc.archived ? 'checked' : '') + '> Archiviert (ausgeblendet, zählt nicht zum Vermögen)</label>' : ''}
    </div>`,
    extraFooter: acc ? `<button type="button" class="btn btn-ghost danger" data-del>${icon('trash')} Löschen</button>` : '',
    onOpen: (d) => {
      d.querySelector('[data-del]')?.addEventListener('click', async () => {
        const n = store.all('transactions').filter((t) => t.accountId === acc.id).length;
        if (await confirmDialog(`Konto „${acc.name}“${n ? ` und ${n} Buchungen` : ''} endgültig löschen?`, { ok: 'Löschen' })) {
          store.removeMany('transactions', store.all('transactions').filter((t) => t.accountId === acc.id).map((t) => t.id));
          store.remove('accounts', acc.id);
          d.close();
          toast('Konto gelöscht');
        }
      });
    },
    onSubmit: (v) => {
      if (!v.name.trim()) throw new Error('Bitte einen Namen eingeben.');
      const cents = parseMoney(v.balance) ?? 0;
      const rec = { ...(acc || {}), name: v.name.trim(), type: v.type, bank: v.bank.trim(), iban: v.iban.replace(/\s+/g, '').toUpperCase(), archived: !!v.archived };
      if (!acc || cents !== bal) {
        rec.balanceAnchor = cents;
        rec.anchorDate = v.balanceDate || todayISO();
        // Depot: manueller Wert wird Teil des Wertverlaufs
        if (rec.type === 'depot') {
          const hist = (rec.valueHistory || []).filter((h) => h.date !== rec.anchorDate);
          const prev = hist.filter((h) => h.date <= rec.anchorDate).pop();
          hist.push({ date: rec.anchorDate, value: cents, cost: prev?.cost ?? null });
          rec.valueHistory = hist.sort((a, b) => a.date.localeCompare(b.date));
        }
      }
      store.put('accounts', rec);
      toast('Konto gespeichert', 'success');
    },
  });
}

// ---------- Kategorie ----------
export function openCategoryForm(cat = null) {
  const groups = [...new Set([...GROUPS, ...store.all('categories').map((c) => c.group)])];
  modal({
    title: cat ? 'Kategorie bearbeiten' : 'Neue Kategorie',
    body: `<div class="form-grid">
      ${field('Name', `<input name="name" required autofocus value="${esc(cat?.name || '')}">`, '', 'span-2')}
      ${field('Gruppe', `<input name="group" list="grp-list" required value="${esc(cat?.group || 'Sonstiges')}"><datalist id="grp-list">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>`)}
      ${field('Art', `<select name="type">
        <option value="expense" ${cat?.type === 'expense' || !cat ? 'selected' : ''}>Ausgabe</option>
        <option value="income" ${cat?.type === 'income' ? 'selected' : ''}>Einnahme</option>
        <option value="transfer" ${cat?.type === 'transfer' ? 'selected' : ''}>Umbuchung (zählt nicht)</option></select>`)}
    </div>`,
    extraFooter: cat ? `<button type="button" class="btn btn-ghost danger" data-del>${icon('trash')} Löschen</button>` : '',
    onOpen: (d) => {
      d.querySelector('[data-del]')?.addEventListener('click', async () => {
        const txs = store.all('transactions').filter((t) => t.categoryId === cat.id);
        if (await confirmDialog(`Kategorie „${cat.name}“ löschen?${txs.length ? ` ${txs.length} Buchungen werden „Unkategorisiert“.` : ''}`, { ok: 'Löschen' })) {
          store.putMany('transactions', txs.map((t) => ({ ...t, categoryId: null })));
          store.removeMany('budgets', store.all('budgets').filter((b) => b.categoryId === cat.id).map((b) => b.id));
          store.removeMany('rules', store.all('rules').filter((r) => r.categoryId === cat.id).map((r) => r.id));
          store.remove('categories', cat.id);
          d.close();
        }
      });
    },
    onSubmit: (v) => {
      if (!v.name.trim()) throw new Error('Bitte einen Namen eingeben.');
      store.put('categories', { ...(cat || { order: 500 }), name: v.name.trim(), group: v.group.trim() || 'Sonstiges', type: v.type });
    },
  });
}

// ---------- Regel ----------
export function openRuleForm(rule = null, preset = {}) {
  const r = rule || { field: 'any', sign: 'any', ...preset };
  modal({
    title: rule ? 'Regel bearbeiten' : 'Neue Regel',
    body: `<div class="form-grid">
      ${field('Wenn der Text enthält', `<input name="match" required autofocus value="${esc(r.match || '')}" placeholder="z. B. rewe|edeka">`, 'Mehrere Begriffe mit | trennen. Groß-/Kleinschreibung egal.', 'span-2')}
      ${field('Suchen in', `<select name="field">
        <option value="any" ${r.field === 'any' ? 'selected' : ''}>Empfänger und Verwendungszweck</option>
        <option value="payee" ${r.field === 'payee' ? 'selected' : ''}>nur Empfänger / Auftraggeber</option>
        <option value="purpose" ${r.field === 'purpose' ? 'selected' : ''}>nur Verwendungszweck</option></select>`)}
      ${field('Gilt für', `<select name="sign">
        <option value="any" ${r.sign === 'any' ? 'selected' : ''}>Ein- und Ausgänge</option>
        <option value="out" ${r.sign === 'out' ? 'selected' : ''}>nur Ausgaben</option>
        <option value="in" ${r.sign === 'in' ? 'selected' : ''}>nur Einnahmen</option></select>`)}
      ${field('Dann Kategorie', `<select name="categoryId" required>${catOptions(r.categoryId, { withNone: false })}</select>`)}
      ${field('und Steuer', `<select name="taxCategory">${taxOptions(r.taxCategory)}</select>`)}
      <label class="check span-2"><input type="checkbox" name="apply" checked> Auf bestehende Buchungen anwenden (manuell gesetzte bleiben unverändert)</label>
    </div>`,
    extraFooter: rule ? `<button type="button" class="btn btn-ghost danger" data-del>${icon('trash')} Löschen</button>` : '',
    onOpen: (d) => {
      d.querySelector('[data-del]')?.addEventListener('click', () => { store.remove('rules', rule.id); d.close(); });
    },
    onSubmit: (v) => {
      if (!norm(v.match)) throw new Error('Bitte einen Suchbegriff eingeben.');
      const saved = store.put('rules', { ...(rule || {}), match: v.match.trim(), field: v.field, sign: v.sign, categoryId: v.categoryId, taxCategory: v.taxCategory || null, prio: rule?.prio ?? 10 });
      if (v.apply) {
        const n = applyRules({ onlyUncategorized: false, ruleIds: [saved.id] });
        toast(`Regel gespeichert – ${n} Buchung(en) aktualisiert`, 'success');
      }
    },
  });
}

// ---------- Budget ----------
export function openBudgetForm(budget = null, preset = {}) {
  const b = budget || preset;
  modal({
    title: budget ? 'Budget bearbeiten' : 'Neues Budget',
    body: `<div class="form-grid">
      ${field('Kategorie', `<select name="categoryId" required ${budget ? 'disabled' : ''}>${catOptions(b.categoryId, { types: ['expense'], withNone: false })}</select>`, '', 'span-2')}
      ${field('Monatsbudget (€)', `<input name="amount" inputmode="decimal" required autofocus value="${b.amount ? centsToInput(b.amount) : ''}" placeholder="0,00">`, '<span data-avg></span>', 'span-2')}
    </div>`,
    extraFooter: budget ? `<button type="button" class="btn btn-ghost danger" data-del>${icon('trash')} Löschen</button>` : '',
    onOpen: (d, form) => {
      const sel = form.categoryId;
      const upd = () => { const a = avgMonthlyExpense(sel.value); d.querySelector('[data-avg]').textContent = a ? `Ø letzte 3 Monate: ${money(a)}` : ''; };
      sel.addEventListener('change', upd); upd();
      d.querySelector('[data-del]')?.addEventListener('click', () => { store.remove('budgets', budget.id); d.close(); });
    },
    onSubmit: (v) => {
      const categoryId = budget ? budget.categoryId : v.categoryId;
      const amount = Math.abs(money$(v.amount));
      const existing = store.all('budgets').find((x) => x.categoryId === categoryId && x.id !== budget?.id);
      store.put('budgets', { ...(existing || budget || {}), categoryId, amount });
    },
  });
}

// ---------- Urlaubskasse ----------
export function openVacationForm(v = null) {
  modal({
    title: v ? 'Urlaubskasse bearbeiten' : 'Neue Urlaubskasse',
    body: `<div class="form-grid">
      ${field('Name / Reiseziel', `<input name="name" required autofocus value="${esc(v?.name || '')}" placeholder="z. B. Sommer 2027 – Italien">`, '', 'span-2')}
      ${field('Sparziel (€)', `<input name="goal" inputmode="decimal" value="${v?.goal ? centsToInput(v.goal) : ''}" placeholder="3.000,00">`)}
      ${field('Reisedatum', `<input type="date" name="targetDate" value="${esc(v?.targetDate || '')}">`)}
      ${field('Monatliche Sparrate (€)', `<input name="monthlyRate" inputmode="decimal" value="${v?.monthlyRate ? centsToInput(v.monthlyRate) : ''}">`)}
      ${field('Startguthaben (€)', `<input name="startBalance" inputmode="decimal" value="${v?.startBalance ? centsToInput(v.startBalance) : ''}">`)}
      ${field('Notiz', `<input name="note" value="${esc(v?.note || '')}">`, '', 'span-2')}
      ${v ? `<label class="check span-2"><input type="checkbox" name="archived" ${v.archived ? 'checked' : ''}> Abgeschlossen / archiviert</label>` : ''}
    </div>`,
    extraFooter: v ? `<button type="button" class="btn btn-ghost danger" data-del>${icon('trash')} Löschen</button>` : '',
    onOpen: (d) => {
      d.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!(await confirmDialog(`Urlaubskasse „${v.name}“ mit allen Einträgen löschen? Zugeordnete Bankbuchungen bleiben erhalten.`, { ok: 'Löschen' }))) return;
        store.removeMany('vacationEntries', store.all('vacationEntries').filter((e) => e.vacationId === v.id).map((e) => e.id));
        store.putMany('transactions', store.all('transactions').filter((t) => t.vacationId === v.id).map((t) => ({ ...t, vacationId: null })));
        store.remove('vacations', v.id);
        d.close();
      });
    },
    onSubmit: (f) => {
      if (!f.name.trim()) throw new Error('Bitte einen Namen eingeben.');
      store.put('vacations', {
        ...(v || {}), name: f.name.trim(),
        goal: Math.abs(parseMoney(f.goal) || 0), targetDate: f.targetDate || '',
        monthlyRate: Math.abs(parseMoney(f.monthlyRate) || 0), startBalance: parseMoney(f.startBalance) || 0,
        note: f.note.trim(), archived: !!f.archived,
      });
    },
  });
}

export function openVacationEntryForm(v, dir = 'in', entry = null) {
  const isIn = entry ? entry.amount >= 0 : dir === 'in';
  modal({
    title: entry ? 'Eintrag bearbeiten' : isIn ? `Einzahlung – ${v.name}` : `Ausgabe – ${v.name}`,
    body: `
      <div class="seg" role="radiogroup">
        <label><input type="radio" name="dir" value="in" ${isIn ? 'checked' : ''}><span>Einzahlung</span></label>
        <label><input type="radio" name="dir" value="out" ${!isIn ? 'checked' : ''}><span>Ausgabe</span></label>
      </div>
      <div class="form-grid">
        ${field('Datum', `<input type="date" name="date" value="${esc(entry?.date || todayISO())}">`)}
        ${field('Betrag (€)', `<input name="amount" inputmode="decimal" required autofocus value="${entry ? centsToInput(Math.abs(entry.amount)) : isIn && v.monthlyRate ? centsToInput(v.monthlyRate) : ''}">`)}
        ${field('Beschreibung', `<input name="note" value="${esc(entry?.note || '')}" placeholder="${isIn ? 'Sparrate' : 'z. B. Hotel, Flug, Mietwagen'}">`, '', 'span-2')}
      </div>`,
    extraFooter: entry ? `<button type="button" class="btn btn-ghost danger" data-del>${icon('trash')} Löschen</button>` : '',
    onOpen: (d) => d.querySelector('[data-del]')?.addEventListener('click', () => { store.remove('vacationEntries', entry.id); d.close(); }),
    onSubmit: (f) => {
      const c = Math.abs(money$(f.amount));
      store.put('vacationEntries', { ...(entry || {}), vacationId: v.id, date: f.date || todayISO(), amount: f.dir === 'out' ? -c : c, note: f.note.trim() });
    },
  });
}

// ---------- Steuerposten (ohne Bankbuchung, z. B. Barzahlung) ----------
export function openTaxItemForm(year, item = null) {
  modal({
    title: item ? 'Steuerposten bearbeiten' : 'Steuerposten hinzufügen',
    body: `<div class="form-grid">
      ${field('Art', `<select name="taxCategory" required>${TAX_CATEGORIES.map((t) => `<option value="${t.id}" ${t.id === item?.taxCategory ? 'selected' : ''}>${esc(t.group)} – ${esc(t.label)}</option>`).join('')}</select>`, '', 'span-2')}
      ${field('Beschreibung', `<input name="description" required autofocus value="${esc(item?.description || '')}">`, '', 'span-2')}
      ${field('Betrag (€)', `<input name="amount" inputmode="decimal" required value="${item ? centsToInput(item.amount) : ''}">`)}
      ${field('Datum', `<input type="date" name="date" value="${esc(item?.date || `${year}-12-31`)}">`)}
      ${field('Beleg / Ablageort', `<input name="receipt" value="${esc(item?.receipt || '')}" placeholder="z. B. Ordner Steuer 2025, Drive-Link">`, '', 'span-2')}
    </div>`,
    extraFooter: item ? `<button type="button" class="btn btn-ghost danger" data-del>${icon('trash')} Löschen</button>` : '',
    onOpen: (d) => d.querySelector('[data-del]')?.addEventListener('click', () => { store.remove('taxItems', item.id); d.close(); }),
    onSubmit: (f) => {
      store.put('taxItems', { ...(item || {}), year: String((f.date || `${year}`).slice(0, 4)), taxCategory: f.taxCategory, description: f.description.trim(), amount: Math.abs(money$(f.amount)), date: f.date, receipt: f.receipt.trim() });
    },
  });
}
