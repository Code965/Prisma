/**
 * Preferenze dell'interfaccia salvate nel browser del renderer (tema, sidebar).
 * Ogni accesso è protetto: se lo storage non è disponibile si usano i default.
 */
export function readPreference(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    if (value !== null) return value;
    // Preferenze salvate prima del cambio di nome (cronaca.tema → prisma.tema).
    const legacy = LEGACY_KEYS[key];
    return legacy ? window.localStorage.getItem(legacy) : null;
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferenza non salvata: l'interfaccia continua a funzionare con lo stato in memoria.
  }
}

export const PREFERENCE_KEYS = {
  theme: 'prisma.tema',
  sidebarCollapsed: 'prisma.sidebar.chiusa',
  brand: 'prisma.brand',
  /** Configurazione guidata del primo avvio completata o saltata. */
  setupDone: 'prisma.configurazione',
} as const;

const LEGACY_KEYS: Record<string, string> = {
  'prisma.tema': 'cronaca.tema',
  'prisma.sidebar.chiusa': 'cronaca.sidebar.chiusa',
  'prisma.brand': 'cronaca.brand',
};
