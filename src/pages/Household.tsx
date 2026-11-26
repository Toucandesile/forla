import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight, HandCoins, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { remove, save, setSetting, uid } from '../db/db';
import { MEMBER_COLORS } from '../db/seed';
import type { Member, Settlement, SplitMode } from '../db/schema';
import { useData, usePrefs } from '../state';
import { currentMonth, monthEnd, monthLabel, monthStart, shortDate, todayISO } from '../lib/dates';
import { centsToInput, formatMoney, formatPercent, parseAmount } from '../lib/money';
import { isShared, memberBalances, memberShareOfSpending, settleUp } from '../lib/split';
import { HBarList } from '../components/charts';
import { AmountInput, Avatar, Button, Card, CardHeader, EmptyState, Field, Money, MonthNav, PageHeader, Segmented, Sheet, Switch, cn } from '../components/ui';
import { TxRow, sortTx } from '../components/TxList';

const EMOJIS = ['🦊', '🐻', '🐼', '🦁', '🐨', '🐯', '🐸', '🦉', '🐙', '🦄', '🐶', '🐱', '🐰', '🐵', '🐧', '🐢'];

export default function Household() {
  const data = useData();
  const { members, activeMembers, transactions, settlements, memberMap, settings } = data;
  const [prefs, setPref] = usePrefs();
  const [editing, setEditing] = useState<Partial<Member> | null>(null);
  const [settling, setSettling] = useState<{ from: string; to: string; amount: number } | null>(null);
  const [month, setMonth] = useState(currentMonth());

  const balances = useMemo(() => memberBalances(transactions, settlements, members), [transactions, settlements, members]);
  const transfers = useMemo(() => settleUp(balances), [balances]);
  const shares = useMemo(() => memberShareOfSpending(transactions, activeMembers, monthStart(month), monthEnd(month)), [transactions, activeMembers, month]);
  const shared = useMemo(() => transactions.filter((t) => isShared(t) && t.date.startsWith(month)).sort(sortTx), [transactions, month]);
  const totalWeight = activeMembers.reduce((a, m) => a + Math.max(0, m.weight || 0), 0);
  const totalShares = [...shares.values()].reduce((a, b) => a + b, 0);

  return (
    <div>
      <PageHeader
        title={settings.householdName}
        subtitle="Qui paie quoi, et qui doit combien"
        actions={
          <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setEditing({})}>
            Ajouter un membre
          </Button>
        }
      />

      {activeMembers.length === 0 ? (
        <Card>
          <EmptyState icon="👥" title="Aucun membre" action={<Button variant="primary" onClick={() => setEditing({})}>Ajouter un membre</Button>}>
            Ajoutez les personnes du foyer pour suivre qui a payé quoi et partager les dépenses.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card>
              <CardHeader title="Équilibre des comptes" icon={<HandCoins size={16} className="text-primary" />} subtitle="Dépenses communes avancées par un membre" />
              <div className="px-5 pb-5">
                <div className="mb-4 grid gap-2 sm:grid-cols-2">
                  {activeMembers.map((m) => {
                    const b = balances.get(m.id) ?? 0;
                    return (
                      <div key={m.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
                        <Avatar member={m} size={36} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{m.name}</p>
                          <p className={cn('text-sm', b > 0 && 'text-success', b < 0 && 'text-danger', b === 0 && 'text-muted')}>
                            {b > 0 ? 'On lui doit ' : b < 0 ? 'Doit ' : 'À l’équilibre'}
                            {b !== 0 && <Money value={Math.abs(b)} className="font-semibold" />}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {transfers.length === 0 ? (
                  <p className="text-sm text-muted">Tout le monde est à l’équilibre ✨</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Pour équilibrer :</p>
                    {transfers.map((t) => (
                      <div key={t.from + t.to} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line p-3">
                        <Avatar member={memberMap.get(t.from)} size={28} />
                        <ArrowRight size={16} className="text-muted" />
                        <Avatar member={memberMap.get(t.to)} size={28} />
                        <span className="min-w-0 flex-1 text-sm">
                          <strong>{memberMap.get(t.from)?.name}</strong> rembourse <Money value={t.amount} className="font-semibold" /> à{' '}
                          <strong>{memberMap.get(t.to)?.name}</strong>
                        </span>
                        <Button size="sm" variant="soft" onClick={() => setSettling(t)}>
                          C’est réglé
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-2">
                <div>
                  <h2 className="text-[15px] font-semibold">Part de chacun dans les dépenses</h2>
                  <p className="text-sm text-muted">Dépenses personnelles + part des dépenses partagées</p>
                </div>
                <MonthNav month={month} onChange={setMonth} />
              </div>
              <div className="px-3 pb-4">
                <HBarList
                  total={totalShares}
                  items={[
                    ...activeMembers.map((m) => ({
                      key: m.id,
                      label: (
                        <>
                          <Avatar member={m} size={22} /> {m.name}
                        </>
                      ),
                      value: shares.get(m.id) ?? 0,
                    })),
                    {
                      key: 'common',
                      label: (
                        <>
                          <Avatar member={null} size={22} /> Compte commun
                        </>
                      ),
                      value: shares.get('common') ?? 0,
                    },
                  ].filter((i) => i.value > 0)}
                />
                {totalShares === 0 && <p className="px-2 text-sm text-muted">Aucune dépense en {monthLabel(month).toLowerCase()}.</p>}
              </div>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader title="Dépenses partagées" subtitle={monthLabel(month)} />
              {shared.length ? (
                <div className="divide-y divide-line/60 pb-2">
                  {shared.map((t) => (
                    <TxRow key={t.id} tx={t} showDate />
                  ))}
                </div>
              ) : (
                <p className="px-5 pb-5 text-sm text-muted">Aucune dépense partagée ce mois-ci. Lors de la saisie, choisissez « Payé par » un membre puis le mode de partage.</p>
              )}
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Membres" />
              <ul className="divide-y divide-line/60 pb-2">
                {members
                  .filter((m) => !m.archived)
                  .map((m) => (
                    <li key={m.id} className="flex items-center gap-3 px-5 py-2.5">
                      <Avatar member={m} size={34} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {m.name} {prefs.meId === m.id && <span className="text-xs font-normal text-muted">(cet appareil)</span>}
                        </p>
                        {totalWeight > 0 && activeMembers.length > 1 && (
                          <p className="text-xs text-muted">Prorata : {formatPercent(((m.weight || 0) / totalWeight) * 100)}</p>
                        )}
                      </div>
                      <button type="button" className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label={`Modifier ${m.name}`} onClick={() => setEditing(m)}>
                        <Pencil size={16} />
                      </button>
                    </li>
                  ))}
              </ul>
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 text-[15px] font-semibold">Préférences</h2>
              <Field label="Partage par défaut des dépenses avancées" htmlFor="def-split">
                <select
                  id="def-split"
                  className="field"
                  value={settings.defaultSplit}
                  onChange={(e) => setSetting('defaultSplit', e.target.value as SplitMode)}
                >
                  <option value="equal">Parts égales</option>
                  <option value="prorata">Au prorata des revenus</option>
                  <option value="none">Personnel (pas de partage)</option>
                </select>
              </Field>
              <Field label="Qui utilise cet appareil ?" htmlFor="me" className="mt-4" hint="Sert à personnaliser l’accueil et le payeur par défaut.">
                <select id="me" className="field" value={prefs.meId ?? ''} onChange={(e) => setPref('meId', e.target.value || null)}>
                  <option value="">—</option>
                  {activeMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.emoji} {m.name}
                    </option>
                  ))}
                </select>
              </Field>
            </Card>

            <Card>
              <CardHeader title="Remboursements" />
              {settlements.length ? (
                <ul className="divide-y divide-line/60 pb-2">
                  {[...settlements]
                    .sort((a, b) => (a.date < b.date ? 1 : -1))
                    .slice(0, 20)
                    .map((s) => (
                      <li key={s.id} className="flex items-center gap-2 px-5 py-2 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            {memberMap.get(s.fromId)?.name} → {memberMap.get(s.toId)?.name}
                          </span>
                          <span className="block text-xs text-muted">
                            {shortDate(s.date)}
                            {s.note && ` · ${s.note}`}
                          </span>
                        </span>
                        <Money value={s.amount} className="font-medium" />
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-muted hover:text-danger"
                          aria-label="Supprimer ce remboursement"
                          onClick={async () => {
                            await remove('settlements', s.id);
                            toast('Remboursement supprimé', { action: { label: 'Annuler', onClick: () => save('settlements', s) } });
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="px-5 pb-5 text-sm text-muted">Aucun remboursement enregistré.</p>
              )}
              <div className="px-5 pb-4">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus size={14} />}
                  onClick={() => activeMembers.length > 1 && setSettling({ from: activeMembers[0].id, to: activeMembers[1].id, amount: 0 })}
                  disabled={activeMembers.length < 2}
                >
                  Saisir un remboursement
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {editing && <MemberEditor initial={editing} onClose={() => setEditing(null)} />}
      {settling && <SettleSheet initial={settling} onClose={() => setSettling(null)} />}
    </div>
  );
}

function MemberEditor({ initial, onClose }: { initial: Partial<Member>; onClose: () => void }) {
  const { members } = useData();
  const isEdit = !!initial.id;
  const [name, setName] = useState(initial.name ?? '');
  const [emoji, setEmoji] = useState(initial.emoji ?? EMOJIS[members.length % EMOJIS.length]);
  const [color, setColor] = useState(initial.color ?? MEMBER_COLORS[members.length % MEMBER_COLORS.length]);
  const [weightRaw, setWeightRaw] = useState(initial.weight != null && initial.weight !== 1 ? centsToInput(initial.weight * 100) : '');
  const [archived, setArchived] = useState(initial.archived ?? false);

  async function submit() {
    if (!name.trim()) return toast.error('Indiquez un prénom.');
    const w = weightRaw ? (parseAmount(weightRaw) ?? 100) / 100 : 1;
    await save('members', {
      ...(initial as Member),
      id: initial.id ?? uid(),
      name: name.trim(),
      emoji,
      color,
      weight: Math.max(0, w),
      archived,
      order: initial.order ?? members.length,
    });
    toast.success(isEdit ? 'Membre modifié' : 'Membre ajouté');
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={isEdit ? 'Modifier le membre' : 'Nouveau membre'}
      footer={
        <div className="flex justify-end">
          <Button variant="primary" onClick={submit} className="min-w-[8rem]">
            Enregistrer
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Prénom" htmlFor="m-name">
          <input id="m-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-muted">Avatar</p>
          <div className="flex flex-wrap gap-1.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                className={cn('flex h-10 w-10 items-center justify-center rounded-xl text-xl', emoji === e ? 'bg-primary-soft ring-2 ring-primary' : 'bg-surface-2')}
                aria-pressed={emoji === e}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-muted">Couleur</p>
          <div className="flex flex-wrap gap-2">
            {MEMBER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn('h-8 w-8 rounded-full ring-offset-2 ring-offset-surface', color === c && 'ring-2 ring-ink')}
                style={{ background: c }}
                aria-label={`Couleur ${c}`}
                aria-pressed={color === c}
              />
            ))}
          </div>
        </div>
        <Field label="Revenu mensuel net (facultatif)" htmlFor="m-weight" hint="Utilisé pour le partage « au prorata des revenus ». Reste privé sur vos appareils.">
          <AmountInput id="m-weight" value={weightRaw} onChange={setWeightRaw} placeholder="Ex. 2 100" />
        </Field>
        {isEdit && (
          <div className="rounded-2xl border border-line px-3">
            <Switch checked={archived} onChange={setArchived} label="Ne fait plus partie du foyer" description="Le membre est masqué, l’historique est conservé." />
          </div>
        )}
      </div>
    </Sheet>
  );
}

function SettleSheet({ initial, onClose }: { initial: { from: string; to: string; amount: number }; onClose: () => void }) {
  const { activeMembers } = useData();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [raw, setRaw] = useState(initial.amount ? centsToInput(initial.amount) : '');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'virement' | 'especes' | 'autre'>('virement');

  async function submit() {
    const amount = parseAmount(raw);
    if (amount == null || amount <= 0) return toast.error('Montant invalide');
    if (from === to) return toast.error('Choisissez deux membres différents');
    const label = { virement: 'Virement', especes: 'Espèces', autre: '' }[mode];
    await save('settlements', { date, fromId: from, toId: to, amount, note: [label, note].filter(Boolean).join(' · ') } as Omit<Settlement, 'id' | 'createdAt' | 'updatedAt'>);
    toast.success(`Remboursement de ${formatMoney(amount)} enregistré`);
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Enregistrer un remboursement"
      footer={
        <div className="flex justify-end">
          <Button variant="primary" onClick={submit}>
            Enregistrer
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="De" htmlFor="s-from">
            <select id="s-from" className="field" value={from} onChange={(e) => setFrom(e.target.value)}>
              {activeMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.emoji} {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="À" htmlFor="s-to">
            <select id="s-to" className="field" value={to} onChange={(e) => setTo(e.target.value)}>
              {activeMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.emoji} {m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Montant" htmlFor="s-amount">
          <AmountInput id="s-amount" large value={raw} onChange={setRaw} />
        </Field>
        <Segmented
          value={mode}
          onChange={setMode}
          className="w-full"
          ariaLabel="Moyen"
          options={[
            { value: 'virement', label: 'Virement' },
            { value: 'especes', label: 'Espèces' },
            { value: 'autre', label: 'Autre' },
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" htmlFor="s-date">
            <input id="s-date" type="date" className="field" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          <Field label="Note" htmlFor="s-note">
            <input id="s-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}
