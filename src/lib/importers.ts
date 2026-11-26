import type { Category, ID, Rule, Transaction } from '../db/schema';
import { parseFlexibleDate } from './dates';
import { parseNumber } from './money';
import { normalizePayee } from './recurring';

/** Opération lue depuis un relevé bancaire, avant validation. */
export interface ParsedRow {
  date: string;
  /** Signé : négatif = débit */
  amount: number;
  payee: string;
  memo: string;
  fitId: string | null;
  categoryHint?: string;
}

/* ------------------------------------------------------------------ */
/*  CSV                                                                */
/* ------------------------------------------------------------------ */

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const candidates = [';', ',', '\t', '|'];
  let best = ';';
  let bestScore = -1;
  for (const d of candidates) {
    const counts = sample
      .split('\n')
      .filter(Boolean)
      .map((l) => splitCsvLine(l, d).length);
    if (counts.length === 0) continue;
    const mode = counts.sort((a, b) => counts.filter((x) => x === b).length - counts.filter((x) => x === a).length)[0];
    const score = mode > 1 ? mode * counts.filter((c) => c === mode).length : 0;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function splitCsvLine(line: string, d: string): string[] {
  return parseCSV(line, d)[0] ?? [];
}

/** Analyseur CSV conforme RFC 4180 (guillemets, retours à la ligne dans les champs). */
export function parseCSV(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? detectDelimiter(text);
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') inQuotes = true;
    else if (c === d) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row.map((f) => f.trim()));
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row.map((f) => f.trim()));
  return rows;
}

