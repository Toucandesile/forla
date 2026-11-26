import { useState } from 'react';
import { toast } from 'sonner';
import { CloudDownload, Copy, Smartphone, UserPlus, Users } from 'lucide-react';
import { save, uid, writePref } from '../db/db';
import { MEMBER_COLORS } from '../db/seed';
import { useData, navigate } from '../state';
import { isSameHousehold, isValidSecret, joinHousehold, probeInvite, useSyncState } from '../lib/sync';
import { isIOS, isStandalone } from '../lib/install';
import { Avatar, Button, Field } from '../components/ui';

type Step = 'confirm' | 'working' | 'pick' | 'error';

export function JoinPage({ code }: { code: string | null }) {
  const data = useData();
  const sync = useSyncState();
  const [step, setStep] = useState<Step>(() => (isValidSecret(code) ? 'confirm' : 'error'));
  const [error, setError] = useState<string | null>(isValidSecret(code) ? null : 'Ce lien d’invitation est incomplet. Demandez à l’autre personne de vous le renvoyer.');
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const hasLocalData = data.settings.onboarded && (data.transactions.length > 0 || data.accounts.length > 0);
  const already = isValidSecret(code) && isSameHousehold(code);
  const iosBrowser = isIOS() && !isStandalone();

  async function join() {
    if (!isValidSecret(code)) return;
    setStep('working');
    try {
      if (!(await probeInvite(code))) {
        setError('Ce foyer est introuvable pour le moment. Vérifiez que le téléphone qui a envoyé l’invitation est connecté à Internet, puis réessayez.');
        setStep('error');
        return;
      }
      await joinHousehold(code);
      setStep('pick');
    } catch {
      setError('Connexion impossible. Vérifiez votre accès à Internet, puis réessayez.');
      setStep('error');
    }
  }

  function finish(memberId: string) {
    writePref('meId', memberId);
    toast.success('Bienvenue ! Vos appareils sont maintenant synchronisés.');
    navigate('/', true);
  }

  async function addMe() {
    const name = newName.trim();
    if (!name) return;
    const m = await save('members', {
      id: uid(),
      name,
      emoji: ['🐼', '🦁', '🐨', '🐯', '🐸', '🦉'][data.members.length % 6],
      color: MEMBER_COLORS[data.members.length % MEMBER_COLORS.length],
      weight: 1,
      archived: false,
      order: data.members.length,
    });
    finish(m.id);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      toast.success('Lien copié');
    } catch {
      toast.error('Copie impossible');
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <img src="./logo.svg" alt="" className="h-11 w-11" />
          <p className="text-xl font-bold">Forla</p>
        </div>

        {already && step !== 'pick' ? (
          <div className="card space-y-4 p-6">
            <h1 className="text-xl font-bold">Cet appareil fait déjà partie de ce foyer ✓</h1>
            <Button variant="primary" block onClick={() => navigate('/', true)}>
              Ouvrir Forla
            </Button>
          </div>
        ) : step === 'confirm' ? (
          <div className="card space-y-5 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <Users size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Rejoindre un foyer partagé</h1>
              <p className="mt-2 text-sm text-muted">
                Les dépenses, budgets et comptes du foyer seront synchronisés automatiquement sur ce téléphone. Les données sont chiffrées : seuls les
                appareils du foyer peuvent les lire.
              </p>
            </div>
            {hasLocalData && (
              <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning-ink">
                Les données déjà présentes sur cet appareil seront remplacées par celles du foyer.
              </p>
            )}
            {iosBrowser && (
              <div className="space-y-2 rounded-xl bg-surface-2 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <Smartphone size={16} /> Sur iPhone, pour utiliser Forla depuis l’écran d’accueil :
                </p>
                <ol className="list-decimal space-y-0.5 pl-5 text-muted">
                  <li>Copiez ce lien d’invitation.</li>
                  <li>Touchez Partager → « Sur l’écran d’accueil ».</li>
                  <li>Ouvrez Forla depuis l’écran d’accueil → « J’ai reçu une invitation » et collez le lien.</li>
                </ol>
                <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={copyLink}>
                  Copier le lien
                </Button>
              </div>
            )}
            <Button variant="primary" size="lg" block icon={<CloudDownload size={18} />} onClick={join}>
              Rejoindre le foyer
            </Button>
            <Button variant="ghost" block onClick={() => navigate('/', true)}>
              Annuler
            </Button>
          </div>
        ) : step === 'working' ? (
          <div className="card space-y-3 p-6 text-center">
            <CloudDownload size={32} className="mx-auto animate-pulse text-primary" />
            <h1 className="text-lg font-semibold">Récupération des données du foyer…</h1>
            <p className="text-sm text-muted">{sync.progress ? `${sync.progress.done} / ${sync.progress.total}` : 'Quelques secondes suffisent.'}</p>
          </div>
        ) : step === 'pick' ? (
          <div className="card space-y-5 p-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Bienvenue dans « {data.settings.householdName} » 🎉</h1>
              <p className="mt-1 text-sm text-muted">Qui utilise ce téléphone ?</p>
            </div>
            <div className="space-y-2">
              {data.activeMembers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => finish(m.id)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-line p-3 text-left font-medium hover:bg-surface-2"
                >
                  <Avatar member={m} size={36} />
                  {m.name}
                </button>
              ))}
            </div>
            {adding ? (
              <div className="space-y-2">
                <Field label="Votre prénom" htmlFor="join-name">
                  <input id="join-name" className="field" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addMe()} autoFocus />
                </Field>
                <Button variant="primary" block onClick={addMe} disabled={!newName.trim()}>
                  M’ajouter au foyer
                </Button>
              </div>
            ) : (
              <Button variant="secondary" block icon={<UserPlus size={16} />} onClick={() => setAdding(true)}>
                Je ne suis pas dans la liste
              </Button>
            )}
          </div>
        ) : (
          <div className="card space-y-4 p-6">
            <h1 className="text-xl font-bold">Impossible de rejoindre le foyer</h1>
            <p className="text-sm text-muted">{error}</p>
            <div className="flex flex-wrap gap-2">
              {isValidSecret(code) && (
                <Button variant="primary" onClick={join}>
                  Réessayer
                </Button>
              )}
              <Button variant="secondary" onClick={() => navigate('/', true)}>
                Retour
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
