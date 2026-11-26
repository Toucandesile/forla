/**
 * Synchronisation automatique entre appareils d'un même foyer, chiffrée de bout en bout.
 *
 * - Un « secret de foyer » de 128 bits est partagé via le lien / QR code d'invitation
 *   (dans la partie #… de l'URL : jamais envoyé à aucun serveur).
 * - Du secret on dérive (HKDF) : l'identifiant du foyer, un jeton d'accès, une clé AES-256-GCM
 *   et une clé HMAC. Le relais ne reçoit que des empreintes opaques et des données chiffrées.
 * - Résolution des conflits : la version la plus récente (updatedAt) gagne, suppressions comprises.
 * - Hors ligne, rien ne bloque : les changements partent dès que le réseau revient.
 */
import { useSyncExternalStore } from 'react';
import { db } from '../db/db';
import { SYNC_TABLES, type Setting, type SyncTable, type Tombstone } from '../db/schema';

export const SYNC_URL: string = (import.meta.env.VITE_SYNC_URL ?? '').replace(/\/+$/, '');

/** Les photos de tickets restent sur l'appareil (trop lourdes pour le relais gratuit). */
const CLOUD_TABLES = SYNC_TABLES.filter((t) => t !== 'receipts') as SyncTable[];
const CONFIG_KEY = 'forla.sync';
const PUSH_BATCH = 40;
const PUSH_CONCURRENCY = 4;

/* ------------------------------------------------------------------ */
/*  Configuration locale                                                */
/* ------------------------------------------------------------------ */

export interface SyncConfig {
  secret: string;
  since: number;
  enabledAt: number;
}

export function readSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as SyncConfig;
    return isValidSecret(c.secret) ? c : null;
  } catch {
    return null;
  }
}

function writeSyncConfig(c: SyncConfig | null) {
  try {
    if (c) localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* ignore */
  }
}

export function isSyncAvailable(): boolean {
  return !!SYNC_URL && !!globalThis.crypto?.subtle;
}

/* ------------------------------------------------------------------ */
/*  Encodage & cryptographie                                            */
/* ------------------------------------------------------------------ */

function b64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function isValidSecret(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Za-z0-9_-]{22}$/.test(s);
}

export function newSecret(): string {
  return b64u(crypto.getRandomValues(new Uint8Array(16)));
}

interface Keys {
  h: string;
  t: string;
  enc: CryptoKey;
  mac: CryptoKey;
}

const keyCache = new Map<string, Promise<Keys>>();

