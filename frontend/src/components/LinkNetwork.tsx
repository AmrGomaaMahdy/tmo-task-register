import { useMemo, useState } from 'react';

import type { DrillSpec } from './Drill';
import { useDrill } from './Drill';
import { FullScreenButton, FullScreenFrame, useFullScreen } from './FullScreen';

export interface GroupLinks {
  id: number;
  code: string;
  name: string;
  need: number;
  deliver: number;
}

const CX = 330, CY = 228, RX = 262, RY = 172, HUB = 46;

/** Radius of a group's circle: grows with its number of links, so busy partners stand out. */
const radius = (total: number) => (total ? 18 + Math.min(13, Math.sqrt(total) * 3.2) : 12);

/**
 * "Links between work groups": the selected group (or ALL) in the centre, every other group on an orbit
 * around it, the busiest at the top and going clockwise. Amber arrows into the centre: what our tasks need
 * from that group. Blue arrows out: what our Enable and Support tasks deliver to it. An arrow is as thick
 * as its number of rows; a group's circle shows its total, and its ring is split amber / blue in the same
 * proportion, so the balance reads at a glance.
 *
 * Hovering or picking a group shows the number on each of its arrows and fades the rest; picking it also
 * filters the tables below. Double-click a group for its rows. The diagram opens full screen.
 */
