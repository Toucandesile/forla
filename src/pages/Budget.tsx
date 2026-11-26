import { useMemo, useState, useContext } from 'react';
import { toast } from 'sonner';
import { Info, Repeat, Wand2 } from 'lucide-react';
import { saveMany, save, patch } from '../db/db';
import type { Category, CategoryGroup } from '../db/schema';
import { useData } from '../state';
import { addMonths, currentMonth, monthEnd, monthLabel, monthShortLabel, monthStart, todayISO, addDays } from '../lib/dates';
import { BudgetIndex, computeBudgetRows, flowTotals, spentByCategoryMonth, averageSpent, sumOccurrences, type BudgetRow } from '../lib/finance';
import { upcoming } from '../lib/recurring';
import { centsToInput, formatMoney, parseAmount } from '../lib/money';
import { ColumnChart } from '../components/charts';
import { AmountInput, Button, Card, CatIcon, Meter, Money, MonthNav, PageHeader, Pill, PrivacyContext, Sheet, Switch, cn } from '../components/ui';
import { TxRow, sortTx } from '../components/TxList';

const roundUp = (cents: number, step = 500) => Math.ceil(cents / step) * step;

export default function BudgetPage() {
  const data = useData();
  const { categories, groups, budgets, transactions, kindOf, recurring } = data;
  const [month, setMonth] = useState(currentMonth());
  const [detail, setDetail] = useState<Category | null>(null);
  const [fillOpen, setFillOpen] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);

  const index = useMemo(() => new BudgetIndex(budgets), [budgets]);
  const spent = useMemo(() => spentByCategoryMonth(transactions, kindOf), [transactions, kindOf]);
  const rows = useMemo(() => computeBudgetRows(month, categories, index, spent), [month, categories, index, spent]);

  const income = useMemo(() => {
    const received = flowTotals(transactions, kindOf, monthStart(month), monthEnd(month)).income;
    const today = todayISO();
    const from = month < currentMonth() ? null : month === currentMonth() ? addDays(today, 1) : monthStart(month);
    const expected = from
      ? sumOccurrences(
          upcoming(
            recurring.filter((r) => r.active),
            from,
            monthEnd(month),
          ),
          'income',
          kindOf,
        )
      : 0;
    return { received, expected, total: received + expected };
  }, [transactions, kindOf, month, recurring]);

  const totalBudgeted = rows.reduce((a, r) => a + r.budgeted, 0);
  const totalSpent = rows.reduce((a, r) => a + r.spent, 0);
  const totalAvailable = rows.reduce((a, r) => a + Math.max(0, r.available), 0);
  const toAssign = income.total - totalBudgeted;
  const uncategorized = spent.get(`none|${month}`) ?? 0;
  const isEmpty = (r: BudgetRow) => !r.budgeted && !r.carry && !r.spent;
  const anyActive = rows.some((r) => !isEmpty(r));
  const hiddenCount = anyActive && !showEmpty ? rows.filter(isEmpty).length : 0;

  async function setBudget(categoryId: string, cents: number) {
    if (index.amount(categoryId, month) === cents && index.isExplicit(categoryId, month)) return;
    await save('budgets', { id: `${month}|${categoryId}`, month, categoryId, amount: Math.max(0, cents) });
  }

  async function fill(mode: 'last' | 'avg3' | 'zero') {
    const list = rows.map((r) => {
      const v =
        mode === 'zero'
          ? 0
          : mode === 'last'
            ? roundUp(spent.get(`${r.category.id}|${addMonths(month, -1)}`) ?? 0)
            : roundUp(averageSpent(spent, r.category.id, month, 3));
      return { id: `${month}|${r.category.id}`, month, categoryId: r.category.id, amount: v };
    });
    await saveMany('budgets', list);
    setFillOpen(false);
    toast.success('Budget du mois mis à jour');
  }

  return (
    <div>
      <PageHeader
        title="Budget"
        subtitle="Donnez un rôle à chaque euro. Un montant saisi est reconduit les mois suivants."
        actions={
          <>
            <MonthNav month={month} onChange={setMonth} />
            <Button variant="secondary" icon={<Wand2 size={16} />} onClick={() => setFillOpen(true)}>
              Remplir
            </Button>
          </>
        }
      />

      <Card className="mb-5 p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted">Revenus {month < currentMonth() ? 'du mois' : 'attendus'}</p>
            <p className="text-lg font-semibold">
              <Money value={income.total} round />
            </p>
            {income.expected > 0 && (
              <p className="text-xs text-muted">
                dont <Money value={income.expected} round /> à venir
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted">Budgété</p>
            <p className="text-lg font-semibold">
              <Money value={totalBudgeted} round />
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Dépensé</p>
            <p className="text-lg font-semibold">
              <Money value={totalSpent + uncategorized} round />
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Reste à budgéter</p>
            <p className={cn('text-lg font-semibold', toAssign < 0 ? 'text-danger' : toAssign > 0 ? 'text-success' : '')}>
              <Money value={toAssign} round />
            </p>
            <p className="text-xs text-muted">{toAssign < 0 ? 'Budget supérieur aux revenus' : toAssign === 0 ? 'Chaque euro a un rôle 🎯' : 'À répartir ou épargner'}</p>
          </div>
        </div>
        {income.total > 0 && (
          <div className="mt-4">
            <Meter ratio={totalBudgeted / income.total} label="Part des revenus budgétée" />
            <p className="mt-1 text-xs text-muted">
              {Math.round((totalBudgeted / income.total) * 100)} % des revenus attribués · <Money value={totalAvailable} round /> encore disponibles dans les enveloppes
            </p>
          </div>
        )}
      </Card>

      <div className="space-y-4">
        {groups
          .filter((g) => g.kind === 'expense')
          .map((g) => {
            const groupRows = rows.filter((r) => r.category.groupId === g.id && (showEmpty || !anyActive || !isEmpty(r)));
            if (!groupRows.length) return null;
            const gb = groupRows.reduce((a, r) => a + r.budgeted + r.carry, 0);
            const gs = groupRows.reduce((a, r) => a + r.spent, 0);
            return (
              <Card key={g.id} className="overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2/50 px-4 py-2.5">
                  <h2 className="flex items-center gap-2 font-semibold">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                    {g.name}
                  </h2>
                  <p className="tabular text-xs text-muted">
                    <Money value={gs} round /> / <Money value={gb} round />
                  </p>
                </div>
                <div className="hidden grid-cols-[minmax(0,1fr)_8.5rem_6.5rem_7.5rem] gap-3 px-4 pt-2 text-xs font-medium text-faint uppercase sm:grid">
                  <span>Enveloppe</span>
                  <span className="text-right">Budgété</span>
                  <span className="text-right">Dépensé</span>
                  <span className="text-right">Disponible</span>
                </div>
                <ul className="divide-y divide-line/60">
                  {groupRows.map((r) => (
                    <BudgetLine key={r.category.id} row={r} month={month} group={g} onEdit={() => setDetail(r.category)} onSet={(v) => setBudget(r.category.id, v)} />
                  ))}
                </ul>
              </Card>
            );
          })}
        {anyActive && rows.some(isEmpty) && (
          <div className="text-center">
            <Button variant="ghost" size="sm" onClick={() => setShowEmpty((s) => !s)}>
              {showEmpty ? 'Masquer les enveloppes vides' : `Afficher ${hiddenCount} enveloppe${hiddenCount > 1 ? 's' : ''} sans budget ni dépense`}
            </Button>
          </div>
        )}
        {uncategorized > 0 && (
          <Card className="flex items-center justify-between gap-3 p-4">
            <span className="flex items-center gap-3">
              <CatIcon category={null} />
              <span>
                <span className="block font-medium">Dépenses non catégorisées</span>
                <a href={`#/operations?cat=none&month=${month}`} className="text-sm text-primary">
                  Les classer
                </a>
              </span>
            </span>
            <Money value={uncategorized} className="font-semibold" />
          </Card>
        )}
      </div>

      <Sheet open={fillOpen} onClose={() => setFillOpen(false)} title={`Remplir ${monthLabel(month).toLowerCase()}`}>
        <div className="space-y-2">
          {[
            { mode: 'avg3' as const, title: 'Moyenne des 3 derniers mois', desc: 'Idéal pour démarrer : un budget réaliste basé sur vos habitudes.' },
            { mode: 'last' as const, title: 'Dépenses du mois dernier', desc: 'Reprend ce que vous avez réellement dépensé le mois précédent.' },
            { mode: 'zero' as const, title: 'Tout remettre à zéro', desc: 'Repartir d’une feuille blanche pour ce mois et les suivants.' },
          ].map((o) => (
            <button key={o.mode} type="button" onClick={() => fill(o.mode)} className="w-full rounded-2xl border border-line p-4 text-left hover:bg-surface-2">
              <span className="block font-medium">{o.title}</span>
              <span className="block text-sm text-muted">{o.desc}</span>
            </button>
          ))}
          <p className="flex items-start gap-2 pt-2 text-xs text-muted">
            <Info size={14} className="mt-0.5 shrink-0" /> Les montants sont arrondis aux 5 € supérieurs et s’appliquent aussi aux mois suivants.
          </p>
        </div>
      </Sheet>

      {detail && <CategoryDetail category={detail} month={month} index={index} spent={spent} onClose={() => setDetail(null)} onSet={(v) => setBudget(detail.id, v)} />}
    </div>
  );
}

function BudgetLine({ row, onEdit, onSet, group }: { row: BudgetRow; month: string; group: CategoryGroup; onEdit: () => void; onSet: (v: number) => void }) {
  const [raw, setRaw] = useState<string | null>(null);
  const hidden = useContext(PrivacyContext);
  const { category: c, budgeted, spent, available, carry, ratio } = row;
  const envelope = budgeted + carry;
  const tone = available < 0 ? 'bad' : envelope > 0 && ratio >= 0.85 ? 'warn' : envelope > 0 ? 'good' : 'neutral';

  function commit() {
    if (raw == null) return;
    const v = parseAmount(raw);
    setRaw(null);
    if (v == null) return;
    onSet(v);
  }

  return (
    <li className="px-4 py-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_8.5rem_6.5rem_7.5rem]">
        <button type="button" onClick={onEdit} className="flex min-w-0 items-center gap-3 text-left">
          <CatIcon category={c} group={group} size={34} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-medium">{c.name}</span>
              {c.rollover && <Repeat size={12} className="shrink-0 text-faint" aria-label="Report du reste activé" />}
            </span>
            {envelope > 0 ? (
              <Meter ratio={ratio} className="mt-1.5" label={`${c.name} : consommation de l'enveloppe`} />
            ) : (
              <span className="text-xs text-faint">{spent > 0 ? 'Pas de budget' : 'Définir un budget'}</span>
            )}
          </span>
        </button>
        <div className="hidden sm:block">
          <input
            inputMode="decimal"
            className={cn('field tabular h-9 py-1 text-right text-sm', hidden && raw == null && 'privacy-blur')}
            aria-label={`Budget ${c.name}`}
            value={raw ?? (budgeted ? centsToInput(budgeted) : '')}
            placeholder="0"
            onFocus={(e) => {
              setRaw(budgeted ? centsToInput(budgeted) : '');
              requestAnimationFrame(() => e.target.select());
            }}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRaw(null);
            }}
          />
        </div>
        <span className="tabular hidden text-right text-sm text-muted sm:block">
          <Money value={spent} />
        </span>
        <span className="text-right">
          <Pill tone={tone} className="tabular text-sm">
            <Money value={available} />
          </Pill>
          {carry !== 0 && (
            <span className="block text-[11px] text-faint">
              dont <Money value={carry} signed /> reporté
            </span>
          )}
        </span>
      </div>
    </li>
  );
}

