import { db } from '../db/db';
import { SYNC_TABLES, type Setting, type SyncTable, type Tombstone, type Transaction } from '../db/schema';
import { numericDate } from './dates';

export interface BackupFile {
  app: 'forla';
  format: 1;
  exportedAt: number;
  data: Partial<Record<SyncTable, Array<{ id: string; updatedAt: number }>>>;
  settings: Setting[];
  tombstones: Tombstone[];
}

export interface EncryptedBackup {
  app: 'forla';
  format: 1;
  encrypted: true;
  salt: string;
  iv: string;
  payload: string;
}

export async function exportAll(): Promise<BackupFile> {
  const data: BackupFile['data'] = {};
  await db.transaction('r', [...SYNC_TABLES.map((t) => db.table(t)), db.settings, db.tombstones], async () => {
    for (const t of SYNC_TABLES) data[t] = await db.table(t).toArray();
  });
  return {
    app: 'forla',
    format: 1,
    exportedAt: Date.now(),
    data,
    settings: await db.settings.toArray(),
    tombstones: await db.tombstones.toArray(),
  };
}

export function isBackup(x: unknown): x is BackupFile {
  return !!x && typeof x === 'object' && (x as BackupFile).app === 'forla' && typeof (x as BackupFile).data === 'object';
}

export function isEncrypted(x: unknown): x is EncryptedBackup {
  return !!x && typeof x === 'object' && (x as EncryptedBackup).app === 'forla' && (x as EncryptedBackup).encrypted === true;
}

/** Remplace toutes les données locales par celles de la sauvegarde. */
export async function restoreReplace(file: BackupFile): Promise<void> {
  await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.settings, db.tombstones], async () => {
    for (const t of SYNC_TABLES) {
      await db.table(t).clear();
      const rows = file.data[t];
      if (rows?.length) await db.table(t).bulkPut(rows);
    }
    await db.settings.clear();
    if (file.settings?.length) await db.settings.bulkPut(file.settings);
    await db.tombstones.clear();
    if (file.tombstones?.length) await db.tombstones.bulkPut(file.tombstones);
  });
}

export interface MergeReport {
  added: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

/**
 * Fusionne une sauvegarde venant d'un autre appareil (ex. téléphone du conjoint) :
 * pour chaque enregistrement, la version la plus récente gagne ; les suppressions
 * sont propagées grâce aux pierres tombales.
 */
export async function restoreMerge(file: BackupFile): Promise<MergeReport> {
  const report: MergeReport = { added: 0, updated: 0, deleted: 0, unchanged: 0 };
  await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.settings, db.tombstones], async () => {
    const localTombs = new Map((await db.tombstones.toArray()).map((t) => [t.id, t]));
    const incomingTombs = file.tombstones ?? [];

    for (const t of SYNC_TABLES) {
      const table = db.table(t);
      for (const rec of file.data[t] ?? []) {
        const tomb = localTombs.get(`${t}:${rec.id}`);
        if (tomb && tomb.deletedAt >= rec.updatedAt) {
          report.unchanged++;
          continue;
        }
        const local = (await table.get(rec.id)) as { updatedAt: number } | undefined;
        if (!local) {
          await table.put(rec);
          if (tomb) await db.tombstones.delete(tomb.id);
          report.added++;
        } else if (rec.updatedAt > local.updatedAt) {
          await table.put(rec);
          report.updated++;
        } else report.unchanged++;
      }
    }

    for (const tomb of incomingTombs) {
      if (!SYNC_TABLES.includes(tomb.table)) continue;
      const table = db.table(tomb.table);
      const local = (await table.get(tomb.recordId)) as { updatedAt: number } | undefined;
      if (local && local.updatedAt <= tomb.deletedAt) {
        await table.delete(tomb.recordId);
        report.deleted++;
      }
      const existing = localTombs.get(tomb.id);
      if (!existing || existing.deletedAt < tomb.deletedAt) await db.tombstones.put(tomb);
    }

    const localSettings = new Map((await db.settings.toArray()).map((s) => [s.key, s]));
    for (const s of file.settings ?? []) {
      const cur = localSettings.get(s.key);
      if (s.key === 'onboarded') {
        if (s.value === true) await db.settings.put(s);
        continue;
      }
      if (!cur || s.updatedAt > cur.updatedAt) await db.settings.put(s);
    }
  });
  return report;
}

