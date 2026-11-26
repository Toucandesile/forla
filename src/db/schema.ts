export type ID = string;

/** Champs communs à tous les enregistrements synchronisables (fusion "dernière écriture gagne"). */
export interface Meta {
  id: ID;
  createdAt: number;
  updatedAt: number;
}

export type AccountType = 'checking' | 'savings' | 'cash' | 'credit' | 'investment' | 'loan';

export interface Account extends Meta {
  name: string;
  type: AccountType;
  /** Solde initial en centimes */
  initialBalance: number;
  /** Membre titulaire, ou null pour un compte commun */
  ownerId: ID | null;
  color: string;
  archived: boolean;
  order: number;
}

export type CategoryKind = 'expense' | 'income';

export interface CategoryGroup extends Meta {
  name: string;
  kind: CategoryKind;
  color: string;
  order: number;
}

export interface Category extends Meta {
  name: string;
  emoji: string;
  groupId: ID;
  kind: CategoryKind;
  /** Report du reste (positif ou négatif) d'un mois sur l'autre — budget par enveloppes */
  rollover: boolean;
  /** Dépense essentielle (besoins) vs envies, pour l'analyse 50/30/20 */
  essential: boolean;
  archived: boolean;
  order: number;
}

export type TxType = 'expense' | 'income' | 'transfer';
export type SplitMode = 'none' | 'equal' | 'prorata' | 'custom';

/**
 * Répartition d'une dépense avancée par un membre.
 * Les parts sont figées (en centimes) à l'enregistrement : changer les revenus ou
 * ajouter un membre ne modifie pas le passé.
 */
export interface Split {
  mode: SplitMode;
  shares: Record<ID, number>;
}

export interface Transaction extends Meta {
  type: TxType;
  /** AAAA-MM-JJ */
  date: string;
  /** Toujours positif, en centimes. Le type donne le sens. */
  amount: number;
  accountId: ID;
  /** Compte de destination (virements uniquement) */
  toAccountId: ID | null;
  categoryId: ID | null;
  payee: string;
  note: string;
  /** Membre ayant avancé la dépense, ou null si payée par le compte commun */
  paidBy: ID | null;
  split: Split;
  cleared: boolean;
  recurringId: ID | null;
  /** Identifiant d'import bancaire (FITID ou empreinte) pour éviter les doublons */
  importId: string | null;
  hasReceipt: boolean;
}

export interface Budget extends Meta {
  /** id = `${month}|${categoryId}` */
  month: string;
  categoryId: ID;
  amount: number;
}

export type RecurrenceUnit = 'week' | 'month' | 'year';

export interface Recurring extends Meta {
  name: string;
  type: TxType;
  amount: number;
  accountId: ID;
  toAccountId: ID | null;
  categoryId: ID | null;
  paidBy: ID | null;
  splitMode: SplitMode;
  unit: RecurrenceUnit;
  interval: number;
  anchorDay: number | null;
  startDate: string;
  nextDate: string;
  endDate: string | null;
  /** Créer l'opération automatiquement à échéance (sinon : à valider) */
  autoPost: boolean;
  active: boolean;
  /** Abonnement (streaming, salle de sport…) — suivi dédié */
  subscription: boolean;
  note: string;
}

export interface Member extends Meta {
  name: string;
  emoji: string;
  color: string;
  /** Poids pour le partage au prorata (ex. revenus nets mensuels) */
  weight: number;
  archived: boolean;
  order: number;
}

export interface Goal extends Meta {
  name: string;
  emoji: string;
  target: number;
  targetDate: string | null;
  /** Si lié à un compte, l'avancement = solde du compte */
  accountId: ID | null;
  archived: boolean;
  order: number;
}

export interface GoalContribution extends Meta {
  goalId: ID;
  date: string;
  /** Positif = versement, négatif = retrait */
  amount: number;
  note: string;
}

export interface Settlement extends Meta {
  date: string;
  fromId: ID;
  toId: ID;
  amount: number;
  note: string;
}

export interface Rule extends Meta {
  /** Texte recherché dans le libellé (insensible à la casse et aux accents) */
  pattern: string;
  categoryId: ID;
  /** Libellé de remplacement facultatif */
  rename: string;
  order: number;
}

export interface Receipt extends Meta {
  /** id = id de l'opération */
  dataUrl: string;
}

export interface Setting {
  key: string;
  value: unknown;
  updatedAt: number;
}

export interface Tombstone {
  /** `${table}:${recordId}` */
  id: string;
  table: SyncTable;
  recordId: string;
  deletedAt: number;
}

export const SYNC_TABLES = [
  'accounts',
  'groups',
  'categories',
  'transactions',
  'budgets',
  'recurring',
  'members',
  'goals',
  'contributions',
  'settlements',
  'rules',
  'receipts',
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

export interface TableTypes {
  accounts: Account;
  groups: CategoryGroup;
  categories: Category;
  transactions: Transaction;
  budgets: Budget;
  recurring: Recurring;
  members: Member;
  goals: Goal;
  contributions: GoalContribution;
  settlements: Settlement;
  rules: Rule;
  receipts: Receipt;
}

export interface HouseholdSettings {
  householdName: string;
  currency: string;
  defaultSplit: SplitMode;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: HouseholdSettings = {
  householdName: 'Mon foyer',
  currency: 'EUR',
  defaultSplit: 'equal',
  onboarded: false,
};

export const ACCOUNT_TYPES: Record<AccountType, { label: string; emoji: string; liability: boolean }> = {
  checking: { label: 'Compte courant', emoji: '🏦', liability: false },
  savings: { label: 'Épargne', emoji: '🐷', liability: false },
  cash: { label: 'Espèces', emoji: '💶', liability: false },
  credit: { label: 'Carte à débit différé', emoji: '💳', liability: true },
  investment: { label: 'Placement', emoji: '📈', liability: false },
  loan: { label: 'Crédit / prêt', emoji: '🏠', liability: true },
};
