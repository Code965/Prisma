import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { PREFERENCE_KEYS, readPreference, writePreference } from '../services/local-preferences';

export type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Tema salvato, altrimenti quello del sistema operativo. */
export function initialTheme(): Theme {
  const saved = readPreference(PREFERENCE_KEYS.theme);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Applica `.th-light` / `.th-dark` alla radice del documento, dove vivono i token del mockup. */
function applyThemeClass(theme: Theme): void {
  const root = document.documentElement;
  root.classList.remove('th-light', 'th-dark');
  root.classList.add(theme === 'dark' ? 'th-dark' : 'th-light');
  root.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    applyThemeClass(theme);
    writePreference(PREFERENCE_KEYS.theme, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme va usato dentro ThemeProvider');
  return context;
}
