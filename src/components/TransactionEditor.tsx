import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Camera, Copy, Repeat, Trash2, X } from 'lucide-react';
import { db, remove, save, uid } from '../db/db';
import type { ID, RecurrenceUnit, SplitMode, Transaction, TxType } from '../db/schema';
import { useData, useUI } from '../state';
import { addDays, todayISO } from '../lib/dates';
import { centsToInput, formatMoney, parseAmount } from '../lib/money';
import { learnFromHistory, suggestCategory } from '../lib/importers';
import { makeSplit } from '../lib/split';
import { frequencyLabel, nextDateAfter } from '../lib/recurring';
import { compressImage } from '../lib/backup';
import { AmountInput, Avatar, Button, Field, Segmented, Sheet, Switch, cn } from './ui';

const LAST_ACCOUNT_KEY = 'forla.lastAccount';

function lastAccount(): string | null {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export function TransactionEditor() {
  const { txEditor, closeTx } = useUI();
  return (
    <TransactionEditorInner key={txEditor.seq} open={txEditor.open} onClose={closeTx} />
  );
}

function TransactionEditorInner({ open, onClose }: { open: boolean; onClose: () => void }) {
  const data = useData();
  const { txEditor, openTx } = useUI();
  const draft = txEditor.draft;
  const existing = draft?.id ? data.transactions.find((t) => t.id === draft.id) : undefined;
  const isEdit = !!existing;
  const { activeAccounts, activeMembers, categories, groups, transactions, rules, settings } = data;

  const defaultAccount = useMemo(() => {
    const last = lastAccount();
    return activeAccounts.find((a) => a.id === last)?.id ?? activeAccounts[0]?.id ?? '';
  }, [activeAccounts]);

  const init = existing ?? draft ?? {};
  const [type, setType] = useState<TxType>(init.type ?? 'expense');
  const [amountRaw, setAmountRaw] = useState(init.amount ? centsToInput(init.amount) : '');
  const [payee, setPayee] = useState(init.payee ?? '');
  const [categoryId, setCategoryId] = useState<ID | null>(init.categoryId ?? null);
  const [catTouched, setCatTouched] = useState(!!init.categoryId);
  const [accountId, setAccountId] = useState<ID>(init.accountId ?? defaultAccount);
  const [toAccountId, setToAccountId] = useState<ID>(init.toAccountId ?? activeAccounts.find((a) => a.id !== (init.accountId ?? defaultAccount))?.id ?? '');
  const [date, setDate] = useState(init.date ?? todayISO());
  const [note, setNote] = useState(init.note ?? '');
  const ownerOf = (accId: ID) => data.accountMap.get(accId)?.ownerId ?? null;
  const [paidBy, setPaidBy] = useState<ID | null>(init.paidBy !== undefined ? init.paidBy : ownerOf(init.accountId ?? defaultAccount));
  const [paidTouched, setPaidTouched] = useState(init.paidBy !== undefined);
  const [splitMode, setSplitMode] = useState<SplitMode>(init.split?.mode ?? (activeMembers.length > 1 ? settings.defaultSplit : 'none'));
  const [custom, setCustom] = useState<Record<ID, string>>(() => {
    const out: Record<ID, string> = {};
    for (const m of activeMembers) out[m.id] = init.split?.mode === 'custom' && init.split.shares[m.id] ? centsToInput(init.split.shares[m.id]) : '';
    return out;
  });
  const [cleared, setCleared] = useState(init.cleared ?? false);
  const [repeat, setRepeat] = useState(!!draft?.makeRecurring);
  const [repeatUnit, setRepeatUnit] = useState<RecurrenceUnit>('month');
  const [repeatInterval, setRepeatInterval] = useState(1);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [receiptChanged, setReceiptChanged] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && !isEdit) setTimeout(() => amountRef.current?.focus(), 60);
  }, [open, isEdit]);

  useEffect(() => {
    if (existing?.hasReceipt) db.receipts.get(existing.id).then((r) => setReceipt(r?.dataUrl ?? null));
  }, [existing?.id, existing?.hasReceipt]);

  const history = useMemo(() => learnFromHistory(transactions), [transactions]);
  const payees = useMemo(() => {
    const count = new Map<string, number>();
    for (const t of transactions) if (t.payee) count.set(t.payee, (count.get(t.payee) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]).slice(0, 300).map(([p]) => p);
  }, [transactions]);

  const kindWanted = type === 'income' ? 'income' : 'expense';
  const frequentCats = useMemo(() => {
    const count = new Map<ID, number>();
    const since = addDays(todayISO(), -120);
    for (const t of transactions) if (t.categoryId && t.type === type && t.date >= since) count.set(t.categoryId, (count.get(t.categoryId) ?? 0) + 1);
    return categories
      .filter((c) => !c.archived && c.kind === kindWanted)
      .sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) || a.order - b.order)
      .slice(0, 8);
  }, [transactions, categories, type, kindWanted]);

  const amount = parseAmount(amountRaw);
  const absAmount = amount != null ? Math.abs(amount) : null;
  const showSplit = type === 'expense' && !!paidBy && activeMembers.length > 1;
  const customTotal = activeMembers.reduce((a, m) => a + (parseAmount(custom[m.id] || '0') ?? 0), 0);

  function applySuggestion(p: string) {
    if (catTouched || !p.trim()) return;
    const s = suggestCategory(p, '', rules, history, categories);
    if (s.categoryId) {
      const cat = data.categoryMap.get(s.categoryId);
      if (cat && (cat.kind === kindWanted || type === 'income')) setCategoryId(s.categoryId);
    }
  }

  function onAccountChange(id: ID) {
    setAccountId(id);
    if (!paidTouched) setPaidBy(ownerOf(id));
  }

  async function submit(again = false) {
    if (absAmount == null || absAmount === 0) {
      toast.error('Indiquez un montant valide.');
      amountRef.current?.focus();
      return;
    }
    if (!accountId) {
      toast.error("Créez d'abord un compte dans l'onglet Comptes.");
      return;
    }
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) {
      toast.error('Choisissez deux comptes différents pour le virement.');
      return;
    }
    if (showSplit && splitMode === 'custom' && customTotal !== absAmount) {
      toast.error(`La répartition (${formatMoney(customTotal)}) doit égaler le montant (${formatMoney(absAmount)}).`);
      return;
    }
    const customCents: Record<ID, number> = {};
    for (const m of activeMembers) customCents[m.id] = parseAmount(custom[m.id] || '0') ?? 0;
    const id = existing?.id ?? uid();
    let recurringId = existing?.recurringId ?? null;
    if (repeat && !isEdit) {
      recurringId = uid();
      await save('recurring', {
        id: recurringId,
        name: payee.trim() || (type === 'transfer' ? 'Virement' : 'Opération récurrente'),
        type,
        amount: absAmount,
        accountId,
        toAccountId: type === 'transfer' ? toAccountId : null,
        categoryId: type === 'transfer' ? null : categoryId,
        paidBy: type === 'expense' ? paidBy : null,
        splitMode: showSplit ? (splitMode === 'custom' ? 'equal' : splitMode) : 'none',
        unit: repeatUnit,
        interval: repeatInterval,
        anchorDay: repeatUnit === 'week' ? null : Number(date.slice(8, 10)),
        startDate: date,
        nextDate: nextDateAfter({ unit: repeatUnit, interval: repeatInterval, anchorDay: Number(date.slice(8, 10)) }, date),
        endDate: null,
        autoPost: true,
        active: true,
        subscription: false,
        note,
      });
    }
    const tx: Omit<Transaction, 'createdAt' | 'updatedAt'> & { createdAt?: number; updatedAt?: number } = {
      ...(existing ?? {}),
      id,
      type,
      date,
      amount: absAmount,
      accountId,
      toAccountId: type === 'transfer' ? toAccountId : null,
      categoryId: type === 'transfer' ? null : categoryId,
      payee: payee.trim() || (type === 'transfer' ? 'Virement' : ''),
      note: note.trim(),
      paidBy: type === 'expense' ? paidBy : null,
      split: showSplit ? makeSplit(absAmount, splitMode, activeMembers, paidBy, customCents) : paidBy && type === 'expense' ? makeSplit(absAmount, 'none', activeMembers, paidBy) : { mode: 'none', shares: {} },
      cleared,
      recurringId,
      importId: existing?.importId ?? null,
      hasReceipt: receiptChanged ? !!receipt : (existing?.hasReceipt ?? false),
    };
    await save('transactions', tx);
    if (receiptChanged) {
      if (receipt) await save('receipts', { id, dataUrl: receipt });
      else if (existing?.hasReceipt) await remove('receipts', id);
    }
    try {
      localStorage.setItem(LAST_ACCOUNT_KEY, accountId);
    } catch {
      /* ignore */
    }
    toast.success(isEdit ? 'Opération modifiée' : `${type === 'income' ? 'Revenu' : type === 'transfer' ? 'Virement' : 'Dépense'} de ${formatMoney(absAmount)} enregistré${type === 'expense' ? 'e' : ''}`);
    if (again) {
      openTx({ type, accountId, date, paidBy });
    } else onClose();
  }

  async function onDelete() {
    if (!existing) return;
    const snapshot = existing;
    const rec = existing.hasReceipt ? await db.receipts.get(existing.id) : undefined;
    await remove('transactions', existing.id);
    if (rec) await remove('receipts', existing.id);
    onClose();
    toast('Opération supprimée', {
      action: {
        label: 'Annuler',
        onClick: async () => {
          await save('transactions', snapshot);
          if (rec) await save('receipts', rec);
        },
      },
    });
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    try {
      setReceipt(await compressImage(file));
      setReceiptChanged(true);
    } catch {
      toast.error("Impossible de lire l'image.");
    }
  }

  const expenseGroups = groups.filter((g) => g.kind === kindWanted);
  const otherGroups = type === 'income' ? groups.filter((g) => g.kind === 'expense') : [];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isEdit ? "Modifier l'opération" : 'Nouvelle opération'}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {isEdit && (
            <>
              <Button variant="danger" icon={<Trash2 size={16} />} onClick={onDelete}>
                Supprimer
              </Button>
              <Button
                variant="ghost"
                icon={<Copy size={16} />}
                onClick={() => openTx({ ...existing, id: undefined, date: todayISO(), cleared: false, importId: null, hasReceipt: false, recurringId: null })}
              >
                Dupliquer
              </Button>
            </>
          )}
          <div className="ml-auto flex gap-2">
            {!isEdit && (
              <Button variant="secondary" onClick={() => submit(true)} className="hidden sm:inline-flex">
                Enregistrer + nouvelle
              </Button>
            )}
            <Button variant="primary" onClick={() => submit(false)} className="min-w-[8rem]">
              Enregistrer
            </Button>
          </div>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <Segmented
          value={type}
          onChange={(t) => {
            setType(t);
            if (!catTouched || (data.categoryMap.get(categoryId ?? '')?.kind ?? kindWanted) !== (t === 'income' ? 'income' : 'expense')) {
              setCategoryId(null);
              setCatTouched(false);
            }
          }}
          className="w-full"
          ariaLabel="Type d'opération"
          options={[
            { value: 'expense', label: 'Dépense' },
            { value: 'income', label: 'Revenu' },
            { value: 'transfer', label: 'Virement' },
          ]}
        />

        <Field label="Montant" htmlFor="tx-amount" hint="Astuce : vous pouvez calculer, ex. 12,40+7,90">
          <AmountInput id="tx-amount" ref={amountRef} large value={amountRaw} onChange={setAmountRaw} placeholder="0,00" />
        </Field>

        {type !== 'transfer' && (
          <Field label={type === 'income' ? 'Source / libellé' : 'Bénéficiaire / libellé'} htmlFor="tx-payee">
            <input
              id="tx-payee"
              className="field"
              list="payee-list"
              value={payee}
              onChange={(e) => {
                setPayee(e.target.value);
                if (payees.includes(e.target.value)) applySuggestion(e.target.value);
              }}
              onBlur={() => applySuggestion(payee)}
              placeholder={type === 'income' ? 'Ex. Salaire' : 'Ex. Carrefour'}
              autoComplete="off"
            />
            <datalist id="payee-list">
              {payees.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>
        )}

        {type !== 'transfer' && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-muted">Catégorie</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {frequentCats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCategoryId(c.id);
                    setCatTouched(true);
                  }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition',
                    categoryId === c.id ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-line hover:bg-surface-2',
                  )}
                  aria-pressed={categoryId === c.id}
                >
                  <span aria-hidden>{c.emoji}</span>
                  {c.name}
                </button>
              ))}
            </div>
            <select
              aria-label="Toutes les catégories"
              className="field"
              value={categoryId ?? ''}
              onChange={(e) => {
                setCategoryId(e.target.value || null);
                setCatTouched(true);
              }}
            >
              <option value="">— Sans catégorie —</option>
              {expenseGroups.map((g) => (
                <optgroup key={g.id} label={g.name}>
                  {categories
                    .filter((c) => c.groupId === g.id && (!c.archived || c.id === categoryId))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.emoji} {c.name}
                      </option>
                    ))}
                </optgroup>
              ))}
              {otherGroups.map((g) => (
                <optgroup key={g.id} label={`Remboursement · ${g.name}`}>
                  {categories
                    .filter((c) => c.groupId === g.id && (!c.archived || c.id === categoryId))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.emoji} {c.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={type === 'transfer' ? 'Depuis le compte' : 'Compte'} htmlFor="tx-account">
            <select id="tx-account" className="field" value={accountId} onChange={(e) => onAccountChange(e.target.value)}>
              {activeAccounts.length === 0 && <option value="">Aucun compte</option>}
              {data.accounts
                .filter((a) => !a.archived || a.id === accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </Field>
          {type === 'transfer' ? (
            <Field label="Vers le compte" htmlFor="tx-to">
              <select id="tx-to" className="field" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                {data.accounts
                  .filter((a) => (!a.archived || a.id === toAccountId) && a.id !== accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </Field>
          ) : (
            <Field label="Date" htmlFor="tx-date">
              <input id="tx-date" type="date" className="field" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} required />
              <div className="mt-1.5 flex gap-1.5">
                {[
                  ["Aujourd'hui", todayISO()],
                  ['Hier', addDays(todayISO(), -1)],
                ].map(([l, d]) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDate(d)}
                    className={cn('rounded-full px-2.5 py-0.5 text-xs', date === d ? 'bg-primary-soft font-medium text-primary' : 'bg-surface-2 text-muted hover:text-ink')}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </Field>
          )}
        </div>
        {type === 'transfer' && (
          <Field label="Date" htmlFor="tx-date2">
            <input id="tx-date2" type="date" className="field" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
        )}

        {type === 'expense' && activeMembers.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-muted">Payé par</p>
            <div className="flex flex-wrap gap-1.5">
              {[null, ...activeMembers.map((m) => m.id)].map((id) => {
                const m = id ? data.memberMap.get(id) : null;
                const active = paidBy === id;
                return (
                  <button
                    key={id ?? 'common'}
                    type="button"
                    onClick={() => {
                      setPaidBy(id);
                      setPaidTouched(true);
                    }}
                    aria-pressed={active}
                    className={cn(
                      'flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm transition',
                      active ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-line hover:bg-surface-2',
                    )}
                  >
                    <Avatar member={m} size={24} />
                    {m ? m.name : 'Compte commun'}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {showSplit && (
          <div className="rounded-2xl bg-surface-2 p-3">
            <p className="mb-2 text-sm font-medium">Pour qui ?</p>
            <Segmented
              size="sm"
              value={splitMode}
              onChange={setSplitMode}
              className="w-full"
              ariaLabel="Répartition"
              options={[
                { value: 'none', label: 'Perso' },
                { value: 'equal', label: 'Parts égales' },
                { value: 'prorata', label: 'Au prorata' },
                { value: 'custom', label: 'Sur mesure' },
              ]}
            />
            {absAmount != null && absAmount > 0 && splitMode !== 'custom' && (
              <ul className="mt-2 space-y-1 text-sm">
                {Object.entries(makeSplit(absAmount, splitMode, activeMembers, paidBy).shares).map(([id, v]) => (
                  <li key={id} className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Avatar member={data.memberMap.get(id)} size={20} />
                      {data.memberMap.get(id)?.name}
                    </span>
                    <span className="tabular">{formatMoney(v)}</span>
                  </li>
                ))}
              </ul>
            )}
            {splitMode === 'custom' && (
              <div className="mt-2 space-y-2">
                {activeMembers.map((m) => (
                  <div key={m.id} className="flex items-center gap-2">
                    <Avatar member={m} size={24} />
                    <span className="w-24 truncate text-sm">{m.name}</span>
                    <div className="flex-1">
                      <AmountInput value={custom[m.id] ?? ''} onChange={(v) => setCustom((c) => ({ ...c, [m.id]: v }))} placeholder="0" aria-label={`Part de ${m.name}`} />
                    </div>
                  </div>
                ))}
                {absAmount != null && (
                  <p className={cn('text-xs', customTotal === absAmount ? 'text-success' : 'text-warning-ink')}>
                    {customTotal === absAmount ? 'Répartition complète ✓' : `Reste à répartir : ${formatMoney(absAmount - customTotal)}`}
                  </p>
                )}
              </div>
            )}
            {splitMode === 'prorata' && <p className="mt-2 text-xs text-muted">Selon les poids définis dans Foyer (ex. revenus de chacun).</p>}
          </div>
        )}

        <Field label="Note" htmlFor="tx-note">
          <textarea id="tx-note" className="field min-h-[64px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Facultatif" rows={2} />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
          {receipt ? (
            <div className="relative">
              <a href={receipt} target="_blank" rel="noreferrer" title="Voir le justificatif">
                <img src={receipt} alt="Justificatif" className="h-20 w-20 rounded-xl border border-line object-cover" />
              </a>
              <button
                type="button"
                className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-ink text-bg"
                aria-label="Retirer le justificatif"
                onClick={() => {
                  setReceipt(null);
                  setReceiptChanged(true);
                }}
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" icon={<Camera size={16} />} onClick={() => fileRef.current?.click()}>
              Photo du ticket
            </Button>
          )}
        </div>

        <div className="divide-y divide-line rounded-2xl border border-line px-3">
          <Switch checked={cleared} onChange={setCleared} label="Pointée" description="Vérifiée sur le relevé bancaire" />
          {!isEdit && (
            <Switch
              checked={repeat}
              onChange={setRepeat}
              label={
                <span className="flex items-center gap-1.5">
                  <Repeat size={14} /> Répéter automatiquement
                </span>
              }
              description={repeat ? frequencyLabel(repeatUnit, repeatInterval) : 'Loyer, abonnement, salaire…'}
            />
          )}
          {repeat && !isEdit && (
            <div className="flex gap-2 py-2.5">
              <select className="field" aria-label="Intervalle" value={repeatInterval} onChange={(e) => setRepeatInterval(Number(e.target.value))}>
                {[1, 2, 3, 4, 6].map((n) => (
                  <option key={n} value={n}>
                    Tous les {n}
                  </option>
                ))}
              </select>
              <select className="field" aria-label="Unité" value={repeatUnit} onChange={(e) => setRepeatUnit(e.target.value as RecurrenceUnit)}>
                <option value="week">semaine(s)</option>
                <option value="month">mois</option>
                <option value="year">an(s)</option>
              </select>
            </div>
          )}
        </div>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Sheet>
  );
}
