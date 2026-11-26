import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useRegisterSW } from 'virtual:pwa-register/react';
import {
  CalendarClock,
  ChartColumn,
  Eye,
  EyeOff,
  House,
  Landmark,
  List,
  Lock,
  Menu,
  PiggyBank,
  Plus,
  Settings,
  Target,
  Users,
  WifiOff,
} from 'lucide-react';
import { useApplyTheme, useData, usePrefs, useRoute, useUI, navigate } from './state';
import { PrivacyContext, cn, IconButton, Sheet } from './components/ui';
import { TransactionEditor } from './components/TransactionEditor';
import { processRecurring } from './lib/recurring';
import { LockScreen } from './pages/LockScreen';
import { Onboarding } from './pages/Onboarding';
import Dashboard from './pages/Dashboard';

const Transactions = lazy(() => import('./pages/Transactions'));
const BudgetPage = lazy(() => import('./pages/Budget'));
const Schedule = lazy(() => import('./pages/Schedule'));
const Accounts = lazy(() => import('./pages/Accounts'));
const Household = lazy(() => import('./pages/Household'));
const Goals = lazy(() => import('./pages/Goals'));
const Reports = lazy(() => import('./pages/Reports'));
const SettingsPage = lazy(() => import('./pages/Settings'));

interface NavItem {
  path: string;
  label: string;
  icon: ReactNode;
}

const NAV: NavItem[] = [
  { path: '/', label: 'Accueil', icon: <House size={20} /> },
  { path: '/operations', label: 'Opérations', icon: <List size={20} /> },
  { path: '/budget', label: 'Budget', icon: <PiggyBank size={20} /> },
  { path: '/echeancier', label: 'Échéancier', icon: <CalendarClock size={20} /> },
  { path: '/comptes', label: 'Comptes', icon: <Landmark size={20} /> },
  { path: '/foyer', label: 'Foyer', icon: <Users size={20} /> },
  { path: '/objectifs', label: 'Objectifs', icon: <Target size={20} /> },
  { path: '/analyses', label: 'Analyses', icon: <ChartColumn size={20} /> },
  { path: '/reglages', label: 'Réglages', icon: <Settings size={20} /> },
];

const LOCK_AFTER_MS = 5 * 60 * 1000;

