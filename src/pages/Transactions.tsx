import { useMemo, useState } from 'react';
import { Download, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useData, useRoute, useUI, navigate } from '../state';
import { currentMonth, monthOf } from '../lib/dates';
import { formatMoney, parseNumber } from '../lib/money';
import { transactionsToCSV, downloadBlob, backupFileName } from '../lib/backup';
import { isShared } from '../lib/split';
import { Button, Card, EmptyState, Money, MonthNav, PageHeader, cn } from '../components/ui';
import { TxGroupedList, sortTx } from '../components/TxList';

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export default function Transactions() {
  const data = useData();
  const route = useRoute();
  const { openTx } = useUI();
  const { transactions, categories, groups, accounts, activeMembers, categoryMap, accountMap, memberMap, kindOf } = data;

  const q = route.query;
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState<string | 'all'>(q.get('month') ?? (q.get('cat') || q.get('account') ? 'all' : currentMonth()));
  const [type, setType] = useState(q.get('type') ?? '');
  const [accountId, setAccountId] = useState(q.get('account') ?? '');
  const [categoryId, setCategoryId] = useState(q.get('cat') ?? '');
  const [memberId, setMemberId] = useState(q.get('member') ?? '');
  const [status, setStatus] = useState('');
  const [showFilters, setShowFilters] = useState(!!(q.get('account') || q.get('cat') || q.get('member')));
  const [limit, setLimit] = useState(200);

  const filtered = useMemo(() => {
    const text = fold(query.trim());
    const amountQuery = parseNumber(query);
    return transactions
      .filter((t) => {
        if (month !== 'all' && monthOf(t.date) !== month) return false;
        if (type && t.type !== type) return false;
        if (accountId && t.accountId !== accountId && t.toAccountId !== accountId) return false;
        if (categoryId === 'none' ? t.type === 'transfer' || !!t.categoryId : categoryId && t.categoryId !== categoryId) return false;
        if (memberId === 'common' ? !!t.paidBy : memberId && t.paidBy !== memberId && !(t.split?.shares && memberId in t.split.shares)) return false;
        if (status === 'uncleared' && t.cleared) return false;
        if (status === 'shared' && !isShared(t)) return false;
        if (status === 'receipt' && !t.hasReceipt) return false;
        if (text) {
          const cat = t.categoryId ? categoryMap.get(t.categoryId)?.name ?? '' : '';
          const hay = fold(`${t.payee} ${t.note} ${cat} ${accountMap.get(t.accountId)?.name ?? ''}`);
          const amountMatch = amountQuery != null && Math.abs(Math.round(amountQuery * 100)) === t.amount;
          if (!hay.includes(text) && !amountMatch) return false;
        }
        return true;
      })
      .sort(sortTx);
  }, [transactions, month, type, accountId, categoryId, memberId, status, query, categoryMap, accountMap]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of filtered) {
      if (t.type === 'expense') expense += t.amount;
      else if (t.type === 'income') {
        if (kindOf(t.categoryId) === 'expense') expense -= t.amount;
        else income += t.amount;
      }
    }
    return { income, expense };
  }, [filtered, kindOf]);

  const activeFilters = [type, accountId, categoryId, memberId, status].filter(Boolean).length;

  function reset() {
    setType('');
    setAccountId('');
    setCategoryId('');
    setMemberId('');
    setStatus('');
    setQuery('');
    navigate('/operations', true);
  }

  function exportCsv() {
    const blob = transactionsToCSV(filtered, {
      account: (id) => (id ? accountMap.get(id)?.name ?? '' : ''),
      category: (id) => (id ? categoryMap.get(id)?.name ?? '' : ''),
      member: (id) => (id ? memberMap.get(id)?.name ?? '' : ''),
    });
    downloadBlob(blob, backupFileName('forla-operations', 'csv'));
  }

  return (
    <div>
      <PageHeader
        title="Opérations"
        subtitle={`${filtered.length} opération${filtered.length > 1 ? 's' : ''}`}
        actions={
          <>
            <Button variant="secondary" icon={<Download size={16} />} onClick={exportCsv} disabled={!filtered.length}>
              <span className="hidden sm:inline">Exporter</span>
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => openTx()}>
              Ajouter
            </Button>
          </>
        }
      />

      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
            <input
              type="search"
              className="field pl-10"
              placeholder="Rechercher un libellé, une note, un montant…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Rechercher"
            />
          </div>
          {month === 'all' ? (
            <Button variant="secondary" onClick={() => setMonth(currentMonth())}>
              Toutes les dates
            </Button>
          ) : (
            <MonthNav month={month} onChange={setMonth} />
          )}
          {month !== 'all' && (
            <Button variant="ghost" size="sm" onClick={() => setMonth('all')}>
              Tout afficher
            </Button>
          )}
          <Button variant={showFilters || activeFilters ? 'soft' : 'secondary'} icon={<SlidersHorizontal size={16} />} onClick={() => setShowFilters((s) => !s)}>
            Filtres{activeFilters ? ` (${activeFilters})` : ''}
          </Button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <select className="field" aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Tous types</option>
              <option value="expense">Dépenses</option>
              <option value="income">Revenus</option>
              <option value="transfer">Virements</option>
            </select>
            <select className="field" aria-label="Compte" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Tous comptes</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select className="field" aria-label="Catégorie" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Toutes catégories</option>
              <option value="none">🏷️ À catégoriser</option>
              {groups.map((g) => (
                <optgroup key={g.id} label={g.name}>
                  {categories
                    .filter((c) => c.groupId === g.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.emoji} {c.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            {activeMembers.length > 0 && (
              <select className="field" aria-label="Membre" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                <option value="">Tous les membres</option>
                <option value="common">🏠 Compte commun</option>
                {activeMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.emoji} {m.name}
                  </option>
                ))}
              </select>
            )}
            <select className="field" aria-label="Statut" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tous statuts</option>
              <option value="uncleared">Non pointées</option>
              <option value="shared">Partagées</option>
              <option value="receipt">Avec justificatif</option>
            </select>
            {(activeFilters > 0 || query) && (
              <Button variant="ghost" icon={<X size={16} />} onClick={reset}>
                Effacer les filtres
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Summary label="Revenus" value={totals.income} className="text-success" />
        <Summary label="Dépenses" value={totals.expense} />
        <Summary label="Solde" value={totals.income - totals.expense} signed />
      </div>

      <Card className="overflow-hidden">
        {filtered.length ? (
          <>
            <TxGroupedList txs={filtered.slice(0, limit)} />
            {filtered.length > limit && (
              <div className="border-t border-line p-3 text-center">
                <Button variant="ghost" onClick={() => setLimit((l) => l + 200)}>
                  Afficher plus ({filtered.length - limit} restantes)
                </Button>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon="🔍"
            title={transactions.length ? 'Aucun résultat' : 'Aucune opération'}
            action={
              transactions.length ? (
                <Button variant="secondary" onClick={reset}>
                  Réinitialiser les filtres
                </Button>
              ) : (
                <Button variant="primary" icon={<Plus size={16} />} onClick={() => openTx()}>
                  Ajouter une opération
                </Button>
              )
            }
          >
            {transactions.length ? 'Essayez une autre période ou d’autres filtres.' : 'Saisissez une opération ou importez un relevé (Réglages → Importer).'}
          </EmptyState>
        )}
      </Card>
      <p className="mt-3 text-center text-xs text-faint">Astuce : appuyez sur « N » pour saisir une opération. Total affiché : {formatMoney(totals.expense)} de dépenses.</p>
    </div>
  );
}

function Summary({ label, value, className, signed }: { label: string; value: number; className?: string; signed?: boolean }) {
  return (
    <div className="card px-3 py-2.5 sm:px-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn('tabular font-semibold sm:text-lg', className)}>
        <Money value={value} signed={signed} round />
      </p>
    </div>
  );
}
