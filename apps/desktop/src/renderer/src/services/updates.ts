import type { PrismaApi } from '../../../preload/index';

export type UpdateState = Awaited<ReturnType<PrismaApi['updates']['state']>>;

/** Riga «Versione» delle Impostazioni: cosa sta facendo il controllo degli aggiornamenti. */
export function updateStatusLabel(state: UpdateState): string {
  switch (state.status) {
    case 'disattivato':
      return 'Copia di sviluppo: gli aggiornamenti funzionano solo nell’app installata';
    case 'inattivo':
      return 'Controllo all’avvio';
    case 'controllo':
      return 'Cerco aggiornamenti…';
    case 'download':
      return `Scarico la versione ${state.version ?? ''} · ${state.percent ?? 0}%`;
    case 'pronto':
      return `Versione ${state.version ?? ''} pronta da installare`;
    case 'aggiornato':
      return 'Stai usando l’ultima versione';
    case 'errore':
      return state.error ?? 'Controllo non riuscito';
  }
}

/** Si può avviare una verifica a mano (non mentre ne gira già una). */
export function canCheckUpdates(state: UpdateState): boolean {
  return (
    state.status !== 'disattivato' && state.status !== 'controllo' && state.status !== 'download'
  );
}
