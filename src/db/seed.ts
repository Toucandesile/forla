import { db, saveMany, setSetting, uid, writePref } from './db';
import type { Account, Category, CategoryGroup, Goal, Member, Recurring, Rule, Transaction } from './schema';
import { addDays, addMonths, currentMonth, todayISO } from '../lib/dates';
import { makeSplit } from '../lib/split';
import { processRecurring } from '../lib/recurring';

export const MEMBER_COLORS = ['#257de0', '#f47230', '#00b894', '#f2a600', '#ee7fac', '#008a17', '#6a4ce2', '#ec4647'];
export const ACCOUNT_COLORS = ['#0f766e', '#257de0', '#6a4ce2', '#f47230', '#008a17', '#ee7fac', '#f2a600', '#ec4647'];

type GroupSeed = { key: string; name: string; kind: 'expense' | 'income'; color: string; cats: [string, string, boolean?, boolean?][] };

/** Catégories par défaut, adaptées à un foyer français. [emoji, nom, essentielle, report] */
const DEFAULT_GROUPS: GroupSeed[] = [
  {
    key: 'income',
    name: 'Revenus',
    kind: 'income',
    color: '#16a34a',
    cats: [
      ['💼', 'Salaires'],
      ['🏛️', 'Allocations & aides'],
      ['🎁', 'Primes & cadeaux reçus'],
      ['💰', 'Autres revenus'],
    ],
  },
  {
    key: 'home',
    name: 'Logement',
    kind: 'expense',
    color: '#257de0',
    cats: [
      ['🏠', 'Loyer / crédit immobilier', true],
      ['🏢', 'Charges & copropriété', true],
      ['⚡', 'Électricité & gaz', true],
      ['💧', 'Eau', true],
      ['📶', 'Internet & téléphone', true],
      ['🛡️', 'Assurances', true],
      ['🔧', 'Entretien & équipement', false, true],
    ],
  },
  {
    key: 'daily',
    name: 'Vie quotidienne',
    kind: 'expense',
    color: '#0f9d76',
    cats: [
      ['🛒', 'Courses', true],
      ['🍽️', 'Restaurants & cafés'],
      ['💊', 'Santé', true, true],
      ['🧴', 'Hygiène & beauté'],
      ['👕', 'Vêtements', false, true],
      ['🐾', 'Animaux'],
    ],
  },
  {
    key: 'transport',
    name: 'Transport',
    kind: 'expense',
    color: '#f47230',
    cats: [
      ['⛽', 'Carburant', true],
      ['🚇', 'Transports en commun', true],
      ['🚗', 'Entretien véhicule', true, true],
      ['🅿️', 'Parking & péages'],
    ],
  },
  {
    key: 'kids',
    name: 'Enfants',
    kind: 'expense',
    color: '#ee7fac',
    cats: [
      ['🎒', 'Garde & école', true],
      ['⚽', 'Activités enfants'],
      ['🧸', 'Jouets & fournitures'],
    ],
  },
  {
    key: 'fun',
    name: 'Loisirs',
    kind: 'expense',
    color: '#6a4ce2',
    cats: [
      ['🎬', 'Sorties & culture'],
      ['✈️', 'Vacances & voyages', false, true],
      ['📺', 'Abonnements'],
      ['🏋️', 'Sport'],
      ['🎁', 'Cadeaux', false, true],
      ['🛍️', 'Shopping'],
    ],
  },
  {
    key: 'misc',
    name: 'Finances & divers',
    kind: 'expense',
    color: '#64748b',
    cats: [
      ['🧾', 'Impôts & taxes', true],
      ['🏦', 'Frais bancaires', true],
      ['💝', 'Dons'],
      ['📦', 'Divers'],
    ],
  },
];

