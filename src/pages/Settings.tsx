import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileSpreadsheet,
  FileUp,
  HardDrive,
  KeyRound,
  Monitor,
  Moon,
  Plus,
  Share2,
  Smartphone,
  Sun,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { patch, remove, requestPersistence, save, saveMany, setSetting, uid } from '../db/db';
import { seedDemo } from '../db/seed';
import type { Category, CategoryGroup, Rule } from '../db/schema';
import { useData, usePrefs } from '../state';
import {
  backupFileName,
  cryptoAvailable,
  decryptBackup,
  downloadBlob,
  encryptBackup,
  exportAll,
  hashPin,
  isBackup,
  isEncrypted,
  restoreMerge,
  restoreReplace,
  shareOrDownload,
  transactionsToCSV,
  wipeAll,
  type BackupFile,
} from '../lib/backup';
import { matchRule } from '../lib/importers';
import { canInstall, isIOS, isStandalone, onInstallChange, promptInstall } from '../lib/install';
import { Button, Card, Field, PageHeader, Segmented, Sheet, Switch, cn } from '../components/ui';
import { ImportWizard } from '../components/ImportWizard';
import { SyncPanel } from '../components/SyncPanel';
import { disableSync } from '../lib/sync';

const CURRENCIES = [
  ['EUR', 'Euro (€)'],
  ['CHF', 'Franc suisse (CHF)'],
  ['CAD', 'Dollar canadien ($ CA)'],
  ['USD', 'Dollar américain ($)'],
  ['GBP', 'Livre sterling (£)'],
  ['XOF', 'Franc CFA (F CFA)'],
  ['MAD', 'Dirham marocain (MAD)'],
];

function Section({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <Card className="p-5">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="mt-0.5 mb-4 text-sm text-muted">{description}</p>}
        {!description && <div className="mb-3" />}
        {children}
      </Card>
    </section>
  );
}

