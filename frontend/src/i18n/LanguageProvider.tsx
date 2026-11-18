import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

import { setDateLanguage } from '../lib/format';
import { trText } from './ar';

export type Lang = 'en' | 'ar';
const STORE = 'task-register.lang';
const ATTRS = ['placeholder', 'aria-label', 'data-tip', 'title', 'label'] as const;
const SELECTOR = '[placeholder],[aria-label],[data-tip],[title],optgroup[label]';
const SKIP = 'script,style,textarea,[data-notr]';

type Marked = Text & { __tr?: string };
type MarkedEl = Element & { __tra?: Record<string, string> };

function translateText(n: Marked) {
  const p = n.parentElement;
  if (!p || p.closest(SKIP)) return;
  const v = n.nodeValue ?? '';
  if (n.__tr === v || !v.trim()) return;
  const t = trText(v);
  n.__tr = t;
  if (t !== v) n.nodeValue = t;
}

function translateAttr(e: MarkedEl, a: string) {
  if (e.closest('[data-notr]')) return;
  const v = e.getAttribute(a);
  if (v == null) return;
  const done = (e.__tra ??= {});
  if (done[a] === v) return;
  const t = trText(v);
  done[a] = t;
  if (t !== v) e.setAttribute(a, t);
}

function translateTree(n: Node) {
  if (n.nodeType === Node.TEXT_NODE) return translateText(n as Marked);
  if (n.nodeType !== Node.ELEMENT_NODE) return;
  const el = n as Element;
  if (el.closest(SKIP)) return;
  ATTRS.forEach((a) => translateAttr(el, a));
  el.querySelectorAll(SELECTOR).forEach((e) => ATTRS.forEach((a) => translateAttr(e, a)));
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) translateText(t as Marked);
}

function readLang(): Lang {
  try {
    return localStorage.getItem(STORE) === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

interface LangValue {
  lang: Lang;
  setLang: (l: Lang) => void;
}
const LangContext = createContext<LangValue>({ lang: 'en', setLang: () => undefined });
export const useLang = () => useContext(LangContext);

/**
 * English or Arabic. The interface is written in English; in Arabic every interface text, tooltip and
 * placeholder is translated as React renders it (src/i18n/ar.ts), the page turns right-to-left and dates
 * use Arabic month names. Content people type (task names, directions, activities) is shown as typed.
 * Switching language remounts the app so every page renders afresh in the chosen language.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);
  setDateLanguage(lang);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = lang === 'ar' ? 'سجل المهام' : 'Task Register';
    if (lang !== 'ar') return undefined;
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'childList') r.addedNodes.forEach(translateTree);
        else if (r.type === 'characterData') translateText(r.target as Marked);
        else if (r.attributeName) translateAttr(r.target as MarkedEl, r.attributeName);
      }
      observer.takeRecords(); // our own changes
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    translateTree(document.body);
    return () => observer.disconnect();
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem(STORE, l);
    } catch {
      /* private mode: the choice lasts for this visit */
    }
    setLangState(l);
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return (
    <LangContext.Provider value={value}>
      <div key={lang} className="lang-root">{children}</div>
    </LangContext.Provider>
  );
}

/** The switch in the header: shows the other language, in that language. */
export function LanguageSwitch() {
  const { lang, setLang } = useLang();
  const other: Lang = lang === 'ar' ? 'en' : 'ar';
  return (
    <button
      type="button"
      className="btn langb"
      data-notr
      lang={other}
      onClick={() => setLang(other)}
      aria-label={lang === 'ar' ? 'عرض الصفحة بالإنجليزية' : 'Show the page in Arabic'}
      data-tip={lang === 'ar' ? 'عرض الصفحة بالإنجليزية' : 'Show the page in Arabic'}
    >
      {lang === 'ar' ? 'English' : 'العربية'}
    </button>
  );
}