/** Règles de catégorisation prêtes à l'emploi pour les enseignes françaises courantes. */
const DEFAULT_RULES: [string, string][] = [
  ['carrefour', 'Courses'],
  ['leclerc', 'Courses'],
  ['auchan', 'Courses'],
  ['lidl', 'Courses'],
  ['aldi', 'Courses'],
  ['intermarche', 'Courses'],
  ['super u', 'Courses'],
  ['monoprix', 'Courses'],
  ['franprix', 'Courses'],
  ['picard', 'Courses'],
  ['biocoop', 'Courses'],
  ['grand frais', 'Courses'],
  ['netflix', 'Abonnements'],
  ['spotify', 'Abonnements'],
  ['deezer', 'Abonnements'],
  ['disney', 'Abonnements'],
  ['canal+', 'Abonnements'],
  ['prime video', 'Abonnements'],
  ['apple.com', 'Abonnements'],
  ['uber eats', 'Restaurants & cafés'],
  ['deliveroo', 'Restaurants & cafés'],
  ['mcdonald', 'Restaurants & cafés'],
  ['starbucks', 'Restaurants & cafés'],
  ['pharmacie', 'Santé'],
  ['doctolib', 'Santé'],
  ['sncf', 'Transports en commun'],
  ['ratp', 'Transports en commun'],
  ['navigo', 'Transports en commun'],
  ['blablacar', 'Transports en commun'],
  ['esso', 'Carburant'],
  ['station', 'Carburant'],
  ['edf', 'Électricité & gaz'],
  ['engie', 'Électricité & gaz'],
  ['veolia', 'Eau'],
  ['free mobile', 'Internet & téléphone'],
  ['free telecom', 'Internet & téléphone'],
  ['orange', 'Internet & téléphone'],
  ['sfr', 'Internet & téléphone'],
  ['bouygues', 'Internet & téléphone'],
  ['decathlon', 'Sport'],
  ['ikea', 'Entretien & équipement'],
  ['leroy merlin', 'Entretien & équipement'],
  ['castorama', 'Entretien & équipement'],
  ['fnac', 'Shopping'],
  ['amazon', 'Shopping'],
  ['zara', 'Vêtements'],
  ['kiabi', 'Vêtements'],
  ['dgfip', 'Impôts & taxes'],
  ['impot', 'Impôts & taxes'],
  ['caf ', 'Allocations & aides'],
  ['salaire', 'Salaires'],
  ['cotisation', 'Frais bancaires'],
  ['frais', 'Frais bancaires'],
];

export async function seedDefaults(): Promise<{ groups: CategoryGroup[]; categories: Category[] }> {
  const groups: Omit<CategoryGroup, 'createdAt' | 'updatedAt'>[] = [];
  const categories: Omit<Category, 'createdAt' | 'updatedAt'>[] = [];
  DEFAULT_GROUPS.forEach((g, gi) => {
    const gid = uid();
    groups.push({ id: gid, name: g.name, kind: g.kind, color: g.color, order: gi });
    g.cats.forEach(([emoji, name, essential, rollover], ci) =>
      categories.push({
        id: uid(),
        name,
        emoji,
        groupId: gid,
        kind: g.kind,
        essential: !!essential,
        rollover: !!rollover,
        archived: false,
        order: gi * 100 + ci,
      }),
    );
  });
  const savedGroups = await saveMany('groups', groups);
  const savedCats = await saveMany('categories', categories);
  const byName = new Map(savedCats.map((c) => [c.name, c.id]));
  await saveMany(
    'rules',
    DEFAULT_RULES.filter(([, cat]) => byName.has(cat)).map(([pattern, cat], i) => ({
      id: uid(),
      pattern,
      categoryId: byName.get(cat)!,
      rename: '',
      order: i,
    })) as Omit<Rule, 'createdAt' | 'updatedAt'>[],
  );
  return { groups: savedGroups, categories: savedCats };
}

