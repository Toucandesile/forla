import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, readPrefs, writePref, type DevicePrefs } from './db/db';
import {
  DEFAULT_SETTINGS,
  type Account,
  type Category,
  type CategoryGroup,
  type Goal,
  type GoalContribution,
  type HouseholdSettings,
  type ID,
  type Member,
  type Recurring,
  type Rule,
  type Settlement,
  type Transaction,
  type Budget,
} from './db/schema';
import { computeBalances, makeKindLookup } from './lib/finance';
import { setCurrency } from './lib/money';

/* ------------------------------------------------------------------ */
/*  Données (requêtes "live" : l'interface se met à jour seule)         */
/* ------------------------------------------------------------------ */

export interface AppData {
  ready: boolean;
  accounts: Account[];
  groups: CategoryGroup[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  recurring: Recurring[];
  members: Member[];
  goals: Goal[];
  contributions: GoalContribution[];
  settlements: Settlement[];
  rules: Rule[];
  settings: HouseholdSettings;
  accountMap: Map<ID, Account>;
  categoryMap: Map<ID, Category>;
  groupMap: Map<ID, CategoryGroup>;
  memberMap: Map<ID, Member>;
  balances: Map<ID, number>;
  kindOf: (id: ID | null) => 'expense' | 'income' | null;
  activeMembers: Member[];
  activeAccounts: Account[];
}

const DataContext = createContext<AppData | null>(null);

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

export function DataProvider({ children }: { children: ReactNode }) {
  const accounts = useLiveQuery(() => db.accounts.toArray().then((r) => r.sort(byOrder)), []);
  const groups = useLiveQuery(() => db.groups.toArray().then((r) => r.sort(byOrder)), []);
  const categories = useLiveQuery(() => db.categories.toArray().then((r) => r.sort(byOrder)), []);
  const transactions = useLiveQuery(() => db.transactions.toArray(), []);
  const budgets = useLiveQuery(() => db.budgets.toArray(), []);
  const recurring = useLiveQuery(() => db.recurring.toArray(), []);
  const members = useLiveQuery(() => db.members.toArray().then((r) => r.sort(byOrder)), []);
  const goals = useLiveQuery(() => db.goals.toArray().then((r) => r.sort(byOrder)), []);
  const contributions = useLiveQuery(() => db.contributions.toArray(), []);
  const settlements = useLiveQuery(() => db.settlements.toArray(), []);
  const rules = useLiveQuery(() => db.rules.toArray().then((r) => r.sort(byOrder)), []);
  const settingsRows = useLiveQuery(() => db.settings.toArray(), []);

  const value = useMemo<AppData>(() => {
    const settings = { ...DEFAULT_SETTINGS } as HouseholdSettings;
    for (const r of settingsRows ?? []) (settings as unknown as Record<string, unknown>)[r.key] = r.value;
    setCurrency(settings.currency);
    const a = accounts ?? [];
    const c = categories ?? [];
    const m = members ?? [];
    const t = transactions ?? [];
    return {
      ready: [accounts, groups, categories, transactions, budgets, recurring, members, goals, contributions, settlements, rules, settingsRows].every(
        (x) => x !== undefined,
      ),
      accounts: a,
      groups: groups ?? [],
      categories: c,
      transactions: t,
      budgets: budgets ?? [],
      recurring: recurring ?? [],
      members: m,
      goals: goals ?? [],
      contributions: contributions ?? [],
      settlements: settlements ?? [],
      rules: rules ?? [],
      settings,
      accountMap: new Map(a.map((x) => [x.id, x])),
      categoryMap: new Map(c.map((x) => [x.id, x])),
      groupMap: new Map((groups ?? []).map((x) => [x.id, x])),
      memberMap: new Map(m.map((x) => [x.id, x])),
      balances: computeBalances(a, t),
      kindOf: makeKindLookup(c),
      activeMembers: m.filter((x) => !x.archived),
      activeAccounts: a.filter((x) => !x.archived),
    };
  }, [accounts, groups, categories, transactions, budgets, recurring, members, goals, contributions, settlements, rules, settingsRows]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): AppData {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData hors DataProvider');
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Préférences de l'appareil                                          */
/* ------------------------------------------------------------------ */

export function usePrefs(): [DevicePrefs, <K extends keyof DevicePrefs>(k: K, v: DevicePrefs[K]) => void] {
  const [prefs, setPrefs] = useState(readPrefs);
  useEffect(() => {
    const sync = () => setPrefs(readPrefs());
    window.addEventListener('forla:prefs', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('forla:prefs', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const set = useCallback(<K extends keyof DevicePrefs>(k: K, v: DevicePrefs[K]) => writePref(k, v), []);
  return [prefs, set];
}

/** Applique le thème clair/sombre/système sur <html>. */
export function useApplyTheme(theme: DevicePrefs['theme']) {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0c0d0f' : '#0f766e');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

/* ------------------------------------------------------------------ */
/*  Interface : feuille de saisie d'opération                          */
/* ------------------------------------------------------------------ */

export type TxDraft = Partial<Transaction> & { makeRecurring?: boolean };

interface UIState {
  txEditor: { open: boolean; draft: TxDraft | null; seq: number };
  openTx: (draft?: TxDraft) => void;
  closeTx: () => void;
}

const UIContext = createContext<UIState | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [txEditor, setTxEditor] = useState<UIState['txEditor']>({ open: false, draft: null, seq: 0 });
  const openTx = useCallback((draft?: TxDraft) => setTxEditor((s) => ({ open: true, draft: draft ?? null, seq: s.seq + 1 })), []);
  const closeTx = useCallback(() => setTxEditor((s) => ({ ...s, open: false })), []);
  const value = useMemo(() => ({ txEditor, openTx, closeTx }), [txEditor, openTx, closeTx]);
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIState {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI hors UIProvider');
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Routeur minimal par hash (#/budget) — fonctionne partout, même en   */
/*  ouvrant l'application hors ligne depuis l'écran d'accueil.          */
/* ------------------------------------------------------------------ */

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function readRoute(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, segments: path.split('/').filter(Boolean), query: new URLSearchParams(qs ?? '') };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(to: string, replace = false) {
  const hash = '#' + to;
  if (replace) window.history.replaceState(null, '', hash);
  else window.location.hash = to;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}
