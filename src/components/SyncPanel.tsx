import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import qrcode from 'qrcode-generator';
import { CloudCheck, CloudOff, Copy, Link2, QrCode, RefreshCw, Share2, TriangleAlert } from 'lucide-react';
import { navigate } from '../state';
import { disableSync, enableSync, inviteLink, isSyncAvailable, parseInvite, syncNow, useSyncState, type SyncState } from '../lib/sync';
import { Button, Field, Sheet, cn } from './ui';

/** QR code rendu en SVG net (toujours noir sur blanc pour rester lisible par les appareils photo). */
export function QrCodeSvg({ text, size = 220 }: { text: string; size?: number }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c + 3},${r + 3}h1v1h-1z`;
    return { d: path, n: count + 6 };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} role="img" aria-label="QR code d'invitation" shapeRendering="crispEdges" className="rounded-xl">
      <rect width={n} height={n} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}

export function syncLabel(s: SyncState): string {
  switch (s.phase) {
    case 'syncing':
      return s.progress ? `Envoi… ${s.progress.done}/${s.progress.total}` : 'Synchronisation…';
    case 'offline':
      return 'Hors ligne — envoi dès le retour du réseau';
    case 'error':
      return s.error ?? 'Erreur de synchronisation';
    case 'idle':
      return s.lastSync ? `Synchronisé ${ago(s.lastSync)}` : 'Synchronisé';
    default:
      return 'Non synchronisé';
  }
}

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

export function SyncStatusIcon({ state, size = 16 }: { state: SyncState; size?: number }) {
  if (state.phase === 'syncing') return <RefreshCw size={size} className="animate-spin text-primary" />;
  if (state.phase === 'offline') return <CloudOff size={size} className="text-muted" />;
  if (state.phase === 'error') return <TriangleAlert size={size} className="text-warning-ink" />;
  return <CloudCheck size={size} className="text-primary" />;
}

/** Re-rendu périodique pour garder « il y a X s » à jour. */
function useTick(ms = 15000) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const link = open ? inviteLink() : null;
  async function share() {
    if (!link) return;
    const data = { title: 'Rejoindre notre foyer sur Forla', text: 'Rejoins notre foyer sur Forla pour partager nos dépenses :', url: link };
    if (navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    copy();
  }
  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Lien copié');
    } catch {
      toast.error('Copie impossible : sélectionnez le lien manuellement.');
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Inviter un appareil">
      {link && (
        <div className="space-y-4">
          <div className="flex justify-center rounded-2xl bg-white p-3">
            <QrCodeSvg text={link} size={240} />
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Sur l’autre téléphone, ouvrez l’appareil photo et visez ce QR code.</li>
            <li>Touchez le lien qui apparaît, puis « Rejoindre le foyer ».</li>
          </ol>
          <p className="text-sm text-muted">Ou envoyez-lui directement le lien :</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Share2 size={16} />} onClick={share}>
              Envoyer le lien
            </Button>
            <Button variant="secondary" icon={<Copy size={16} />} onClick={copy}>
              Copier
            </Button>
          </div>
          <p className="flex items-start gap-2 rounded-xl bg-warning-soft p-3 text-xs text-warning-ink">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            Ce lien donne accès aux données du foyer : ne le partagez qu’avec les personnes du foyer.
          </p>
        </div>
      )}
    </Sheet>
  );
}

export function JoinPrompt({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [value, setValue] = useState('');
  function go() {
    const code = parseInvite(value);
    if (!code) return toast.error('Lien d’invitation non reconnu.');
    onClose();
    navigate(`/rejoindre?c=${code}`);
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="J’ai reçu une invitation"
      footer={
        <div className="flex justify-end">
          <Button variant="primary" onClick={go} disabled={!value.trim()}>
            Continuer
          </Button>
        </div>
      }
    >
      <Field label="Collez le lien d’invitation" htmlFor="join-link" hint="Il commence par https:// et contient « rejoindre ».">
        <input id="join-link" className="field" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} placeholder="https://…/#/rejoindre?c=…" autoComplete="off" />
      </Field>
    </Sheet>
  );
}

export function SyncPanel() {
  const s = useSyncState();
  useTick();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isSyncAvailable()) {
    return <p className="text-sm text-muted">La synchronisation nécessite une connexion sécurisée (HTTPS) : utilisez la version en ligne de Forla.</p>;
  }

  async function onEnable() {
    setBusy(true);
    try {
      await enableSync();
      toast.success('Synchronisation activée');
      setInviteOpen(true);
    } catch {
      toast.error('Connexion au relais impossible. Vérifiez Internet puis réessayez.');
    } finally {
      setBusy(false);
    }
  }

  if (s.phase === 'off') {
    return (
      <div className="space-y-3">
        <ul className="space-y-1.5 text-sm text-muted">
          <li>• Les dépenses saisies sur un téléphone apparaissent sur les autres en quelques secondes.</li>
          <li>• Chiffrement de bout en bout : même l’hébergeur ne peut pas lire vos données.</li>
          <li>• Hors connexion, tout continue de fonctionner et se synchronise au retour du réseau.</li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<QrCode size={16} />} onClick={onEnable} disabled={busy}>
            {busy ? 'Activation…' : 'Activer et inviter un appareil'}
          </Button>
          <Button variant="secondary" icon={<Link2 size={16} />} onClick={() => setJoinOpen(true)}>
            J’ai reçu une invitation
          </Button>
        </div>
        <JoinPrompt open={joinOpen} onClose={() => setJoinOpen(false)} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className={cn('flex items-center gap-2 text-sm font-medium', s.phase === 'error' && 'text-warning-ink')} aria-live="polite">
        <SyncStatusIcon state={s} />
        {syncLabel(s)}
      </p>
      {s.progress && (
        <div className="h-2 overflow-hidden rounded-full bg-track">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(s.progress.done / Math.max(1, s.progress.total)) * 100}%` }} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<QrCode size={16} />} onClick={() => setInviteOpen(true)}>
          Inviter un appareil
        </Button>
        <Button
          variant="secondary"
          icon={<RefreshCw size={16} />}
          onClick={() =>
            syncNow()
              .then((r) => toast.success(r.pulled || r.pushed ? `Synchronisé (${r.pulled} reçu·s, ${r.pushed} envoyé·s)` : 'Tout est à jour'))
              .catch(() => toast.error('Synchronisation impossible pour le moment.'))
          }
        >
          Synchroniser maintenant
        </Button>
      </div>
      <p className="text-xs text-muted">Les photos de tickets restent sur l’appareil où elles ont été prises.</p>
      {confirmStop ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-3 text-sm">
          <span className="flex-1">Arrêter la synchronisation sur cet appareil ? Ses données restent intactes.</span>
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              await disableSync();
              setConfirmStop(false);
              toast('Synchronisation arrêtée sur cet appareil');
            }}
          >
            Arrêter
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmStop(false)}>
            Annuler
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setConfirmStop(true)}>
          Arrêter sur cet appareil
        </Button>
      )}
      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