export default function App() {
  const data = useData();
  const [prefs, setPref] = usePrefs();
  const route = useRoute();
  const { openTx } = useUI();
  const [locked, setLocked] = useState(() => !!prefs.pinHash);
  const [moreOpen, setMoreOpen] = useState(false);
  const online = useOnline();
  useApplyTheme(prefs.theme);
  usePwaUpdates();

  // Opérations récurrentes automatiques : au démarrage et au retour sur l'appli
  useEffect(() => {
    if (!data.ready || !data.settings.onboarded) return;
    const run = () =>
      processRecurring()
        .then((n) => n > 0 && toast.success(`${n} opération${n > 1 ? 's' : ''} récurrente${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''}`))
        .catch(() => {});
    run();
    const onVis = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [data.ready, data.settings.onboarded]);

  // Verrouillage automatique après 5 min en arrière-plan
  useEffect(() => {
    if (!prefs.pinHash) return;
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [prefs.pinHash]);

  // Raccourci clavier "N" : nouvelle opération
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (t.closest('input, textarea, select, [contenteditable], dialog[open]')) return;
      e.preventDefault();
      openTx();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openTx]);

  // Raccourci d'application (écran d'accueil) : #/?new=expense
  useEffect(() => {
    if (!data.ready || locked) return;
    const t = route.query.get('new');
    if (t === 'expense' || t === 'income' || t === 'transfer') {
      openTx({ type: t });
      navigate(route.path, true);
    }
  }, [route, data.ready, locked, openTx]);

  if (!data.ready) return <Splash />;
  if (locked && prefs.pinHash) return <LockScreen onUnlock={() => setLocked(false)} />;
  if (!data.settings.onboarded) return <Onboarding />;

  const current = '/' + (route.segments[0] ?? '');
  const page = (() => {
    switch (current) {
      case '/operations':
        return <Transactions />;
      case '/budget':
        return <BudgetPage />;
      case '/echeancier':
        return <Schedule />;
      case '/comptes':
        return <Accounts />;
      case '/foyer':
        return <Household />;
      case '/objectifs':
        return <Goals />;
      case '/analyses':
        return <Reports />;
      case '/reglages':
        return <SettingsPage />;
      default:
        return <Dashboard />;
    }
  })();

  return (
    <PrivacyContext.Provider value={prefs.hideAmounts}>
      <div className="min-h-dvh lg:flex">
        {/* Barre latérale (ordinateur) */}
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
          <a href="#/" className="mb-6 flex items-center gap-2.5 px-2">
            <img src="./logo.svg" alt="" className="h-9 w-9" />
            <span>
              <span className="block text-lg leading-tight font-bold">Forla</span>
              <span className="block max-w-[10rem] truncate text-xs text-muted">{data.settings.householdName}</span>
            </span>
          </a>
          <button
            type="button"
            onClick={() => openTx()}
            className="mb-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-primary font-medium text-primary-fg shadow-sm transition hover:bg-primary-hover"
            title="Nouvelle opération (N)"
          >
            <Plus size={18} /> Nouvelle opération
          </button>
          <nav className="flex-1 space-y-0.5" aria-label="Navigation principale">
            {NAV.map((n) => (
              <NavLink key={n.path} item={n} active={current === n.path} />
            ))}
          </nav>
          <div className="mt-4 flex items-center justify-between gap-2 px-2 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              {online ? <span className="h-2 w-2 rounded-full bg-good" /> : <WifiOff size={14} />}
              {online ? 'Données sur cet appareil' : 'Hors ligne — tout fonctionne'}
            </span>
            <span className="flex">
              <IconButton
                label={prefs.hideAmounts ? 'Afficher les montants' : 'Masquer les montants'}
                className="h-8 w-8"
                onClick={() => setPref('hideAmounts', !prefs.hideAmounts)}
              >
                {prefs.hideAmounts ? <EyeOff size={16} /> : <Eye size={16} />}
              </IconButton>
              {prefs.pinHash && (
                <IconButton label="Verrouiller" className="h-8 w-8" onClick={() => setLocked(true)}>
                  <Lock size={16} />
                </IconButton>
              )}
            </span>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Barre supérieure (mobile) */}
          <header className="safe-top sticky top-0 z-20 flex items-center justify-between border-b border-line bg-bg/85 px-4 py-2.5 backdrop-blur lg:hidden">
            <a href="#/" className="flex items-center gap-2">
              <img src="./logo.svg" alt="" className="h-8 w-8" />
              <span className="font-bold">Forla</span>
            </a>
            <div className="flex items-center">
              {!online && (
                <span className="mr-1 flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
                  <WifiOff size={12} /> Hors ligne
                </span>
              )}
              <IconButton label={prefs.hideAmounts ? 'Afficher les montants' : 'Masquer les montants'} onClick={() => setPref('hideAmounts', !prefs.hideAmounts)}>
                {prefs.hideAmounts ? <EyeOff size={19} /> : <Eye size={19} />}
              </IconButton>
              {prefs.pinHash && (
                <IconButton label="Verrouiller" onClick={() => setLocked(true)}>
                  <Lock size={19} />
                </IconButton>
              )}
            </div>
          </header>

          <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-28 sm:px-6 lg:px-10 lg:pt-8 lg:pb-12">
            <Suspense fallback={<div className="py-20 text-center text-muted">Chargement…</div>}>{page}</Suspense>
          </main>
        </div>

        {/* Barre d'onglets (mobile) */}
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden" aria-label="Navigation">
          <div className="mx-auto grid max-w-lg grid-cols-5 items-end px-2">
            <TabLink item={NAV[0]} active={current === '/'} />
            <TabLink item={NAV[1]} active={current === '/operations'} />
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => openTx()}
                aria-label="Nouvelle opération"
                className="-mt-5 mb-1.5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-fg shadow-pop transition active:scale-95"
              >
                <Plus size={28} />
              </button>
            </div>
            <TabLink item={NAV[2]} active={current === '/budget'} />
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium',
                !['/', '/operations', '/budget'].includes(current) ? 'text-primary' : 'text-muted',
              )}
            >
              <Menu size={20} />
              Plus
            </button>
          </div>
        </nav>

        <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Menu">
          <div className="grid grid-cols-3 gap-2 pb-2">
            {NAV.slice(3).map((n) => (
              <a
                key={n.path}
                href={'#' + n.path}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-2xl border border-line p-4 text-sm font-medium',
                  current === n.path ? 'bg-primary-soft text-primary' : 'hover:bg-surface-2',
                )}
              >
                {n.icon}
                {n.label}
              </a>
            ))}
          </div>
        </Sheet>

        <TransactionEditor />
      </div>
    </PrivacyContext.Provider>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <a
      href={'#' + item.path}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition',
        active ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-ink',
      )}
    >
      {item.icon}
      {item.label}
    </a>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <a
      href={'#' + item.path}
      aria-current={active ? 'page' : undefined}
      className={cn('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', active ? 'text-primary' : 'text-muted')}
    >
      {item.icon}
      {item.label}
    </a>
  );
}

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <img src="./logo.svg" alt="Forla" className="h-16 w-16 animate-pulse" />
    </div>
  );
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Service worker : prévient quand l'appli est prête hors ligne et quand une mise à jour est disponible. */
function usePwaUpdates() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (reg) setInterval(() => navigator.onLine && reg.update().catch(() => {}), 60 * 60 * 1000);
    },
  });
  useEffect(() => {
    if (offlineReady) {
      toast.success('Forla est prête à fonctionner hors connexion.');
      setOfflineReady(false);
    }
  }, [offlineReady, setOfflineReady]);
  useEffect(() => {
    if (needRefresh)
      toast('Une nouvelle version de Forla est disponible.', {
        duration: Infinity,
        action: { label: 'Mettre à jour', onClick: () => updateServiceWorker(true) },
      });
  }, [needRefresh, updateServiceWorker]);
}