function deriveKeys(secret: string): Promise<Keys> {
  let p = keyCache.get(secret);
  if (!p) {
    p = (async () => {
      const ikm = await crypto.subtle.importKey('raw', fromB64u(secret), 'HKDF', false, ['deriveBits', 'deriveKey']);
      const salt = new TextEncoder().encode('forla-sync');
      const params = (label: string) => ({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(`forla-sync-v1:${label}`) });
      const bits = async (label: string, bytes: number) => new Uint8Array(await crypto.subtle.deriveBits(params(label), ikm, bytes * 8));
      return {
        h: b64u(await bits('household', 16)),
        t: b64u(await bits('token', 32)),
        enc: await crypto.subtle.deriveKey(params('enc'), ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
        mac: await crypto.subtle.deriveKey(params('mac'), ikm, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']),
      };
    })();
    keyCache.set(secret, p);
  }
  return p;
}

async function recordKey(keys: Keys, plainKey: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', keys.mac, new TextEncoder().encode(plainKey));
  return b64u(new Uint8Array(sig).slice(0, 18));
}

/** Contenu chiffré d'un élément : un enregistrement, une suppression ou un réglage. */
type Envelope = { t: SyncTable; r: { id: string; updatedAt: number } } | { t: SyncTable; id: string; del: number } | { t: 'settings'; s: Setting };

async function encrypt(keys: Keys, env: Envelope): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keys.enc, new TextEncoder().encode(JSON.stringify(env))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64u(out);
}

async function decrypt(keys: Keys, payload: string): Promise<Envelope | null> {
  try {
    const raw = fromB64u(payload);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, keys.enc, raw.slice(12));
    return JSON.parse(new TextDecoder().decode(plain)) as Envelope;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  État observable (pour l'interface)                                  */
/* ------------------------------------------------------------------ */

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  phase: SyncPhase;
  lastSync: number | null;
  error: string | null;
  progress: { done: number; total: number } | null;
}

let state: SyncState = {
  phase: readSyncConfig() ? 'idle' : 'off',
  lastSync: (() => {
    try {
      const v = localStorage.getItem('forla.sync.last');
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  })(),
  error: null,
  progress: null,
};
const listeners = new Set<() => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  if (patch.lastSync) {
    try {
      localStorage.setItem('forla.sync.last', String(patch.lastSync));
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l());
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

/* ------------------------------------------------------------------ */
/*  Réseau                                                              */
/* ------------------------------------------------------------------ */

class SyncError extends Error {
  constructor(
    message: string,
    public kind: 'network' | 'forbidden' | 'server',
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(SYNC_URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new SyncError('Relais injoignable', 'network');
  }
  if (res.status === 403) throw new SyncError('Invitation non valide pour ce foyer', 'forbidden');
  if (!res.ok) throw new SyncError(`Erreur du relais (${res.status})`, 'server');
  return res.json() as Promise<T>;
}

interface PullItem {
  s: number;
  k: string;
  u: number;
  p: string;
}

/* ------------------------------------------------------------------ */
/*  Application des changements reçus                                   */
/* ------------------------------------------------------------------ */

async function applyRemote(keys: Keys, items: PullItem[]): Promise<number> {
  const decoded = (await Promise.all(items.map((it) => decrypt(keys, it.p)))).filter((e): e is Envelope => !!e);
  let applied = 0;
  await db.transaction('rw', [...CLOUD_TABLES.map((t) => db.table(t)), db.settings, db.tombstones, db.syncmeta], async () => {
    for (const env of decoded) {
      if ('s' in env) {
        const remote = env.s;
        const cur = await db.settings.get(remote.key);
        if (!cur || remote.updatedAt > cur.updatedAt) {
          await db.settings.put(remote);
          applied++;
        }
        if (!cur || remote.updatedAt >= cur.updatedAt) await db.syncmeta.put({ key: `settings:${remote.key}`, u: remote.updatedAt });
        continue;
      }
      if (!CLOUD_TABLES.includes(env.t)) continue;
      const table = db.table(env.t);
      if ('r' in env) {
        const r = env.r;
        const tombId = `${env.t}:${r.id}`;
        const tomb = await db.tombstones.get(tombId);
        if (tomb && tomb.deletedAt >= r.updatedAt) continue; // supprimé ici après cette version
        const local = (await table.get(r.id)) as { updatedAt: number } | undefined;
        if (!local || r.updatedAt > local.updatedAt) {
          await table.put(r);
          if (tomb) await db.tombstones.delete(tombId);
          await db.syncmeta.put({ key: tombId, u: r.updatedAt });
          applied++;
        } else if (local.updatedAt === r.updatedAt) {
          await db.syncmeta.put({ key: tombId, u: r.updatedAt });
        }
      } else {
        const tombId = `${env.t}:${env.id}`;
        const local = (await table.get(env.id)) as { updatedAt: number } | undefined;
        if (local && local.updatedAt > env.del) continue; // modifié ici après la suppression : on garde
        if (local) {
          await table.delete(env.id);
          applied++;
        }
        const tomb = await db.tombstones.get(tombId);
        if (!tomb || tomb.deletedAt < env.del) await db.tombstones.put({ id: tombId, table: env.t, recordId: env.id, deletedAt: env.del });
        await db.syncmeta.put({ key: tombId, u: env.del });
      }
    }
  });
  return applied;
}

/* ------------------------------------------------------------------ */
/*  Collecte des changements locaux à envoyer                           */
/* ------------------------------------------------------------------ */

interface Pending {
  key: string;
  u: number;
  env: Envelope;
}

async function collectPending(): Promise<Pending[]> {
  const meta = new Map((await db.syncmeta.toArray()).map((m) => [m.key, m.u]));
  const out: Pending[] = [];
  const existing = new Set<string>();
  for (const t of CLOUD_TABLES) {
    const rows = (await db.table(t).toArray()) as { id: string; updatedAt: number }[];
    for (const r of rows) {
      const key = `${t}:${r.id}`;
      existing.add(key);
      if (meta.get(key) !== r.updatedAt) out.push({ key, u: r.updatedAt, env: { t, r } });
    }
  }
  for (const tomb of (await db.tombstones.toArray()) as Tombstone[]) {
    if (!CLOUD_TABLES.includes(tomb.table) || existing.has(tomb.id)) continue;
    if (meta.get(tomb.id) !== tomb.deletedAt) out.push({ key: tomb.id, u: tomb.deletedAt, env: { t: tomb.table, id: tomb.recordId, del: tomb.deletedAt } });
  }
  for (const s of await db.settings.toArray()) {
    const key = `settings:${s.key}`;
    if (meta.get(key) !== s.updatedAt) out.push({ key, u: s.updatedAt, env: { t: 'settings', s } });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Cycle de synchronisation                                            */
/* ------------------------------------------------------------------ */

export interface SyncResult {
  pulled: number;
  pushed: number;
}

let running: Promise<SyncResult> | null = null;
let again = false;

/** Lance une synchronisation (ou en programme une autre si une est déjà en cours). */
export function syncNow(): Promise<SyncResult> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    const total: SyncResult = { pulled: 0, pushed: 0 };
    try {
      do {
        again = false;
        const r = await runOnce();
        total.pulled += r.pulled;
        total.pushed += r.pushed;
      } while (again);
    } finally {
      running = null;
    }
    return total;
  })();
  return running;
}

async function runOnce(): Promise<SyncResult> {
  const cfg = readSyncConfig();
  if (!cfg || !isSyncAvailable()) {
    setState({ phase: 'off' });
    return { pulled: 0, pushed: 0 };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setState({ phase: 'offline' });
    return { pulled: 0, pushed: 0 };
  }
  setState({ phase: 'syncing', error: null });
  const keys = await deriveKeys(cfg.secret);
  try {
    // 1. Récupérer les changements des autres appareils
    let since = cfg.since;
    let pulled = 0;
    for (;;) {
      const res = await post<{ items: PullItem[]; more: boolean }>('/v1/pull', { h: keys.h, t: keys.t, since });
      if (res.items.length) {
        pulled += await applyRemote(keys, res.items);
        since = res.items[res.items.length - 1].s;
        const current = readSyncConfig();
        if (!current || current.secret !== cfg.secret) return { pulled, pushed: 0 }; // désactivée entre-temps
        writeSyncConfig({ ...current, since });
      }
      if (!res.more) break;
    }

    // 2. Envoyer les changements de cet appareil
    const pending = await collectPending();
    let pushed = 0;
    if (pending.length) {
      const batches: Pending[][] = [];
      for (let i = 0; i < pending.length; i += PUSH_BATCH) batches.push(pending.slice(i, i + PUSH_BATCH));
      const big = pending.length > PUSH_BATCH * 2;
      if (big) setState({ progress: { done: 0, total: pending.length } });
      let next = 0;
      const worker = async () => {
        while (next < batches.length) {
          const batch = batches[next++];
          const items = await Promise.all(
            batch.map(async (p) => ({ k: await recordKey(keys, p.key), u: p.u, p: await encrypt(keys, p.env) })),
          );
          const res = await post<{ accepted: number; rejected: string[] }>('/v1/push', { h: keys.h, t: keys.t, items });
          if (res.rejected.length) again = true; // une version plus récente existe : on la récupérera
          await db.syncmeta.bulkPut(batch.map((p) => ({ key: p.key, u: p.u })));
          pushed += batch.length;
          if (big) setState({ progress: { done: pushed, total: pending.length } });
        }
      };
      await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, batches.length) }, worker));
    }
    setState({ phase: 'idle', lastSync: Date.now(), error: null, progress: null });
    return { pulled, pushed };
  } catch (e) {
    const err = e as SyncError;
    setState({
      phase: err.kind === 'network' ? 'offline' : 'error',
      error: err.kind === 'network' ? null : err.message,
      progress: null,
    });
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/*  Activation, invitation, désactivation                               */
/* ------------------------------------------------------------------ */

/** Crée un nouveau foyer partagé à partir des données de cet appareil. */
export async function enableSync(): Promise<SyncResult> {
  writeSyncConfig({ secret: newSecret(), since: 0, enabledAt: Date.now() });
  await db.syncmeta.clear();
  setState({ phase: 'idle', error: null });
  return syncNow();
}

export function inviteLink(): string | null {
  const cfg = readSyncConfig();
  if (!cfg) return null;
  return `${location.origin}${location.pathname}#/rejoindre?c=${cfg.secret}`;
}

/** Extrait le code d'un lien d'invitation (ou d'un code collé tel quel). */
export function parseInvite(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{22}$/.test(s)) return s;
  const m = s.match(/[?&#]c=([A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/);
  return m ? m[1] : null;
}

/** Vérifie qu'un foyer existe pour ce code (sans rien modifier localement). */
export async function probeInvite(secret: string): Promise<boolean> {
  const keys = await deriveKeys(secret);
  const res = await post<{ items: PullItem[] }>('/v1/pull', { h: keys.h, t: keys.t, since: 0 });
  return res.items.length > 0;
}

/**
 * Rejoint un foyer : les données de cet appareil sont remplacées par celles du foyer.
 * (Vérifier d'abord avec probeInvite pour ne rien effacer si le code est invalide.)
 */
export async function joinHousehold(secret: string): Promise<SyncResult> {
  await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.settings, db.tombstones, db.syncmeta], async () => {
    for (const t of SYNC_TABLES) await db.table(t).clear();
    await db.settings.clear();
    await db.tombstones.clear();
    await db.syncmeta.clear();
  });
  writeSyncConfig({ secret, since: 0, enabledAt: Date.now() });
  setState({ phase: 'idle', error: null });
  return syncNow();
}

/** Arrête la synchronisation sur cet appareil (les données locales sont conservées). */
export async function disableSync(): Promise<void> {
  writeSyncConfig(null);
  await db.syncmeta.clear();
  setState({ phase: 'off', error: null, progress: null });
}

export function isSameHousehold(secret: string): boolean {
  return readSyncConfig()?.secret === secret;
}