function CategoryDetail({
  category,
  month,
  index,
  spent,
  onClose,
  onSet,
}: {
  category: Category;
  month: string;
  index: BudgetIndex;
  spent: Map<string, number>;
  onClose: () => void;
  onSet: (v: number) => void;
}) {
  const { transactions, categories } = useData();
  const live = categories.find((c) => c.id === category.id) ?? category;
  const [raw, setRaw] = useState(() => centsToInput(index.amount(category.id, month)));
  const months = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5));
  const avg = averageSpent(spent, category.id, month, 3);
  const last = spent.get(`${category.id}|${addMonths(month, -1)}`) ?? 0;
  const txs = transactions.filter((t) => t.categoryId === category.id && t.date.startsWith(month)).sort(sortTx);

  return (
    <Sheet
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {live.emoji} {live.name}
        </span>
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              const v = parseAmount(raw);
              if (v == null) return toast.error('Montant invalide');
              onSet(v);
              onClose();
            }}
          >
            Enregistrer
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="cat-budget" className="mb-1.5 block text-sm font-medium text-muted">
            Budget mensuel à partir de {monthLabel(month).toLowerCase()}
          </label>
          <AmountInput id="cat-budget" value={raw} onChange={setRaw} large />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" className="rounded-full bg-surface-2 px-2.5 py-1 text-xs" onClick={() => setRaw(centsToInput(roundUp(avg)))}>
              Moyenne 3 mois : {formatMoney(avg, { round: true })}
            </button>
            <button type="button" className="rounded-full bg-surface-2 px-2.5 py-1 text-xs" onClick={() => setRaw(centsToInput(roundUp(last)))}>
              Mois dernier : {formatMoney(last, { round: true })}
            </button>
          </div>
        </div>
        <div className="rounded-2xl border border-line px-3">
          <Switch
            checked={live.rollover}
            onChange={(v) => patch('categories', live.id, { rollover: v })}
            label="Reporter le reste d’un mois sur l’autre"
            description="Idéal pour les dépenses irrégulières : vacances, cadeaux, entretien…"
          />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Dépenses des 6 derniers mois</h3>
          <ColumnChart
            ariaLabel={`Dépenses mensuelles en ${live.name}`}
            height={170}
            labels={months.map((m) => monthShortLabel(m))}
            fullLabels={months.map((m) => monthLabel(m))}
            series={[{ name: 'Dépensé', color: 'var(--s1)', values: months.map((m) => spent.get(`${category.id}|${m}`) ?? 0) }]}
          />
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold">Opérations de {monthLabel(month).toLowerCase()}</h3>
          {txs.length ? (
            <div className="-mx-5 divide-y divide-line/60">
              {txs.map((t) => (
                <TxRow key={t.id} tx={t} showDate />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Aucune opération ce mois-ci.</p>
          )}
        </div>
      </div>
    </Sheet>
  );
}
