import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeftRight, Check, Plus, SkipForward, Sparkles, Trash2 } from 'lucide-react';
import { patch, remove, save, uid } from '../db/db';
import type { ID, Recurring, RecurrenceUnit, SplitMode, TxType } from '../db/schema';
import { useData } from '../state';
import { addDays, dayHeading, shortDate, todayISO } from '../lib/dates';
import { centsToInput, formatMoney, parseAmount } from '../lib/money';
import { detectRecurring, dueOccurrences, frequencyLabel, monthlyEquivalent, nextDateAfter, transactionFromOccurrence, upcoming, type RecurringSuggestion } from '../lib/recurring';
import { LineChart } from '../components/charts';
import { AmountInput, Avatar, Button, Card, CardHeader, CatIcon, EmptyState, Field, Money, PageHeader, Segmented, Sheet, StatTile, Switch, cn } from '../components/ui';

type Tab = 'all' | 'subs' | 'income';

export default function Schedule() {
  const data = useData();
  const { recurring, categoryMap, groupMap, accountMap, accounts, balances, transactions, kindOf, activeMembers, memberMap } = data;
  const [tab, setTab] = useState<Tab>('all');
  const [editing, setEditing] = useState<Partial<Recurring> | null>(null);
  const today = todayISO();

  const due = useMemo(() => dueOccurrences(recurring.filter((r) => r.active), today), [recurring, today]);
  const suggestions = useMemo(() => detectRecurring(transactions, recurring), [transactions, recurring]);

  const stats = useMemo(() => {
    const active = recurring.filter((r) => r.active);
    const fixed = active.filter((r) => r.type === 'expense').reduce((a, r) => a + monthlyEquivalent(r), 0);
    const subs = active.filter((r) => r.type === 'expense' && r.subscription);
    const subsMonthly = subs.reduce((a, r) => a + monthlyEquivalent(r), 0);
    const income = active.filter((r) => r.type === 'income' && kindOf(r.categoryId) !== 'expense').reduce((a, r) => a + monthlyEquivalent(r), 0);
    return { fixed, subsMonthly, subsCount: subs.length, income };
  }, [recurring, kindOf]);

  // Solde prévisionnel des comptes courants / espèces sur 60 jours
  const forecast = useMemo(() => {
    const liquid = accounts.filter((a) => !a.archived && (a.type === 'checking' || a.type === 'cash' || a.type === 'credit'));
    const liquidIds = new Set(liquid.map((a) => a.id));
    let bal = liquid.reduce((a, acc) => a + (balances.get(acc.id) ?? 0), 0);
    // Dépenses courantes (hors échéances) : moyenne quotidienne des 90 derniers jours
    const since = addDays(today, -90);
    let variable = 0;
    for (const t of transactions) {
      if (t.type === 'expense' && !t.recurringId && t.date > since && t.date <= today && liquidIds.has(t.accountId)) variable += t.amount;
    }
    const variableDaily = Math.round(variable / 90);
    const end = addDays(today, 60);
    const occ = upcoming(recurring.filter((r) => r.active), addDays(today, 1), end);
    const dueNow = due;
    for (const o of dueNow) bal += effect(o.rec);
    const days: string[] = [];
    const values: number[] = [];
    let k = 0;
    const events: { date: string; rec: Recurring; after: number }[] = [];
    for (let d = today; d <= end; d = addDays(d, 1)) {
      if (d !== today) bal -= variableDaily;
      while (k < occ.length && occ[k].date === d) {
        bal += effect(occ[k].rec);
        events.push({ date: d, rec: occ[k].rec, after: bal });
        k++;
      }
      days.push(d);
      values.push(bal);
    }
    function effect(r: Recurring) {
      if (r.type === 'income') return liquidIds.has(r.accountId) ? r.amount : 0;
      if (r.type === 'expense') return liquidIds.has(r.accountId) ? -r.amount : 0;
      let v = 0;
      if (liquidIds.has(r.accountId)) v -= r.amount;
      if (r.toAccountId && liquidIds.has(r.toAccountId)) v += r.amount;
      return v;
    }
    const min = Math.min(...values);
    return { days, values, events, min, minDate: days[values.indexOf(min)], variableDaily };
  }, [accounts, balances, recurring, due, today, transactions]);

  const list = recurring
    .filter((r) => (tab === 'subs' ? r.subscription : tab === 'income' ? r.type === 'income' : true))
    .sort((a, b) => Number(b.active) - Number(a.active) || (a.nextDate < b.nextDate ? -1 : 1));

  async function validate(rec: Recurring, date: string) {
    await save('transactions', transactionFromOccurrence(rec, date, data.activeMembers));
    await patch('recurring', rec.id, { nextDate: nextDateAfter(rec, date) });
    toast.success(`${rec.name} enregistré`);
  }

  function fromSuggestion(s: RecurringSuggestion) {
    setEditing({
      name: s.payee,
      type: s.type,
      amount: s.amount,
      accountId: s.accountId,
      categoryId: s.categoryId,
      unit: s.unit,
      interval: s.interval,
      nextDate: s.nextDate,
      anchorDay: Number(s.nextDate.slice(8, 10)),
      autoPost: false,
      subscription: kindOf(s.categoryId) === 'expense' && (categoryMap.get(s.categoryId ?? '')?.name ?? '').toLowerCase().includes('abonnement'),
    });
  }

  return (
    <div>
      <PageHeader
        title="Échéancier"
        subtitle="Charges fixes, abonnements et revenus réguliers"
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing({})}>
            Nouvelle échéance
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Charges fixes" value={<Money value={stats.fixed} round />} hint="par mois" />
        <StatTile label="Abonnements" value={<Money value={stats.subsMonthly} round />} hint={`${stats.subsCount} actifs · ${formatMoney(stats.subsMonthly * 12, { round: true })}/an`} />
        <StatTile label="Revenus réguliers" value={<Money value={stats.income} round />} hint="par mois" />
        <StatTile
          label="Point bas à 60 jours"
          value={<Money value={forecast.min} round className={forecast.min < 0 ? 'text-danger' : ''} />}
          hint={forecast.minDate ? (forecast.minDate === today ? "aujourd'hui" : `le ${shortDate(forecast.minDate)}`) : undefined}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader
              title="Solde prévisionnel"
              subtitle={`Comptes courants et espèces sur 60 jours : échéances + dépenses courantes moyennes (≈ ${formatMoney(forecast.variableDaily, { round: true })}/jour)`}
            />
            <div className="px-3 pb-4 sm:px-5">
              <LineChart
                ariaLabel="Solde prévisionnel sur 60 jours"
                labels={forecast.days.map((d) => shortDate(d).replace(/ \d{4}$/, ''))}
                fullLabels={forecast.days.map((d) => dayHeading(d))}
                series={[{ name: 'Solde prévu', color: 'var(--s1)', values: forecast.values }]}
                zeroBased={forecast.min < 0}
              />
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-2">
              <h2 className="text-[15px] font-semibold">Mes échéances</h2>
              <Segmented
                size="sm"
                value={tab}
                onChange={setTab}
                ariaLabel="Filtrer"
                options={[
                  { value: 'all', label: 'Toutes' },
                  { value: 'subs', label: 'Abonnements' },
                  { value: 'income', label: 'Revenus' },
                ]}
              />
            </div>
            {list.length ? (
              <ul className="divide-y divide-line/60">
                {list.map((r) => {
                  const cat = r.categoryId ? categoryMap.get(r.categoryId) : null;
                  return (
                    <li key={r.id}>
                      <button type="button" onClick={() => setEditing(r)} className={cn('flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-surface-2', !r.active && 'opacity-50')}>
                        {r.type === 'transfer' ? (
                          <span className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted" aria-hidden>
                            <ArrowLeftRight size={17} />
                          </span>
                        ) : (
                          <CatIcon category={cat} group={cat ? groupMap.get(cat.groupId) : null} size={38} />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-medium">{r.name}</span>
                            {r.subscription && <span className="rounded bg-surface-2 px-1.5 text-[10px] font-semibold text-muted uppercase">abo</span>}
                            {!r.autoPost && <span className="rounded bg-warning-soft px-1.5 text-[10px] font-semibold text-warning-ink uppercase">à valider</span>}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {frequencyLabel(r.unit, r.interval)} · {r.active ? `prochaine : ${shortDate(r.nextDate)}` : 'en pause'}
                            {r.type === 'transfer' && ` · ${accountMap.get(r.accountId)?.name} → ${accountMap.get(r.toAccountId ?? '')?.name}`}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className={cn('tabular block font-semibold', r.type === 'income' && 'text-success')}>
                            {r.type === 'income' ? '+' : r.type === 'expense' ? '−' : ''}
                            <Money value={r.amount} />
                          </span>
                          {(r.unit !== 'month' || r.interval !== 1) && (
                            <span className="block text-[11px] text-muted">
                              ≈ <Money value={monthlyEquivalent(r)} round />
                              /mois
                            </span>
                          )}
                        </span>
                        {r.paidBy && <Avatar member={memberMap.get(r.paidBy)} size={20} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon="📅" title="Aucune échéance" action={<Button variant="primary" onClick={() => setEditing({})}>Ajouter</Button>}>
                Loyer, salaire, électricité, abonnements… Ajoutez-les une fois, Forla s’occupe du reste.
              </EmptyState>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {due.length > 0 && (
            <Card>
              <CardHeader title="À valider" subtitle="Échéances passées non enregistrées" />
              <ul className="divide-y divide-line/60 px-2 pb-3">
                {due.map(({ rec, date }) => (
                  <li key={rec.id + date} className="flex items-center gap-2 px-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{rec.name}</p>
                      <p className="text-xs text-muted">
                        {shortDate(date)} · <Money value={rec.amount} />
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg p-2 text-muted hover:bg-surface-2"
                      title="Ignorer cette échéance"
                      aria-label={`Ignorer ${rec.name}`}
                      onClick={() => patch('recurring', rec.id, { nextDate: nextDateAfter(rec, date) })}
                    >
                      <SkipForward size={16} />
                    </button>
                    <button type="button" className="rounded-lg bg-primary-soft p-2 text-primary" title="Valider" aria-label={`Valider ${rec.name}`} onClick={() => validate(rec, date)}>
                      <Check size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {suggestions.length > 0 && (
            <Card>
              <CardHeader title="Détectées automatiquement" icon={<Sparkles size={16} className="text-primary" />} subtitle="Dépenses qui reviennent régulièrement" />
              <ul className="divide-y divide-line/60 px-2 pb-3">
                {suggestions.slice(0, 8).map((s) => (
                  <li key={s.key} className="flex items-center gap-2 px-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.payee}</p>
                      <p className="text-xs text-muted">
                        {frequencyLabel(s.unit, s.interval)} · {s.count} fois · <Money value={s.amount} />
                      </p>
                    </div>
                    <Button size="sm" variant="soft" onClick={() => fromSuggestion(s)}>
                      Ajouter
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Les 30 prochains jours" />
            {(() => {
              const evts = forecast.events.filter((e) => e.date <= addDays(today, 30));
              return evts.length ? (
                <ul className="px-5 pb-4">
                  {evts.map((e, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate">{e.rec.name}</span>
                        <span className="block text-xs text-muted">{shortDate(e.date)}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={cn('tabular block font-medium', e.rec.type === 'income' && 'text-success')}>
                          {e.rec.type === 'income' ? '+' : e.rec.type === 'expense' ? '−' : '↔ '}
                          <Money value={e.rec.amount} />
                        </span>
                        <span className="tabular block text-[11px] text-muted">
                          solde <Money value={e.after} round />
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 pb-5 text-sm text-muted">Aucune échéance prévue.</p>
              );
            })()}
          </Card>
        </div>
      </div>

      {editing && <RecurringEditor initial={editing} onClose={() => setEditing(null)} members={activeMembers.map((m) => m.id)} />}
    </div>
  );
}

function RecurringEditor({ initial, onClose }: { initial: Partial<Recurring>; onClose: () => void; members: ID[] }) {
  const { activeAccounts, accounts, categories, groups, activeMembers, memberMap, accountMap, settings } = useData();
  const isEdit = !!initial.id;
  const [name, setName] = useState(initial.name ?? '');
  const [type, setType] = useState<TxType>(initial.type ?? 'expense');
  const [amountRaw, setAmountRaw] = useState(initial.amount ? centsToInput(initial.amount) : '');
  const [accountId, setAccountId] = useState(initial.accountId ?? activeAccounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState(initial.toAccountId ?? activeAccounts.find((a) => a.id !== (initial.accountId ?? activeAccounts[0]?.id))?.id ?? '');
  const [categoryId, setCategoryId] = useState<string>(initial.categoryId ?? '');
  const [paidBy, setPaidBy] = useState<string>(initial.paidBy ?? accountMap.get(initial.accountId ?? '')?.ownerId ?? '');
  const [splitMode, setSplitMode] = useState<SplitMode>(initial.splitMode ?? settings.defaultSplit);
  const [unit, setUnit] = useState<RecurrenceUnit>(initial.unit ?? 'month');
  const [interval, setIntervalN] = useState(initial.interval ?? 1);
  const [nextDate, setNextDate] = useState(initial.nextDate ?? todayISO());
  const [endDate, setEndDate] = useState(initial.endDate ?? '');
  const [autoPost, setAutoPost] = useState(initial.autoPost ?? true);
  const [subscription, setSubscription] = useState(initial.subscription ?? false);
  const [active, setActive] = useState(initial.active ?? true);
  const [note, setNote] = useState(initial.note ?? '');

  async function submit() {
    const amount = parseAmount(amountRaw);
    if (!name.trim()) return toast.error('Donnez un nom à cette échéance.');
    if (amount == null || amount <= 0) return toast.error('Montant invalide.');
    if (!accountId) return toast.error('Choisissez un compte.');
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) return toast.error('Choisissez deux comptes différents.');
    await save('recurring', {
      ...(initial as Recurring),
      id: initial.id ?? uid(),
      name: name.trim(),
      type,
      amount: Math.abs(amount),
      accountId,
      toAccountId: type === 'transfer' ? toAccountId : null,
      categoryId: type === 'transfer' ? null : categoryId || null,
      paidBy: type === 'expense' ? paidBy || null : null,
      splitMode: type === 'expense' && paidBy && activeMembers.length > 1 ? splitMode : 'none',
      unit,
      interval,
      anchorDay: unit === 'week' ? null : Number(nextDate.slice(8, 10)),
      startDate: initial.startDate ?? nextDate,
      nextDate,
      endDate: endDate || null,
      autoPost,
      active,
      subscription: type === 'expense' && subscription,
      note,
    });
    toast.success(isEdit ? 'Échéance modifiée' : 'Échéance ajoutée');
    onClose();
  }

  async function onDelete() {
    if (!initial.id) return;
    const snap = initial as Recurring;
    await remove('recurring', initial.id);
    onClose();
    toast('Échéance supprimée (les opérations passées sont conservées)', { action: { label: 'Annuler', onClick: () => save('recurring', snap) } });
  }

  const kind = type === 'income' ? 'income' : 'expense';
  return (
    <Sheet
      open
      onClose={onClose}
      title={isEdit ? 'Modifier l’échéance' : 'Nouvelle échéance'}
      footer={
        <div className="flex items-center gap-2">
          {isEdit && (
            <Button variant="danger" icon={<Trash2 size={16} />} onClick={onDelete}>
              Supprimer
            </Button>
          )}
          <Button variant="primary" className="ml-auto min-w-[8rem]" onClick={submit}>
            Enregistrer
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Segmented
          value={type}
          onChange={setType}
          className="w-full"
          ariaLabel="Type"
          options={[
            { value: 'expense', label: 'Dépense' },
            { value: 'income', label: 'Revenu' },
            { value: 'transfer', label: 'Virement' },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom" htmlFor="rec-name">
            <input id="rec-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Loyer, Netflix…" />
          </Field>
          <Field label="Montant" htmlFor="rec-amount">
            <AmountInput id="rec-amount" value={amountRaw} onChange={setAmountRaw} placeholder="0,00" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={type === 'transfer' ? 'Depuis' : 'Compte'} htmlFor="rec-acc">
            <select
              id="rec-acc"
              className="field"
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                if (!isEdit) setPaidBy(accountMap.get(e.target.value)?.ownerId ?? '');
              }}
            >
              {accounts
                .filter((a) => !a.archived || a.id === accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </Field>
          {type === 'transfer' ? (
            <Field label="Vers" htmlFor="rec-to">
              <select id="rec-to" className="field" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                {accounts
                  .filter((a) => a.id !== accountId && (!a.archived || a.id === toAccountId))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </Field>
          ) : (
            <Field label="Catégorie" htmlFor="rec-cat">
              <select id="rec-cat" className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">— Sans catégorie —</option>
                {groups
                  .filter((g) => g.kind === kind)
                  .map((g) => (
                    <optgroup key={g.id} label={g.name}>
                      {categories
                        .filter((c) => c.groupId === g.id && !c.archived)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.emoji} {c.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
              </select>
            </Field>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fréquence" htmlFor="rec-int">
            <div className="flex gap-2">
              <select id="rec-int" className="field" value={interval} onChange={(e) => setIntervalN(Number(e.target.value))} aria-label="Intervalle">
                {[1, 2, 3, 4, 6, 12].map((n) => (
                  <option key={n} value={n}>
                    Tous les {n}
                  </option>
                ))}
              </select>
              <select className="field" value={unit} onChange={(e) => setUnit(e.target.value as RecurrenceUnit)} aria-label="Unité">
                <option value="week">semaine(s)</option>
                <option value="month">mois</option>
                <option value="year">an(s)</option>
              </select>
            </div>
          </Field>
          <Field label="Prochaine échéance" htmlFor="rec-next">
            <input id="rec-next" type="date" className="field" value={nextDate} onChange={(e) => e.target.value && setNextDate(e.target.value)} />
          </Field>
        </div>
        {type === 'expense' && activeMembers.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payé par" htmlFor="rec-paid">
              <select id="rec-paid" className="field" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                <option value="">🏠 Compte commun</option>
                {activeMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.emoji} {m.name}
                  </option>
                ))}
              </select>
            </Field>
            {paidBy && activeMembers.length > 1 && (
              <Field label="Partage" htmlFor="rec-split">
                <select id="rec-split" className="field" value={splitMode} onChange={(e) => setSplitMode(e.target.value as SplitMode)}>
                  <option value="none">Personnel ({memberMap.get(paidBy)?.name})</option>
                  <option value="equal">Parts égales</option>
                  <option value="prorata">Au prorata des revenus</option>
                </select>
              </Field>
            )}
          </div>
        )}
        <Field label="Date de fin (facultatif)" htmlFor="rec-end" hint="Ex. fin d’un crédit ou d’un engagement.">
          <input id="rec-end" type="date" className="field" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <div className="divide-y divide-line rounded-2xl border border-line px-3">
          <Switch checked={autoPost} onChange={setAutoPost} label="Enregistrer automatiquement" description="Sinon, l’échéance vous est proposée « à valider »" />
          {type === 'expense' && <Switch checked={subscription} onChange={setSubscription} label="C’est un abonnement" description="Suivi dans le total de vos abonnements" />}
          <Switch checked={active} onChange={setActive} label="Active" description="Mettez en pause sans supprimer" />
        </div>
        <Field label="Note" htmlFor="rec-note">
          <input id="rec-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {amountRaw && unit && (
          <p className="text-sm text-muted">
            {frequencyLabel(unit, interval)} · ≈ {formatMoney(monthlyEquivalent({ amount: parseAmount(amountRaw) ?? 0, unit, interval }))} par mois ·{' '}
            {formatMoney(monthlyEquivalent({ amount: parseAmount(amountRaw) ?? 0, unit, interval }) * 12)} par an
          </p>
        )}
      </div>
    </Sheet>
  );
}
