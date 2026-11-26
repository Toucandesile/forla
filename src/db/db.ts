import Dexie, { type Table } from 'dexie';
import {
  DEFAULT_SETTINGS,
  type HouseholdSettings,
  type Meta,
  type Setting,
  type SyncTable,
  type TableTypes,
  type Tombstone,
} from './schema';

/**
 * Base locale IndexedDB : toutes les données restent sur l'appareil.
 * Chaque enregistrement porte un id unique + updatedAt, et chaque suppression laisse
 * une "pierre tombale" : deux appareils peuvent ainsi fusionner leurs sauvegardes.
 */
export class ForlaDB extends Dexie {
  accounts!: Table<TableTypes['accounts'], string>;
  groups!: Table<TableTypes['groups'], string>;
  categories!: Table<TableTypes['categories'], string>;
  transactions!: Table<TableTypes['transactions'], string>;
  budgets!: Table<TableTypes['budgets'], string>;
  recurring!: Table<TableTypes['recurring'], string>;
  members!: Table<TableTypes['members'], string>;
  goals!: Table<TableTypes['goals'], string>;
  contributions!: Table<TableTypes['contributions'], string>;
  settlements!: Table<TableTypes['settlements'], string>;
  rules!: Table<TableTypes['rules'], string>;
  receipts!: Table<TableTypes['receipts'], string>;
  settings!: Table<Setting, string>;
  tombstones!: Table<Tombstone, string>;

  constructor(name = 'forla') {
    super(name);
    this.version(1).stores({
      accounts: 'id, order',
      groups: 'id, order',
      categories: 'id, groupId, order',
      transactions: 'id, date, accountId, toAccountId, categoryId, recurringId, importId, updatedAt',
      budgets: 'id, month, categoryId',
      recurring: 'id, nextDate',
      members: 'id, order',
      goals: 'id, order',
      contributions: 'id, goalId, date',
      settlements: 'id, date',
      rules: 'id, order',
      receipts: 'id',
      settings: 'key',
      tombstones: 'id, table',
    });
  }
}

export const db = new ForlaDB();

/** UUID v4 — avec repli si crypto.randomUUID est indisponible (http non sécurisé). */
export function uid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type Draft<T extends Meta> = Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<Meta>;

function table<K extends SyncTable>(name: K): Table<TableTypes[K], string> {
  return db.table(name) as Table<TableTypes[K], string>;
}

/** Crée ou met à jour un enregistrement (horodatage automatique). */
export async function save<K extends SyncTable>(name: K, record: Draft<TableTypes[K]>): Promise<TableTypes[K]> {
  const now = Date.now();
  const full = {
    ...record,
    id: record.id ?? uid(),
    createdAt: record.createdAt ?? now,
    updatedAt: Math.max(now, (record.updatedAt ?? 0) + 1),
  } as TableTypes[K];
  await table(name).put(full);
  return full;
}

export async function saveMany<K extends SyncTable>(name: K, records: Draft<TableTypes[K]>[]): Promise<TableTypes[K][]> {
  const now = Date.now();
  const full = records.map(
    (r) => ({ ...r, id: r.id ?? uid(), createdAt: r.createdAt ?? now, updatedAt: Math.max(now, (r.updatedAt ?? 0) + 1) }) as TableTypes[K],
  );
  await table(name).bulkPut(full);
  return full;
}

/** Met à jour certains champs d'un enregistrement existant. */
export async function patch<K extends SyncTable>(name: K, id: string, changes: Partial<TableTypes[K]>): Promise<void> {
  const t = table(name);
  await db.transaction('rw', t, async () => {
    const current = await t.get(id);
    if (!current) return;
    await t.put({ ...current, ...changes, id, updatedAt: Math.max(Date.now(), current.updatedAt + 1) });
  });
}

/** Supprime des enregistrements en laissant une pierre tombale pour la synchronisation. */
export async function remove<K extends SyncTable>(name: K, ids: string | string[]): Promise<void> {
  const list = Array.isArray(ids) ? ids : [ids];
  if (list.length === 0) return;
  const now = Date.now();
  await db.transaction('rw', table(name), db.tombstones, async () => {
    await table(name).bulkDelete(list);
    await db.tombstones.bulkPut(list.map((id) => ({ id: `${name}:${id}`, table: name, recordId: id, deletedAt: now })));
  });
}

/* ---------------- Réglages du foyer (partagés) ---------------- */

export async function getSettings(): Promise<HouseholdSettings> {
  const rows = await db.settings.toArray();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as HouseholdSettings;
}

export async function setSetting<K extends keyof HouseholdSettings>(key: K, value: HouseholdSettings[K]): Promise<void> {
  await db.settings.put({ key, value, updatedAt: Date.now() });
}

/* ---------------- Préférences propres à l'appareil ---------------- */

export interface DevicePrefs {
  theme: 'system' | 'light' | 'dark';
  meId: string | null;
  hideAmounts: boolean;
  pinHash: string | null;
  pinSalt: string | null;
  lastBackupAt: number | null;
}

const PREF_KEYS: Record<keyof DevicePrefs, string> = {
  theme: 'forla.theme',
  meId: 'forla.me',
  hideAmounts: 'forla.hideAmounts',
  pinHash: 'forla.pinHash',
  pinSalt: 'forla.pinSalt',
  lastBackupAt: 'forla.lastBackupAt',
};

export function readPrefs(): DevicePrefs {
  const get = (k: keyof DevicePrefs) => {
    try {
      return localStorage.getItem(PREF_KEYS[k]);
    } catch {
      return null;
    }
  };
  const theme = get('theme');
  const last = get('lastBackupAt');
  return {
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
    meId: get('meId'),
    hideAmounts: get('hideAmounts') === '1',
    pinHash: get('pinHash'),
    pinSalt: get('pinSalt'),
    lastBackupAt: last ? Number(last) : null,
  };
}

export function writePref<K extends keyof DevicePrefs>(key: K, value: DevicePrefs[K]): void {
  try {
    if (value == null || value === false) localStorage.removeItem(PREF_KEYS[key]);
    else localStorage.setItem(PREF_KEYS[key], value === true ? '1' : String(value));
  } catch {
    /* stockage indisponible (navigation privée) */
  }
  window.dispatchEvent(new CustomEvent('forla:prefs'));
}

/** Demande au navigateur de ne jamais effacer les données (stockage persistant). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return false;
}
