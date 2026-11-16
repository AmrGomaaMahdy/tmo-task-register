import type { DrillSpec } from './Drill';
import { useDrill } from './Drill';

export interface GroupLinks {
  id: number;
  code: string;
  name: string;
  need: number;
  deliver: number;
}

/**
 * "Links between work groups": the selected group (or ALL) in the centre, every other group around it.
 * Amber arrows into the centre: what our tasks need from that group. Teal arrows out: what our Enable and
 * Support tasks deliver to it. Arrow width grows with the number of rows; the number on a group is its total.
 */
export default function LinkNetwork({ center, groups, selected, onSelect, drill }: {
  center: string;
  groups: GroupLinks[];
  selected: number | null;
  onSelect: (id: number | null) => void;
  drill: (g: GroupLinks) => DrillSpec | null;
}) {
  const open = useDrill();
  const cx = 330, cy = 225, rx = 255, ry = 170;
  const pos = groups.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, groups.length);
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as const;
  });
  return (
    <div className="net">
      <svg viewBox="-70 0 800 460" role="img" aria-label="Links with other work groups">
        <defs>
          <marker id="ah-a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--amber)" /></marker>
          <marker id="ah-b" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" /></marker>
        </defs>
        {groups.map((g, i) => {
          const [gx, gy] = pos[i];
          const dx = gx - cx, dy = gy - cy, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
          const p1 = [cx + ux * 42, cy + uy * 42], p2 = [gx - ux * 24, gy - uy * 24];
          return (
            <g key={`e${g.code}`}>
              {g.need > 0 && (
                <line className="edge" x1={p2[0] + nx * 6} y1={p2[1] + ny * 6} x2={p1[0] + nx * 6} y2={p1[1] + ny * 6}
                  stroke="var(--amber)" strokeWidth={1.5 + g.need * 1.4} markerEnd="url(#ah-a)" />
              )}
              {g.deliver > 0 && (
                <line className="edge" x1={p1[0] - nx * 6} y1={p1[1] - ny * 6} x2={p2[0] - nx * 6} y2={p2[1] - ny * 6}
                  stroke="var(--accent)" strokeWidth={1.5 + g.deliver * 1.4} markerEnd="url(#ah-b)" />
              )}
            </g>
          );
        })}
        <g className="node hub">
          <circle cx={cx} cy={cy} r={40} />
          <text x={cx} y={cy + 6} textAnchor="middle" style={{ fontSize: 17 }}>{center}</text>
        </g>
        {groups.map((g, i) => {
          const [x, y] = pos[i];
          const total = g.need + g.deliver;
          const anchor = x < cx - 20 ? 'end' : x > cx + 20 ? 'start' : 'middle';
          const tx = anchor === 'end' ? x - 28 : anchor === 'start' ? x + 28 : x;
          const ty = anchor === 'middle' ? (y < cy ? y - 30 : y + 40) : y + 4;
          const spec = drill(g);
          const pick = () => onSelect(selected === g.id ? null : g.id);
          return (
            <g key={g.code} className={`node ${selected === g.id ? 'sel' : ''}`} tabIndex={0} role="button" aria-label={`${g.code} – ${g.name}`}
              data-tip={`${g.code} – ${g.name}\nWe need from them: ${g.need}\nWe deliver to them: ${g.deliver}\nClick to filter the tables`}
              onClick={pick} onKeyDown={(e) => { if (e.key === 'Enter') pick(); }}
              onDoubleClick={spec && spec.rows.length ? () => open(spec) : undefined}>
              <circle cx={x} cy={y} r={total ? 20 : 15} style={total ? undefined : { opacity: 0.5 }} />
              <text x={x} y={y + 4} textAnchor="middle" className="cnt">{total || ''}</text>
              <text x={tx} y={ty} textAnchor={anchor}>{g.code}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span><i style={{ background: 'var(--amber)' }} />We need from partners</span>
        <span><i style={{ background: 'var(--accent)' }} />We deliver to them</span>
      </div>
    </div>
  );
}
