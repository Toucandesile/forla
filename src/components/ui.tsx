import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { formatMoney, parseAmount, centsToInput, type MoneyFormatOptions } from '../lib/money';
import { addMonths, currentMonth, monthLabel } from '../lib/dates';
import type { Category, CategoryGroup, Member } from '../db/schema';

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

/* ---------------- Mode discret (masquer les montants) ---------------- */

export const PrivacyContext = createContext(false);

export function Money({
  value,
  className,
  colored,
  ...opts
}: { value: number; className?: string; colored?: boolean } & MoneyFormatOptions) {
  const hidden = useContext(PrivacyContext);
  const text = formatMoney(value, opts);
  return (
    <span
      className={cn('whitespace-nowrap', colored && value > 0 && 'text-success', colored && value < 0 && 'text-danger', hidden && 'privacy-blur', className)}
      aria-label={hidden ? 'Montant masqué' : undefined}
    >
      {text}
    </span>
  );
}

/* ---------------- Boutons ---------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover shadow-sm',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
  ghost: 'text-ink hover:bg-surface-2',
  danger: 'bg-danger-soft text-danger hover:brightness-95',
  soft: 'bg-primary-soft text-primary hover:brightness-95',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; block?: boolean }
>(function Button({ variant = 'secondary', size = 'md', icon, block, className, children, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100',
        size === 'sm' && 'h-8 px-3 text-sm',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-5 text-base',
        block && 'w-full',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn('inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---------------- Mise en page ---------------- */

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          {icon}
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-2xl text-primary">{icon}</div>
      <h3 className="font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Pill({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'primary'; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'bg-surface-2 text-muted',
    good: 'bg-primary-soft text-success',
    warn: 'bg-warning-soft text-warning-ink',
    bad: 'bg-danger-soft text-danger',
    primary: 'bg-primary-soft text-primary',
  };
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>;
}

/* ---------------- Formulaires ---------------- */

export function Field({ label, hint, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn('block', className)}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

export function Switch({ checked, onChange, label, description, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; id?: string }) {
  const autoId = useId();
  const sid = id ?? autoId;
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <label htmlFor={sid} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </label>
      <button
        id={sid}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-primary' : 'bg-surface-3')}
      >
        <span className={cn('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition', checked && 'translate-x-5')} />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex rounded-xl bg-surface-2 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-lg font-medium whitespace-nowrap transition',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Champ montant : accepte "12,50", "1 234,56" et les calculs ("12+8,5"). */
export const AmountInput = forwardRef<
  HTMLInputElement,
  { value: string; onChange: (raw: string) => void; large?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>
>(function AmountInput({ value, onChange, large, className, ...rest }, ref) {
  const cents = parseAmount(value);
  const isFormula = /[+*/]|\d-\d/.test(value.trim().slice(1));
  return (
    <div className="relative">
      <input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (isFormula && cents != null) onChange(centsToInput(cents));
        }}
        className={cn('field tabular pr-10', large && 'h-16 text-3xl font-semibold', className)}
        {...rest}
      />
      <span className={cn('pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-faint', large && 'text-2xl')}>€</span>
      {isFormula && (
        <p className="mt-1 text-xs text-muted" aria-live="polite">
          = {cents != null ? formatMoney(cents) : 'calcul invalide'}
        </p>
      )}
    </div>
  );
});

/* ---------------- Feuille modale ---------------- */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="flex min-h-dvh items-end justify-center sm:min-h-0 sm:items-center sm:p-6" onClick={(e) => e.target === e.currentTarget && onClose()}>
          <div
            className={cn(
              'sheet-panel flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-line bg-surface shadow-pop sm:rounded-3xl',
              wide ? 'sm:w-[720px]' : 'sm:w-[520px]',
            )}
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
              <h2 className="text-lg font-semibold">{title}</h2>
              <IconButton label="Fermer" onClick={onClose} className="-mr-2">
                <X size={20} />
              </IconButton>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="safe-bottom border-t border-line px-5 py-3">{footer}</div>}
          </div>
        </div>
      )}
    </dialog>
  );
}

/* ---------------- Jauges ---------------- */

/** Jauge de budget : la couleur porte l'état (normal → attention → dépassé). */
export function Meter({ ratio, className, label }: { ratio: number; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 1));
  const color = ratio > 1 ? 'var(--critical)' : ratio >= 0.85 ? 'var(--warn)' : 'var(--primary)';
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-track', className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((Number.isFinite(ratio) ? ratio : 1) * 100)}
      aria-label={label}
    >
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct * 100}%`, background: color }} />
    </div>
  );
}

export function Ring({ ratio, size = 56, stroke = 6, children }: { ratio: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, ratio));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ratio >= 1 ? 'var(--good)' : 'var(--primary)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset .6s' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-lg">{children}</div>
    </div>
  );
}

/* ---------------- Identité visuelle ---------------- */

export function CatIcon({ category, group, size = 40 }: { category?: Category | null; group?: CategoryGroup | null; size?: number }) {
  const color = group?.color ?? '#8d939b';
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 16%, transparent)`, fontSize: size * 0.48 }}
      aria-hidden
    >
      {category?.emoji ?? '❔'}
    </span>
  );
}

export function Avatar({ member, size = 28, className }: { member?: Member | null; size?: number; className?: string }) {
  if (!member)
    return (
      <span
        className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-surface-2', className)}
        style={{ width: size, height: size, fontSize: size * 0.5 }}
        title="Compte commun"
        aria-label="Commun"
      >
        🏠
      </span>
    );
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full', className)}
      style={{ width: size, height: size, fontSize: size * 0.52, background: `color-mix(in srgb, ${member.color} 18%, transparent)`, boxShadow: `inset 0 0 0 2px ${member.color}` }}
      title={member.name}
      aria-label={member.name}
    >
      {member.emoji}
    </span>
  );
}

/* ---------------- Navigation mensuelle ---------------- */

export function MonthNav({ month, onChange, className }: { month: string; onChange: (m: string) => void; className?: string }) {
  const isCurrent = month === currentMonth();
  return (
    <div className={cn('inline-flex items-center gap-1 rounded-xl border border-line bg-surface p-1', className)}>
      <IconButton label="Mois précédent" className="h-8 w-8" onClick={() => onChange(addMonths(month, -1))}>
        <ChevronLeft size={18} />
      </IconButton>
      <button
        type="button"
        className="min-w-[8.5rem] rounded-lg px-2 py-1 text-sm font-semibold hover:bg-surface-2"
        onClick={() => onChange(currentMonth())}
        title={isCurrent ? 'Mois en cours' : 'Revenir au mois en cours'}
      >
        {monthLabel(month)}
      </button>
      <IconButton label="Mois suivant" className="h-8 w-8" onClick={() => onChange(addMonths(month, 1))}>
        <ChevronRight size={18} />
      </IconButton>
    </div>
  );
}

/* ---------------- Tuiles de statistiques ---------------- */

export function StatTile({
  label,
  value,
  delta,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  delta?: { text: string; good: boolean | null };
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('card px-4 py-3.5', className)}>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
      {delta && (
        <p className={cn('mt-0.5 text-xs font-medium', delta.good === true && 'text-success', delta.good === false && 'text-danger', delta.good === null && 'text-muted')}>
          {delta.text}
        </p>
      )}
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Hook utilitaire : valeur initialisée une fois puis modifiable (formulaires). */
export function useFormState<T>(init: () => T, deps: unknown[]): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(init);
  useEffect(() => {
    setState(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [state, setState];
}