/* ------------------------------------------------------------------ */
/*  Données de démonstration                                           */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedDemo(): Promise<void> {
  const { categories } = await seedDefaults();
  const cat = (name: string) => categories.find((c) => c.name === name)!.id;
  const rnd = mulberry32(42);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const between = (a: number, b: number) => Math.round((a + rnd() * (b - a)) * 100);

  const today = todayISO();
  const startMonth = addMonths(currentMonth(), -5);
  const start = `${startMonth}-01`;

  const [camille, sacha] = await saveMany('members', [
    { name: 'Camille', emoji: '🦊', color: MEMBER_COLORS[0], weight: 2600, archived: false, order: 0 },
    { name: 'Sacha', emoji: '🐻', color: MEMBER_COLORS[1], weight: 2100, archived: false, order: 1 },
  ] as Omit<Member, 'id' | 'createdAt' | 'updatedAt'>[]);
  const members = [camille, sacha];

  const [joint, accCamille, accSacha, livret, cash] = await saveMany('accounts', [
    { name: 'Compte joint', type: 'checking', initialBalance: 185000, ownerId: null, color: ACCOUNT_COLORS[0], archived: false, order: 0 },
    { name: 'Compte Camille', type: 'checking', initialBalance: 95000, ownerId: camille.id, color: ACCOUNT_COLORS[1], archived: false, order: 1 },
    { name: 'Compte Sacha', type: 'checking', initialBalance: 64000, ownerId: sacha.id, color: ACCOUNT_COLORS[3], archived: false, order: 2 },
    { name: 'Livret A', type: 'savings', initialBalance: 620000, ownerId: null, color: ACCOUNT_COLORS[4], archived: false, order: 3 },
    { name: 'Espèces', type: 'cash', initialBalance: 8000, ownerId: null, color: ACCOUNT_COLORS[6], archived: false, order: 4 },
  ] as Omit<Account, 'id' | 'createdAt' | 'updatedAt'>[]);

  const rec = (r: Partial<Recurring> & Pick<Recurring, 'name' | 'type' | 'amount' | 'accountId'> & { day: number }) => {
    const first = `${startMonth}-${String(r.day).padStart(2, '0')}`;
    return {
      toAccountId: null,
      categoryId: null,
      paidBy: null,
      splitMode: 'none',
      unit: 'month',
      interval: 1,
      anchorDay: r.day,
      startDate: first,
      nextDate: first,
      endDate: null,
      autoPost: true,
      active: true,
      subscription: false,
      note: '',
      ...r,
    } as Omit<Recurring, 'id' | 'createdAt' | 'updatedAt'> & { day?: number };
  };

  const recurrings = [
    rec({ name: 'Salaire Camille', type: 'income', amount: 260000, accountId: accCamille.id, categoryId: cat('Salaires'), day: 27 }),
    rec({ name: 'Salaire Sacha', type: 'income', amount: 210000, accountId: accSacha.id, categoryId: cat('Salaires'), day: 1 }),
    rec({ name: 'Virement compte joint', type: 'transfer', amount: 140000, accountId: accCamille.id, toAccountId: joint.id, day: 2 }),
    rec({ name: 'Virement compte joint', type: 'transfer', amount: 113000, accountId: accSacha.id, toAccountId: joint.id, day: 2 }),
    rec({ name: 'Épargne mensuelle', type: 'transfer', amount: 30000, accountId: joint.id, toAccountId: livret.id, day: 3 }),
    rec({ name: 'Retrait espèces', type: 'transfer', amount: 10000, accountId: joint.id, toAccountId: cash.id, day: 7 }),
    rec({ name: 'Loyer', type: 'expense', amount: 115000, accountId: joint.id, categoryId: cat('Loyer / crédit immobilier'), day: 5 }),
    rec({ name: 'EDF', type: 'expense', amount: 9800, accountId: joint.id, categoryId: cat('Électricité & gaz'), day: 10 }),
    rec({ name: 'Free Box', type: 'expense', amount: 3999, accountId: joint.id, categoryId: cat('Internet & téléphone'), day: 12 }),
    rec({ name: 'Assurance habitation', type: 'expense', amount: 2450, accountId: joint.id, categoryId: cat('Assurances'), day: 8 }),
    rec({ name: 'Netflix', type: 'expense', amount: 1349, accountId: accCamille.id, categoryId: cat('Abonnements'), paidBy: camille.id, splitMode: 'equal', subscription: true, day: 15 }),
    rec({ name: 'Spotify Famille', type: 'expense', amount: 2199, accountId: joint.id, categoryId: cat('Abonnements'), subscription: true, day: 20 }),
    rec({ name: 'Salle de sport', type: 'expense', amount: 3490, accountId: accCamille.id, categoryId: cat('Sport'), paidBy: camille.id, splitMode: 'none', subscription: true, day: 6 }),
    rec({ name: 'Pass Navigo', type: 'expense', amount: 8880, accountId: accSacha.id, categoryId: cat('Transports en commun'), paidBy: sacha.id, splitMode: 'none', day: 4 }),
    rec({ name: 'Forfait mobile Sacha', type: 'expense', amount: 1599, accountId: accSacha.id, categoryId: cat('Internet & téléphone'), paidBy: sacha.id, splitMode: 'none', subscription: true, day: 18 }),
  ];
  // Facture d'eau trimestrielle à valider manuellement
  const water = rec({ name: "Facture d'eau", type: 'expense', amount: 7420, accountId: joint.id, categoryId: cat('Eau'), day: 22, unit: 'month', interval: 3, autoPost: false });
  water.startDate = water.nextDate = addDays(today, -2) < `${currentMonth()}-01` ? `${currentMonth()}-01` : addDays(today, -2);
  water.anchorDay = Number(water.nextDate.slice(8, 10));
  recurrings.push(water);
  // Abonnement annuel
  const amazon = rec({ name: 'Amazon Prime', type: 'expense', amount: 6990, accountId: joint.id, categoryId: cat('Abonnements'), subscription: true, unit: 'year', day: 14 });
  amazon.startDate = amazon.nextDate = `${addMonths(currentMonth(), 1)}-14`;
  recurrings.push(amazon);
  await saveMany('recurring', recurrings.map(({ day: _d, ...r }) => r) as Omit<Recurring, 'id' | 'createdAt' | 'updatedAt'>[]);

  // Opérations ponctuelles
  const txs: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  const add = (t: Partial<Transaction> & Pick<Transaction, 'date' | 'amount' | 'payee' | 'categoryId'>) => {
    if (t.date > today) return;
    const paidBy = t.paidBy ?? null;
    const mode = (t.split?.mode ?? (paidBy ? 'equal' : 'none')) as Transaction['split']['mode'];
    txs.push({
      type: 'expense',
      accountId: joint.id,
      toAccountId: null,
      note: '',
      cleared: t.date < addDays(today, -5),
      recurringId: null,
      importId: null,
      hasReceipt: false,
      ...t,
      paidBy,
      split: paidBy ? makeSplit(t.amount, mode, members, paidBy) : { mode: 'none', shares: {} },
    });
  };

  for (let d = start; d <= today; d = addDays(d, 1)) {
    const dow = new Date(d).getDay();
    const dom = Number(d.slice(8, 10));
    if (dow === 6 || (dow === 3 && rnd() < 0.7)) add({ date: d, amount: between(45, 145), payee: pick(['Carrefour Market', 'Lidl', 'Biocoop', 'Leclerc Drive']), categoryId: cat('Courses') });
    if (dow === 0 && rnd() < 0.5) add({ date: d, amount: between(14, 38), payee: 'Marché de quartier', categoryId: cat('Courses'), accountId: cash.id });
    if (rnd() < 0.11) {
      const who = rnd() < 0.5 ? camille : sacha;
      add({
        date: d,
        amount: between(12, 72),
        payee: pick(['Le Petit Bistrot', 'Sushi Shop', 'Uber Eats', 'Café des Arts', 'Pizzeria Napoli']),
        categoryId: cat('Restaurants & cafés'),
        paidBy: who.id,
        accountId: who.id === camille.id ? accCamille.id : accSacha.id,
      });
    }
    if (dom === 9 || dom === 24) add({ date: d, amount: between(52, 78), payee: pick(['TotalEnergies', 'Esso', 'Station Intermarché']), categoryId: cat('Carburant') });
    if (rnd() < 0.04) add({ date: d, amount: between(8, 46), payee: 'Pharmacie du Centre', categoryId: cat('Santé') });
    if (rnd() < 0.035) add({ date: d, amount: between(25, 120), payee: pick(['Zara', 'Kiabi', 'Decathlon']), categoryId: cat('Vêtements'), paidBy: sacha.id, accountId: accSacha.id, split: { mode: 'none', shares: {} } });
    if (rnd() < 0.04) add({ date: d, amount: between(15, 60), payee: pick(['Cinéma Pathé', 'Fnac', 'Musée d’Orsay']), categoryId: cat('Sorties & culture') });
    if (rnd() < 0.03) add({ date: d, amount: between(12, 90), payee: 'Amazon', categoryId: cat('Shopping'), paidBy: camille.id, accountId: accCamille.id });
    if (rnd() < 0.025) add({ date: d, amount: between(6, 25), payee: 'Monoprix', categoryId: cat('Hygiène & beauté') });
  }
  add({ date: addDays(today, -40), amount: 34000, payee: 'Airbnb Biarritz', categoryId: cat('Vacances & voyages'), paidBy: camille.id, accountId: accCamille.id });
  add({ date: addDays(today, -18), amount: 6500, payee: 'Cadeau anniversaire Léa', categoryId: cat('Cadeaux') });
  add({ date: addDays(today, -6), amount: 4200, payee: 'Leroy Merlin', categoryId: cat('Entretien & équipement'), paidBy: sacha.id, accountId: accSacha.id });
  add({ date: addDays(today, -3), amount: 2380, payee: 'Remboursement Ameli', categoryId: cat('Santé'), type: 'income' });
  // quelques opérations sans catégorie (à classer)
  add({ date: addDays(today, -1), amount: 1890, payee: 'Paiement CB 4521', categoryId: null });
  add({ date: today, amount: 760, payee: 'Boulangerie Paul', categoryId: null, accountId: cash.id });
  await saveMany('transactions', txs);

  await processRecurring(today);

  // Budgets mensuels (reconduits automatiquement)
  const budgets: [string, number][] = [
    ['Loyer / crédit immobilier', 115000],
    ['Électricité & gaz', 10000],
    ['Eau', 2500],
    ['Internet & téléphone', 5600],
    ['Assurances', 2500],
    ['Courses', 75000],
    ['Restaurants & cafés', 18000],
    ['Carburant', 13000],
    ['Transports en commun', 9000],
    ['Santé', 5000],
    ['Vêtements', 8000],
    ['Sorties & culture', 8000],
    ['Abonnements', 5000],
    ['Sport', 3500],
    ['Shopping', 6000],
    ['Vacances & voyages', 15000],
    ['Cadeaux', 4000],
    ['Entretien & équipement', 5000],
    ['Hygiène & beauté', 3000],
  ];
  await saveMany(
    'budgets',
    budgets.map(([name, amount]) => ({ id: `${startMonth}|${cat(name)}`, month: startMonth, categoryId: cat(name), amount })),
  );

  const [vacances] = await saveMany('goals', [
    { name: 'Vacances d’été', emoji: '🏖️', target: 250000, targetDate: `${Number(today.slice(0, 4)) + 1}-07-01`, accountId: null, archived: false, order: 0 },
    { name: 'Fonds d’urgence', emoji: '🛟', target: 1000000, targetDate: null, accountId: livret.id, archived: false, order: 1 },
  ] as Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>[]);
  const contribs = [];
  for (let m = startMonth; m <= currentMonth(); m = addMonths(m, 1)) {
    const date = `${m}-04`;
    if (date <= today) contribs.push({ goalId: vacances.id, date, amount: 15000, note: 'Versement mensuel' });
  }
  await saveMany('contributions', contribs);

  await saveMany('settlements', [
    { date: addDays(today, -35), fromId: sacha.id, toId: camille.id, amount: 8000, note: 'Remboursement Lydia' },
  ]);

  await setSetting('householdName', 'Foyer Martin');
  await setSetting('onboarded', true);
  writePref('meId', camille.id);
}

export async function hasData(): Promise<boolean> {
  return (await db.categories.count()) > 0;
}

export function memberColor(index: number): string {
  return MEMBER_COLORS[index % MEMBER_COLORS.length];
}

