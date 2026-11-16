import { useEffect, type RefObject } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Count a KPI number up from zero (numbers and percentages only). */
function countUp(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.kpi-v, .stage .n, .ring .rv').forEach((el) => {
    const target = el.querySelector<HTMLElement>('.dn') ?? el;
    const node = [...target.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.nodeValue?.trim());
    if (!node) return;
    const m = /^(\d+)(%?)$/.exec(node.nodeValue?.trim() ?? '');
    if (!m || Number(m[1]) < 2) return;
    const end = Number(m[1]);
    const suffix = m[2];
    const t0 = performance.now();
    const step = (now: number) => {
      if (!node.isConnected) return;
      const k = Math.min(1, (now - t0) / 750);
      node.nodeValue = `${Math.round(end * (1 - (1 - k) ** 3))}${suffix}`;
      if (k < 1) requestAnimationFrame(step);
    };
    node.nodeValue = `0${suffix}`;
    requestAnimationFrame(step);
  });
}

/** Play the entrance animation (bars grow, lines draw, numbers count up) when `key` changes and data is shown. */
export function useEntrance(ref: RefObject<HTMLElement>, key: unknown, ready = true) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !ready || reduced()) return undefined;
    el.classList.remove('anim');
    void el.offsetWidth;
    el.classList.add('anim');
    countUp(el);
    const t = setTimeout(() => el.classList.remove('anim'), 2300);
    return () => clearTimeout(t);
  }, [ref, key, ready]);
}
