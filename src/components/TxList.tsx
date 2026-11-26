import { useContext } from 'react';
import { ArrowLeftRight, Check, Paperclip, Repeat, Users } from 'lucide-react';
import type { Transaction } from '../db/schema';
import { useData, useUI } from '../state';
import { dayHeading } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { isShared } from '../lib/split';
import { Avatar, CatIcon, cn, PrivacyContext } from './ui';

export function TxRow({ tx, showDate }: { tx: Transaction; showDate?: boolean }) {
  const { categoryMap, groupMap, accountMap, memberMap } = useData();
  const { openTx } = useUI();
  const hidden = useContext(PrivacyContext);
  const cat = tx.categoryId ? categoryMap.get(tx.categoryId) : null;
  const group = cat ? groupMap.get(cat.groupId) : null;
  const account = accountMap.get(tx.accountId);
  const member = tx.paidBy ? memberMap.get(tx.paidBy) : null;
  const isTransfer = tx.type === 'transfer';
  const refund = tx.type === 'income' && cat?.kind === 'expense';

  const subtitle = isTransfer
    ? `${account?.name ?? '?'} → ${accountMap.get(tx.toAccountId ?? '')?.name ?? '?'}`
    : [cat ? cat.name : 'À catégoriser', account?.name].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      onClick={() => openTx({ id: tx.id })}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface-2 focus-visible:bg-surface-2"
    >
      {isTransfer ? (
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted" aria-hidden>
          <ArrowLeftRight size={18} />
        </span>
      ) : (
        <CatIcon category={cat} group={group} />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium">{tx.payee || (cat?.name ?? 'Opération')}</span>
          {tx.recurringId && <Repeat size={12} className="shrink-0 text-faint" aria-label="Récurrente" />}
          {tx.hasReceipt && <Paperclip size={12} className="shrink-0 text-faint" aria-label="Justificatif" />}
          {tx.cleared && <Check size={12} className="shrink-0 text-faint" aria-label="Pointée" />}
        </span>
        <span className={cn('block truncate text-xs', cat || isTransfer ? 'text-muted' : 'font-medium text-warning-ink')}>
          {showDate && `${dayHeading(tx.date)} · `}
          {subtitle}
          {refund && ' · remboursement'}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span
          className={cn(
            'tabular font-semibold',
            tx.type === 'income' && 'text-success',
            isTransfer && 'text-muted',
            hidden && 'privacy-blur',
          )}
        >
          {tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}
          {formatMoney(tx.amount)}
        </span>
        {(member || isShared(tx)) && (
          <span className="flex items-center gap-1 text-[11px] text-muted">
            {isShared(tx) && <Users size={11} aria-label="Partagée" />}
            {member && <Avatar member={member} size={16} />}
          </span>
        )}
      </span>
    </button>
  );
}

/** Liste groupée par jour, avec total journalier des dépenses. */
export function TxGroupedList({ txs }: { txs: Transaction[] }) {
  const { kindOf } = useData();
  const hidden = useContext(PrivacyContext);
  const groups: { date: string; items: Transaction[] }[] = [];
  for (const tx of txs) {
    const last = groups[groups.length - 1];
    if (last && last.date === tx.date) last.items.push(tx);
    else groups.push({ date: tx.date, items: [tx] });
  }
  return (
    <div>
      {groups.map((g) => {
        const spent = g.items.reduce((a, t) => a + (t.type === 'expense' ? t.amount : t.type === 'income' && kindOf(t.categoryId) === 'expense' ? -t.amount : 0), 0);
        return (
          <section key={g.date}>
            <div className="sticky top-0 z-[1] flex items-center justify-between bg-surface/95 px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase backdrop-blur">
              <h3>{dayHeading(g.date)}</h3>
              {spent > 0 && <span className={cn('tabular normal-case', hidden && 'privacy-blur')}>−{formatMoney(spent)}</span>}
            </div>
            <div className="divide-y divide-line/60">
              {g.items.map((tx) => (
                <TxRow key={tx.id} tx={tx} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function sortTx(a: Transaction, b: Transaction) {
  return a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt;
}
