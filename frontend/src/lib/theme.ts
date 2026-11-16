/** The colour themes of the app. The choice is kept per browser. */
export type Theme = 'light' | 'dark' | 'desert' | 'aurora';

export const THEMES: { id: Theme; label: string; tip: string; swatch: string; tick: string }[] = [
  { id: 'light', label: 'Light', tip: 'Light: the standard look', swatch: 'linear-gradient(135deg, #ffffff 50%, #d6eaf0 50%)', tick: '#0d5c70' },
  { id: 'dark', label: 'Dark', tip: 'Dark: easy on the eyes in low light', swatch: 'linear-gradient(135deg, #15202a 50%, #55b6cc 50%)', tick: '#ffffff' },
  { id: 'desert', label: 'Desert gold', tip: 'Desert gold: warm sand and copper', swatch: 'linear-gradient(135deg, #f5ede0 0%, #d3a033 55%, #a3591a 100%)', tick: '#2b1d10' },
  { id: 'aurora', label: 'Aurora night', tip: 'Aurora night: deep indigo with northern lights', swatch: 'linear-gradient(135deg, #2dd4bf 0%, #8f82ff 55%, #f472b6 100%)', tick: '#0b0c20' },
];

const KEY = 'task-register.theme';

export function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return THEMES.some((x) => x.id === t) ? (t as Theme) : null;
  } catch {
    return null;
  }
}

/** Without a stored choice the page follows the device (light or dark). */
export function currentTheme(): Theme {
  return storedTheme() ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

export function applyTheme(theme: Theme | null): void {
  const root = document.documentElement;
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private window: the choice lasts for this visit only */
  }
  applyTheme(theme);
}
