import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { useData, navigate } from '../state';
import { addMonths, currentMonth, monthEnd, monthLabel, monthRange, monthShortLabel, monthStart, monthOf, todayISO } from '../lib/dates';
import { flowTotals, spendingOf, incomeOf } from '../lib/finance';
import { formatMoney, formatPercent } from '../lib/money';
import { ColumnChart, HBarList, SegmentBar } from '../components/charts';
import { Card, CardHeader, Money, PageHeader, Segmented, StatTile } from '../components/ui';
import { normalizePayee } from '../lib/recurring';

type Period = 'month' | 'last' | '3m' | '6m' | '12m' | 'year';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'month', label: 'Ce mois' },
  { value: 'last', label: 'Mois dernier' },
  { value: '3m', label: '3 mois' },
  { value: '6m', label: '6 mois' },
  { value: '12m', label: '12 mois' },
  { value: 'year', label: 'Cette année' },
];

function periodRange(p: Period): [string, string] {
  const cm = currentMonth();
  switch (p) {
    case 'month':
      return [cm, cm];
    case 'last':
      return [addMonths(cm, -1), addMonths(cm, -1)];
    case '3m':
      return [addMonths(cm, -2), cm];
    case '6m':
      return [addMonths(cm, -5), cm];
    case '12m':
      return [addMonths(cm, -11), cm];
    case 'year':
      return [`${cm.slice(0, 4)}-01`, cm];
  }
}

