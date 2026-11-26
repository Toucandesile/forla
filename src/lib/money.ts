/**
 * Montants stockés en CENTIMES entiers (jamais de flottants) pour éviter
 * les erreurs d'arrondi : 12,30 € => 1230.
 */
export type Cents = number;

let currency = 'EUR';
let fmtFull = makeFormatter(2);
let fmtRound = makeFormatter(0);
let fmtCompact = new Intl.NumberFormat('fr-FR', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });

function makeFormatter(digits: number) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function setCurrency(code: string) {
  if (!code || code === currency) return;
  try {
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: code });
  } catch {
    return;
  }
  currency = code;
  fmtFull = makeFormatter(2);
  fmtRound = makeFormatter(0);
  fmtCompact = new Intl.NumberFormat('fr-FR', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
}

export function getCurrency() {
  return currency;
}

export function currencySymbol(): string {
  const part = fmtRound.formatToParts(0).find((p) => p.type === 'currency');
  return part?.value ?? currency;
}

export interface MoneyFormatOptions {
  /** Affiche un signe + pour les montants positifs */
  signed?: boolean;
  /** Arrondit à l'euro */
  round?: boolean;
  /** Notation compacte (1,2 k€) */
  compact?: boolean;
}

export function formatMoney(cents: Cents, opts: MoneyFormatOptions = {}): string {
  const value = cents / 100;
  let out: string;
  if (opts.compact && Math.abs(value) >= 10000) out = fmtCompact.format(value);
  else if (opts.round || opts.compact) out = fmtRound.format(Math.round(value));
  else out = fmtFull.format(value);
  // Intl renvoie "-0,00 €" pour -0
  if (Object.is(value, -0) || (cents < 0 && Math.round(Math.abs(value)) === 0 && (opts.round || opts.compact))) {
    out = out.replace('-', '');
  }
  if (opts.signed && cents > 0) out = '+' + out;
  // Remplace le tiret par un vrai signe moins typographique
  return out.replace('-', '−');
}

/** Valeur brute pour un champ de saisie : 1230 => "12,30" */
export function centsToInput(cents: Cents | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return '';
  const v = Math.abs(cents) / 100;
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return (cents < 0 ? '-' : '') + s.replace('.', ',');
}

/**
 * Interprète un nombre écrit à la française ou à l'anglaise.
 * "1 234,56" / "1.234,56" / "1,234.56" / "12.5" / "12,5" / "-3" / "12 €"
 */
export function parseNumber(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw)
    .trim()
    .replace(/[\s  ']/g, '')
    .replace(/[€$£]|EUR|CHF|USD|GBP/gi, '')
    .replace(/[−–—]/g, '-');
  if (!s) return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? ',' : '.';
    const thou = dec === ',' ? '.' : ',';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    if (parts.length > 2) s = parts.join('');
    else s = s.replace(',', '.');
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    // "1.234.567" ou "1.234" (groupe de 3) => séparateur de milliers
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0')) {
      s = parts.join('');
    }
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Évalue un montant saisi, avec calculs simples autorisés :
 * "12,50+3" => 1550 ; "100/3" => 3333 ; "2*4,5" => 900.
 * Retourne des centimes, ou null si l'expression est invalide.
 */
export function parseAmount(input: string): Cents | null {
  if (input == null) return null;
  const s = String(input).replace(/[\s  €]/g, '').replace(/[−–—]/g, '-').replace(/[x×]/gi, '*').replace(/÷/g, '/');
  if (!s) return null;
  if (!/[+*/()]/.test(s.slice(1)) && !/\d-\d/.test(s)) {
    const n = parseNumber(s);
    return n == null ? null : Math.round(n * 100);
  }
  const tokens = s.match(/\d[\d.,]*|[+\-*/()]/g);
  if (!tokens || tokens.join('') !== s) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): number | null {
    let left = parseTerm();
    if (left == null) return null;
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const right = parseTerm();
      if (right == null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  function parseTerm(): number | null {
    let left = parseFactor();
    if (left == null) return null;
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const right = parseFactor();
      if (right == null) return null;
      if (op === '/' && right === 0) return null;
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }
  function parseFactor(): number | null {
    const t = next();
    if (t === '-') {
      const v = parseFactor();
      return v == null ? null : -v;
    }
    if (t === '+') return parseFactor();
    if (t === '(') {
      const v = parseExpr();
      if (next() !== ')') return null;
      return v;
    }
    if (t == null) return null;
    return parseNumber(t);
  }
  const value = parseExpr();
  if (value == null || pos !== tokens.length || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Répartit un montant en parts entières proportionnelles aux poids (somme exacte garantie). */
export function allocate(total: Cents, weights: number[]): Cents[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (weights.length === 0) return [];
  if (sum <= 0) return allocate(total, weights.map(() => 1));
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * Math.max(0, w)) / sum);
  const floors = raw.map(Math.floor);
  let rest = abs - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) floors[order[k].i]++;
  return floors.map((f) => f * sign);
}

export function percent(part: number, whole: number): number {
  if (!whole) return 0;
  return (part / whole) * 100;
}

export function formatPercent(value: number, digits = 0): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value) + ' %';
}
