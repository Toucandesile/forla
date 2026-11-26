import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileUp, Upload } from 'lucide-react';
import { saveMany } from '../db/db';
import type { ID, Transaction } from '../db/schema';
import { useData } from '../state';
import {
  cleanPayee,
  findProbableDuplicate,
  guessMapping,
  learnFromHistory,
  parseCSV,
  parseOFX,
  parseQIF,
  rowFingerprint,
  rowsFromCsv,
  suggestCategory,
  type CsvMapping,
  type ParsedRow,
} from '../lib/importers';
import { numericDate } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { Button, Field, Sheet, Switch, cn } from './ui';

interface Candidate extends ParsedRow {
  key: string;
  importId: string;
  include: boolean;
  duplicate: 'exact' | 'probable' | null;
  categoryId: ID | null;
  cleanName: string;
}

async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  // Beaucoup de banques françaises exportent en Windows-1252 : on bascule si des caractères sont invalides
  if (utf8.includes('�')) return new TextDecoder('windows-1252').decode(buf);
  return utf8;
}

export function ImportWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activeAccounts, accounts, categories, groups, rules, transactions } = useData();
  const [fileName, setFileName] = useState('');
  const [csvRows, setCsvRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [accountId, setAccountId] = useState(activeAccounts[0]?.id ?? '');
  const [cleanNames, setCleanNames] = useState(true);
  const [overrides, setOverrides] = useState<Record<string, Partial<Candidate>>>({});
  const [busy, setBusy] = useState(false);

  function reset() {
    setFileName('');
    setCsvRows(null);
    setMapping(null);
    setParsed(null);
    setOverrides({});
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    reset();
    setFileName(file.name);
    const text = await readText(file);
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.ofx') || lower.endsWith('.qfx') || /<OFX>/i.test(text)) {
      const rows = parseOFX(text);
      if (!rows.length) toast.error('Aucune opération trouvée dans ce fichier OFX.');
      setParsed(rows);
    } else if (lower.endsWith('.qif') || text.startsWith('!Type')) {
      const rows = parseQIF(text);
      if (!rows.length) toast.error('Aucune opération trouvée dans ce fichier QIF.');
      setParsed(rows);
    } else {
      const rows = parseCSV(text);
      if (rows.length < 2) return toast.error('Fichier CSV vide ou illisible.');
      const m = guessMapping(rows);
      setCsvRows(rows);
      setMapping(m);
      if (m.date >= 0 && (m.amount >= 0 || (m.debit >= 0 && m.credit >= 0))) setParsed(rowsFromCsv(rows, m).rows);
    }
  }

  function applyMapping(m: CsvMapping) {
    setMapping(m);
    setOverrides({});
    if (csvRows && m.date >= 0 && (m.amount >= 0 || (m.debit >= 0 || m.credit >= 0))) {
      const r = rowsFromCsv(csvRows, m);
      setParsed(r.rows);
      if (r.errors) toast(`${r.errors} ligne(s) ignorée(s) (date ou montant illisible)`);
    } else setParsed(null);
  }

  const history = useMemo(() => learnFromHistory(transactions), [transactions]);

  const candidates: Candidate[] = useMemo(() => {
    if (!parsed) return [];
    const existingIds = new Set(transactions.map((t) => t.importId).filter(Boolean) as string[]);
    const seen = new Map<string, number>();
    return parsed.map((r, i) => {
      const base = `${r.date}|${r.amount}|${r.payee}`;
      const occ = seen.get(base) ?? 0;
      seen.set(base, occ + 1);
      const importId = rowFingerprint(accountId, r, occ);
      const exact = existingIds.has(importId);
      const probable = !exact && !!findProbableDuplicate(transactions, accountId, r);
      const cleanName = cleanNames ? cleanPayee(r.payee) : r.payee;
      const sug = suggestCategory(cleanName, `${r.payee} ${r.memo}`, rules, history, categories, r.categoryHint);
      const key = String(i);
      const o = overrides[key] ?? {};
      return {
        ...r,
        key,
        importId,
        duplicate: exact ? 'exact' : probable ? 'probable' : null,
        include: o.include ?? !(exact || probable),
        categoryId: o.categoryId !== undefined ? o.categoryId : sug.categoryId,
        cleanName: sug.rename || cleanName,
      };
    });
  }, [parsed, transactions, accountId, cleanNames, rules, history, categories, overrides]);

  const selected = candidates.filter((c) => c.include);
  const categorized = selected.filter((c) => c.categoryId).length;

  async function doImport() {
    if (!accountId) return toast.error('Choisissez le compte concerné.');
    if (!selected.length) return toast.error('Aucune opération sélectionnée.');
    setBusy(true);
    try {
      const txs: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[] = selected.map((c) => {
        const cat = c.categoryId ? categories.find((x) => x.id === c.categoryId) : null;
        const ownerId = accounts.find((a) => a.id === accountId)?.ownerId ?? null;
        const type = c.amount < 0 ? 'expense' : 'income';
        return {
          type,
          date: c.date,
          amount: Math.abs(c.amount),
          accountId,
          toAccountId: null,
          categoryId: cat ? cat.id : null,
          payee: c.cleanName,
          note: c.memo,
          paidBy: type === 'expense' ? ownerId : null,
          split: type === 'expense' && ownerId ? { mode: 'none', shares: { [ownerId]: Math.abs(c.amount) } } : { mode: 'none', shares: {} },
          cleared: true,
          recurringId: null,
          importId: c.importId,
          hasReceipt: false,
        };
      });
      await saveMany('transactions', txs);
      toast.success(`${txs.length} opération${txs.length > 1 ? 's' : ''} importée${txs.length > 1 ? 's' : ''}`);
      reset();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const header = csvRows && mapping ? csvRows[mapping.headerRow] ?? [] : [];
  const colOptions = (
    <>
      <option value={-1}>—</option>
      {header.map((h, i) => (
        <option key={i} value={i}>
          {h || `Colonne ${i + 1}`}
        </option>
      ))}
    </>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title="Importer un relevé bancaire"
      footer={
        candidates.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted">
              {selected.length} sélectionnée{selected.length > 1 ? 's' : ''} · {categorized} catégorisée{categorized > 1 ? 's' : ''} automatiquement
            </p>
            <Button variant="primary" className="ml-auto" icon={<Upload size={16} />} onClick={doImport} disabled={busy || !selected.length}>
              Importer
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line p-6 text-center hover:bg-surface-2">
          <FileUp size={28} className="text-primary" />
          <span className="font-medium">{fileName || 'Choisir un fichier CSV, OFX ou QIF'}</span>
          <span className="text-xs text-muted">Exportez-le depuis l’espace client de votre banque. Le fichier est lu sur votre appareil, rien n’est envoyé.</span>
          <input type="file" accept=".csv,.txt,.ofx,.qfx,.qif,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>

        {(parsed || csvRows) && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Compte concerné" htmlFor="imp-acc">
              <select id="imp-acc" className="field" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end">
              <div className="w-full rounded-2xl border border-line px-3">
                <Switch checked={cleanNames} onChange={setCleanNames} label="Nettoyer les libellés" description="« CB CARREFOUR 12/11 » → « Carrefour »" />
              </div>
            </div>
          </div>
        )}

        {csvRows && mapping && (
          <details className="rounded-2xl border border-line p-3" open={!parsed}>
            <summary className="cursor-pointer text-sm font-medium">Correspondance des colonnes (détectée automatiquement)</summary>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Date" htmlFor="m-date">
                <select id="m-date" className="field" value={mapping.date} onChange={(e) => applyMapping({ ...mapping, date: Number(e.target.value) })}>
                  {colOptions}
                </select>
              </Field>
              <Field label="Libellé" htmlFor="m-payee">
                <select id="m-payee" className="field" value={mapping.payee} onChange={(e) => applyMapping({ ...mapping, payee: Number(e.target.value) })}>
                  {colOptions}
                </select>
              </Field>
              <Field label="Montant (signé)" htmlFor="m-amount">
                <select id="m-amount" className="field" value={mapping.amount} onChange={(e) => applyMapping({ ...mapping, amount: Number(e.target.value) })}>
                  {colOptions}
                </select>
              </Field>
              <Field label="ou Débit" htmlFor="m-debit">
                <select id="m-debit" className="field" value={mapping.debit} onChange={(e) => applyMapping({ ...mapping, debit: Number(e.target.value), amount: -1 })}>
                  {colOptions}
                </select>
              </Field>
              <Field label="et Crédit" htmlFor="m-credit">
                <select id="m-credit" className="field" value={mapping.credit} onChange={(e) => applyMapping({ ...mapping, credit: Number(e.target.value), amount: -1 })}>
                  {colOptions}
                </select>
              </Field>
              <Field label="Format de date" htmlFor="m-order">
                <select id="m-order" className="field" value={mapping.dateOrder} onChange={(e) => applyMapping({ ...mapping, dateOrder: e.target.value as 'dmy' | 'mdy' })}>
                  <option value="dmy">JJ/MM/AAAA</option>
                  <option value="mdy">MM/JJ/AAAA</option>
                </select>
              </Field>
            </div>
            <div className="mt-2">
              <Switch checked={mapping.invert} onChange={(v) => applyMapping({ ...mapping, invert: v })} label="Inverser le signe des montants" description="Si vos dépenses apparaissent en positif" />
            </div>
          </details>
        )}

        {candidates.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-line">
            <div className="max-h-[45vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-[1] bg-surface-2 text-xs text-muted">
                  <tr>
                    <th className="w-8 p-2">
                      <input
                        type="checkbox"
                        aria-label="Tout sélectionner"
                        checked={selected.length === candidates.length}
                        onChange={(e) => setOverrides(Object.fromEntries(candidates.map((c) => [c.key, { ...overrides[c.key], include: e.target.checked }])))}
                      />
                    </th>
                    <th className="p-2 text-left font-medium">Date</th>
                    <th className="p-2 text-left font-medium">Libellé</th>
                    <th className="p-2 text-left font-medium">Catégorie</th>
                    <th className="p-2 text-right font-medium">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.key} className={cn('border-t border-line', !c.include && 'opacity-50')}>
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Importer ${c.cleanName}`}
                          checked={c.include}
                          onChange={(e) => setOverrides((o) => ({ ...o, [c.key]: { ...o[c.key], include: e.target.checked } }))}
                        />
                      </td>
                      <td className="tabular p-2 whitespace-nowrap">{numericDate(c.date)}</td>
                      <td className="max-w-[14rem] p-2">
                        <span className="block truncate font-medium" title={c.payee}>
                          {c.cleanName}
                        </span>
                        {c.duplicate && (
                          <span className="text-xs text-warning-ink">{c.duplicate === 'exact' ? 'Déjà importée' : 'Doublon probable'}</span>
                        )}
                      </td>
                      <td className="p-2">
                        <select
                          className="field h-8 min-w-[9rem] py-0 text-xs"
                          aria-label={`Catégorie de ${c.cleanName}`}
                          value={c.categoryId ?? ''}
                          onChange={(e) => setOverrides((o) => ({ ...o, [c.key]: { ...o[c.key], categoryId: e.target.value || null } }))}
                        >
                          <option value="">— À catégoriser —</option>
                          {groups.map((g) => (
                            <optgroup key={g.id} label={g.name}>
                              {categories
                                .filter((x) => x.groupId === g.id && !x.archived)
                                .map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.emoji} {x.name}
                                  </option>
                                ))}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                      <td className={cn('tabular p-2 text-right font-semibold whitespace-nowrap', c.amount > 0 && 'text-success')}>{formatMoney(c.amount, { signed: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {fileName && parsed && parsed.length === 0 && <p className="text-sm text-muted">Aucune opération lisible : vérifiez la correspondance des colonnes.</p>}
        <p className="text-xs text-muted">
          Formats pris en charge : CSV (toutes banques, séparateur « ; » ou « , »), OFX/QFX (format « Money ») et QIF. Les doublons sont détectés et décochés
          automatiquement.
        </p>
      </div>
    </Sheet>
  );
}
