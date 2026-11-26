import type { Account, Budget, Category, ID, Recurring, Transaction } from '../db/schema';
import { addMonths, monthOf, monthRange, todayISO } from './dates';

/* ------------------------------------------------------------------ */
/*  Soldes                                                             */
/* ------------------------------------------------------------------ */

/** Effet signé d'une opération sur un compte donné. */
export function signedFor(tx: Transaction, accountId: ID): number {
  if (tx.type === 'transfer') {
    if (tx.accountId === accountId) return -tx.amount;
    if (tx.toAccountId === accountId) return tx.amount;
    return 0;
  }
  if (tx.accountId !== accountId) return 0;
  return tx.type === 'income' ? tx.amount : -tx.amount;
}

export function computeBalances(accounts: Account[], txs: Transaction[], upTo?: string): Map<ID, number> {
  const map = new Map<ID, number>();
  for (const a of accounts) map.set(a.id, a.initialBalance);
  for (const tx of txs) {
    if (upTo && tx.date > upTo) continue;
    if (tx.type === 'transfer') {
      if (map.has(tx.accountId)) map.set(tx.accountId, map.get(tx.accountId)! - tx.amount);
      if (tx.toAccountId && map.has(tx.toAccountId)) map.set(tx.toAccountId, map.get(tx.toAccountId)! + tx.amount);
    } else if (map.has(tx.accountId)) {
      map.set(tx.accountId, map.get(tx.accountId)! + (tx.type === 'income' ? tx.amount : -tx.amount));
    }
  }
  return map;
}

export function netWorth(accounts: Account[], balances: Map<ID, number>) {
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    if (a.archived) continue;
    // Les comptes de crédit/prêt ont normalement un solde négatif (ce qui reste dû).
    const b = balances.get(a.id) ?? 0;
    if (b >= 0) assets += b;
    else liabilities += -b;
  }
  return { assets, liabilities, total: assets - liabilities };
}

