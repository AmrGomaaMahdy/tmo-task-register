import type { ReactNode } from 'react';

import type { Status } from '../api/types';
import logo from '../assets/al-ayuni-logo.png';
import { fmtDate, fmtStamp } from '../lib/format';

export const STAGES: Status[] = ['draft', 'needs_completion', 'ready', 'leader_approved', 'in_master_plan'];
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Rows cut into pages: `first` rows on the first page (under the header), `next` on each page after it. */
export function paginate<T>(rows: T[], first: number, next: number): T[][] {
  const pages: T[][] = [rows.slice(0, first)];
  for (let i = first; i < rows.length; i += next) pages.push(rows.slice(i, i + next));
  return pages;
}

/** What every report page shares: who it is for, when it was made and where we are in it. */
export interface Stamp {
  generatedAt: string;
  preparedBy: string;
  scope: string;
}

export function ReportHead({ title, stamp, sub }: { title: string; stamp: Stamp; sub?: string }) {
  return (
    <header className="rp-head">
      <img src={logo} alt="Al-Ayuni" width={58} height={56} />
      <div className="rp-head-t">
        <span className="rp-kicker">Management board · Al-Ayuni TMO Task Register</span>
        <h2>{title}</h2>
        <span className="rp-scope">{sub ?? stamp.scope}</span>
      </div>
      <div className="rp-head-m">
        <span>{fmtDate(stamp.generatedAt.slice(0, 10))}</span>
        <span className="rp-dim">{`Prepared by ${stamp.preparedBy}`}</span>
      </div>
    </header>
  );
}

/** A small running title for the pages after the first. */
export function RunningHead({ title, stamp }: { title: string; stamp: Stamp }) {
  return (
    <div className="rp-run">
      <b>{title}</b>
      <span>{stamp.scope}</span>
    </div>
  );
}

export function Page({ children, stamp, n, of, wide = false, className = '' }: {
  children: ReactNode;
  stamp: Stamp;
  n: number;
  of: number;
  wide?: boolean;
  className?: string;
}) {
  return (
    <section className={`rp-page ${wide ? 'rp-wide' : ''} ${className}`}>
      {children}
      <footer className="rp-foot"><span>{`Generated ${fmtStamp(stamp.generatedAt)} from the Task Register.`}</span><span>{`${n} / ${of}`}</span></footer>
    </section>
  );
}

/**
 * Each report page as an A4 picture, one PDF page each: portrait, or landscape for a wide page. A page taller
 * than A4 is cut into A4 pieces.
 */
export async function savePdf(pages: HTMLElement[], fileName: string, title: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')]);
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (const el of pages) {
    const landscape = el.offsetWidth > el.offsetHeight;
    const W = landscape ? 297 : 210;
    const H = landscape ? 210 : 297;
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', logging: false });
    const perMm = canvas.width / W;
    const pageH = Math.floor(H * perMm);
    for (let y = 0; y < canvas.height - 4; y += pageH) {
      const h = Math.min(pageH, canvas.height - y);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = h;
      slice.getContext('2d')?.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (!pdf) pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait', compress: true });
      else pdf.addPage('a4', landscape ? 'landscape' : 'portrait');
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, h / perMm);
    }
  }
  if (!pdf) return;
  pdf.setProperties({ title, subject: title, creator: 'Al-Ayuni TMO Task Register' });
  pdf.save(fileName);
}
