import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ArrowRight, CloudOff, PiggyBank, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { requestPersistence, save, saveMany, setSetting, uid, writePref } from '../db/db';
import { seedDefaults, seedDemo, MEMBER_COLORS, ACCOUNT_COLORS } from '../db/seed';
import { ACCOUNT_TYPES, type AccountType } from '../db/schema';
import { wipeAll } from '../lib/backup';
import { parseAmount } from '../lib/money';
import { AmountInput, Button, Field } from '../components/ui';
import { JoinPrompt } from '../components/SyncPanel';

const EMOJIS = ['🦊', '🐻', '🐼', '🦁', '🐨', '🐯', '🐸', '🦉', '🐙', '🦄'];

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [household, setHousehold] = useState('Mon foyer');
  const [members, setMembers] = useState([{ id: uid(), name: '', emoji: EMOJIS[0] }]);
  const [accountName, setAccountName] = useState('Compte courant');
  const [accountType, setAccountType] = useState<AccountType>('checking');
  const [balance, setBalance] = useState('');
  const [joinOpen, setJoinOpen] = useState(false);

  async function startDemo() {
    setBusy(true);
    try {
      await wipeAll();
      await seedDemo();
      await requestPersistence();
      toast.success('Données de démonstration chargées. Vous pourrez tout effacer dans Réglages.');
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    const named = members.filter((m) => m.name.trim());
    setBusy(true);
    try {
      await wipeAll();
      await seedDefaults();
      const saved = await saveMany(
        'members',
        named.map((m, i) => ({ id: m.id, name: m.name.trim(), emoji: m.emoji, color: MEMBER_COLORS[i % MEMBER_COLORS.length], weight: 1, archived: false, order: i })),
      );
      await save('accounts', {
        name: accountName.trim() || 'Compte courant',
        type: accountType,
        initialBalance: parseAmount(balance) ?? 0,
        ownerId: saved.length === 1 ? saved[0].id : null,
        color: ACCOUNT_COLORS[0],
        archived: false,
        order: 0,
      });
      await setSetting('householdName', household.trim() || 'Mon foyer');
      await setSetting('defaultSplit', saved.length > 1 ? 'equal' : 'none');
      if (saved[0]) writePref('meId', saved[0].id);
      await setSetting('onboarded', true);
      const persisted = await requestPersistence();
      toast.success(persisted ? 'Votre foyer est prêt ! Stockage permanent activé.' : 'Votre foyer est prêt !');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center gap-3">
          <img src="./logo.svg" alt="" className="h-12 w-12" />
          <div>
            <p className="text-xl font-bold">Forla</p>
            <p className="text-sm text-muted">Les dépenses du foyer, simplement.</p>
          </div>
        </div>

        {step === 0 && (
          <div className="card space-y-6 p-6">
            <h1 className="text-2xl font-bold tracking-tight">Reprenez la main sur le budget de votre foyer</h1>
            <ul className="space-y-4">
              <Feature icon={<CloudOff size={20} />} title="100 % hors connexion">
                Installez Forla sur votre téléphone : elle fonctionne partout, même sans réseau.
              </Feature>
              <Feature icon={<ShieldCheck size={20} />} title="Privée par conception">
                Aucun compte, aucun serveur : vos données restent sur votre appareil. Sauvegardes chiffrées.
              </Feature>
              <Feature icon={<PiggyBank size={20} />} title="Budget par enveloppes">
                Donnez un rôle à chaque euro, suivez votre « reste à vivre » et vos abonnements.
              </Feature>
              <Feature icon={<Users size={20} />} title="Pensée pour le foyer">
                Qui a payé quoi, partage au prorata des revenus, équilibrage en un geste.
              </Feature>
            </ul>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="primary" size="lg" block onClick={() => setStep(1)} icon={<ArrowRight size={18} />}>
                Créer mon foyer
              </Button>
              <Button variant="secondary" size="lg" block onClick={startDemo} disabled={busy}>
                Essayer la démo
              </Button>
            </div>
            <button type="button" className="w-full text-center text-sm font-medium text-primary hover:underline" onClick={() => setJoinOpen(true)}>
              J’ai reçu une invitation pour rejoindre un foyer
            </button>
            <JoinPrompt open={joinOpen} onClose={() => setJoinOpen(false)} />
          </div>
        )}

        {step === 1 && (
          <div className="card space-y-5 p-6">
            <div>
              <p className="text-sm font-medium text-primary">Étape 1 sur 2</p>
              <h1 className="text-xl font-bold">Votre foyer</h1>
            </div>
            <Field label="Nom du foyer" htmlFor="ob-house">
              <input id="ob-house" className="field" value={household} onChange={(e) => setHousehold(e.target.value)} />
            </Field>
            <div>
              <p className="mb-1.5 text-sm font-medium text-muted">Membres (vous en premier)</p>
              <div className="space-y-2">
                {members.map((m, i) => (
                  <div key={m.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-xl"
                      onClick={() => setMembers((ms) => ms.map((x) => (x.id === m.id ? { ...x, emoji: EMOJIS[(EMOJIS.indexOf(x.emoji) + 1) % EMOJIS.length] } : x)))}
                      aria-label="Changer d'avatar"
                    >
                      {m.emoji}
                    </button>
                    <input
                      className="field"
                      placeholder={i === 0 ? 'Votre prénom' : 'Prénom'}
                      value={m.name}
                      aria-label={`Prénom du membre ${i + 1}`}
                      onChange={(e) => setMembers((ms) => ms.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)))}
                    />
                    {members.length > 1 && (
                      <button
                        type="button"
                        className="p-2 text-muted hover:text-danger"
                        aria-label="Retirer"
                        onClick={() => setMembers((ms) => ms.filter((x) => x.id !== m.id))}
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                icon={<Plus size={16} />}
                onClick={() => setMembers((ms) => [...ms, { id: uid(), name: '', emoji: EMOJIS[ms.length % EMOJIS.length] }])}
              >
                Ajouter un membre
              </Button>
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(0)}>
                Retour
              </Button>
              <Button variant="primary" onClick={() => setStep(2)} disabled={!members.some((m) => m.name.trim())}>
                Continuer
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="card space-y-5 p-6">
            <div>
              <p className="text-sm font-medium text-primary">Étape 2 sur 2</p>
              <h1 className="text-xl font-bold">Votre compte principal</h1>
              <p className="mt-1 text-sm text-muted">Vous pourrez ajouter d'autres comptes (joint, épargne, espèces…) ensuite.</p>
            </div>
            <Field label="Nom du compte" htmlFor="ob-acc">
              <input id="ob-acc" className="field" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
            </Field>
            <Field label="Type" htmlFor="ob-type">
              <select id="ob-type" className="field" value={accountType} onChange={(e) => setAccountType(e.target.value as AccountType)}>
                {Object.entries(ACCOUNT_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.emoji} {v.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Solde actuel" htmlFor="ob-bal" hint="Le solde affiché par votre banque aujourd'hui.">
              <AmountInput id="ob-bal" value={balance} onChange={setBalance} placeholder="0,00" />
            </Field>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Retour
              </Button>
              <Button variant="primary" onClick={finish} disabled={busy}>
                Terminer
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">{icon}</span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted">{children}</span>
      </span>
    </li>
  );
}