export default function LinkNetwork({ center, groups, selected, onSelect, drill }: {
  center: string;
  groups: GroupLinks[];
  selected: number | null;
  onSelect: (id: number | null) => void;
  drill: (g: GroupLinks) => DrillSpec | null;
}) {
  const open = useDrill();
  const fs = useFullScreen();
  const [hover, setHover] = useState<number | null>(null);

  // Busiest first, from the top clockwise; groups without links at the end.
  const ordered = useMemo(
    () => [...groups].sort((a, b) => b.need + b.deliver - (a.need + a.deliver) || a.code.localeCompare(b.code)),
    [groups],
  );
  const pos = ordered.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, ordered.length);
    return [CX + RX * Math.cos(a), CY + RY * Math.sin(a)] as const;
  });
  const focus = selected ?? hover;
  const picked = groups.find((g) => g.id === selected) ?? null;
  const focused = groups.find((g) => g.id === focus) ?? null;
  const totals = groups.reduce((t, g) => ({ need: t.need + g.need, deliver: t.deliver + g.deliver }), { need: 0, deliver: 0 });
  const linked = groups.filter((g) => g.need + g.deliver > 0).length;
  const showRows = (g: GroupLinks) => {
    const spec = drill(g);
    if (!spec || !spec.rows.length) return;
    fs.exit();
    open(spec);
  };

  const diagram = (
    // Its own .net wrapper, so the diagram keeps its look when full screen moves it out of the page.
    <div className={`net net-stage${focus !== null ? ' focusing' : ''}`}>
    <div className={`net-body${fs.full && picked ? ' with-card' : ''}`}>
      <svg viewBox="-80 -40 820 514" role="img" aria-label="Links with other work groups">
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
            <stop offset="0%" style={{ stopColor: 'color-mix(in srgb, var(--gold) 40%, white)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--gold)' }} />
          </radialGradient>
          <radialGradient id="net-halo">
            <stop offset="55%" style={{ stopColor: 'var(--accent)', stopOpacity: 0.26 }} />
            <stop offset="100%" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        {/* the orbit the groups sit on */}
        <ellipse cx={CX} cy={CY} rx={RX} ry={RY} className="orbit" />
        <circle cx={CX} cy={CY} r={HUB + 28} fill="url(#net-halo)" className="hub-halo" />
        {ordered.map((g, i) => {
          const [gx, gy] = pos[i];
          const r = radius(g.need + g.deliver);
          const dx = gx - CX, dy = gy - CY, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
          const p1 = [CX + ux * (HUB + 5), CY + uy * (HUB + 5)], p2 = [gx - ux * (r + 8), gy - uy * (r + 8)];
          const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
          const bend = 24;
          const cIn = [mid[0] + nx * bend, mid[1] + ny * bend], cOut = [mid[0] - nx * bend, mid[1] - ny * bend];
          const on = focus === g.id;
          const dim = focus !== null && !on;
          const lIn = [mid[0] + (nx * bend) / 2, mid[1] + (ny * bend) / 2], lOut = [mid[0] - (nx * bend) / 2, mid[1] - (ny * bend) / 2];
          return (
            <g key={`e${g.code}`} className={`edges${on ? ' on' : ''}${dim ? ' dim' : ''}`}>
              {g.need > 0 && (
                <path className="edge need" d={`M${p2[0]},${p2[1]} Q${cIn[0]},${cIn[1]} ${p1[0]},${p1[1]}`}
                  stroke="var(--amber)" strokeWidth={1.8 + Math.min(9, g.need * 1.1)} markerEnd="url(#ah-a)" />
              )}
              {g.deliver > 0 && (
                <path className="edge out" d={`M${p1[0]},${p1[1]} Q${cOut[0]},${cOut[1]} ${p2[0]},${p2[1]}`}
                  stroke="var(--accent)" strokeWidth={1.8 + Math.min(9, g.deliver * 1.1)} markerEnd="url(#ah-b)" />
              )}
              {on && g.need > 0 && <EdgeCount x={lIn[0]} y={lIn[1]} n={g.need} kind="need" />}
              {on && g.deliver > 0 && <EdgeCount x={lOut[0]} y={lOut[1]} n={g.deliver} kind="out" />}
            </g>
          );
        })}
        <g className="node hub">
          <circle cx={CX} cy={CY} r={HUB} fill="url(#net-hub)" />
          <text x={CX} y={CY + 2} textAnchor="middle" className="hub-code" style={{ fontSize: center.length > 3 ? 16 : 19 }}>{center}</text>
          <text x={CX} y={CY + 20} textAnchor="middle" className="hub-sub">{`${linked} groups`}</text>
        </g>
        {ordered.map((g, i) => {
          const [x, y] = pos[i];
          const total = g.need + g.deliver;
          const r = radius(total);
          const isSel = selected === g.id;
          const on = focus === g.id;
          const dim = focus !== null && !on;
          const off = isSel ? r * 0.45 + 12 : 10;
          const anchor = x < CX - 20 ? 'end' : x > CX + 20 ? 'start' : 'middle';
          const tx = anchor === 'end' ? x - r - off : anchor === 'start' ? x + r + off : x;
          const above = anchor === 'middle' && y < CY;
          const ty = anchor === 'middle' ? (above ? y - r - off - 16 : y + r + off + 10) : y - 2;
          // Above the circle the arrows line sits under the code, so neither runs into the circle.
          const subY = above ? ty + 13 : ty + 14;
          const lblY = ty;
          const pick = () => onSelect(isSel ? null : g.id);
          // The ring around the circle: amber for what we need, blue for what we deliver.
          const ringR = r + 4;
          const C = 2 * Math.PI * ringR;
          const a = total ? (C * g.need) / total : 0;
          return (
            <g key={g.code} className={`node${isSel ? ' sel' : ''}${on ? ' on' : ''}${dim ? ' dim' : ''}${total ? '' : ' empty'}`}
              tabIndex={0} role="button" aria-pressed={isSel} aria-label={`${g.code} – ${g.name}: we need from them ${g.need}, we deliver to them ${g.deliver}`}
              data-tip={`${g.code} – ${g.name}\nWe need from them: ${g.need}\nWe deliver to them: ${g.deliver}\n${isSel ? 'Click again to show all groups' : 'Click to highlight it and filter the tables'}`}
              onClick={pick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
              onMouseEnter={() => setHover(g.id)} onMouseLeave={() => setHover(null)}
              onDoubleClick={() => showRows(g)}>
              <g className="scale" style={{ transformOrigin: `${x}px ${y}px` }}>
                {isSel && <circle cx={x} cy={y} r={r + 10} className="ring" />}
                <circle cx={x} cy={y} r={r} className="disc" fill={isSel ? 'url(#net-sel)' : 'url(#net-node)'} />
                {total > 0 && (
                  <g transform={`rotate(-90 ${x} ${y})`} className="split">
                    {g.need > 0 && <circle cx={x} cy={y} r={ringR} stroke="var(--amber)" strokeDasharray={`${a} ${C}`} />}
                    {g.deliver > 0 && <circle cx={x} cy={y} r={ringR} stroke="var(--accent)" strokeDasharray={`${C - a} ${C}`} strokeDashoffset={-a} />}
                  </g>
                )}
                <text x={x} y={y + 4.5} textAnchor="middle" className="cnt">{total || ''}</text>
              </g>
              <text x={tx} y={lblY} textAnchor={anchor} className="lbl">{g.code}</text>
              {total > 0 && (
                <text x={tx} y={subY} textAnchor={anchor} className="sub">
                  {g.need > 0 && <tspan className="in">↓{g.need}</tspan>}
                  {g.need > 0 && g.deliver > 0 && <tspan> </tspan>}
                  {g.deliver > 0 && <tspan className="out">↑{g.deliver}</tspan>}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {fs.full && picked && (
        <aside className="net-card" aria-live="polite">
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
        </aside>
      )}
    </div>
    </div>
  );

  return (
    <div className={`net${focus !== null ? ' focusing' : ''}`}>
      <div className="net-bar">
        <span className="net-kpi need"><b>{totals.need}</b><span>needed from other groups</span></span>
        <span className="net-kpi out"><b>{totals.deliver}</b><span>delivered to other groups</span></span>
        <span className="spacer" />
        <FullScreenButton full={fs.full} onClick={fs.toggle} />
      </div>
      <p className={`net-focus${focused ? ' on' : ''}`} aria-live="polite">
        {focused ? (
          <>
            <span className="tag wg">{focused.code}</span> <b>{focused.name}</b>
            <span className="amber">{` · ↓ ${focused.need} we need from them`}</span>
            <span className="acc">{` · ↑ ${focused.deliver} we deliver to them`}</span>
            {selected === focused.id && (drill(focused)?.rows.length ?? 0) > 0 && <> · <button type="button" className="dn" onClick={() => showRows(focused)}>show the rows</button></>}
          </>
        ) : <span className="t2">Point at a group to see its links; click it to filter the tables below.</span>}
      </p>
      <FullScreenFrame full={fs.full} onExit={fs.exit} title={`Links between work groups · ${center}`}
        actions={picked ? <button type="button" className="btn sm" onClick={() => onSelect(null)}>Show all groups</button> : undefined}>
        {diagram}
      </FullScreenFrame>
      <div className="legend net-legend">
        <span><svg width="26" height="10" aria-hidden="true"><path d="M2 5h17" stroke="var(--amber)" strokeWidth="3" strokeDasharray="5 3" /><path d="M18 1l6 4-6 4z" fill="var(--amber)" /></svg>Into the centre: we need from them</span>
        <span><svg width="26" height="10" aria-hidden="true"><path d="M2 5h17" stroke="var(--accent)" strokeWidth="3" strokeDasharray="5 3" /><path d="M18 1l6 4-6 4z" fill="var(--accent)" /></svg>Out of the centre: we deliver to them</span>
        <span className="t2">Circle size and number: all links with the group. Thicker arrow: more rows. Double-click a group for its rows.</span>
      </div>
    </div>
  );
}

function EdgeCount({ x, y, n, kind }: { x: number; y: number; n: number; kind: 'need' | 'out' }) {
  const w = 16 + String(n).length * 8;
  return (
    <g className={`ecount ${kind}`}>
      <rect x={x - w / 2} y={y - 11} width={w} height={22} rx={11} />
      <text x={x} y={y + 4.5} textAnchor="middle">{n}</text>
    </g>
  );
}