export async function wipeAll(): Promise<void> {
  await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.settings, db.tombstones], async () => {
    for (const t of SYNC_TABLES) await db.table(t).clear();
    await db.settings.clear();
    await db.tombstones.clear();
  });
}

/* ------------------------------------------------------------------ */
/*  Chiffrement (AES-GCM 256, clé dérivée PBKDF2-SHA256)               */
/* ------------------------------------------------------------------ */

const ITERATIONS = 310_000;

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function cryptoAvailable(): boolean {
  return !!globalThis.crypto?.subtle;
}

export async function encryptBackup(file: BackupFile, password: string): Promise<EncryptedBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const data = new TextEncoder().encode(JSON.stringify(file));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { app: 'forla', format: 1, encrypted: true, salt: toB64(salt), iv: toB64(iv), payload: toB64(cipher) };
}

export async function decryptBackup(enc: EncryptedBackup, password: string): Promise<BackupFile> {
  const key = await deriveKey(password, fromB64(enc.salt));
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(enc.iv) }, key, fromB64(enc.payload));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('Mot de passe incorrect ou fichier endommagé.');
  }
}

/* ------------------------------------------------------------------ */
/*  Code PIN de verrouillage                                           */
/* ------------------------------------------------------------------ */

export async function hashPin(pin: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150_000, hash: 'SHA-256' }, base, 256);
  return { hash: toB64(bits), salt: toB64(salt) };
}

/* ------------------------------------------------------------------ */
/*  Fichiers : téléchargement / partage                                */
/* ------------------------------------------------------------------ */

export function backupFileName(prefix = 'forla-sauvegarde', ext = 'json') {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${prefix}-${stamp}.${ext}`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Partage natif (WhatsApp, e-mail, Drive…) si disponible, sinon téléchargement. */
export async function shareOrDownload(blob: Blob, name: string, title: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  downloadBlob(blob, name);
  return 'downloaded';
}

/** Export CSV compatible Excel français (séparateur ";", virgule décimale, BOM UTF-8). */
export function transactionsToCSV(
  txs: Transaction[],
  lookup: { account: (id: string | null) => string; category: (id: string | null) => string; member: (id: string | null) => string },
): Blob {
  const esc = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ['Date', 'Type', 'Libellé', 'Catégorie', 'Montant', 'Compte', 'Vers compte', 'Payé par', 'Note', 'Pointée'];
  const typeLabel = { expense: 'Dépense', income: 'Revenu', transfer: 'Virement' } as const;
  const lines = [header.join(';')];
  for (const t of [...txs].sort((a, b) => (a.date < b.date ? 1 : -1))) {
    const signed = t.type === 'expense' ? -t.amount : t.amount;
    lines.push(
      [
        numericDate(t.date),
        typeLabel[t.type],
        esc(t.payee),
        esc(t.type === 'transfer' ? '' : lookup.category(t.categoryId)),
        (signed / 100).toFixed(2).replace('.', ','),
        esc(lookup.account(t.accountId)),
        esc(t.type === 'transfer' ? lookup.account(t.toAccountId) : ''),
        esc(t.paidBy ? lookup.member(t.paidBy) : 'Commun'),
        esc(t.note),
        t.cleared ? 'oui' : 'non',
      ].join(';'),
    );
  }
  return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

/** Compresse une photo de ticket (max 1280 px, JPEG) pour le stockage local. */
export async function compressImage(file: File, max = 1280, quality = 0.72): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}
