const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
let MONTHS = MONTHS_EN;
let arabic = false;

/** Called by the language provider: Arabic month names, and "1 ديسمبر 2026" instead of "1-Dec-2026". */
export function setDateLanguage(lang: 'en' | 'ar') {
  arabic = lang === 'ar';
  MONTHS = arabic ? MONTHS_AR : MONTHS_EN;
}
/** "5 minutes ago", "yesterday", "3 days ago": in the page's language. */
export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const sec = Math.round((t - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(arabic ? 'ar' : 'en', { numeric: 'auto' });
  const abs = Math.abs(sec);
  if (abs < 60) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(sec / 86400), 'day');
  return fmtStamp(iso).split(' ')[0];
}
export const monthName = (d: Date) => MONTHS[d.getMonth()];

export const parseDate = (s: string) => new Date(`${s}T00:00:00`);

/** 1-Dec-2026, the format used in the register template. */
export function fmtDate(s: string | null | undefined): string {
  if (!s) return '';
  const d = parseDate(s);
  return arabic ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : `${d.getDate()}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

/** 15-Nov-2026 23:34 (Arabic: 15 نوفمبر 2026 23:34), for saved times and the audit log. */
export function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${fmtDate(day)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const monthLabel = (d: Date) => `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;

/** Working days between two dates, inclusive; Friday and Saturday are the weekend. */
export function workingDays(start: string | null, finish: string | null): number | null {
  if (!start || !finish) return null;
  const end = parseDate(finish);
  let n = 0;
  for (const d = parseDate(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 5 && d.getDay() !== 6) n += 1;
  }
  return end < parseDate(start) ? null : n;
}

export function sar(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function sarShort(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${Math.round(value / 1e3)}K`;
  return String(Math.round(value));
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** "1 Dec", for short ranges. */
export function fmtShort(s: string | null | undefined): string {
  if (!s) return '';
  const d = parseDate(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
export const monthFull = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (iso: string, n: number) => {
  const d = parseDate(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};
/** First day of each month from the month of `from` to the month of `to`. */
export function monthsBetween(from: string, to: string): Date[] {
  const out: Date[] = [];
  const a = parseDate(from), b = parseDate(to);
  for (const d = new Date(a.getFullYear(), a.getMonth(), 1); d <= b; d.setMonth(d.getMonth() + 1)) out.push(new Date(d));
  return out;
}
export const monthEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
