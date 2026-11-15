import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fr } from "./locales/fr";
import { ar } from "./locales/ar";

// English source strings are the keys; French and Arabic dictionaries map
// them, and anything not yet translated falls back to English. Arabic
// switches the document to right-to-left.
export type Lang = "en" | "fr" | "ar";
export const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "ar", label: "العربية" },
];

const DICTS: Record<Lang, Record<string, string>> = { en: {}, fr, ar };
const STORAGE_KEY = "manage-lang";

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (text: string, vars?: Record<string, string | number>) => string; dir: "ltr" | "rtl" };
const I18nContext = createContext<Ctx | null>(null);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "fr" || saved === "ar") return saved;
  } catch { /* storage unavailable */ }
  const nav = navigator.language?.slice(0, 2);
  return nav === "fr" ? "fr" : nav === "ar" ? "ar" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const dir = lang === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((l: Lang) => {
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* storage unavailable */ }
    setLangState(l);
  }, []);

  const t = useCallback((text: string, vars?: Record<string, string | number>) => {
    let out = DICTS[lang][text] ?? text;
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
    return out;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t, dir }) as Ctx, [lang, setLang, t, dir]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
