import type { ID, Member, Settlement, Split, SplitMode, Transaction } from '../db/schema';
import { allocate } from './money';

/**
 * Calcule les parts (en centimes) d'une dépense avancée par un membre.
 * - none    : dépense personnelle du payeur (aucune dette)
 * - equal   : parts égales entre les participants
 * - prorata : au prorata du poids (revenus) de chaque participant
 * - custom  : parts fournies
 */
export function computeShares(
  amount: number,
  mode: SplitMode,
  members: Member[],
  paidBy: ID | null,
  custom?: Record<ID, number>,
): Record<ID, number> {
  const active = members.filter((m) => !m.archived);
  if (mode === 'none' || active.length === 0) return paidBy ? { [paidBy]: amount } : {};
  if (mode === 'custom' && custom) {
    const out: Record<ID, number> = {};
    for (const [k, v] of Object.entries(custom)) if (v) out[k] = v;
    return out;
  }
  const weights = active.map((m) => (mode === 'prorata' ? Math.max(0, m.weight || 0) : 1));
  const parts = allocate(amount, weights);
  const out: Record<ID, number> = {};
  active.forEach((m, i) => {
    if (parts[i]) out[m.id] = parts[i];
  });
  return out;
}

export function makeSplit(amount: number, mode: SplitMode, members: Member[], paidBy: ID | null, custom?: Record<ID, number>): Split {
  return { mode, shares: computeShares(amount, mode, members, paidBy, custom) };
}

/** La dépense crée-t-elle une dette entre membres ? */
export function isShared(tx: Transaction): boolean {
  if (tx.type !== 'expense' || !tx.paidBy) return false;
  const ids = Object.keys(tx.split?.shares ?? {});
  return ids.some((id) => id !== tx.paidBy);
}

/**
 * Solde net de chaque membre : positif = on lui doit de l'argent, négatif = il doit.
 */
export function memberBalances(txs: Transaction[], settlements: Settlement[], members: Member[]): Map<ID, number> {
  const net = new Map<ID, number>(members.map((m) => [m.id, 0]));
  const add = (id: ID, v: number) => net.set(id, (net.get(id) ?? 0) + v);
  for (const tx of txs) {
    if (!isShared(tx)) continue;
    add(tx.paidBy!, tx.amount);
    for (const [id, share] of Object.entries(tx.split.shares)) add(id, -share);
  }
  for (const s of settlements) {
    add(s.fromId, s.amount);
    add(s.toId, -s.amount);
  }
  return net;
}

export interface Transfer {
  from: ID;
  to: ID;
  amount: number;
}

/** Nombre minimal de remboursements pour équilibrer les comptes (algorithme glouton). */
export function settleUp(balances: Map<ID, number>): Transfer[] {
  const debtors = [...balances].filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
  const creditors = [...balances].filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
  debtors.sort((a, b) => b.v - a.v);
  creditors.sort((a, b) => b.v - a.v);
  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].v, creditors[j].v);
    if (amount > 0) out.push({ from: debtors[i].id, to: creditors[j].id, amount });
    debtors[i].v -= amount;
    creditors[j].v -= amount;
    if (debtors[i].v === 0) i++;
    if (creditors[j].v === 0) j++;
  }
  return out;
}

/** Part de chaque membre dans les dépenses (pour "qui dépense quoi"). */
export function memberShareOfSpending(txs: Transaction[], members: Member[], from: string, to: string) {
  const map = new Map<ID | 'common', number>(members.map((m) => [m.id, 0]));
  map.set('common', 0);
  for (const tx of txs) {
    if (tx.type !== 'expense' || tx.date < from || tx.date > to) continue;
    if (!tx.paidBy) {
      map.set('common', (map.get('common') ?? 0) + tx.amount);
      continue;
    }
    const shares = Object.entries(tx.split?.shares ?? {});
    if (shares.length === 0) map.set(tx.paidBy, (map.get(tx.paidBy) ?? 0) + tx.amount);
    for (const [id, v] of shares) map.set(id, (map.get(id) ?? 0) + v);
  }
  return map;
}
