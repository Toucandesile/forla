import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { remove, save, uid } from '../db/db';
import type { Goal } from '../db/schema';
import { useData } from '../state';
import { addMonths, currentMonth, monthDiff, monthLabel, shortDate, todayISO } from '../lib/dates';
import { centsToInput, formatMoney, parseAmount } from '../lib/money';
import { AmountInput, Button, Card, EmptyState, Field, Money, PageHeader, Pill, Ring, Segmented, Sheet, Switch } from '../components/ui';

const EMOJIS = ['🏖️', '🛟', '🏠', '🚗', '🎓', '💍', '👶', '🎁', '💻', '✈️', '🛋️', '🌱'];

export default function Goals() {
  const { goals, contributions, balances, accountMap } = useData();
  const [editing, setEditing] = useState<Partial<Goal> | null>(null);
  const [moving, setMoving] = useState<{ goal: Goal; dir: 1 | -1 } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const saved = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of contributions) map.set(c.goalId, (map.get(c.goalId) ?? 0) + c.amount);
    return map;
  }, [contributions]);

  const savedFor = (g: Goal) => (g.accountId ? Math.max(0, balances.get(g.accountId) ?? 0) : (saved.get(g.id) ?? 0));
  const visible = goals.filter((g) => showArchived || !g.archived);
  const totalTarget = visible.filter((g) => !g.archived).reduce((a, g) => a + g.target, 0);
  const totalSaved = visible.filter((g) => !g.archived).reduce((a, g) => a + Math.min(g.target, savedFor(g)), 0);

  return (
    <div>
      <PageHeader
        title="Objectifs d’épargne"
        subtitle={totalTarget ? `${formatMoney(totalSaved, { round: true })} mis de côté sur ${formatMoney(totalTarget, { round: true })}` : 'Vacances, fonds d’urgence, projet…'}
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing({})}>
            Nouvel objectif
          </Button>
        }
      />
      {visible.length === 0 ? (
        <Card>
          <EmptyState icon="🎯" title="Aucun objectif" action={<Button variant="primary" onClick={() => setEditing({})}>Créer un objectif</Button>}>
            Conseil : commencez par un fonds d’urgence de 3 mois de dépenses essentielles.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((g) => {
            const s = savedFor(g);
            const ratio = g.target > 0 ? s / g.target : 0;
            const remaining = Math.max(0, g.target - s);
            const monthsLeft = g.targetDate ? Math.max(1, monthDiff(currentMonth(), g.targetDate.slice(0, 7))) : null;
            const perMonth = monthsLeft ? Math.ceil(remaining / monthsLeft) : null;
            // Rythme des 3 derniers mois
            const since = `${addMonths(currentMonth(), -3)}-01`;
            const recent = g.accountId ? null : contributions.filter((c) => c.goalId === g.id && c.date >= since).reduce((a, c) => a + c.amount, 0) / 3;
            const eta = recent && recent > 0 && remaining > 0 ? addMonths(currentMonth(), Math.ceil(remaining / recent)) : null;
            const late = !!(perMonth && recent != null && recent < perMonth * 0.9 && remaining > 0);
            return (
              <Card key={g.id} className={`p-5 ${g.archived ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-4">
                  <Ring ratio={ratio} size={64} stroke={7}>
                    {g.emoji}
                  </Ring>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="truncate font-semibold">{g.name}</h2>
                      <button type="button" className="-mt-1 -mr-1 rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label={`Modifier ${g.name}`} onClick={() => setEditing(g)}>
                        <Pencil size={15} />
                      </button>
                    </div>
                    <p className="text-2xl font-bold tracking-tight">
                      <Money value={s} round />
                    </p>
                    <p className="text-sm text-muted">
                      sur <Money value={g.target} round /> · {Math.min(100, Math.round(ratio * 100))} %
                    </p>
                  </div>
                </div>
                <div className="mt-4 space-y-1 text-sm">
                  {ratio >= 1 ? (
                    <Pill tone="good">Objectif atteint 🎉</Pill>
                  ) : (
                    <>
                      {g.targetDate && (
                        <p className="text-muted">
                          Échéance : <span className="text-ink">{shortDate(g.targetDate)}</span>
                          {perMonth != null && (
                            <>
                              {' '}
                              · <Money value={perMonth} round className="font-medium text-ink" />
                              /mois nécessaires
                            </>
                          )}
                        </p>
                      )}
                      {eta && <p className="text-muted">À ce rythme : atteint en {monthLabel(eta).toLowerCase()}</p>}
                      {late && <Pill tone="warn">Un peu en retard sur le rythme prévu</Pill>}
                      {g.accountId && <p className="text-xs text-muted">Suit le solde de « {accountMap.get(g.accountId)?.name} »</p>}
                    </>
                  )}
                </div>
                {!g.accountId && !g.archived && (
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" variant="soft" icon={<Plus size={14} />} onClick={() => setMoving({ goal: g, dir: 1 })} className="flex-1">
                      Verser
                    </Button>
                    <Button size="sm" variant="secondary" icon={<Minus size={14} />} onClick={() => setMoving({ goal: g, dir: -1 })}>
                      Retirer
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {goals.some((g) => g.archived) && (
        <button type="button" className="mt-4 w-full text-center text-sm text-muted hover:text-ink" onClick={() => setShowArchived((s) => !s)}>
          {showArchived ? 'Masquer' : 'Afficher'} les objectifs archivés
        </button>
      )}
      {editing && <GoalEditor initial={editing} onClose={() => setEditing(null)} />}
      {moving && <ContributionSheet goal={moving.goal} dir={moving.dir} onClose={() => setMoving(null)} />}
    </div>
  );
}

function GoalEditor({ initial, onClose }: { initial: Partial<Goal>; onClose: () => void }) {
  const { goals, accounts } = useData();
  const isEdit = !!initial.id;
  const [name, setName] = useState(initial.name ?? '');
  const [emoji, setEmoji] = useState(initial.emoji ?? EMOJIS[goals.length % EMOJIS.length]);
  const [targetRaw, setTargetRaw] = useState(initial.target ? centsToInput(initial.target) : '');
  const [targetDate, setTargetDate] = useState(initial.targetDate ?? '');
  const [mode, setMode] = useState<'manual' | 'account'>(initial.accountId ? 'account' : 'manual');
  const [accountId, setAccountId] = useState(initial.accountId ?? accounts.find((a) => a.type === 'savings')?.id ?? accounts[0]?.id ?? '');
  const [archived, setArchived] = useState(initial.archived ?? false);

  async function submit() {
    const target = parseAmount(targetRaw);
    if (!name.trim()) return toast.error('Donnez un nom à l’objectif.');
    if (target == null || target <= 0) return toast.error('Montant cible invalide.');
    await save('goals', {
      ...(initial as Goal),
      id: initial.id ?? uid(),
      name: name.trim(),
      emoji,
      target,
      targetDate: targetDate || null,
      accountId: mode === 'account' ? accountId || null : null,
      archived,
      order: initial.order ?? goals.length,
    });
    toast.success(isEdit ? 'Objectif modifié' : 'Objectif créé');
    onClose();
  }

  async function onDelete() {
    if (!initial.id) return;
    await remove('goals', initial.id);
    toast('Objectif supprimé');
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={isEdit ? 'Modifier l’objectif' : 'Nouvel objectif'}
      footer={
        <div className="flex items-center gap-2">
          {isEdit && (
            <Button variant="danger" icon={<Trash2 size={16} />} onClick={onDelete}>
              Supprimer
            </Button>
          )}
          <Button variant="primary" className="ml-auto min-w-[8rem]" onClick={submit}>
            Enregistrer
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Nom" htmlFor="g-name">
          <input id="g-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Vacances d’été" />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(e)}
              className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl ${emoji === e ? 'bg-primary-soft ring-2 ring-primary' : 'bg-surface-2'}`}
              aria-pressed={emoji === e}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Montant cible" htmlFor="g-target">
            <AmountInput id="g-target" value={targetRaw} onChange={setTargetRaw} placeholder="0" />
          </Field>
          <Field label="Date cible (facultatif)" htmlFor="g-date">
            <input id="g-date" type="date" className="field" value={targetDate} min={todayISO()} onChange={(e) => setTargetDate(e.target.value)} />
          </Field>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-muted">Suivi de l’avancement</p>
          <Segmented
            value={mode}
            onChange={setMode}
            className="w-full"
            ariaLabel="Suivi"
            options={[
              { value: 'manual', label: 'Versements manuels' },
              { value: 'account', label: 'Solde d’un compte' },
            ]}
          />
          {mode === 'account' && (
            <select className="field mt-2" aria-label="Compte suivi" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts
                .filter((a) => !a.archived)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          )}
        </div>
        {isEdit && (
          <div className="rounded-2xl border border-line px-3">
            <Switch checked={archived} onChange={setArchived} label="Archiver" description="Objectif terminé ou abandonné" />
          </div>
        )}
      </div>
    </Sheet>
  );
}

function ContributionSheet({ goal, dir, onClose }: { goal: Goal; dir: 1 | -1; onClose: () => void }) {
  const [raw, setRaw] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  async function submit() {
    const v = parseAmount(raw);
    if (v == null || v <= 0) return toast.error('Montant invalide');
    await save('contributions', { goalId: goal.id, date, amount: v * dir, note });
    toast.success(dir > 0 ? `${formatMoney(v)} versés sur « ${goal.name} »` : `${formatMoney(v)} retirés`);
    onClose();
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${dir > 0 ? 'Verser sur' : 'Retirer de'} « ${goal.name} »`}
      footer={
        <div className="flex justify-end">
          <Button variant="primary" onClick={submit}>
            Valider
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Montant" htmlFor="c-amount">
          <AmountInput id="c-amount" large value={raw} onChange={setRaw} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" htmlFor="c-date">
            <input id="c-date" type="date" className="field" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          <Field label="Note" htmlFor="c-note">
            <input id="c-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-muted">Pensez à faire le virement correspondant vers votre compte épargne : vous pouvez le saisir comme « Virement » dans les opérations.</p>
      </div>
    </Sheet>
  );
}
