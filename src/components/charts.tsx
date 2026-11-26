import { useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatMoney } from '../lib/money';
import { cn, PrivacyContext } from './ui';

/* Graphiques SVG faits main : légers, nets, lisibles en clair comme en sombre.
   Règles : barres ≤ 24 px aux extrémités arrondies, lignes de 2 px, grille discrète,
   info-bulle au survol / au toucher, légende dès 2 séries. */

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (max === min) max = min + 1;
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

const axisMoney = (v: number) => formatMoney(v, { compact: true });

export interface Series {
  name: string;
  color: string;
  values: (number | null)[];
}

export function Legend({ series, shape = 'rect' }: { series: { name: string; color: string }[]; shape?: 'rect' | 'line' }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          {shape === 'rect' ? (
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
          ) : (
            <span className="h-0.5 w-3.5 rounded-full" style={{ background: s.color }} />
          )}
          {s.name}
        </li>
      ))}
    </ul>
  );
}

function Tooltip({ x, width, title, rows }: { x: number; width: number; title: ReactNode; rows: { name: string; color: string; value: string }[] }) {
  const hidden = useContext(PrivacyContext);
  const left = Math.min(Math.max(x, 80), width - 80);
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 min-w-[9rem] -translate-x-1/2 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-pop"
      style={{ left }}
      role="status"
    >
      <p className="mb-1 font-medium text-muted">{title}</p>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2 py-0.5">
          <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
          <span className={cn('tabular font-semibold text-ink', hidden && 'privacy-blur')}>{r.value}</span>
          <span className="truncate text-muted">{r.name}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Colonnes groupées                                                  */
/* ------------------------------------------------------------------ */

export function ColumnChart({
  labels,
  fullLabels,
  series,
  height = 220,
  ariaLabel,
}: {
  labels: string[];
  fullLabels?: string[];
  series: Series[];
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 12, right: 8, bottom: 26, left: 56 };
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const ticks = niceTicks(0, max);
  const top = ticks[ticks.length - 1];
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const band = labels.length ? innerW / labels.length : 0;
  const gap = 2;
  const barW = Math.max(3, Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;
  const labelEvery = Math.ceil(labels.length / Math.max(1, Math.floor(innerW / 44)));

  return (
    <div className="space-y-3">
      <Legend series={series} />
      <div ref={ref} className="relative" onPointerLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} />
                <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-[var(--muted)] text-[11px]">
                  {axisMoney(t)}
                </text>
              </g>
            ))}
            {labels.map((l, i) => {
              const x0 = pad.left + band * i + (band - groupW) / 2;
              return (
                <g key={i}>
                  {hover === i && <rect x={pad.left + band * i} y={pad.top} width={band} height={innerH} fill="var(--surface-2)" rx={6} />}
                  {series.map((s, si) => {
                    const v = s.values[i] ?? 0;
                    if (v <= 0) return null;
                    const x = x0 + si * (barW + gap);
                    const h = Math.max(1, y(0) - y(v));
                    const r = Math.min(4, barW / 2, h);
                    const yt = y(0) - h;
                    return (
                      <path
                        key={si}
                        d={`M${x},${y(0)} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + barW - r} Q${x + barW},${yt} ${x + barW},${yt + r} V${y(0)} Z`}
                        fill={s.color}
                        opacity={hover === null || hover === i ? 1 : 0.55}
                      />
                    );
                  })}
                  {i % labelEvery === 0 && (
                    <text x={pad.left + band * i + band / 2} y={height - 8} textAnchor="middle" className="fill-[var(--muted)] text-[11px]">
                      {l}
                    </text>
                  )}
                  <rect
                    x={pad.left + band * i}
                    y={pad.top}
                    width={band}
                    height={innerH + pad.bottom}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${fullLabels?.[i] ?? l} : ${series.map((s) => `${s.name} ${formatMoney(s.values[i] ?? 0)}`).join(', ')}`}
                    onPointerEnter={() => setHover(i)}
                    onPointerDown={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    style={{ outline: 'none' }}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {hover !== null && width > 0 && (
          <Tooltip
            x={pad.left + band * hover + band / 2}
            width={width}
            title={fullLabels?.[hover] ?? labels[hover]}
            rows={series.map((s) => ({ name: s.name, color: s.color, value: formatMoney(s.values[hover] ?? 0) }))}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Courbes (avec réticule)                                            */
/* ------------------------------------------------------------------ */

export function LineChart({
  labels,
  fullLabels,
  series,
  height = 200,
  ariaLabel,
  area = true,
  zeroBased = true,
  marker,
}: {
  labels: string[];
  fullLabels?: string[];
  series: Series[];
  height?: number;
  ariaLabel: string;
  area?: boolean;
  zeroBased?: boolean;
  /** Index vertical à souligner (ex. aujourd'hui) */
  marker?: { index: number; label: string };
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 12, right: 12, bottom: 26, left: 60 };
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const minV = zeroBased ? Math.min(0, ...all) : Math.min(...all);
  const maxV = Math.max(1, ...all);
  const ticks = niceTicks(minV, maxV);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const n = labels.length;
  const x = (i: number) => pad.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;
  const labelEvery = Math.ceil(n / Math.max(1, Math.floor(innerW / 48)));

  const paths = useMemo(
    () =>
      series.map((s) => {
        let d = '';
        let started = false;
        let last = -1;
        s.values.forEach((v, i) => {
          if (v == null) return;
          d += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
          started = true;
          last = i;
        });
        const first = s.values.findIndex((v) => v != null);
        const areaD = started ? `${d}L${x(last).toFixed(1)},${y(Math.max(lo, 0))} L${x(first).toFixed(1)},${y(Math.max(lo, 0))} Z` : '';
        return { d, areaD, last };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, width, lo, hi],
  );

  const onMove = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left - pad.left;
    const i = Math.round((px / (innerW || 1)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className="space-y-3">
      <Legend series={series} shape="line" />
      <div
        ref={ref}
        className="relative touch-pan-y"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
        tabIndex={0}
        aria-label={ariaLabel}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
          if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n) - 1));
        }}
        onBlur={() => setHover(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} />
                <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-[var(--muted)] text-[11px]">
                  {axisMoney(t)}
                </text>
              </g>
            ))}
            {labels.map((l, i) =>
              i % labelEvery === 0 ? (
                <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="fill-[var(--muted)] text-[11px]">
                  {l}
                </text>
              ) : null,
            )}
            {marker && marker.index >= 0 && marker.index < n && (
              <g>
                <line x1={x(marker.index)} x2={x(marker.index)} y1={pad.top} y2={pad.top + innerH} stroke="var(--axis)" strokeWidth={1} />
                <text x={x(marker.index) + 4} y={pad.top + 10} className="fill-[var(--muted)] text-[10px]">
                  {marker.label}
                </text>
              </g>
            )}
            {area && paths[0]?.areaD && <path d={paths[0].areaD} fill={series[0].color} opacity={0.1} />}
            {paths.map((p, si) => (
              <path key={si} d={p.d} fill="none" stroke={series[si].color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {paths.map((p, si) =>
              p.last >= 0 && hover === null ? (
                <circle key={si} cx={x(p.last)} cy={y(series[si].values[p.last]!)} r={4} fill={series[si].color} stroke="var(--surface)" strokeWidth={2} />
              ) : null,
            )}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} stroke="var(--axis)" strokeWidth={1} />
                {series.map((s, si) =>
                  s.values[hover] != null ? <circle key={si} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} /> : null,
                )}
              </g>
            )}
          </svg>
        )}
        {hover !== null && width > 0 && (
          <Tooltip
            x={x(hover)}
            width={width}
            title={fullLabels?.[hover] ?? labels[hover]}
            rows={series.filter((s) => s.values[hover] != null).map((s) => ({ name: s.name, color: s.color, value: formatMoney(s.values[hover]!) }))}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Barres horizontales classées                                       */
/* ------------------------------------------------------------------ */

export interface BarItem {
  key: string;
  label: ReactNode;
  value: number;
  sub?: ReactNode;
  onClick?: () => void;
}

export function HBarList({ items, total, color = 'var(--s1)' }: { items: BarItem[]; total?: number; color?: string }) {
  const hidden = useContext(PrivacyContext);
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-1">
      {items.map((it) => {
        const pct = total ? (it.value / total) * 100 : null;
        const Comp = it.onClick ? 'button' : 'div';
        return (
          <li key={it.key}>
            <Comp
              {...(it.onClick ? { type: 'button' as const, onClick: it.onClick } : {})}
              className={cn('group w-full rounded-xl px-2 py-1.5 text-left', it.onClick && 'hover:bg-surface-2')}
              title={`${formatMoney(it.value)}${pct != null ? ` · ${pct.toFixed(1).replace('.', ',')} %` : ''}`}
            >
              <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2 truncate">{it.label}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className={cn('tabular font-semibold', hidden && 'privacy-blur')}>{formatMoney(it.value, { round: true })}</span>
                  {pct != null && <span className="tabular w-10 text-right text-xs text-muted">{Math.round(pct)} %</span>}
                </span>
              </div>
              <div className="h-2 w-full">
                <div className="h-2 rounded-r-[4px] rounded-l-[2px]" style={{ width: `${Math.max(1, (it.value / max) * 100)}%`, background: color }} />
              </div>
              {it.sub && <div className="mt-0.5 text-xs text-muted">{it.sub}</div>}
            </Comp>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Barre segmentée (un tout découpé en parts)                         */
/* ------------------------------------------------------------------ */

export function SegmentBar({ parts, ariaLabel }: { parts: { name: string; value: number; color: string; ink?: string }[]; ariaLabel: string }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0) || 1;
  return (
    <div className="space-y-2">
      <div className="flex h-7 w-full gap-[2px]" role="img" aria-label={ariaLabel}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => {
            const share = (p.value / total) * 100;
            return (
              <div
                key={p.name}
                className="flex h-full items-center overflow-hidden rounded-[4px] px-2 text-xs font-semibold"
                style={{ width: `${share}%`, background: p.color, color: p.ink ?? '#fff' }}
                title={`${p.name} : ${Math.round(share)} %`}
              >
                {share >= 12 ? `${Math.round(share)} %` : ''}
              </div>
            );
          })}
      </div>
      <Legend series={parts} />
    </div>
  );
}