export interface CsvMapping {
  headerRow: number;
  date: number;
  payee: number;
  memo: number;
  /** Colonne montant signé, ou -1 si débit/crédit séparés */
  amount: number;
  debit: number;
  credit: number;
  category: number;
  dateOrder: 'dmy' | 'mdy';
  /** Inverser le signe (certaines cartes exportent les dépenses en positif) */
  invert: boolean;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

/** Devine la correspondance des colonnes d'après les en-têtes (banques françaises et internationales). */
export function guessMapping(rows: string[][]): CsvMapping {
  let headerRow = 0;
  // L'en-tête est la première ligne contenant un mot-clé "date"
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    if (rows[i].some((c) => /date|jour/.test(norm(c)))) {
      headerRow = i;
      break;
    }
  }
  const h = (rows[headerRow] ?? []).map(norm);
  const find = (...patterns: RegExp[]) => {
    for (const p of patterns) {
      const idx = h.findIndex((c) => p.test(c));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const date = find(/^date( de)? (operation|op)/, /^date$/, /date/, /jour/);
  const payee = find(/libelle simplifie/, /^libelle$/, /libelle/, /beneficiaire|tiers|payee|merchant|commercant/, /description/, /intitule|label|operation|nature/);
  const memo = find(/libelle operation|informations complementaires|detail|memo|commentaire|note/);
  const amount = find(/^montant$|^amount$|montant\(|montant \(|montant eur|^valeur$/, /montant|amount|somme/);
  const debit = find(/debit|sortie|withdrawal/);
  const credit = find(/credit|entree|deposit/);
  const category = find(/^categorie$|^category$|sous.categorie|categorie/);
  return {
    headerRow,
    date,
    payee,
    memo: memo === payee ? -1 : memo,
    amount: debit >= 0 && credit >= 0 && amount < 0 ? -1 : amount,
    debit,
    credit,
    category,
    dateOrder: 'dmy',
    invert: false,
  };
}

export function rowsFromCsv(rows: string[][], m: CsvMapping): { rows: ParsedRow[]; errors: number } {
  const out: ParsedRow[] = [];
  let errors = 0;
  for (let i = m.headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseFlexibleDate(r[m.date] ?? '', m.dateOrder);
    let amount: number | null = null;
    if (m.amount >= 0) amount = parseNumber(r[m.amount] ?? '');
    else {
      const deb = parseNumber(r[m.debit] ?? '');
      const cre = parseNumber(r[m.credit] ?? '');
      if (deb != null || cre != null) amount = (cre ? Math.abs(cre) : 0) - (deb ? Math.abs(deb) : 0);
    }
    if (!date || amount == null) {
      errors++;
      continue;
    }
    let cents = Math.round(amount * 100);
    if (m.invert) cents = -cents;
    if (cents === 0) continue;
    const payee = (r[m.payee] ?? '').trim();
    const memo = m.memo >= 0 ? (r[m.memo] ?? '').trim() : '';
    out.push({
      date,
      amount: cents,
      payee: payee || memo || 'Opération',
      memo: memo && memo !== payee ? memo : '',
      fitId: null,
      categoryHint: m.category >= 0 ? r[m.category] : undefined,
    });
  }
  return { rows: out, errors };
}

/* ------------------------------------------------------------------ */
/*  OFX / QFX (format standard des banques françaises : "Money")       */
/* ------------------------------------------------------------------ */

export function parseOFX(text: string): ParsedRow[] {
  const out: ParsedRow[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const tag = (name: string) => {
      const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
      return m ? decodeEntities(m[1].trim()) : '';
    };
    const date = parseFlexibleDate(tag('DTPOSTED').slice(0, 8)) ?? parseFlexibleDate(tag('DTUSER').slice(0, 8));
    const amount = parseNumber(tag('TRNAMT'));
    if (!date || amount == null) continue;
    const name = tag('NAME');
    const memo = tag('MEMO');
    out.push({
      date,
      amount: Math.round(amount * 100),
      payee: name || memo || 'Opération',
      memo: memo && memo !== name ? memo : '',
      fitId: tag('FITID') || null,
    });
  }
  return out;
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/* ------------------------------------------------------------------ */
/*  QIF                                                                */
/* ------------------------------------------------------------------ */

export function parseQIF(text: string, dateOrder: 'dmy' | 'mdy' = 'dmy'): ParsedRow[] {
  const out: ParsedRow[] = [];
  let cur: Partial<ParsedRow> & { rawDate?: string } = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const code = line[0];
    const val = line.slice(1).trim();
    if (code === '!') continue;
    if (code === 'D') cur.rawDate = val;
    else if (code === 'T' || code === 'U') cur.amount = Math.round((parseNumber(val) ?? 0) * 100);
    else if (code === 'P') cur.payee = val;
    else if (code === 'M') cur.memo = val;
    else if (code === 'L') cur.categoryHint = val;
    else if (code === 'N') cur.fitId = val || null;
    else if (code === '^') {
      const date = cur.rawDate ? parseFlexibleDate(cur.rawDate.replace("'", '/'), dateOrder) : null;
      if (date && cur.amount) {
        out.push({
          date,
          amount: cur.amount,
          payee: cur.payee || cur.memo || 'Opération',
          memo: cur.memo && cur.memo !== cur.payee ? cur.memo : '',
          fitId: cur.fitId ?? null,
          categoryHint: cur.categoryHint,
        });
      }
      cur = {};
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Nettoyage des libellés bancaires                                   */
/* ------------------------------------------------------------------ */

const PREFIXES = [
  /^(paiement|achat)\s+(par\s+)?(carte|cb)\s*/i,
  /^facture\s+carte\s*/i,
  /^carte\s+(x\s*)?\d{0,4}\s*/i,
  /^cb\s*\*?\s*/i,
  /^prlv\s+(sepa\s+)?/i,
  /^prelevement\s+(sepa\s+)?(europeen\s+)?/i,
  /^prélèvement\s+(sepa\s+)?(européen\s+)?/i,
  /^vir(ement)?\s+(sepa\s+)?(inst(antane)?\s+)?(recu|reçu|emis|émis)?\s*(\/de\s+|de\s+|vers\s+)?/i,
  /^retrait\s+(dab|cb)?\s*/i,
  /^avoir\s+carte\s*/i,
];

/** "CB CARREFOUR MARKET 12/11 PARIS" => "Carrefour Market Paris" */
export function cleanPayee(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  for (let k = 0; k < 2; k++) for (const p of PREFIXES) s = s.replace(p, '');
  s = s
    .replace(/\b\d{2}[/.]\d{2}([/.]\d{2,4})?\b/g, ' ')
    .replace(/\bX{2,}\d+\b/gi, ' ')
    .replace(/\b(FR|CARTE)\s*\d{4,}\b/gi, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) s = raw.trim();
  if (s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|[\s\-'/])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
  }
  return s.slice(0, 80);
}

/* ------------------------------------------------------------------ */
/*  Catégorisation automatique                                         */
/* ------------------------------------------------------------------ */

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export function matchRule(rules: Rule[], text: string): Rule | null {
  const t = fold(text);
  for (const r of [...rules].sort((a, b) => a.order - b.order)) {
    const p = fold(r.pattern.trim());
    if (p && t.includes(p)) return r;
  }
  return null;
}

/** Mémorise la dernière catégorie utilisée pour chaque bénéficiaire. */
export function learnFromHistory(txs: Transaction[]): Map<string, ID> {
  const map = new Map<string, { cat: ID; date: string }>();
  for (const tx of txs) {
    if (!tx.categoryId || tx.type === 'transfer') continue;
    const key = normalizePayee(tx.payee);
    if (!key) continue;
    const cur = map.get(key);
    if (!cur || cur.date <= tx.date) map.set(key, { cat: tx.categoryId, date: tx.date });
  }
  return new Map([...map].map(([k, v]) => [k, v.cat]));
}

export function suggestCategory(
  payee: string,
  memo: string,
  rules: Rule[],
  history: Map<string, ID>,
  categories: Category[],
  hint?: string,
): { categoryId: ID | null; rename: string | null } {
  const rule = matchRule(rules, `${payee} ${memo}`);
  if (rule) return { categoryId: rule.categoryId, rename: rule.rename || null };
  const fromHistory = history.get(normalizePayee(payee));
  if (fromHistory) return { categoryId: fromHistory, rename: null };
  if (hint) {
    const h = fold(hint);
    const cat = categories.find((c) => !c.archived && (fold(c.name) === h || fold(c.name).includes(h) || h.includes(fold(c.name))));
    if (cat) return { categoryId: cat.id, rename: null };
  }
  return { categoryId: null, rename: null };
}

/** Empreinte stable d'une ligne importée (quand la banque ne fournit pas d'identifiant). */
export function rowFingerprint(accountId: ID, r: ParsedRow, occurrence = 0): string {
  return r.fitId ? `${accountId}:fit:${r.fitId}` : `${accountId}:${r.date}:${r.amount}:${normalizePayee(r.payee)}:${occurrence}`;
}

/** Doublon probable : même compte, même montant, dates à ±3 jours. */
export function findProbableDuplicate(txs: Transaction[], accountId: ID, r: ParsedRow): Transaction | null {
  const abs = Math.abs(r.amount);
  const type = r.amount < 0 ? 'expense' : 'income';
  const d = new Date(r.date).getTime();
  for (const tx of txs) {
    if (tx.accountId !== accountId || tx.amount !== abs || tx.type !== type) continue;
    if (Math.abs(new Date(tx.date).getTime() - d) <= 3 * 86400000) return tx;
  }
  return null;
}
