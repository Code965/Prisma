import { createContext, useContext } from 'react';

/** Apre la configurazione guidata da qualsiasi schermata (es. Impostazioni). */
export const SetupContext = createContext<{ openSetup: () => void }>({ openSetup: () => {} });

export function useOpenSetup(): () => void {
  return useContext(SetupContext).openSetup;
}