export default function Reports() {
  const { transactions, categories, categoryMap, groupMap, kindOf, activeMembers } = useData();
  const [period, setPeriod] = useState<Period>('3m');
  const [who, setWho] = useState<string>('');

  const [fromM, toM] = periodRange(period);
  const from = monthStart(fromM);
  const to = monthEnd(toM);
  const txs = useMemo(
    () => transactions.filter((t) => (who === '' ? true : who === 'common' ? !t.paidBy : t.paidBy === who) && t.date <= todayISO()),
    [transactions, who],
  );
  const totals = useMemo(() => flowTotals(txs, kindOf, from, to), [txs, kindOf, from, to]);
  const nMonths = monthRange(fromM, toM).length;

  const chartMonths = useMemo(() => monthRange(nMonths < 6 ? addMonths(toM, -5) : fromM, toM), [fromM, toM, nMonths]);
  const monthly = useMemo(() => {
    const inc = new Map<string, number>();
    const exp = new Map<string, number>();
    for (const t of txs) {
      const m = monthOf(t.date);
      inc.set(m, (inc.get(m) ?? 0) + incomeOf(t, kindOf));
      exp.set(m, (exp.get(m) ?? 0) + spendingOf(t, kindOf));
    }
    return chartMonths.map((m) => ({ month: m, income: inc.get(m) ?? 0, expense: exp.get(m) ?? 0 }));
  }, [txs, kindOf, chartMonths]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of txs) {
      if (t.date < from || t.date > to) continue;
      const s = spendingOf(t, kindOf);
      if (!s) continue;
      const k = t.categoryId ?? 'none';
      map.set(k, (map.get(k) ?? 0) + s);
    }
    return [...map].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  }, [txs, kindOf, from, to]);

  const needsWants = useMemo(() => {
    let needs = 0;
    let wants = 0;
    for (const [k, v] of byCategory) {
      if (k !== 'none' && categoryMap.get(k)?.essential) needs += v;
      else wants += v;
    }
    const savings = Math.max(0, totals.income - needs - wants);
    return { needs, wants, savings };
  }, [byCategory, categoryMap, totals.income]);

  const payees = useMemo(() => {
    const map = new Map<string, { name: string; total: number; count: number }>();
    for (const t of txs) {
      if (t.type !== 'expense' || t.date < from || t.date > to) continue;
      const key = normalizePayee(t.payee) || t.payee;
      const cur = map.get(key) ?? { name: t.payee, total: 0, count: 0 };
      cur.total += t.amount;
      cur.count++;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 8);
  }, [txs, from, to]);

  const top = byCategory.slice(0, 10);
  const rest = byCategory.slice(10).reduce((a, [, v]) => a + v, 0);
  const avgExpense = totals.expense / nMonths;

  return (
    <div>
      <PageHeader title="Analyses" subtitle={fromM === toM ? monthLabel(fromM) : `${monthLabel(fromM)} → ${monthLabel(toM)}`} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <Segmented value={period} onChange={setPeriod} options={PERIODS} ariaLabel="Période" />
        </div>
        {activeMembers.length > 0 && (
          <select className="field w-auto" aria-label="Payé par" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Tout le foyer</option>
            <option value="common">🏠 Compte commun</option>
            {activeMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.emoji} Payé par {m.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Revenus" value={<Money value={totals.income} round />} hint={nMonths > 1 ? `${formatMoney(totals.income / nMonths, { round: true })}/mois en moyenne` : undefined} />
        <StatTile label="Dépenses" value={<Money value={totals.expense} round />} hint={nMonths > 1 ? `${formatMoney(avgExpense, { round: true })}/mois en moyenne` : undefined} />
        <StatTile label="Épargne nette" value={<Money value={totals.net} round className={totals.net < 0 ? 'text-danger' : ''} />} hint="Revenus − dépenses" />
        <StatTile
          label="Taux d’épargne"
          value={totals.income > 0 ? formatPercent(totals.savingsRate) : '—'}
          delta={totals.income > 0 ? { text: totals.savingsRate >= 20 ? 'Objectif 20 % atteint' : 'Repère conseillé : 20 %', good: totals.savingsRate >= 20 ? true : null } : undefined}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Revenus et dépenses par mois" />
          <div className="px-3 pb-4 sm:px-5">
            <ColumnChart
              ariaLabel="Revenus et dépenses par mois"
              labels={monthly.map((m) => monthShortLabel(m.month, chartMonths.length > 12))}
              fullLabels={monthly.map((m) => monthLabel(m.month))}
              series={[
                { name: 'Revenus', color: 'var(--s1)', values: monthly.map((m) => m.income) },
                { name: 'Dépenses', color: 'var(--s2)', values: monthly.map((m) => m.expense) },
              ]}
            />
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted">Voir le tableau</summary>
              <table className="tabular mt-2 w-full text-right">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1 text-left font-medium">Mois</th>
                    <th className="font-medium">Revenus</th>
                    <th className="font-medium">Dépenses</th>
                    <th className="font-medium">Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((m) => (
                    <tr key={m.month} className="border-t border-line">
                      <td className="py-1 text-left">{monthLabel(m.month)}</td>
                      <td>
                        <Money value={m.income} round />
                      </td>
                      <td>
                        <Money value={m.expense} round />
                      </td>
                      <td>
                        <Money value={m.income - m.expense} round signed />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Règle 50 / 30 / 20" subtitle="Besoins, envies et épargne, en part des revenus" />
          <div className="px-5 pb-5">
            {totals.income > 0 ? (
              <>
                <SegmentBar
                  ariaLabel="Répartition des revenus entre besoins, envies et épargne"
                  parts={[
                    { name: 'Besoins', value: needsWants.needs, color: 'var(--s1)' },
                    { name: 'Envies', value: needsWants.wants, color: 'var(--s2)' },
                    { name: 'Épargne', value: needsWants.savings, color: 'var(--s3)' },
                  ]}
                />
                <ul className="mt-4 space-y-2 text-sm">
                  {[
                    { label: 'Besoins', v: needsWants.needs, target: 50, hint: 'logement, courses, transport, santé…' },
                    { label: 'Envies', v: needsWants.wants, target: 30, hint: 'sorties, shopping, loisirs…' },
                    { label: 'Épargne', v: needsWants.savings, target: 20, hint: 'ce qui reste des revenus' },
                  ].map((r) => {
                    const pct = (r.v / totals.income) * 100;
                    const ok = r.label === 'Épargne' ? pct >= r.target : pct <= r.target;
                    return (
                      <li key={r.label} className="flex items-center justify-between gap-2">
                        <span>
                          <span className="font-medium">{r.label}</span> <span className="text-xs text-muted">· {r.hint}</span>
                        </span>
                        <span className="tabular shrink-0">
                          <span className="font-semibold">{formatPercent(pct)}</span>
                          <span className={`ml-1 text-xs ${ok ? 'text-success' : 'text-warning-ink'}`}>
                            {ok ? '✓' : '⚠'} {r.label === 'Épargne' ? '≥' : '≤'} {r.target} %
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
                  <Info size={13} className="mt-0.5 shrink-0" /> Les catégories « essentielles » se règlent dans Réglages → Catégories.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">Saisissez vos revenus pour obtenir cette analyse.</p>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Dépenses par catégorie" subtitle={`${formatMoney(totals.expense, { round: true })} au total · cliquez pour voir le détail`} />
          <div className="px-3 pb-4">
            {top.length ? (
              <HBarList
                total={totals.expense}
                items={[
                  ...top.map(([k, v]) => {
                    const c = categoryMap.get(k);
                    return {
                      key: k,
                      label: (
                        <>
                          <span aria-hidden>{c?.emoji ?? '🏷️'}</span>
                          <span className="truncate">{c?.name ?? 'À catégoriser'}</span>
                          {c && <span className="hidden truncate text-xs text-faint sm:inline">{groupMap.get(c.groupId)?.name}</span>}
                        </>
                      ),
                      value: v,
                      sub: nMonths > 1 ? `${formatMoney(v / nMonths, { round: true })}/mois` : undefined,
                      onClick: () => navigate(`/operations?cat=${k}${fromM === toM ? `&month=${fromM}` : ''}`),
                    };
                  }),
                  ...(rest > 0 ? [{ key: 'rest', label: <span className="text-muted">Autres catégories</span>, value: rest }] : []),
                ]}
              />
            ) : (
              <p className="px-2 pb-2 text-sm text-muted">Aucune dépense sur la période.</p>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Où part l’argent" subtitle="Principaux bénéficiaires" />
          {payees.length ? (
            <ol className="px-5 pb-4">
              {payees.map((p, i) => (
                <li key={p.name} className="flex items-center gap-3 py-1.5 text-sm">
                  <span className="tabular w-5 text-xs text-faint">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block text-xs text-muted">
                      {p.count} achat{p.count > 1 ? 's' : ''} · panier moyen {formatMoney(p.total / p.count)}
                    </span>
                  </span>
                  <Money value={p.total} round className="tabular font-semibold" />
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-5 pb-5 text-sm text-muted">Rien à afficher.</p>
          )}
        </Card>
      </div>
      {categories.length === 0 && <p className="mt-4 text-sm text-muted">Aucune catégorie.</p>}
    </div>
  );
}
