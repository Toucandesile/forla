import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, remove, save } from '../db/db';
import { exportAll, restoreMerge, encryptBackup, decryptBackup, wipeAll } from '../lib/backup';
import { processRecurring } from '../lib/recurring';
import type { Recurring } from '../db/schema';

const account = { name: 'Joint', type: 'checking' as const, initialBalance: 0, ownerId: null, color: '#000', archived: false, order: 0 };

describe('synchronisation par fichier (fusion)', () => {
  beforeEach(async () => {
    await wipeAll();
  });

  it('fusionne deux appareils : ajouts, modifications, suppressions', async () => {
    const a = await save('accounts', { ...account, id: 'acc' });
    await save('accounts', { ...account, id: 'gone', name: 'À supprimer' });
    const snapshot = await exportAll();

    // L'autre appareil renomme le compte et en supprime un
    await save('accounts', { ...a, name: 'Compte joint (renommé)', updatedAt: a.updatedAt + 10 });
    await remove('accounts', 'gone');
    await save('accounts', { ...account, id: 'new', name: 'Nouveau livret' });
    const remote = await exportAll();

    // Retour à l'état initial puis fusion
    await wipeAll();
    await db.accounts.bulkPut(snapshot.data.accounts as never);
    const report = await restoreMerge(remote);
    const names = (await db.accounts.toArray()).map((x) => x.name).sort();
    expect(names).toEqual(['Compte joint (renommé)', 'Nouveau livret']);
    expect(report.deleted).toBe(1);
    expect(report.added).toBe(1);
  });

  it('chiffre et déchiffre une sauvegarde', async () => {
    await save('accounts', { ...account, id: 'acc' });
    const data = await exportAll();
    const enc = await encryptBackup(data, 'motdepasse');
    expect(JSON.stringify(enc)).not.toContain('Joint');
    const dec = await decryptBackup(enc, 'motdepasse');
    expect(dec.data.accounts?.[0]).toMatchObject({ name: 'Joint' });
    await expect(decryptBackup(enc, 'mauvais')).rejects.toThrow();
  });

  it('génère les échéances automatiques sans doublon', async () => {
    await save('accounts', { ...account, id: 'acc' });
    await save('recurring', {
      id: 'loyer',
      name: 'Loyer',
      type: 'expense',
      amount: 90000,
      accountId: 'acc',
      toAccountId: null,
      categoryId: null,
      paidBy: null,
      splitMode: 'none',
      unit: 'month',
      interval: 1,
      anchorDay: 5,
      startDate: '2026-09-05',
      nextDate: '2026-09-05',
      endDate: null,
      autoPost: true,
      active: true,
      subscription: false,
      note: '',
    } as Omit<Recurring, 'createdAt' | 'updatedAt'>);
    expect(await processRecurring('2026-11-20')).toBe(3);
    expect(await processRecurring('2026-11-20')).toBe(0);
    expect((await db.recurring.get('loyer'))?.nextDate).toBe('2026-12-05');
    expect(await db.transactions.count()).toBe(3);
  });
});
