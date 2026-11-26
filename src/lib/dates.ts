/**
 * Dates manipulées en chaînes locales "AAAA-MM-JJ" (jamais via toISOString qui passe en UTC
 * et décale d'un jour le soir). Les mois sont des clés "AAAA-MM".
 */

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

export function isValidISODate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = parseISODate(iso);
  return toISODate(d) === iso;
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function currentMonth(): string {
  return monthOf(todayISO());
}

export function addDays(iso: string, n: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

export function monthDiff(from: string, to: string): number {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad(daysInMonth(y, m))}`;
}

export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Ajoute n mois à une date en conservant le jour d'ancrage (31 => 28/29/30 si besoin). */
export function addMonthsToDate(iso: string, n: number, anchorDay?: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const target = addMonths(`${y}-${pad(m)}`, n);
  const [ty, tm] = target.split('-').map(Number);
  const day = Math.min(anchorDay ?? d, daysInMonth(ty, tm));
  return `${target}-${pad(day)}`;
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86400000);
}

const fmtMonthLong = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const fmtMonthShort = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const fmtMonthShortYear = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' });
const fmtDayLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDayLongYear = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtDayShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const fmtDayShortYear = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateNum = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function monthLabel(month: string): string {
  return cap(fmtMonthLong.format(parseISODate(monthStart(month))));
}

export function monthShortLabel(month: string, withYear = false): string {
  const d = parseISODate(monthStart(month));
  return cap((withYear ? fmtMonthShortYear : fmtMonthShort).format(d).replace('.', ''));
}

export function dayHeading(iso: string): string {
  const today = todayISO();
  if (iso === today) return "Aujourd'hui";
  if (iso === addDays(today, -1)) return 'Hier';
  if (iso === addDays(today, 1)) return 'Demain';
  const d = parseISODate(iso);
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return cap((sameYear ? fmtDayLong : fmtDayLongYear).format(d));
}

export function shortDate(iso: string): string {
  const today = todayISO();
  if (iso === today) return "aujourd'hui";
  if (iso === addDays(today, 1)) return 'demain';
  if (iso === addDays(today, -1)) return 'hier';
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return (sameYear ? fmtDayShort : fmtDayShortYear).format(parseISODate(iso));
}

export function numericDate(iso: string): string {
  return fmtDateNum.format(parseISODate(iso));
}

export function relativeDays(iso: string): string {
  const n = diffDays(todayISO(), iso);
  if (n === 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  if (n === -1) return 'hier';
  if (n > 0) return `dans ${n} j`;
  return `il y a ${-n} j`;
}

/**
 * Interprète une date bancaire : "05/11/2026", "05-11-26", "2026-11-05", "20261105", "05.11.2026".
 * Par défaut, ordre jour/mois (format français).
 */
export function parseFlexibleDate(raw: string, order: 'dmy' | 'mdy' = 'dmy'): string | null {
  if (!raw) return null;
  const s = raw.trim().split(/[ T]/)[0];
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return build(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return build(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.'](\d{2,4})$/);
  if (m) {
    let year = +m[3];
    if (year < 100) year += year > 70 ? 1900 : 2000;
    const a = +m[1];
    const b = +m[2];
    return order === 'dmy' ? build(year, b, a) : build(year, a, b);
  }
  return null;

  function build(y: number, mo: number, d: number): string | null {
    const iso = `${y}-${pad(mo)}-${pad(d)}`;
    return isValidISODate(iso) ? iso : null;
  }
}
