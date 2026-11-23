import { useCallback, useState } from 'react';
import { PREFERENCE_KEYS, readPreference, writePreference } from '../../services/local-preferences';

/** Stato comprimibile della sidebar (224 ↔ 64 px), conservato tra una sessione e l'altra. */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(
    () => readPreference(PREFERENCE_KEYS.sidebarCollapsed) === '1',
  );
  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      writePreference(PREFERENCE_KEYS.sidebarCollapsed, next ? '1' : '0');
      return next;
    });
  }, []);
  return [collapsed, toggle];
}
