import { db } from '../db/db';
import type { ID, Member, Recurring, RecurrenceUnit, Transaction } from '../db/schema';
import { addDays, addMonthsToDate, diffDays, todayISO } from './dates';
import { makeSplit } from './split';
import type { Occurrence } from './finance';

export function nextDateAfter(rec: Pick<Recurring, 'unit' | 'interval' | 'anchorDay'>, date: string): string {
  const n = Math.max(1, rec.interval || 1);
  if (rec.unit === 'week') return addDays(date, 7 * n);
  if (rec.unit === 'month') return addMonthsToDate(date, n, rec.anchorDay ?? undefined);
  return addMonthsToDate(date, 12 * n, rec.anchorDay ?? undefined);
}

/** Toutes les échéances d'une récurrence entre deux dates (incluses), à partir de nextDate. */
export function occurrencesBetween(rec: Recurring, from: string, to: string, max = 400): string[] {
  const out: string[] = [];
  if (!rec.active) return out;
  let d = rec.nextDate;
  let guard = 0;
  while (d <= to && guard++ < max) {
    if (rec.endDate && d > rec.endDate) break;
    if (d >= from) out.push(d);
    d = nextDateAfter(rec, d);
  }
  return out;
}

export function upcoming(recs: Recurring[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const rec of recs) for (const date of occurrencesBetween(rec, from, to)) out.push({ rec, date });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rec.name.localeCompare(b.rec.name)));
}

/** Échéances passées non encore enregistrées (à valider). */
export function dueOccurrences(recs: Recurring[], today = todayISO()): Occurrence[] {
  return upcoming(
    recs.filter((r) => !r.autoPost),
    '0000-01-01',
    today,
  );
}

/** Coût mensuel équivalent (pour comparer abonnements hebdo/mensuels/annuels). */
export function monthlyEquivalent(rec: Pick<Recurring, 'amount' | 'unit' | 'interval'>): number {
  const n = Math.max(1, rec.interval || 1);
  if (rec.unit === 'week') return Math.round((rec.amount * 52) / 12 / n);
  if (rec.unit === 'month') return Math.round(rec.amount / n);
  return Math.round(rec.amount / 12 / n);
}

export function frequencyLabel(unit: RecurrenceUnit, interval: number): string {
  const n = Math.max(1, interval || 1);
  if (unit === 'week') return n === 1 ? 'Chaque semaine' : n === 2 ? 'Toutes les 2 semaines' : `Toutes les ${n} semaines`;
  if (unit === 'month') {
    if (n === 1) return 'Chaque mois';
    if (n === 2) return 'Tous les 2 mois';
    if (n === 3) return 'Chaque trimestre';
    if (n === 6) return 'Chaque semestre';
    return `Tous les ${n} mois`;
  }
  return n === 1 ? 'Chaque année' : `Tous les ${n} ans`;
}

/** Identifiant déterministe : deux appareils génèrent la même opération => pas de doublon à la fusion. */
export function occurrenceTxId(recId: ID, date: string) {
  return `rec-${recId}-${date}`;
}

export function transactionFromOccurrence(rec: Recurring, date: string, members: Member[]): Omit<Transaction, 'createdAt' | 'updatedAt'> {
  return {
    id: occurrenceTxId(rec.id, date),
    type: rec.type,
    date,
    amount: rec.amount,
    accountId: rec.accountId,
    toAccountId: rec.type === 'transfer' ? rec.toAccountId : null,
    categoryId: rec.type === 'transfer' ? null : rec.categoryId,
    payee: rec.name,
    note: rec.note,
    paidBy: rec.type === 'expense' ? rec.paidBy : null,
    split: rec.type === 'expense' && rec.paidBy ? makeSplit(rec.amount, rec.splitMode, members, rec.paidBy) : { mode: 'none', shares: {} },
    cleared: false,
    recurringId: rec.id,
    importId: null,
    hasReceipt: false,
  };
}

