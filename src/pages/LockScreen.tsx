import { useEffect, useState } from 'react';
import { Delete, Lock } from 'lucide-react';
import { hashPin } from '../lib/backup';
import { readPrefs } from '../db/db';
import { cn } from '../components/ui';

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    if (pin.length < 4) return;
    let cancelled = false;
    const { pinHash, pinSalt } = readPrefs();
    if (!pinHash || !pinSalt) {
      onUnlock();
      return;
    }
    hashPin(pin, pinSalt).then(({ hash }) => {
      if (cancelled) return;
      if (hash === pinHash) onUnlock();
      else if (pin.length >= 6) {
        setError(true);
        setTimeout(() => {
          setPin('');
          setError(false);
        }, 600);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pin, onUnlock]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 6 ? p + e.key : p));
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Lock size={26} />
        </div>
        <h1 className="text-xl font-semibold">Forla est verrouillée</h1>
        <p className="mt-1 text-sm text-muted">Saisissez votre code (4 à 6 chiffres)</p>
      </div>
      <div className={cn('flex gap-3', error && 'animate-[shake_.3s]')} aria-live="polite" aria-label={`${pin.length} chiffres saisis`}>
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className={cn('h-3.5 w-3.5 rounded-full border-2', i < pin.length ? (error ? 'border-danger bg-danger' : 'border-primary bg-primary') : 'border-line')}
          />
        ))}
      </div>
      <div className="grid w-full max-w-[280px] grid-cols-3 gap-3">
        {keys.map((k, i) =>
          k === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              aria-label={k === 'del' ? 'Effacer' : k}
              onClick={() => setPin((p) => (k === 'del' ? p.slice(0, -1) : p.length < 6 ? p + k : p))}
              className="flex h-16 items-center justify-center rounded-2xl bg-surface text-2xl font-medium shadow-card transition active:scale-95 active:bg-surface-2"
            >
              {k === 'del' ? <Delete size={22} /> : k}
            </button>
          ),
        )}
      </div>
      <button type="button" className="text-sm text-muted underline-offset-4 hover:underline" onClick={() => setHelp((h) => !h)}>
        Code oublié ?
      </button>
      {help && (
        <p className="max-w-sm text-center text-xs text-muted">
          Par sécurité, le code ne peut pas être contourné depuis l'application. Effacez les données du site dans les réglages du navigateur, puis
          restaurez votre dernière sauvegarde.
        </p>
      )}
      <style>{`@keyframes shake{0%,100%{transform:none}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}`}</style>
    </div>
  );
}
