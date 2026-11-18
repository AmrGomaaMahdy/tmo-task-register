import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { DrillSpec } from './Drill';
import { useDrill } from './Drill';

export interface GroupLinks {
  id: number;
  code: string;
  name: string;
  need: number;
  deliver: number;
}

const CX = 330, CY = 225, RX = 255, RY = 170, HUB = 44;

/** Radius of a group's circle: grows with its number of links, so busy partners stand out. */
const radius = (total: number) => (total ? 17 + Math.min(13, Math.sqrt(total) * 3.2) : 13);

/**
 * "Links between work groups": the selected group (or ALL) in the centre, every other group around it.
 * Amber arcs into the centre: what our tasks need from that group. Blue arcs out: what our Enable and
 * Support tasks deliver to it. Arc width grows with the number of rows; the number on a group is its total.
 *
 * Picking a group enlarges and highlights it, shows the count on each of its arcs and fades the rest; the
 * tables below follow the pick. The diagram opens full screen with a details card for the picked group.
 */
export default function LinkNetwork({ center, groups, selected, onSelect, drill }: {
  center: string;
  groups: GroupLinks[];
  selected: number | null;
  onSelect: (id: number | null) => void;
  drill: (g: GroupLinks) => DrillSpec | null;
}) {
  const open = useDrill();
  const [full, setFull] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  const exitFull = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);
  const enterFull = () => {
    setFull(true);
    // The whole page goes full screen (where the browser allows it), so tooltips and dialogs still show.
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  useEffect(() => {
    if (!full) return;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitFull(); };
    const onChange = () => { if (!document.fullscreenElement) setFull(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onChange);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onChange);
      document.body.classList.remove('no-scroll');
    };
  }, [full, exitFull]);

  const pos = groups.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, groups.length);
    return [CX + RX * Math.cos(a), CY + RY * Math.sin(a)] as const;
  });
  const focus = selected ?? hover;
  const picked = groups.find((g) => g.id === selected) ?? null;
  const totals = groups.reduce((t, g) => ({ need: t.need + g.need, deliver: t.deliver + g.deliver }), { need: 0, deliver: 0 });
  const showRows = (g: GroupLinks) => {
    const spec = drill(g);
    if (!spec || !spec.rows.length) return;
    exitFull();
    open(spec);
  };

  const view = (
    <div className={`net${full ? ' net-full' : ''}${focus !== null ? ' focusing' : ''}`}>
      <div className="net-bar">
        {full && <strong className="net-title">Links between work groups · {center}</strong>}
        <span className="net-sum">
          <b className="amber">{totals.need}</b> needed from partners · <b className="acc">{totals.deliver}</b> delivered to others
        </span>
        <button ref={full ? closeBtn : undefined} type="button" className="btn sm net-fs" onClick={full ? exitFull : enterFull}
          aria-label={full ? 'Exit full screen' : 'Full screen'} data-tip={full ? 'Exit full screen (Esc)' : 'Show the diagram full screen'}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            {full
              ? <path d="M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              : <path d="M1 6V1h5M15 6V1h-5M1 10v5h5M15 10v5h-5" fill="none" stroke="currentColor" strokeWidth="1.6" />}
          </svg>
          <span>{full ? 'Exit full screen' : 'Full screen'}</span>
        </button>
      </div>
      <div className="net-body">
        <svg viewBox="-70 -6 800 470" role="img" aria-label="Links with other work groups">
          <defs>
            <marker id="ah-a" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--amber)" /></marker>
            <marker id="ah-b" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" /></marker>
            <radialGradient id="net-hub" cx="35%" cy="30%" r="75%">
              <stop offset="0%" style={{ stopColor: 'color-mix(in srgb, var(--accent) 55%, white)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--accent-deep)' }} />
            </radialGradient>
            <radialGradient id="net-node" cx="35%" cy="30%" r="80%">
              <stop offset="0%" style={{ stopColor: 'var(--surface)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--surface2)' }} />
            </radialGradient>
            <radialGradient id="net-sel" cx="35%" cy="30%" r="80%">
              <stop offset="0%" style={{ stopColor: 'color-mix(in srgb, var(--gold) 45%, white)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--gold)' }} />
            </radialGradient>
            <radialGradient id="net-halo">
              <stop offset="55%" style={{ stopColor: 'var(--accent)', stopOpacity: .28 }} />
              <stop offset="100%" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} />
            </radialGradient>
          </defs>
          {/* the orbit the groups sit on */}
          <ellipse cx={CX} cy={CY} rx={RX} ry={RY} className="orbit" />
          <circle cx={CX} cy={CY} r={HUB + 26} fill="url(#net-halo)" className="hub-halo" />
          {groups.map((g, i) => {
            const [gx, gy] = pos[i];
            const r = radius(g.need + g.deliver);
            const dx = gx - CX, dy = gy - CY, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
            const p1 = [CX + ux * (HUB + 4), CY + uy * (HUB + 4)], p2 = [gx - ux * (r + 6), gy - uy * (r + 6)];
            const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
            const bend = 26;
            const cIn = [mid[0] + nx * bend, mid[1] + ny * bend], cOut = [mid[0] - nx * bend, mid[1] - ny * bend];
            const on = focus === g.id;
            const dim = focus !== null && !on;
            // the label sits at the arc's middle: half way between the mid-point and the control point
            const lIn = [mid[0] + nx * bend / 2, mid[1] + ny * bend / 2], lOut = [mid[0] - nx * bend / 2, mid[1] - ny * bend / 2];
            return (
              <g key={`e${g.code}`} className={`edges${on ? ' on' : ''}${dim ? ' dim' : ''}`}>
                {g.need > 0 && (
                  <path className="edge need" d={`M${p2[0]},${p2[1]} Q${cIn[0]},${cIn[1]} ${p1[0]},${p1[1]}`}
                    stroke="var(--amber)" strokeWidth={1.6 + Math.min(9, g.need * 1.2)} markerEnd="url(#ah-a)" />
                )}
                {g.deliver > 0 && (
                  <path className="edge out" d={`M${p1[0]},${p1[1]} Q${cOut[0]},${cOut[1]} ${p2[0]},${p2[1]}`}
                    stroke="var(--accent)" strokeWidth={1.6 + Math.min(9, g.deliver * 1.2)} markerEnd="url(#ah-b)" />
                )}
                {on && g.need > 0 && <EdgeCount x={lIn[0]} y={lIn[1]} n={g.need} kind="need" />}
                {on && g.deliver > 0 && <EdgeCount x={lOut[0]} y={lOut[1]} n={g.deliver} kind="out" />}
              </g>
            );
          })}
          <g className="node hub">
            <circle cx={CX} cy={CY} r={HUB} fill="url(#net-hub)" />
            <text x={CX} y={CY + 6} textAnchor="middle" style={{ fontSize: center.length > 3 ? 15 : 18 }}>{center}</text>
          </g>
          {groups.map((g, i) => {
            const [x, y] = pos[i];
            const total = g.need + g.deliver;
            const r = radius(total);
            const isSel = selected === g.id;
            const on = focus === g.id;
            const dim = focus !== null && !on;
            const off = isSel ? r * 0.45 + 10 : 8;
            const anchor = x < CX - 20 ? 'end' : x > CX + 20 ? 'start' : 'middle';
            const tx = anchor === 'end' ? x - r - off : anchor === 'start' ? x + r + off : x;
            const ty = anchor === 'middle' ? (y < CY ? y - r - off : y + r + off + 10) : y + 4;
            const pick = () => onSelect(isSel ? null : g.id);
            return (
              <g key={g.code} className={`node${isSel ? ' sel' : ''}${on ? ' on' : ''}${dim ? ' dim' : ''}${total ? '' : ' empty'}`}
                tabIndex={0} role="button" aria-pressed={isSel} aria-label={`${g.code} – ${g.name}: ${total} links`}
                data-tip={`${g.code} – ${g.name}\nWe need from them: ${g.need}\nWe deliver to them: ${g.deliver}\n${isSel ? 'Click again to show all groups' : 'Click to highlight it and filter the tables'}`}
                onClick={pick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
                onMouseEnter={() => setHover(g.id)} onMouseLeave={() => setHover(null)}
                onDoubleClick={() => showRows(g)}>
                {isSel && <circle cx={x} cy={y} r={r + 9} className="ring" />}
                <circle cx={x} cy={y} r={r} className="disc" fill={isSel ? 'url(#net-sel)' : 'url(#net-node)'} />
                <text x={x} y={y + (isSel ? 6 : 4)} textAnchor="middle" className="cnt">{total || ''}</text>
                <text x={tx} y={ty} textAnchor={anchor} className="lbl">{g.code}</text>
              </g>
            );
          })}
        </svg>
        {full && (
          <aside className="net-card" aria-live="polite">
            {picked ? (
              <>
                <div className="t2">Selected group</div>
                <h3><span className="tag wg">{picked.code}</span> {picked.name}</h3>
                <dl>
                  <div><dt>We need from them</dt><dd className="amber">{picked.need}</dd></div>
                  <div><dt>We deliver to them</dt><dd className="acc">{picked.deliver}</dd></div>
                  <div><dt>All links</dt><dd>{picked.need + picked.deliver}</dd></div>
                </dl>
                <div className="net-card-act">
                  {(drill(picked)?.rows.length ?? 0) > 0 && <button type="button" className="btn sm pri" onClick={() => showRows(picked)}>Show the rows</button>}
                  <button type="button" className="btn sm" onClick={() => onSelect(null)}>Show all groups</button>
                </div>
              </>
            ) : (
              <>
                <div className="t2">Pick a group</div>
                <p>Click a circle to enlarge it, see the number of links on each arc, and filter the tables below.</p>
                <ul className="net-rank">
                  {[...groups].filter((g) => g.need + g.deliver > 0).sort((a, b) => b.need + b.deliver - (a.need + a.deliver)).slice(0, 6).map((g) => (
                    <li key={g.id}><button type="button" className="dn" onClick={() => onSelect(g.id)}><span className="tag wg">{g.code}</span> {g.name}</button><b>{g.need + g.deliver}</b></li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        )}
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--amber)' }} />We need from partners</span>
        <span><i style={{ background: 'var(--accent)' }} />We deliver to them</span>
        <span className="t2">Circle size and number: links with the group. Double-click a group for its rows.</span>
      </div>
    </div>
  );
  // Full screen is drawn at the end of <body>, above the page header and outside any animated page layer.
  return full ? <>{createPortal(view, document.body)}<div className="net-placeholder" /></> : view;
}

function EdgeCount({ x, y, n, kind }: { x: number; y: number; n: number; kind: 'need' | 'out' }) {
  const w = 14 + String(n).length * 7;
  return (
    <g className={`ecount ${kind}`}>
      <rect x={x - w / 2} y={y - 10} width={w} height={20} rx={10} />
      <text x={x} y={y + 4} textAnchor="middle">{n}</text>
    </g>
  );
}
