import logo from '../assets/al-ayuni-logo.png';
import { fmtDate } from '../lib/format';

/** The program window shown on the "Final Mile to 2027" strip (the Master Plan range). */
export const PROGRAM_START = '2026-09-01';
export const PROGRAM_END = '2027-10-31';
const DAY = 86_400_000;

export function Logo() {
  return (
    <span className="logo" data-tip="Al-Ayuni Investment & Contracting">
      <img src={logo} alt="Al-Ayuni" width={74} height={72} />
    </span>
  );
}

/** How far today is through the program, for the road and its tooltip. */
export function programProgress(today = new Date()) {
  const a = new Date(`${PROGRAM_START}T00:00:00`).getTime();
  const b = new Date(`${PROGRAM_END}T00:00:00`).getTime();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const share = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return { percent: Math.round(share * 100), daysLeft: Math.max(0, Math.round((b - t) / DAY)) };
}

/**
 * "Final Mile to 2027": a shining title over a road that fills to today's share of the program,
 * with a runner at today and the 2027 flag at the end.
 */
export function FinalMile() {
  const { percent, daysLeft } = programProgress();
  const tip = [
    'Final Mile to 2027',
    `The program runs from ${fmtDate(PROGRAM_START)} to ${fmtDate(PROGRAM_END)}.`,
    `Today is ${percent}% of the way: ${daysLeft} days to go.`,
  ].join('\n');
  return (
    <div className="fm" data-tip={tip} style={{ ['--fm' as string]: `${Math.max(3, percent)}%` }}>
      <span className="fm-t">Final Mile to 2027</span>
      <span className="fm-road" aria-hidden="true">
        <span className="fm-fill" />
        <i className="fm-run" />
        <b className="fm-flag">2027</b>
      </span>
    </div>
  );
}
