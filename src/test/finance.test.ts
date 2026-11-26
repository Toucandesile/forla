import { describe, expect, it } from 'vitest';
import { allocate, formatMoney, parseAmount, parseNumber } from '../lib/money';
import { addMonths, addMonthsToDate, parseFlexibleDate, monthEnd } from '../lib/dates';
import { BudgetIndex, computeBalances, computeBudgetRows, flowTotals, makeKindLookup, spentByCategoryMonth } from '../lib/finance';
import { computeShares, memberBalances, settleUp } from '../lib/split';
import { detectRecurring, monthlyEquivalent, nextDateAfter, occurrencesBetween } from '../lib/recurring';
import { cleanPayee, guessMapping, parseCSV, parseOFX, parseQIF, rowsFromCsv, matchRule } from '../lib/importers';
import type { Account, Budget, Category, Member, Recurring, Rule, Settlement, Transaction } from '../db/schema';

const meta = { createdAt: 0, updatedAt: 0 };

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    ...meta,
    type: 'expense',
    date: '2026-11-10',
    amount: 1000,
    accountId: 'a1',
    toAccountId: null,
    categoryId: null,
    payee: '',
    note: '',
    paidBy: null,
    split: { mode: 'none', shares: {} },
    cleared: false,
    recurringId: null,
    importId: null,
    hasReceipt: false,
    ...p,
  };
}

const member = (id: string, weight = 1): Member => ({ id, ...meta, name: id, emoji: '🙂', color: '#000', weight, archived: false, order: 0 });