export default function SettingsPage() {
  const { settings } = useData();
  const [prefs, setPref] = usePrefs();
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div>
      <PageHeader title="Réglages" subtitle="Vos données restent sur cet appareil. Rien n’est envoyé sur Internet." />
      <div className="mb-5 flex flex-wrap gap-2 text-sm">
        {[
          ['#sync', 'Synchronisation'],
          ['#import', 'Importer'],
          ['#sauvegarde', 'Sauvegarde'],
          ['#categories', 'Catégories'],
          ['#regles', 'Règles'],
          ['#securite', 'Sécurité'],
          ['#app', 'Application'],
        ].map(([h, l]) => (
          <button
            key={h}
            type="button"
            className="rounded-full border border-line bg-surface px-3 py-1 hover:bg-surface-2"
            onClick={() => document.querySelector(h)?.scrollIntoView({ behavior: 'smooth' })}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Section id="foyer" title="Foyer">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom du foyer" htmlFor="s-name">
                <input
                  id="s-name"
                  className="field"
                  defaultValue={settings.householdName}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== settings.householdName && setSetting('householdName', e.target.value.trim())}
                />
              </Field>
              <Field label="Devise" htmlFor="s-cur">
                <select id="s-cur" className="field" value={settings.currency} onChange={(e) => setSetting('currency', e.target.value)}>
                  {CURRENCIES.map(([c, l]) => (
                    <option key={c} value={c}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>

          <Section id="sync" title="Synchronisation entre appareils" description="Partagez le même foyer sur plusieurs téléphones (couple, colocation), automatiquement.">
            <SyncPanel />
          </Section>

          <Section id="import" title="Importer un relevé bancaire" description="CSV, OFX ou QIF depuis votre banque. Catégorisation automatique et détection des doublons.">
            <Button variant="primary" icon={<FileUp size={16} />} onClick={() => setImportOpen(true)}>
              Importer un fichier
            </Button>
          </Section>

          <BackupSection />

          <Section id="apparence" title="Apparence">
            <Segmented
              value={prefs.theme}
              onChange={(v) => setPref('theme', v)}
              ariaLabel="Thème"
              options={[
                { value: 'system', label: <span className="flex items-center gap-1.5"><Monitor size={14} /> Système</span> },
                { value: 'light', label: <span className="flex items-center gap-1.5"><Sun size={14} /> Clair</span> },
                { value: 'dark', label: <span className="flex items-center gap-1.5"><Moon size={14} /> Sombre</span> },
              ]}
            />
            <div className="mt-3 rounded-2xl border border-line px-3">
              <Switch
                checked={prefs.hideAmounts}
                onChange={(v) => setPref('hideAmounts', v)}
                label="Mode discret"
                description="Floute les montants (pratique en public). Aussi accessible via l’icône 👁."
              />
            </div>
          </Section>

          <SecuritySection />
        </div>

        <div className="space-y-5">
          <CategoriesSection />
          <RulesSection />
          <AppSection />
          <DangerSection />
        </div>
      </div>
      <ImportWizard open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sauvegarde & synchronisation                                        */
/* ------------------------------------------------------------------ */

function BackupSection() {
  const { transactions, accountMap, categoryMap, memberMap } = useData();
  const [prefs, setPref] = usePrefs();
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [encPending, setEncPending] = useState<unknown>(null);
  const [decryptPwd, setDecryptPwd] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function makeBlob(): Promise<Blob | null> {
    const data = await exportAll();
    if (encrypt) {
      if (password.length < 6) {
        toast.error('Choisissez un mot de passe d’au moins 6 caractères.');
        return null;
      }
      const enc = await encryptBackup(data, password);
      return new Blob([JSON.stringify(enc)], { type: 'application/json' });
    }
    return new Blob([JSON.stringify(data)], { type: 'application/json' });
  }

  async function onExport(share: boolean) {
    const blob = await makeBlob();
    if (!blob) return;
    const name = backupFileName(encrypt ? 'forla-sauvegarde-chiffree' : 'forla-sauvegarde');
    if (share) await shareOrDownload(blob, name, 'Sauvegarde Forla');
    else downloadBlob(blob, name);
    setPref('lastBackupAt', Date.now());
    toast.success('Sauvegarde créée');
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (isEncrypted(json)) setEncPending(json);
      else if (isBackup(json)) setPending(json);
      else toast.error('Ce fichier n’est pas une sauvegarde Forla.');
    } catch {
      toast.error('Fichier illisible.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onDecrypt() {
    try {
      const data = await decryptBackup(encPending as never, decryptPwd);
      setEncPending(null);
      setDecryptPwd('');
      setPending(data);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function apply(mode: 'merge' | 'replace') {
    if (!pending) return;
    if (mode === 'merge') {
      const r = await restoreMerge(pending);
      toast.success(`Fusion terminée : ${r.added} ajout(s), ${r.updated} mise(s) à jour, ${r.deleted} suppression(s)`);
    } else {
      await restoreReplace(pending);
      toast.success('Sauvegarde restaurée');
    }
    setPending(null);
  }

  const last = prefs.lastBackupAt ? new Date(prefs.lastBackupAt) : null;
  return (
    <Section
      id="sauvegarde"
      title="Sauvegarde"
      description="Exportez régulièrement vos données en lieu sûr. « Fusionner » permet aussi d’échanger des données entre appareils sans synchronisation automatique."
    >
      <p className="mb-3 text-sm">
        Dernière sauvegarde :{' '}
        <strong>{last ? last.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'jamais'}</strong>
      </p>
      {cryptoAvailable() && (
        <div className="mb-3 rounded-2xl border border-line px-3">
          <Switch checked={encrypt} onChange={setEncrypt} label="Chiffrer la sauvegarde" description="AES-256 : illisible sans le mot de passe" />
          {encrypt && (
            <div className="pb-3">
              <input
                type="password"
                className="field"
                placeholder="Mot de passe (6 caractères min.)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                aria-label="Mot de passe de la sauvegarde"
              />
              <p className="mt-1 text-xs text-warning-ink">Sans ce mot de passe, la sauvegarde ne pourra pas être restaurée.</p>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<Download size={16} />} onClick={() => onExport(false)}>
          Télécharger
        </Button>
        <Button variant="secondary" icon={<Share2 size={16} />} onClick={() => onExport(true)}>
          Partager
        </Button>
        <Button variant="secondary" icon={<Upload size={16} />} onClick={() => fileRef.current?.click()}>
          Restaurer / fusionner
        </Button>
        <Button
          variant="ghost"
          icon={<FileSpreadsheet size={16} />}
          onClick={() =>
            downloadBlob(
              transactionsToCSV(transactions, {
                account: (id) => (id ? accountMap.get(id)?.name ?? '' : ''),
                category: (id) => (id ? categoryMap.get(id)?.name ?? '' : ''),
                member: (id) => (id ? memberMap.get(id)?.name ?? '' : ''),
              }),
              backupFileName('forla-operations', 'csv'),
            )
          }
        >
          Export Excel (CSV)
        </Button>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>

      <Sheet open={!!encPending} onClose={() => setEncPending(null)} title="Sauvegarde chiffrée">
        <div className="space-y-3">
          <Field label="Mot de passe" htmlFor="dec-pwd">
            <input id="dec-pwd" type="password" className="field" value={decryptPwd} onChange={(e) => setDecryptPwd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onDecrypt()} />
          </Field>
          <Button variant="primary" onClick={onDecrypt} block>
            Déchiffrer
          </Button>
        </div>
      </Sheet>

      <Sheet open={!!pending} onClose={() => setPending(null)} title="Que faire de cette sauvegarde ?">
        {pending && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Sauvegarde du {new Date(pending.exportedAt).toLocaleString('fr-FR')} · {pending.data.transactions?.length ?? 0} opérations
            </p>
            <button type="button" className="w-full rounded-2xl border border-line p-4 text-left hover:bg-surface-2" onClick={() => apply('merge')}>
              <span className="block font-semibold">Fusionner (recommandé)</span>
              <span className="block text-sm text-muted">Combine avec vos données : la version la plus récente de chaque élément est conservée. Idéal pour synchroniser deux téléphones.</span>
            </button>
            <button type="button" className="w-full rounded-2xl border border-danger/40 p-4 text-left hover:bg-danger-soft" onClick={() => apply('replace')}>
              <span className="block font-semibold text-danger">Tout remplacer</span>
              <span className="block text-sm text-muted">Efface les données actuelles de cet appareil et restaure la sauvegarde telle quelle.</span>
            </button>
          </div>
        )}
      </Sheet>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Sécurité                                                            */
/* ------------------------------------------------------------------ */

function SecuritySection() {
  const [prefs, setPref] = usePrefs();
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');

  async function savePin() {
    if (!/^\d{4,6}$/.test(pin)) return toast.error('Le code doit comporter 4 à 6 chiffres.');
    if (pin !== confirm) return toast.error('Les deux codes ne correspondent pas.');
    const { hash, salt } = await hashPin(pin);
    setPref('pinSalt', salt);
    setPref('pinHash', hash);
    setEditing(false);
    setPin('');
    setConfirm('');
    toast.success('Code de verrouillage activé');
  }

  return (
    <Section id="securite" title="Sécurité" description="Un code protège l’accès à Forla sur cet appareil (verrouillage après 5 min en arrière-plan).">
      {!cryptoAvailable() ? (
        <p className="text-sm text-muted">Disponible uniquement lorsque l’application est servie en HTTPS.</p>
      ) : prefs.pinHash ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<KeyRound size={16} />} onClick={() => setEditing(true)}>
            Changer le code
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setPref('pinHash', null);
              setPref('pinSalt', null);
              toast('Code désactivé');
            }}
          >
            Désactiver
          </Button>
        </div>
      ) : (
        <Button variant="secondary" icon={<KeyRound size={16} />} onClick={() => setEditing(true)}>
          Définir un code
        </Button>
      )}
      <Sheet
        open={editing}
        onClose={() => setEditing(false)}
        title="Code de verrouillage"
        footer={
          <div className="flex justify-end">
            <Button variant="primary" onClick={savePin}>
              Enregistrer
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Nouveau code (4 à 6 chiffres)" htmlFor="pin1">
            <input id="pin1" type="password" inputMode="numeric" maxLength={6} className="field tabular text-center text-2xl tracking-[0.5em]" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Confirmez le code" htmlFor="pin2">
            <input id="pin2" type="password" inputMode="numeric" maxLength={6} className="field tabular text-center text-2xl tracking-[0.5em]" value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
      </Sheet>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Catégories                                                          */
/* ------------------------------------------------------------------ */

function CategoriesSection() {
  const { groups, categories, transactions } = useData();
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  const [editingGroup, setEditingGroup] = useState<Partial<CategoryGroup> | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  async function move(c: Category, dir: -1 | 1) {
    const siblings = categories.filter((x) => x.groupId === c.groupId).sort((a, b) => a.order - b.order);
    const i = siblings.findIndex((x) => x.id === c.id);
    const j = i + dir;
    if (j < 0 || j >= siblings.length) return;
    await saveMany('categories', [
      { ...c, order: siblings[j].order },
      { ...siblings[j], order: c.order },
    ]);
  }

  return (
    <Section id="categories" title="Catégories" description="« Essentielle » alimente l’analyse besoins / envies ; « Report » cumule le reste d’un mois sur l’autre.">
      <div className="space-y-4">
        {groups.map((g) => {
          const cats = categories.filter((c) => c.groupId === g.id && (showArchived || !c.archived));
          return (
            <div key={g.id}>
              <div className="mb-1 flex items-center justify-between">
                <button type="button" className="flex items-center gap-2 text-sm font-semibold hover:underline" onClick={() => setEditingGroup(g)}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                  {g.name}
                  <span className="text-xs font-normal text-faint">{g.kind === 'income' ? 'revenus' : ''}</span>
                </button>
                <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setEditing({ groupId: g.id, kind: g.kind })}>
                  Ajouter
                </Button>
              </div>
              <ul className="divide-y divide-line/60 rounded-2xl border border-line">
                {cats.map((c, i) => (
                  <li key={c.id} className={cn('flex items-center gap-2 px-3 py-1.5 text-sm', c.archived && 'opacity-50')}>
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setEditing(c)}>
                      <span aria-hidden>{c.emoji}</span>
                      <span className="truncate">{c.name}</span>
                      {c.essential && <span className="rounded bg-surface-2 px-1.5 text-[10px] text-muted">essentielle</span>}
                      {c.rollover && <span className="rounded bg-surface-2 px-1.5 text-[10px] text-muted">report</span>}
                    </button>
                    <button type="button" className="rounded p-1 text-faint hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => move(c, -1)} aria-label={`Monter ${c.name}`}>
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-faint hover:text-ink disabled:opacity-30"
                      disabled={i === cats.length - 1}
                      onClick={() => move(c, 1)}
                      aria-label={`Descendre ${c.name}`}
                    >
                      <ArrowDown size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setEditingGroup({ kind: 'expense' })}>
            Nouveau groupe
          </Button>
          {categories.some((c) => c.archived) && (
            <Button size="sm" variant="ghost" onClick={() => setShowArchived((s) => !s)}>
              {showArchived ? 'Masquer' : 'Afficher'} les archivées
            </Button>
          )}
        </div>
      </div>
      {editing && <CategoryEditor initial={editing} usage={transactions.filter((t) => t.categoryId === editing.id).length} onClose={() => setEditing(null)} />}
      {editingGroup && <GroupEditor initial={editingGroup} onClose={() => setEditingGroup(null)} />}
    </Section>
  );
}

const EMOJI_CHOICES = '🛒 🍽️ 🏠 ⚡ 💧 📶 🛡️ 🔧 💊 🧴 👕 🐾 ⛽ 🚇 🚗 🅿️ 🎒 ⚽ 🧸 🎬 ✈️ 📺 🏋️ 🎁 🛍️ 🧾 🏦 💝 📦 💼 🏛️ 💰 🍷 ☕ 🎮 📚 💇 🧹 🌱 🚲 🏥 👶 🎓 💻 📱 🎵 🍼 🐶'.split(' ');

function CategoryEditor({ initial, usage, onClose }: { initial: Partial<Category>; usage: number; onClose: () => void }) {
  const { groups, categories } = useData();
  const isEdit = !!initial.id;
  const [name, setName] = useState(initial.name ?? '');
  const [emoji, setEmoji] = useState(initial.emoji ?? '📦');
  const [groupId, setGroupId] = useState(initial.groupId ?? groups[0]?.id ?? '');
  const [essential, setEssential] = useState(initial.essential ?? false);
  const [rollover, setRollover] = useState(initial.rollover ?? false);
  const [archived, setArchived] = useState(initial.archived ?? false);
  const group = groups.find((g) => g.id === groupId);

  async function submit() {
    if (!name.trim()) return toast.error('Donnez un nom à la catégorie.');
    await save('categories', {
      ...(initial as Category),
      id: initial.id ?? uid(),
      name: name.trim(),
      emoji,
      groupId,
      kind: group?.kind ?? 'expense',
      essential,
      rollover,
      archived,
      order: initial.order ?? (group ? groups.indexOf(group) * 100 + categories.filter((c) => c.groupId === groupId).length : 999),
    });
    onClose();
  }

  async function onDelete() {
    if (!initial.id) return;
    if (usage > 0) return toast.error(`Utilisée par ${usage} opération(s) : archivez-la plutôt.`);
    await remove('categories', initial.id);
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={isEdit ? 'Modifier la catégorie' : 'Nouvelle catégorie'}
      footer={
        <div className="flex items-center gap-2">
          {isEdit && (
            <Button variant="danger" icon={<Trash2 size={16} />} onClick={onDelete}>
              Supprimer
            </Button>
          )}
          <Button variant="primary" className="ml-auto" onClick={submit}>
            Enregistrer
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <Field label="Icône" htmlFor="c-emoji">
            <input id="c-emoji" className="field w-16 text-center text-xl" value={emoji} onChange={(e) => setEmoji([...e.target.value].slice(-2).join('') || '📦')} />
          </Field>
          <Field label="Nom" htmlFor="c-name">
            <input id="c-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-1">
          {EMOJI_CHOICES.map((e) => (
            <button key={e} type="button" className={cn('h-9 w-9 rounded-lg text-lg', emoji === e ? 'bg-primary-soft ring-2 ring-primary' : 'hover:bg-surface-2')} onClick={() => setEmoji(e)}>
              {e}
            </button>
          ))}
        </div>
        <Field label="Groupe" htmlFor="c-group">
          <select id="c-group" className="field" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="divide-y divide-line rounded-2xl border border-line px-3">
          {group?.kind !== 'income' && (
            <>
              <Switch checked={essential} onChange={setEssential} label="Dépense essentielle" description="Besoin (logement, alimentation…) plutôt qu’envie" />
              <Switch checked={rollover} onChange={setRollover} label="Report du reste" description="L’enveloppe cumule d’un mois sur l’autre" />
            </>
          )}
          {isEdit && <Switch checked={archived} onChange={setArchived} label="Archiver" description="Masquée des listes, historique conservé" />}
        </div>
      </div>
    </Sheet>
  );
}

function GroupEditor({ initial, onClose }: { initial: Partial<CategoryGroup>; onClose: () => void }) {
  const { groups, categories } = useData();
  const isEdit = !!initial.id;
  const [name, setName] = useState(initial.name ?? '');
  const [color, setColor] = useState(initial.color ?? '#64748b');
  const [kind, setKind] = useState(initial.kind ?? 'expense');
  const COLORS = ['#257de0', '#0f9d76', '#f47230', '#ee7fac', '#6a4ce2', '#64748b', '#16a34a', '#f2a600', '#ec4647'];

  async function submit() {
    if (!name.trim()) return toast.error('Nom requis');
    await save('groups', { ...(initial as CategoryGroup), id: initial.id ?? uid(), name: name.trim(), color, kind, order: initial.order ?? groups.length });
    onClose();
  }
  async function onDelete() {
    if (!initial.id) return;
    if (categories.some((c) => c.groupId === initial.id)) return toast.error('Déplacez ou supprimez d’abord ses catégories.');
    await remove('groups', initial.id);
    onClose();
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={isEdit ? 'Modifier le groupe' : 'Nouveau groupe'}
      footer={
        <div className="flex items-center gap-2">
          {isEdit && (
            <Button variant="danger" icon={<Trash2 size={16} />} onClick={onDelete}>
              Supprimer
            </Button>
          )}
          <Button variant="primary" className="ml-auto" onClick={submit}>
            Enregistrer
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Nom" htmlFor="g-name">
          <input id="g-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {!isEdit && (
          <Segmented
            value={kind}
            onChange={setKind}
            ariaLabel="Type"
            options={[
              { value: 'expense', label: 'Dépenses' },
              { value: 'income', label: 'Revenus' },
            ]}
          />
        )}
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={cn('h-8 w-8 rounded-full ring-offset-2 ring-offset-surface', color === c && 'ring-2 ring-ink')}
              style={{ background: c }}
              aria-label={`Couleur ${c}`}
            />
          ))}
        </div>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Règles de catégorisation                                            */
/* ------------------------------------------------------------------ */

function RulesSection() {
  const { rules, categories, categoryMap, transactions } = useData();
  const [pattern, setPattern] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [rename, setRename] = useState('');
  const [showAll, setShowAll] = useState(false);
  const active = categories.filter((c) => !c.archived);

  async function add() {
    if (!pattern.trim() || !categoryId) return toast.error('Indiquez un texte et une catégorie.');
    await save('rules', { pattern: pattern.trim(), categoryId, rename: rename.trim(), order: -Date.now() } as Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>);
    setPattern('');
    setRename('');
    toast.success('Règle ajoutée');
  }

  async function applyToUncategorized() {
    const targets = transactions.filter((t) => t.type !== 'transfer' && !t.categoryId);
    let n = 0;
    for (const t of targets) {
      const r = matchRule(rules, `${t.payee} ${t.note}`);
      if (r) {
        await patch('transactions', t.id, { categoryId: r.categoryId, ...(r.rename ? { payee: r.rename } : {}) });
        n++;
      }
    }
    toast.success(n ? `${n} opération(s) catégorisée(s)` : 'Aucune opération concernée');
  }

  const list = showAll ? rules : rules.slice(0, 8);
  return (
    <Section id="regles" title="Règles automatiques" description="Si le libellé contient… alors catégoriser en… (appliquées à la saisie et à l’import).">
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr]">
        <input className="field" placeholder="Le libellé contient…" value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="Texte recherché" />
        <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Catégorie">
          <option value="">Catégorie…</option>
          {active.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </select>
        <input className="field" placeholder="Renommer en… (facultatif)" value={rename} onChange={(e) => setRename(e.target.value)} aria-label="Nouveau libellé" />
        <Button variant="primary" icon={<Plus size={16} />} onClick={add}>
          Ajouter la règle
        </Button>
      </div>
      <ul className="divide-y divide-line/60 rounded-2xl border border-line">
        {list.map((r) => (
          <li key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate">
              « {r.pattern} » → {categoryMap.get(r.categoryId)?.emoji} {categoryMap.get(r.categoryId)?.name ?? '?'}
              {r.rename && <span className="text-muted"> · renommé « {r.rename} »</span>}
            </span>
            <button type="button" className="rounded p-1 text-faint hover:text-danger" aria-label={`Supprimer la règle ${r.pattern}`} onClick={() => remove('rules', r.id)}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {rules.length === 0 && <li className="px-3 py-2 text-sm text-muted">Aucune règle.</li>}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        {rules.length > 8 && (
          <Button size="sm" variant="ghost" onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Réduire' : `Voir les ${rules.length} règles`}
          </Button>
        )}
        <Button size="sm" variant="secondary" icon={<Wand2 size={14} />} onClick={applyToUncategorized}>
          Appliquer aux opérations à catégoriser
        </Button>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Application (installation, stockage)                                */
/* ------------------------------------------------------------------ */

function AppSection() {
  const [installable, setInstallable] = useState(canInstall());
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string | null>(null);

  useEffect(() => onInstallChange(() => setInstallable(canInstall())), []);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
    navigator.storage
      ?.estimate?.()
      .then((e) => e.usage != null && setUsage(`${(e.usage / 1024 / 1024).toFixed(1).replace('.', ',')} Mo utilisés`))
      .catch(() => {});
  }, []);

  return (
    <Section id="app" title="Application" description="Forla fonctionne entièrement hors connexion une fois installée.">
      <div className="space-y-3 text-sm">
        {isStandalone() ? (
          <p className="flex items-center gap-2">
            <Smartphone size={16} className="text-primary" /> Application installée ✓
          </p>
        ) : installable ? (
          <Button variant="primary" icon={<Smartphone size={16} />} onClick={() => promptInstall()}>
            Installer Forla sur cet appareil
          </Button>
        ) : isIOS() ? (
          <p className="text-muted">
            Sur iPhone / iPad : touchez <strong>Partager</strong> puis <strong>« Sur l’écran d’accueil »</strong> dans Safari.
          </p>
        ) : (
          <p className="text-muted">Pour installer : menu du navigateur → « Installer l’application » ou « Ajouter à l’écran d’accueil ».</p>
        )}
        <p className="flex flex-wrap items-center gap-2">
          <HardDrive size={16} className="text-muted" />
          Stockage : {persisted ? <strong>permanent ✓</strong> : <span>standard</span>}
          {usage && <span className="text-muted">· {usage}</span>}
          {!persisted && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const ok = await requestPersistence();
                setPersisted(ok);
                toast(ok ? 'Stockage permanent activé' : 'Le navigateur a refusé ; installer l’application aide souvent.');
              }}
            >
              Rendre permanent
            </Button>
          )}
        </p>
        <p className="text-xs text-faint">Forla v{__APP_VERSION__} · données locales (IndexedDB) · aucun traceur, aucune publicité.</p>
      </div>
    </Section>
  );
}

function DangerSection() {
  const [confirm, setConfirm] = useState(false);
  const [text, setText] = useState('');
  return (
    <Section id="donnees" title="Données">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setConfirm(true)}>
          Charger la démo
        </Button>
        <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => setConfirm(true)}>
          Tout effacer
        </Button>
      </div>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Effacer toutes les données ?">
        <div className="space-y-3">
          <p className="text-sm text-muted">Toutes les données de cet appareil seront supprimées. Pensez à faire une sauvegarde avant. Tapez « EFFACER » pour confirmer.</p>
          <input className="field" value={text} onChange={(e) => setText(e.target.value)} aria-label="Confirmation" />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              disabled={text !== 'EFFACER'}
              onClick={async () => {
                await wipeAll();
                await disableSync();
                setConfirm(false);
                toast('Données effacées');
              }}
            >
              Effacer et recommencer
            </Button>
            <Button
              variant="secondary"
              disabled={text !== 'EFFACER'}
              onClick={async () => {
                await wipeAll();
                await disableSync();
                await seedDemo();
                setConfirm(false);
                toast.success('Démo chargée');
              }}
            >
              Effacer et charger la démo
            </Button>
          </div>
        </div>
      </Sheet>
    </Section>
  );
}
