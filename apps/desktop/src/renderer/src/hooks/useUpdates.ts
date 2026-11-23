import { useEffect, useState } from 'react';
import type { UpdateState } from '../services/updates';

/**
 * Stato degli aggiornamenti dal main (solo nell'app Electron: nel browser è null) e azioni
 * della finestra «Aggiornamento disponibile».
 */
export function useUpdates() {
  const updates = window.prisma?.updates;
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    if (!updates) return;
    let active = true;
    void updates.state().then((current) => active && setState(current));
    const stop = updates.onChange(setState);
    return () => {
      active = false;
      stop();
    };
  }, [updates]);

  return {
    state,
    check: () => updates?.check(),
    dismiss: () => updates?.dismiss(),
    skip: () => updates?.skip(),
    install: () => updates?.install(),
  };
}
