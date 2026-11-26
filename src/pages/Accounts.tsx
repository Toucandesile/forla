import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Archive, CheckCheck, Pencil, Plus, Scale } from 'lucide-react';
import { db, save, uid } from '../db/db';
import { ACCOUNT_COLORS } from '../db/seed';
import { ACCOUNT_TYPES, type Account, type AccountType } from '../db/schema';
import { useData, useRoute, useUI, navigate } from '../state';
import { addMonths, currentMonth, monthLabel, monthShortLabel, monthRange, todayISO } from '../lib/dates';
import { computeBalances, netWorth, netWorthHistory } from '../lib/finance';
import { centsToInput, formatMoney, parseAmount } from '../lib/money';
import { LineChart } from '../components/charts';
import { AmountInput, Button, Card, CardHeader, EmptyState, Field, Money, PageHeader, Sheet, Switch, cn } from '../components/ui';
import { TxGroupedList, sortTx } from '../components/TxList';

export default function Accounts() {
  const route = useRoute();
  const id = route.segments[1];
  return id ? <AccountDetail id={id} /> : <AccountsList />;
}

function AccountsList() {
  const { accounts, balances, transactions, memberMap } = useData();
  const [editing, setEditing] = useState<Partial<Account> | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const nw = netWorth(accounts, balances);
  const months = useMemo(() => monthRange(addMonths(currentMonth(), -11), currentMonth()), []);
  const history = useMemo(() => netWorthHistory(accounts.filter((a) => !a.archived), transactions, months), [accounts, transactions, months]);
  const visible = accounts.filter((a) => showArchived || !a.archived);
  const byType = (Object.keys(ACCOUNT_TYPES) as AccountType[]).map((t) => ({ type: t, list: visible.filter((a) => a.type === t) })).filter((g) => g.list.length);

  return (
    <div>
      <PageHeader
        title="Comptes"
        subtitle="Soldes calculés à partir de vos opérations"
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing({})}>
            Nouveau compte
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <p className="text-sm text-muted">Patrimoine net</p>
          <p className="mt-1 text-4xl font-bold tracking-tight">
            <Money value={nw.total} round />
          </p>
          <div className="mt-1 flex gap-4 text-sm text-muted">
            <span>
              Actifs <Money value={nw.assets} round className="font-medium text-ink" />
            </span>
            <span>
              Dettes <Money value={nw.liabilities} round className="font-medium text-ink" />
            </span>
          </div>
          <div className="mt-4">
            <LineChart
              ariaLabel="Évolution du patrimoine net sur 12 mois"
              labels={months.map((m) => monthShortLabel(m))}
              fullLabels={months.map((m) => `Fin ${monthLabel(m).toLowerCase()}`)}
              series={[{ name: 'Patrimoine net', color: 'var(--s1)', values: history }]}
              zeroBased={false}
              height={180}
            />
          </div>
        </Card>
        <div className="space-y-4">
          {byType.length === 0 && (
            <Card>
              <EmptyState icon="🏦" title="Aucun compte" action={<Button variant="primary" onClick={() => setEditing({})}>Ajouter un compte</Button>}>
                Compte courant, joint, livret, espèces…
              </EmptyState>
            </Card>
          )}
          {byType.map((g) => (
            <Card key={g.type} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-sm">
                <span className="font-semibold">
                  {ACCOUNT_TYPES[g.type].emoji} {ACCOUNT_TYPES[g.type].label}
                </span>
                <Money value={g.list.reduce((a, x) => a + (balances.get(x.id) ?? 0), 0)} round className="tabular text-muted" />
              </div>
              <ul className="divide-y divide-line/60">
                {g.list.map((a) => (
                  <li key={a.id}>
                    <a href={`#/comptes/${a.id}`} className={cn('flex items-center gap-3 px-4 py-3 hover:bg-surface-2', a.archived && 'opacity-50')}>
                      <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: a.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{a.name}</span>
                        <span className="block text-xs text-muted">{a.ownerId ? `Titulaire : ${memberMap.get(a.ownerId)?.name ?? '?'}` : 'Commun'}</span>
                      </span>
                      <Money value={balances.get(a.id) ?? 0} className={cn('tabular font-semibold', (balances.get(a.id) ?? 0) < 0 && 'text-danger')} />
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          {accounts.some((a) => a.archived) && (
            <button type="button" className="w-full text-center text-sm text-muted hover:text-ink" onClick={() => setShowArchived((s) => !s)}>
              {showArchived ? 'Masquer' : 'Afficher'} les comptes archivés
            </button>
          )}
        </div>
      </div>
      {editing && <AccountEditor initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AccountDetail({ id }: { id: string }) {
  const { accountMap, balances, transactions, memberMap } = useData();
  const { openTx } = useUI();
  const account = accountMap.get(id);
  const [editing, setEditing] = useState(false);
  const [reconcile, setReconcile] = useState(false);
  const txs = useMemo(() => transactions.filter((t) => t.accountId === id || t.toAccountId === id).sort(sortTx), [transactions, id]);
  const months = useMemo(() => monthRange(addMonths(currentMonth(), -11), currentMonth()), []);
  const history = useMemo(() => {
    if (!account) return [];
    return months.map((m) => computeBalances([account], txs, `${m}-31`).get(id) ?? 0);
  }, [account, txs, months, id]);
  const [limit, setLimit] = useState(100);

  if (!account)
    return (
      <EmptyState icon="🤷" title="Compte introuvable" action={<Button onClick={() => navigate('/comptes')}>Retour aux comptes</Button>}>
        Il a peut-être été supprimé.
      </EmptyState>
    );
  const balance = balances.get(id) ?? 0;
  const uncleared = txs.filter((t) => !t.cleared).length;

  return (
    <div>
      <a href="#/comptes" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} /> Comptes
      </a>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: account.color }} />
            {account.name}
          </span>
        }
        subtitle={`${ACCOUNT_TYPES[account.type].label} · ${account.ownerId ? memberMap.get(account.ownerId)?.name : 'Commun'}${account.archived ? ' · archivé' : ''}`}
        actions={
          <>
            <Button variant="secondary" icon={<Scale size={16} />} onClick={() => setReconcile(true)}>
              Rapprocher
            </Button>
            <Button variant="secondary" icon={<Pencil size={16} />} onClick={() => setEditing(true)}>
              Modifier
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => openTx({ accountId: id })}>
              Opération
            </Button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5">
          <Card className="p-5">
            <p className="text-sm text-muted">Solde actuel</p>
            <p className={cn('mt-1 text-4xl font-bold tracking-tight', balance < 0 && 'text-danger')}>
              <Money value={balance} />
            </p>
            <p className="mt-1 text-sm text-muted">
              {uncleared} opération{uncleared > 1 ? 's' : ''} non pointée{uncleared > 1 ? 's' : ''}
            </p>
          </Card>
          <Card>
            <CardHeader title="Évolution sur 12 mois" />
            <div className="px-3 pb-4">
              <LineChart
                ariaLabel={`Solde de ${account.name} sur 12 mois`}
                labels={months.map((m) => monthShortLabel(m))}
                fullLabels={months.map((m) => `Fin ${monthLabel(m).toLowerCase()}`)}
                series={[{ name: 'Solde', color: account.color, values: history }]}
                zeroBased={false}
                height={160}
              />
            </div>
          </Card>
        </div>
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader title="Opérations" subtitle={`${txs.length} au total`} />
          {txs.length ? (
            <>
              <TxGroupedList txs={txs.slice(0, limit)} />
              {txs.length > limit && (
                <div className="border-t border-line p-3 text-center">
                  <Button variant="ghost" onClick={() => setLimit((l) => l + 200)}>
                    Afficher plus
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="px-5 pb-5 text-sm text-muted">Aucune opération sur ce compte.</p>
          )}
        </Card>
      </div>
      {editing && <AccountEditor initial={account} onClose={() => setEditing(false)} />}
      {reconcile && <ReconcileSheet account={account} balance={balance} onClose={() => setReconcile(false)} />}
    </div>
  );
}

function AccountEditor({ initial, onClose }: { initial: Partial<Account>; onClose: () => void }) {
  const { accounts, activeMembers } = useData();
  const isEdit = !!initial.id;
  const [name, setName] = useState(initial.name ?? '');
  const [type, setType] = useState<AccountType>(initial.type ?? 'checking');
  const [initialRaw, setInitialRaw] = useState(initial.initialBalance != null ? centsToInput(initial.initialBalance) : '');
  const [ownerId, setOwnerId] = useState(initial.ownerId ?? '');
  const [color, setColor] = useState(initial.color ?? ACCOUNT_COLORS[accounts.length % ACCOUNT_COLORS.length]);
  const [archived, setArchived] = useState(initial.archived ?? false);

  async function submit() {
    if (!name.trim()) return toast.error('Donnez un nom au compte.');
    const initialBalance = parseAmount(initialRaw || '0');
    if (initialBalance == null) return toast.error('Solde initial invalide.');
    await save('accounts', {
      ...(initial as Account),
      id: initial.id ?? uid(),
      name: name.trim(),
      type,
      initialBalance,
      ownerId: ownerId || null,
      color,
      archived,
      order: initial.order ?? accounts.length,
    });
    toast.success(isEdit ? 'Compte modifié' : 'Compte créé');
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={isEdit ? 'Modifier le compte' : 'Nouveau compte'}
      footer={
        <div className="flex justify-end">
          <Button variant="primary" onClick={submit} className="min-w-[8rem]">
            Enregistrer
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Nom" htmlFor="acc-name">
          <input id="acc-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Compte joint" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="acc-type">
            <select id="acc-type" className="field" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {Object.entries(ACCOUNT_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.emoji} {v.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Titulaire" htmlFor="acc-owner">
            <select id="acc-owner" className="field" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">🏠 Commun / joint</option>
              {activeMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.emoji} {m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label="Solde initial"
          htmlFor="acc-init"
          hint={ACCOUNT_TYPES[type].liability ? 'Pour un crédit, indiquez le capital restant dû en négatif (ex. -15000).' : 'Solde du compte avant la première opération saisie.'}
        >
          <AmountInput id="acc-init" value={initialRaw} onChange={setInitialRaw} placeholder="0,00" />
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-muted">Couleur</p>
          <div className="flex flex-wrap gap-2">
            {ACCOUNT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn('h-8 w-8 rounded-full ring-offset-2 ring-offset-surface', color === c && 'ring-2 ring-ink')}
                style={{ background: c }}
                aria-label={`Couleur ${c}`}
                aria-pressed={color === c}
              />
            ))}
          </div>
        </div>
        {isEdit && (
          <div className="rounded-2xl border border-line px-3">
            <Switch
              checked={archived}
              onChange={setArchived}
              label={
                <span className="flex items-center gap-1.5">
                  <Archive size={14} /> Archiver ce compte
                </span>
              }
              description="Compte clôturé : il est masqué mais son historique est conservé."
            />
          </div>
        )}
      </div>
    </Sheet>
  );
}

function ReconcileSheet({ account, balance, onClose }: { account: Account; balance: number; onClose: () => void }) {
  const [raw, setRaw] = useState(centsToInput(balance));
  const [markCleared, setMarkCleared] = useState(true);
  const target = parseAmount(raw);
  const diff = target != null ? target - balance : 0;

  async function submit() {
    if (target == null) return toast.error('Montant invalide');
    const today = todayISO();
    if (diff !== 0) {
      await save('transactions', {
        type: diff > 0 ? 'income' : 'expense',
        date: today,
        amount: Math.abs(diff),
        accountId: account.id,
        toAccountId: null,
        categoryId: null,
        payee: 'Ajustement de solde',
        note: 'Rapprochement bancaire',
        paidBy: null,
        split: { mode: 'none', shares: {} },
        cleared: true,
        recurringId: null,
        importId: null,
        hasReceipt: false,
      });
    }
    if (markCleared) {
      const now = Date.now();
      await db.transaction('rw', db.transactions, async () => {
        const list = await db.transactions.where('accountId').equals(account.id).filter((t) => !t.cleared && t.date <= today).toArray();
        await db.transactions.bulkPut(list.map((t) => ({ ...t, cleared: true, updatedAt: now })));
      });
    }
    toast.success(diff === 0 ? 'Compte rapproché, tout correspond ✓' : `Ajustement de ${formatMoney(diff, { signed: true })} créé`);
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Rapprochement bancaire"
      footer={
        <div className="flex justify-end">
          <Button variant="primary" icon={<CheckCheck size={16} />} onClick={submit}>
            Valider
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">Comparez avec le solde affiché par votre banque. En cas d’écart, Forla crée une opération d’ajustement.</p>
        <Field label={`Solde réel de « ${account.name} » aujourd’hui`} htmlFor="rec-bal">
          <AmountInput id="rec-bal" large value={raw} onChange={setRaw} />
        </Field>
        <div className="rounded-2xl bg-surface-2 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Solde dans Forla</span>
            <Money value={balance} />
          </div>
          <div className="mt-1 flex justify-between font-semibold">
            <span>Écart</span>
            <Money value={diff} signed className={diff === 0 ? 'text-success' : 'text-warning-ink'} />
          </div>
        </div>
        <div className="rounded-2xl border border-line px-3">
          <Switch checked={markCleared} onChange={setMarkCleared} label="Pointer toutes les opérations jusqu’à aujourd’hui" />
        </div>
      </div>
    </Sheet>
  );
}