/** Patrimoine net à la fin de chaque mois (pour la courbe d'évolution). */
export function netWorthHistory(accounts: Account[], txs: Transaction[], months: string[]): number[] {
  const sorted = [...txs].sort((a, b) => (a.date < b.date ? -1 : 1));
  const bal = new Map<ID, number>();
  for (const a of accounts) bal.set(a.id, a.initialBalance);
  const out: number[] = [];
  let i = 0;
  for (const m of months) {
    const end = `${m}-31`;
    while (i < sorted.length && sorted[i].date <= end) {
      const tx = sorted[i++];
      if (tx.type === 'transfer') {
        if (bal.has(tx.accountId)) bal.set(tx.accountId, bal.get(tx.accountId)! - tx.amount);
        if (tx.toAccountId && bal.has(tx.toAccountId)) bal.set(tx.toAccountId, bal.get(tx.toAccountId)! + tx.amount);
      } else if (bal.has(tx.accountId)) {
        bal.set(tx.accountId, bal.get(tx.accountId)! + (tx.type === 'income' ? tx.amount : -tx.amount));
      }
    }
    let total = 0;
    for (const v of bal.values()) total += v;
    out.push(total);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Flux : revenus / dépenses                                          */
/* ------------------------------------------------------------------ */

/**
 * Montant "dépensé" d'une opération pour l'analyse :
 * - dépense => +montant
 * - revenu imputé à une catégorie de dépense (remboursement) => −montant
 * - virement => 0
 */
export function spendingOf(tx: Transaction, catKind: (id: ID | null) => 'expense' | 'income' | null): number {
  if (tx.type === 'expense') return tx.amount;
  if (tx.type === 'income' && tx.categoryId && catKind(tx.categoryId) === 'expense') return -tx.amount;
  return 0;
}

export function incomeOf(tx: Transaction, catKind: (id: ID | null) => 'expense' | 'income' | null): number {
  if (tx.type !== 'income') return 0;
  if (tx.categoryId && catKind(tx.categoryId) === 'expense') return 0;
  return tx.amount;
}

export interface FlowTotals {
  income: number;
  expense: number;
  net: number;
  savingsRate: number;
}

export function makeKindLookup(categories: Category[]) {
  const map = new Map(categories.map((c) => [c.id, c.kind]));
  return (id: ID | null) => (id ? (map.get(id) ?? null) : null);
}

export function flowTotals(txs: Transaction[], kindOf: (id: ID | null) => 'expense' | 'income' | null, from: string, to: string): FlowTotals {
  let income = 0;
  let expense = 0;
  for (const tx of txs) {
    if (tx.date < from || tx.date > to) continue;
    income += incomeOf(tx, kindOf);
    expense += spendingOf(tx, kindOf);
  }
  const net = income - expense;
  return { income, expense, net, savingsRate: income > 0 ? (net / income) * 100 : 0 };
}

/** Dépenses par catégorie et par mois : clé `${categoryId}|${month}` */
export function spentByCategoryMonth(txs: Transaction[], kindOf: (id: ID | null) => 'expense' | 'income' | null): Map<string, number> {
  const map = new Map<string, number>();
  for (const tx of txs) {
    const s = spendingOf(tx, kindOf);
    if (!s) continue;
    const key = `${tx.categoryId ?? 'none'}|${monthOf(tx.date)}`;
    map.set(key, (map.get(key) ?? 0) + s);
  }
  return map;
}

/** Dépenses cumulées jour par jour dans un mois (courbe "rythme de dépenses"). */
export function cumulativeDaily(txs: Transaction[], kindOf: (id: ID | null) => 'expense' | 'income' | null, month: string, days: number): number[] {
  const daily = new Array(days).fill(0);
  for (const tx of txs) {
    if (monthOf(tx.date) !== month) continue;
    const d = Number(tx.date.slice(8, 10)) - 1;
    if (d >= 0 && d < days) daily[d] += spendingOf(tx, kindOf);
  }
  for (let i = 1; i < days; i++) daily[i] += daily[i - 1];
  return daily;
}

/* ------------------------------------------------------------------ */
/*  Budget (enveloppes mensuelles reconduites)                         */
/* ------------------------------------------------------------------ */

/**
 * Un budget saisi pour un mois s'applique à ce mois ET aux suivants, jusqu'à la prochaine
 * modification (reconduction automatique).
 */
export class BudgetIndex {
  private byCat = new Map<ID, { month: string; amount: number }[]>();

  constructor(budgets: Budget[]) {
    for (const b of budgets) {
      const list = this.byCat.get(b.categoryId) ?? [];
      list.push({ month: b.month, amount: b.amount });
      this.byCat.set(b.categoryId, list);
    }
    for (const list of this.byCat.values()) list.sort((a, b) => (a.month < b.month ? -1 : 1));
  }

  /** Montant effectif pour un mois (dernier montant saisi ≤ mois). */
  amount(categoryId: ID, month: string): number {
    const list = this.byCat.get(categoryId);
    if (!list) return 0;
    let v = 0;
    for (const e of list) {
      if (e.month <= month) v = e.amount;
      else break;
    }
    return v;
  }

  /** Le montant est-il saisi explicitement pour ce mois ? */
  isExplicit(categoryId: ID, month: string): boolean {
    return !!this.byCat.get(categoryId)?.some((e) => e.month === month);
  }

  firstMonth(categoryId: ID): string | null {
    return this.byCat.get(categoryId)?.[0]?.month ?? null;
  }
}

export interface BudgetRow {
  category: Category;
  budgeted: number;
  spent: number;
  carry: number;
  available: number;
  /** Part consommée de l'enveloppe (0–∞) */
  ratio: number;
}

export function computeBudgetRows(
  month: string,
  categories: Category[],
  index: BudgetIndex,
  spent: Map<string, number>,
): BudgetRow[] {
  const rows: BudgetRow[] = [];
  for (const c of categories) {
    if (c.kind !== 'expense' || c.archived) continue;
    const budgeted = index.amount(c.id, month);
    const s = spent.get(`${c.id}|${month}`) ?? 0;
    let carry = 0;
    if (c.rollover) {
      const first = index.firstMonth(c.id);
      if (first && first < month) {
        for (const m of monthRange(first, addMonths(month, -1))) {
          carry += index.amount(c.id, m) - (spent.get(`${c.id}|${m}`) ?? 0);
        }
      }
    }
    const available = budgeted + carry - s;
    const envelope = budgeted + carry;
    rows.push({ category: c, budgeted, spent: s, carry, available, ratio: envelope > 0 ? s / envelope : s > 0 ? Infinity : 0 });
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/*  Prévisions : échéances récurrentes                                 */
/* ------------------------------------------------------------------ */

export interface Occurrence {
  rec: Recurring;
  date: string;
}

export function sumOccurrences(occ: Occurrence[], type: 'income' | 'expense', kindOf: (id: ID | null) => 'expense' | 'income' | null): number {
  let total = 0;
  for (const o of occ) {
    if (o.rec.type === 'transfer') continue;
    if (type === 'income' && o.rec.type === 'income' && kindOf(o.rec.categoryId) !== 'expense') total += o.rec.amount;
    if (type === 'expense' && o.rec.type === 'expense') total += o.rec.amount;
  }
  return total;
}

/** Moyenne mensuelle des dépenses d'une catégorie sur les n derniers mois terminés. */
export function averageSpent(spent: Map<string, number>, categoryId: ID, month: string, n = 3): number {
  let total = 0;
  for (let i = 1; i <= n; i++) total += spent.get(`${categoryId}|${addMonths(month, -i)}`) ?? 0;
  return Math.round(total / n);
}

export function isFutureDate(iso: string) {
  return iso > todayISO();
}
