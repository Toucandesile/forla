import { useMemo } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, CalendarClock, Check, HandCoins, Lightbulb, Plus, SkipForward } from 'lucide-react';
import { patch, save } from '../db/db';
import { ACCOUNT_TYPES, type Recurring } from '../db/schema';
import { useData, usePrefs, useUI } from '../state';
import { addDays, addMonths, currentMonth, daysInMonth, monthEnd, monthLabel, monthStart, shortDate, todayISO, relativeDays } from '../lib/dates';
import { BudgetIndex, computeBudgetRows, cumulativeDaily, flowTotals, spentByCategoryMonth, sumOccurrences } from '../lib/finance';
import { dueOccurrences, detectRecurring, monthlyEquivalent, nextDateAfter, transactionFromOccurrence, upcoming } from '../lib/recurring';
import { memberBalances, settleUp } from '../lib/split';
import { formatMoney, formatPercent } from '../lib/money';
import { LineChart, SegmentBar } from '../components/charts';
import { Avatar, Button, Card, CardHeader, CatIcon, EmptyState, Meter, Money, StatTile } from '../components/ui';
import { TxRow, sortTx } from '../components/TxList';

const SAVINGS_TYPES = new Set(['savings', 'investment']);

export default function Dashboard() {
  const data = useData();
  const [prefs] = usePrefs();
  const { openTx } = useUI();
  const { transactions, recurring, accounts, accountMap, categoryMap, groupMap, memberMap, kindOf, budgets, categories, balances, members } = data;

  const today = todayISO();
  const month = currentMonth();
  const prevMonth = addMonths(month, -1);
  const [y, m] = month.split('-').map(Number);
  const dim = daysInMonth(y, m);
  const dayOfMonth = Number(today.slice(8, 10));
  const daysLeft = dim - dayOfMonth + 1;

  const calc = useMemo(() => {
    const totals = flowTotals(transactions, kindOf, monthStart(month), monthEnd(month));
    const prevSameDay = flowTotals(transactions, kindOf, monthStart(prevMonth), `${prevMonth}-${String(Math.min(dayOfMonth, 31)).padStart(2, '0')}`);
    const prevTotals = flowTotals(transactions, kindOf, monthStart(prevMonth), monthEnd(prevMonth));
    const active = recurring.filter((r) => r.active);
    const next = upcoming(active, addDays(today, 1), monthEnd(month));
    const due = dueOccurrences(active, today);
    const upcomingIncome = sumOccurrences(next, 'income', kindOf);
    const upcomingExpense = sumOccurrences([...next, ...due], 'expense', kindOf);
    const isSavingsTransfer = (from: string, to: string | null) =>
      !!to && SAVINGS_TYPES.has(accountMap.get(to)?.type ?? '') && !SAVINGS_TYPES.has(accountMap.get(from)?.type ?? '');
    let saved = 0;
    for (const t of transactions) if (t.type === 'transfer' && t.date.startsWith(month) && isSavingsTransfer(t.accountId, t.toAccountId)) saved += t.amount;
    let upcomingSavings = 0;
    for (const o of next) if (o.rec.type === 'transfer' && isSavingsTransfer(o.rec.accountId, o.rec.toAccountId)) upcomingSavings += o.rec.amount;
    const incomeTotal = totals.income + upcomingIncome;
    const remaining = incomeTotal - totals.expense - upcomingExpense - saved - upcomingSavings;
    const cur = cumulativeDaily(transactions, kindOf, month, dim).map((v, i) => (i < dayOfMonth ? v : null));
    const [py, pm] = prevMonth.split('-').map(Number);
    const prevDays = daysInMonth(py, pm);
    const prev = cumulativeDaily(transactions, kindOf, prevMonth, prevDays);
    const prevAligned = Array.from({ length: dim }, (_, i) => prev[Math.min(i, prevDays - 1)]);
    return { totals, prevSameDay, prevTotals, next, due, upcomingIncome, upcomingExpense, saved: saved + upcomingSavings, incomeTotal, remaining, cur, prevAligned };
  }, [transactions, recurring, kindOf, accountMap, month, prevMonth, today, dayOfMonth, dim]);

  const budgetRows = useMemo(() => {
    const spent = spentByCategoryMonth(transactions, kindOf);
    return { rows: computeBudgetRows(month, categories, new BudgetIndex(budgets), spent), spent };
  }, [transactions, kindOf, categories, budgets, month]);

  const watch = budgetRows.rows
    .filter((r) => r.budgeted + r.carry > 0)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 5);

  const household = useMemo(() => settleUp(memberBalances(transactions, data.settlements, members)), [transactions, data.settlements, members]);

  const insights = useMemo(() => {
    const out: { icon: string; text: string; href?: string; tone?: 'warn' | 'good' }[] = [];
    for (const r of budgetRows.rows) {
      if (r.available < 0 && r.budgeted + r.carry > 0)
        out.push({ icon: r.category.emoji, text: `${r.category.name} : enveloppe dépassée de ${formatMoney(-r.available, { round: true })}`, href: '#/budget', tone: 'warn' });
    }
    for (const r of budgetRows.rows) {
      let avg = 0;
      for (let i = 1; i <= 3; i++) avg += budgetRows.spent.get(`${r.category.id}|${addMonths(month, -i)}`) ?? 0;
      avg = avg / 3;
      if (avg > 3000 && r.spent > avg * 1.25 && r.spent - avg > 3000 && r.available >= 0)
        out.push({
          icon: r.category.emoji,
          text: `${r.category.name} : ${formatMoney(r.spent, { round: true })} ce mois-ci, contre ${formatMoney(avg, { round: true })} en moyenne`,
          href: `#/operations?cat=${r.category.id}`,
        });
    }
    const uncategorized = transactions.filter((t) => t.type !== 'transfer' && !t.categoryId).length;
    if (uncategorized) out.push({ icon: '🏷️', text: `${uncategorized} opération${uncategorized > 1 ? 's' : ''} à catégoriser`, href: '#/operations?cat=none' });
    const subs = recurring.filter((r) => r.active && r.subscription);
    if (subs.length) {
      const monthly = subs.reduce((a, r) => a + monthlyEquivalent(r), 0);
      out.push({ icon: '📺', text: `${subs.length} abonnement${subs.length > 1 ? 's' : ''} : ${formatMoney(monthly, { round: true })}/mois, soit ${formatMoney(monthly * 12, { round: true })}/an`, href: '#/echeancier' });
    }
    const suggestions = detectRecurring(transactions, recurring);
    if (suggestions.length) out.push({ icon: '🔁', text: `${suggestions.length} dépense${suggestions.length > 1 ? 's' : ''} régulière${suggestions.length > 1 ? 's' : ''} détectée${suggestions.length > 1 ? 's' : ''} — à ajouter à l'échéancier ?`, href: '#/echeancier' });
    if (calc.prevSameDay.expense > 0 && calc.totals.expense < calc.prevSameDay.expense * 0.9)
      out.push({ icon: '👏', text: `Vous dépensez ${formatPercent((1 - calc.totals.expense / calc.prevSameDay.expense) * 100)} de moins que le mois dernier à la même date.`, tone: 'good' });
    const backupAge = prefs.lastBackupAt ? Math.floor((Date.now() - prefs.lastBackupAt) / 86400000) : null;
    if (transactions.length > 10 && (backupAge === null || backupAge > 30))
      out.push({ icon: '💾', text: backupAge === null ? 'Aucune sauvegarde pour l’instant : exportez vos données en lieu sûr.' : `Dernière sauvegarde il y a ${backupAge} jours.`, href: '#/reglages', tone: 'warn' });
    return out.slice(0, 6);
  }, [budgetRows, transactions, recurring, calc, month, prefs.lastBackupAt]);

  const me = prefs.meId ? memberMap.get(prefs.meId) : undefined;
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Bonne nuit' : hour < 18 ? 'Bonjour' : 'Bonsoir';
  const recent = useMemo(() => [...transactions].filter((t) => t.date <= today).sort(sortTx).slice(0, 6), [transactions, today]);
  const spendDelta = calc.prevSameDay.expense > 0 ? ((calc.totals.expense - calc.prevSameDay.expense) / calc.prevSameDay.expense) * 100 : null;
  const hasIncome = calc.incomeTotal > 0;
  const visibleAccounts = accounts.filter((a) => !a.archived);
  const netWorth = visibleAccounts.reduce((a, acc) => a + (balances.get(acc.id) ?? 0), 0);

  async function validate(rec: Recurring, date: string) {
    await save('transactions', transactionFromOccurrence(rec, date, data.activeMembers));
    await patch('recurring', rec.id, { nextDate: nextDateAfter(rec, date) });
    toast.success(`${rec.name} enregistré`);
  }
  async function skip(rec: Recurring, date: string) {
    await patch('recurring', rec.id, { nextDate: nextDateAfter(rec, date) });
    toast(`Échéance du ${shortDate(date)} ignorée`);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{monthLabel(month)}</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">
            {greeting}
            {me ? `, ${me.name}` : ''} {me?.emoji ?? '👋'}
          </h1>
        </div>
        <div className="hidden gap-2 sm:flex">
          <Button variant="secondary" onClick={() => openTx({ type: 'income' })}>
            + Revenu
          </Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => openTx({ type: 'expense' })}>
            Dépense
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Héros : reste à vivre */}
          <Card className="overflow-hidden">
            <div className="p-5 sm:p-6">
              {hasIncome ? (
                <>
                  <p className="text-sm font-medium text-muted">Reste à vivre ce mois-ci</p>
                  <p className={`mt-1 text-5xl font-bold tracking-tight ${calc.remaining < 0 ? 'text-danger' : ''}`}>
                    <Money value={calc.remaining} round />
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    {calc.remaining > 0 ? (
                      <>
                        soit <Money value={Math.floor(calc.remaining / daysLeft)} round className="font-semibold text-ink" /> par jour pendant {daysLeft} jour
                        {daysLeft > 1 ? 's' : ''}
                      </>
                    ) : (
                      'Vos dépenses prévues dépassent vos revenus du mois.'
                    )}
                  </p>
                  <div className="mt-5">
                    <SegmentBar
                      ariaLabel="Répartition des revenus du mois"
                      parts={[
                        { name: 'Dépensé', value: calc.totals.expense, color: 'var(--s2)' },
                        { name: 'Charges à venir', value: calc.upcomingExpense, color: 'var(--s4)', ink: '#0b0b0b' },
                        { name: 'Épargne', value: calc.saved, color: 'var(--s3)' },
                        { name: 'Reste à vivre', value: Math.max(0, calc.remaining), color: 'var(--surface-3)', ink: 'var(--text)' },
                      ]}
                    />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
                    <Detail label="Revenus attendus" value={calc.incomeTotal} />
                    <Detail label="Déjà dépensé" value={-calc.totals.expense} />
                    <Detail label="Charges à venir" value={-calc.upcomingExpense} />
                    <Detail label="Épargne" value={-calc.saved} />
                  </dl>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-muted">Dépenses ce mois-ci</p>
                  <p className="mt-1 text-5xl font-bold tracking-tight">
                    <Money value={calc.totals.expense} round />
                  </p>
                  <p className="mt-3 max-w-md text-sm text-muted">
                    Ajoutez vos revenus (idéalement en opération récurrente, comme un salaire) pour calculer votre <strong>reste à vivre</strong>.
                  </p>
                  <Button variant="soft" className="mt-4" icon={<Plus size={16} />} onClick={() => openTx({ type: 'income', makeRecurring: true })}>
                    Ajouter un revenu
                  </Button>
                </>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Revenus du mois" value={<Money value={calc.totals.income} round />} hint={calc.upcomingIncome ? `+ ${formatMoney(calc.upcomingIncome, { round: true })} attendus` : undefined} />
            <StatTile
              label="Dépenses du mois"
              value={<Money value={calc.totals.expense} round />}
              delta={
                spendDelta == null
                  ? undefined
                  : { text: `${spendDelta > 0 ? '+' : '−'}${formatPercent(Math.abs(spendDelta))} vs mois dernier à date`, good: spendDelta <= 0 }
              }
            />
            <StatTile
              className="col-span-2 sm:col-span-1"
              label="Patrimoine net"
              value={<Money value={netWorth} round />}
              hint={`${visibleAccounts.length} compte${visibleAccounts.length > 1 ? 's' : ''}`}
            />
          </div>

          <Card>
            <CardHeader title="Rythme de dépenses" subtitle="Dépenses cumulées, comparées au mois dernier" />
            <div className="px-3 pb-4 sm:px-5">
              <LineChart
                ariaLabel="Dépenses cumulées du mois comparées au mois précédent"
                labels={Array.from({ length: dim }, (_, i) => String(i + 1))}
                fullLabels={Array.from({ length: dim }, (_, i) => `${i + 1} ${monthLabel(month).split(' ')[0].toLowerCase()}`)}
                series={[
                  { name: 'Ce mois-ci', color: 'var(--s1)', values: calc.cur },
                  { name: 'Mois dernier', color: 'var(--axis)', values: calc.prevAligned },
                ]}
                marker={{ index: dayOfMonth - 1, label: "Aujourd'hui" }}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Dernières opérations"
              action={
                <a href="#/operations" className="flex items-center gap-1 text-sm font-medium text-primary">
                  Tout voir <ArrowRight size={14} />
                </a>
              }
            />
            {recent.length ? (
              <div className="divide-y divide-line/60 pb-2">
                {recent.map((t) => (
                  <TxRow key={t.id} tx={t} showDate />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="🧾"
                title="Aucune opération"
                action={
                  <Button variant="primary" icon={<Plus size={16} />} onClick={() => openTx()}>
                    Ajouter une dépense
                  </Button>
                }
              >
                Saisissez votre première dépense, ou importez un relevé bancaire depuis Réglages.
              </EmptyState>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {calc.due.length > 0 && (
            <Card className="border-warn/50">
              <CardHeader title="À valider" icon={<CalendarClock size={16} className="text-warning-ink" />} subtitle="Échéances arrivées à terme" />
              <ul className="divide-y divide-line/60 px-2 pb-3">
                {calc.due.slice(0, 5).map(({ rec, date }) => (
                  <li key={rec.id + date} className="flex items-center gap-3 px-2 py-2">
                    <CatIcon category={rec.categoryId ? categoryMap.get(rec.categoryId) : null} group={groupMap.get(categoryMap.get(rec.categoryId ?? '')?.groupId ?? '')} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{rec.name}</p>
                      <p className="text-xs text-muted">
                        {shortDate(date)} · <Money value={rec.amount} />
                      </p>
                    </div>
                    <button type="button" className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label={`Ignorer ${rec.name}`} title="Ignorer" onClick={() => skip(rec, date)}>
                      <SkipForward size={16} />
                    </button>
                    <button type="button" className="rounded-lg bg-primary-soft p-2 text-primary" aria-label={`Valider ${rec.name}`} title="Valider" onClick={() => validate(rec, date)}>
                      <Check size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {insights.length > 0 && (
            <Card>
              <CardHeader title="À retenir" icon={<Lightbulb size={16} className="text-primary" />} />
              <ul className="space-y-1 px-3 pb-3">
                {insights.map((i, k) => {
                  const content = (
                    <>
                      <span className="text-lg leading-none" aria-hidden>
                        {i.icon}
                      </span>
                      <span className="flex-1 text-sm">{i.text}</span>
                      {i.tone === 'warn' && <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning-ink" aria-label="Attention" />}
                    </>
                  );
                  return (
                    <li key={k}>
                      {i.href ? (
                        <a href={i.href} className="flex items-start gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
                          {content}
                        </a>
                      ) : (
                        <div className="flex items-start gap-3 px-2 py-2">{content}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Enveloppes à surveiller"
              action={
                <a href="#/budget" className="text-sm font-medium text-primary">
                  Budget
                </a>
              }
            />
            {watch.length ? (
              <ul className="space-y-3 px-5 pb-5">
                {watch.map((r) => (
                  <li key={r.category.id}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">
                        {r.category.emoji} {r.category.name}
                      </span>
                      <span className="tabular shrink-0 text-xs text-muted">
                        <Money value={r.spent} round /> / <Money value={r.budgeted + r.carry} round />
                      </span>
                    </div>
                    <Meter ratio={r.ratio} label={r.category.name} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 pb-5 text-sm text-muted">
                Aucun budget défini. <a href="#/budget" className="font-medium text-primary">Créer mon budget</a>
              </p>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Prochaines échéances"
              action={
                <a href="#/echeancier" className="text-sm font-medium text-primary">
                  Échéancier
                </a>
              }
            />
            {(() => {
              const list = upcoming(recurring.filter((r) => r.active), addDays(today, 1), addDays(today, 14)).slice(0, 6);
              return list.length ? (
                <ul className="px-5 pb-4">
                  {list.map(({ rec, date }) => (
                    <li key={rec.id + date} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate">{rec.name}</span>
                        <span className="block text-xs text-muted">{relativeDays(date)}</span>
                      </span>
                      <span className={`tabular shrink-0 font-medium ${rec.type === 'income' ? 'text-success' : ''}`}>
                        {rec.type === 'income' ? '+' : rec.type === 'expense' ? '−' : ''}
                        <Money value={rec.amount} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 pb-5 text-sm text-muted">Rien dans les 14 prochains jours.</p>
              );
            })()}
          </Card>

          {members.filter((x) => !x.archived).length > 1 && (
            <Card>
              <CardHeader
                title="Équilibre du foyer"
                icon={<HandCoins size={16} className="text-primary" />}
                action={
                  <a href="#/foyer" className="text-sm font-medium text-primary">
                    Détails
                  </a>
                }
              />
              <div className="px-5 pb-5">
                {household.length === 0 ? (
                  <p className="text-sm text-muted">Tout le monde est à l'équilibre ✨</p>
                ) : (
                  household.map((t) => (
                    <div key={t.from + t.to} className="flex items-center gap-2 py-1 text-sm">
                      <Avatar member={memberMap.get(t.from)} size={24} />
                      <span>
                        <strong>{memberMap.get(t.from)?.name}</strong> doit <Money value={t.amount} className="font-semibold" /> à{' '}
                        <strong>{memberMap.get(t.to)?.name}</strong>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Comptes"
              action={
                <a href="#/comptes" className="text-sm font-medium text-primary">
                  Gérer
                </a>
              }
            />
            <ul className="px-5 pb-4">
              {visibleAccounts.map((a) => (
                <li key={a.id}>
                  <a href={`#/comptes/${a.id}`} className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
                      <span className="truncate">{a.name}</span>
                      <span className="text-xs text-faint">{ACCOUNT_TYPES[a.type].emoji}</span>
                    </span>
                    <Money value={balances.get(a.id) ?? 0} className={`tabular font-medium ${(balances.get(a.id) ?? 0) < 0 ? 'text-danger' : ''}`} />
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular font-semibold">
        <Money value={value} round />
      </dd>
    </div>
  );
}