/**
 * Crée automatiquement les opérations récurrentes arrivées à échéance (autoPost)
 * et avance leur prochaine date. Idempotent.
 */
export async function processRecurring(today = todayISO()): Promise<number> {
  let created = 0;
  await db.transaction('rw', db.recurring, db.transactions, db.members, async () => {
    const recs = await db.recurring.where('nextDate').belowOrEqual(today).toArray();
    const members = await db.members.toArray();
    const now = Date.now();
    for (const rec of recs) {
      if (!rec.active || !rec.autoPost) continue;
      let d = rec.nextDate;
      let guard = 0;
      while (d <= today && guard++ < 400) {
        if (rec.endDate && d > rec.endDate) break;
        const id = occurrenceTxId(rec.id, d);
        if (!(await db.transactions.get(id))) {
          await db.transactions.put({ ...transactionFromOccurrence(rec, d, members), createdAt: now, updatedAt: now });
          created++;
        }
        d = nextDateAfter(rec, d);
      }
      const ended = !!rec.endDate && d > rec.endDate;
      await db.recurring.put({ ...rec, nextDate: d, active: ended ? false : rec.active, updatedAt: now });
    }
  });
  return created;
}

/* ------------------------------------------------------------------ */
/*  Détection automatique des abonnements / prélèvements               */
/* ------------------------------------------------------------------ */

export interface RecurringSuggestion {
  key: string;
  payee: string;
  amount: number;
  unit: RecurrenceUnit;
  interval: number;
  lastDate: string;
  nextDate: string;
  count: number;
  categoryId: ID | null;
  accountId: ID;
  type: 'expense' | 'income';
}

export function normalizePayee(p: string): string {
  return p
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\d+/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectRecurring(txs: Transaction[], existing: Recurring[], today = todayISO()): RecurringSuggestion[] {
  const known = new Set(existing.map((r) => normalizePayee(r.name)));
  const since = addDays(today, -400);
  const groups = new Map<string, Transaction[]>();
  for (const tx of txs) {
    if (tx.type === 'transfer' || tx.date < since || tx.recurringId) continue;
    const key = normalizePayee(tx.payee);
    if (!key || known.has(key)) continue;
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }
  const out: RecurringSuggestion[] = [];
  for (const [key, list] of groups) {
    if (list.length < 3) continue;
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    const gaps: number[] = [];
    for (let i = 1; i < list.length; i++) gaps.push(diffDays(list[i - 1].date, list[i].date));
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const median = sortedGaps[Math.floor(sortedGaps.length / 2)];
    let unit: RecurrenceUnit | null = null;
    let interval = 1;
    if (median >= 6 && median <= 8) unit = 'week';
    else if (median >= 13 && median <= 16) {
      unit = 'week';
      interval = 2;
    } else if (median >= 26 && median <= 35) unit = 'month';
    else if (median >= 85 && median <= 97) {
      unit = 'month';
      interval = 3;
    } else if (median >= 350 && median <= 380) unit = 'year';
    if (!unit) continue;
    const regular = gaps.filter((g) => Math.abs(g - median) <= Math.max(4, median * 0.15)).length / gaps.length;
    if (regular < 0.7) continue;
    const recent = list.slice(-3);
    const amounts = recent.map((t) => t.amount);
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    if (amounts.some((a) => Math.abs(a - avg) > Math.max(100, avg * 0.12))) continue;
    const last = list[list.length - 1];
    // Ignorer si la série semble arrêtée
    if (diffDays(last.date, today) > median * 2 + 5) continue;
    const draft = { unit, interval, anchorDay: Number(last.date.slice(8, 10)) };
    out.push({
      key,
      payee: last.payee,
      amount: last.amount,
      unit,
      interval,
      lastDate: last.date,
      nextDate: nextDateAfter(draft, last.date),
      count: list.length,
      categoryId: last.categoryId,
      accountId: last.accountId,
      type: last.type === 'income' ? 'income' : 'expense',
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}
