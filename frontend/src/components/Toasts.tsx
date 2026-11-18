import { useEffect, useState } from 'react';

/**
 * Short confirmations after a change ("Task saved.", "Decision recorded."). Any code can call toast();
 * the <Toasts /> region shows them for a few seconds and screen readers announce them (role="status").
 */
type Item = { id: number; text: string; out?: boolean };
const EVENT = 'task-register:toast';
let seq = 0;

export function toast(text: string) {
  window.dispatchEvent(new CustomEvent<Item>(EVENT, { detail: { id: ++seq, text } }));
}

export default function Toasts() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const t = window.setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };
    const add = (e: Event) => {
      const item = (e as CustomEvent<Item>).detail;
      // the same message twice in a row (e.g. two quick saves) shows once
      setItems((all) => [...all.filter((i) => i.text !== item.text), item].slice(-3));
      later(() => setItems((all) => all.map((i) => (i.id === item.id ? { ...i, out: true } : i))), 3200);
      later(() => setItems((all) => all.filter((i) => i.id !== item.id)), 3450);
    };
    window.addEventListener(EVENT, add);
    return () => {
      window.removeEventListener(EVENT, add);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((i) => (
        <div key={i.id} className={`toast ${i.out ? 'out' : ''}`}>
          <span className="t-ico" aria-hidden="true">✓</span>
          <span>{i.text}</span>
          <button type="button" aria-label="Close" onClick={() => setItems((all) => all.filter((x) => x.id !== i.id))}>✕</button>
        </div>
      ))}
    </div>
  );
}