describe('montants', () => {
  it('lit les formats français et anglais', () => {
    expect(parseNumber('1 234,56')).toBe(1234.56);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('-45,00 €')).toBe(-45);
    expect(parseNumber('1.234')).toBe(1234);
    expect(parseNumber('abc')).toBeNull();
  });

  it('évalue les calculs dans le champ montant', () => {
    expect(parseAmount('12,40+7,90')).toBe(2030);
    expect(parseAmount('100/3')).toBe(3333);
    expect(parseAmount('2*4,5')).toBe(900);
    expect(parseAmount('(10+5)*2')).toBe(3000);
    expect(parseAmount('12+')).toBeNull();
    expect(parseAmount('15')).toBe(1500);
  });

  it('répartit sans perdre de centime', () => {
    expect(allocate(1001, [1, 1])).toEqual([501, 500]);
    expect(allocate(1000, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(allocate(10000, [2600, 2100])).toEqual([5532, 4468]);
  });

  it('formate en euros à la française', () => {
    expect(formatMoney(123456).replace(/\s/g, ' ')).toBe('1 234,56 €');
    expect(formatMoney(-500)).toContain('−');
  });
});

describe('dates', () => {
  it('ajoute des mois en gardant le jour d’ancrage', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDate('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
  });
  it('lit les dates bancaires', () => {
    expect(parseFlexibleDate('05/11/2026')).toBe('2026-11-05');
    expect(parseFlexibleDate('05-11-26')).toBe('2026-11-05');
    expect(parseFlexibleDate('20261105')).toBe('2026-11-05');
    expect(parseFlexibleDate('2026-11-05')).toBe('2026-11-05');
    expect(parseFlexibleDate('31/02/2026')).toBeNull();
  });
});

describe('soldes et flux', () => {
  const accounts = [{ id: 'a1', initialBalance: 10000 } as Account, { id: 'a2', initialBalance: 0 } as Account];
  const cats = [
    { id: 'food', kind: 'expense' } as Category,
    { id: 'salary', kind: 'income' } as Category,
  ];
  const kindOf = makeKindLookup(cats);
  const txs = [
    tx({ amount: 2500, categoryId: 'food' }),
    tx({ type: 'income', amount: 200000, categoryId: 'salary' }),
    tx({ type: 'income', amount: 500, categoryId: 'food' }), // remboursement
    tx({ type: 'transfer', amount: 3000, toAccountId: 'a2' }),
  ];
  it('calcule les soldes avec les virements', () => {
    const b = computeBalances(accounts, txs);
    expect(b.get('a1')).toBe(10000 - 2500 + 200000 + 500 - 3000);
    expect(b.get('a2')).toBe(3000);
  });
  it('traite un remboursement comme une baisse de dépense', () => {
    const t = flowTotals(txs, kindOf, '2026-11-01', '2026-11-30');
    expect(t.expense).toBe(2000);
    expect(t.income).toBe(200000);
  });
});

describe('budget par enveloppes', () => {
  const cats = [
    { id: 'food', kind: 'expense', rollover: false, archived: false } as Category,
    { id: 'trip', kind: 'expense', rollover: true, archived: false } as Category,
  ];
  const budgets: Budget[] = [
    { id: 'x', ...meta, month: '2026-09', categoryId: 'food', amount: 50000 },
    { id: 'y', ...meta, month: '2026-11', categoryId: 'food', amount: 60000 },
    { id: 'z', ...meta, month: '2026-09', categoryId: 'trip', amount: 10000 },
  ];
  const idx = new BudgetIndex(budgets);
  it('reconduit le dernier montant saisi', () => {
    expect(idx.amount('food', '2026-10')).toBe(50000);
    expect(idx.amount('food', '2026-12')).toBe(60000);
    expect(idx.amount('food', '2026-08')).toBe(0);
  });
  it('reporte le reste des enveloppes à report', () => {
    const txs = [tx({ categoryId: 'trip', amount: 4000, date: '2026-09-15' }), tx({ categoryId: 'trip', amount: 1000, date: '2026-10-15' })];
    const spent = spentByCategoryMonth(txs, makeKindLookup(cats));
    const rows = computeBudgetRows('2026-11', cats, idx, spent);
    const trip = rows.find((r) => r.category.id === 'trip')!;
    // sept : 100 − 40 = 60 ; oct : 100 − 10 = 90 ; report = 150 ; nov : 100 + 150
    expect(trip.carry).toBe(15000);
    expect(trip.available).toBe(25000);
  });
});

describe('partage du foyer', () => {
  const members = [member('A', 3000), member('B', 1000)];
  it('partage égal et au prorata', () => {
    expect(computeShares(1000, 'equal', members, 'A')).toEqual({ A: 500, B: 500 });
    expect(computeShares(1000, 'prorata', members, 'A')).toEqual({ A: 750, B: 250 });
    expect(computeShares(1000, 'none', members, 'A')).toEqual({ A: 1000 });
  });
  it('calcule qui doit combien et propose le règlement', () => {
    const txs = [
      tx({ amount: 10000, paidBy: 'A', split: { mode: 'equal', shares: { A: 5000, B: 5000 } } }),
      tx({ amount: 4000, paidBy: 'B', split: { mode: 'equal', shares: { A: 2000, B: 2000 } } }),
      tx({ amount: 9999, paidBy: 'B', split: { mode: 'none', shares: { B: 9999 } } }),
    ];
    const settlements: Settlement[] = [{ id: 's', ...meta, date: '2026-11-20', fromId: 'B', toId: 'A', amount: 1000, note: '' }];
    const bal = memberBalances(txs, settlements, members);
    expect(bal.get('A')).toBe(2000);
    expect(bal.get('B')).toBe(-2000);
    expect(settleUp(bal)).toEqual([{ from: 'B', to: 'A', amount: 2000 }]);
  });
});

describe('récurrences', () => {
  const rec = { id: 'r', ...meta, unit: 'month', interval: 1, anchorDay: 31, nextDate: '2026-01-31', active: true, endDate: null, amount: 1200 } as unknown as Recurring;
  it('respecte la fin de mois', () => {
    expect(occurrencesBetween(rec, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(nextDateAfter({ unit: 'week', interval: 2, anchorDay: null }, '2026-11-01')).toBe('2026-11-15');
  });
  it('ramène les coûts au mois', () => {
    expect(monthlyEquivalent({ amount: 12000, unit: 'year', interval: 1 })).toBe(1000);
    expect(monthlyEquivalent({ amount: 1000, unit: 'week', interval: 1 })).toBe(4333);
  });
  it('détecte un abonnement mensuel', () => {
    const txs = ['2026-07-15', '2026-08-15', '2026-09-15', '2026-10-15', '2026-11-15'].map((d) => tx({ date: d, payee: 'NETFLIX.COM 1234', amount: 1349 }));
    const s = detectRecurring(txs, [], '2026-11-20');
    expect(s).toHaveLength(1);
    expect(s[0].unit).toBe('month');
    expect(s[0].nextDate).toBe('2026-12-15');
  });
});

describe('import bancaire', () => {
  it('lit un CSV de banque française (débit/crédit séparés)', () => {
    const csv = 'Date;Libellé;Débit;Crédit\n05/11/2026;CB CARREFOUR 04/11 PARIS;-45,30;\n06/11/2026;VIR SEPA SALAIRE;;2 100,00\n';
    const rows = parseCSV(csv);
    const m = guessMapping(rows);
    expect(m.date).toBe(0);
    expect(m.debit).toBe(2);
    expect(m.credit).toBe(3);
    const { rows: parsed } = rowsFromCsv(rows, m);
    expect(parsed.map((r) => r.amount)).toEqual([-4530, 210000]);
    expect(parsed[0].date).toBe('2026-11-05');
  });
  it('gère les champs entre guillemets', () => {
    expect(parseCSV('a,"b, c",d\n1,"x ""y""",3', ',')).toEqual([
      ['a', 'b, c', 'd'],
      ['1', 'x "y"', '3'],
    ]);
  });
  it('lit un OFX SGML sans balises fermantes', () => {
    const ofx = `OFXHEADER:100\n<OFX><BANKTRANLIST>\n<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>20261105\n<TRNAMT>-12.50\n<FITID>ABC1\n<NAME>CB BOULANGERIE\n</STMTTRN>\n<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261106120000<TRNAMT>100,00<FITID>ABC2<NAME>VIREMENT</STMTTRN>`;
    const r = parseOFX(ofx);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ date: '2026-11-05', amount: -1250, fitId: 'ABC1' });
    expect(r[1].amount).toBe(10000);
  });
  it('lit un QIF', () => {
    const r = parseQIF('!Type:Bank\nD05/11/2026\nT-30,00\nPEDF\n^\n');
    expect(r).toEqual([{ date: '2026-11-05', amount: -3000, payee: 'EDF', memo: '', fitId: null, categoryHint: undefined }]);
  });
  it('nettoie les libellés et applique les règles', () => {
    expect(cleanPayee('CB CARREFOUR MARKET 12/11 PARIS')).toBe('Carrefour Market Paris');
    expect(cleanPayee('PRLV SEPA EDF CLIENTS PARTICULIERS')).toBe('Edf Clients Particuliers');
    const rules = [{ id: '1', ...meta, pattern: 'intermarché', categoryId: 'food', rename: '', order: 0 } as Rule];
    expect(matchRule(rules, 'CB INTERMARCHE SUPER')?.categoryId).toBe('food');
  });
});
