import type { VideoProject } from '@prisma-app/shared';
import { UI_TIME_ZONE } from './dates';

/** Azione del pulsante principale di FilmCraft nell'editor. */
export type FilmcraftAction = 'open' | 'export' | 'use';

export interface FilmcraftView {
  button: { label: string; action: FilmcraftAction | null };
  status: { text: string; tone: 'muted' | 'review' | 'ok' | 'pub' };
  /** «Riapri» quando c'è un progetto FilmCraft ma l'app non è aperta da Prisma. */
  canReopen: boolean;
}

interface ViewInput {
  installed: boolean;
  connected: boolean;
}

/** «19:42» in ora italiana. */
export function clockLabel(iso: string, timeZone = UI_TIME_ZONE): string {
  return new Intl.DateTimeFormat('it-IT', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * Stato di FilmCraft come nel mockup (V3Video):
 * - aperto e in attesa dell'esportazione → «Esporta da FilmCraft»;
 * - file rientrato non ancora usato → «Usa la versione rientrata»;
 * - video finale preso da FilmCraft → «Sincronizzato».
 */
export function filmcraftView(project: VideoProject, input: ViewInput): FilmcraftView {
  const fc = project.filmcraft;
  if (!input.installed) {
    return {
      button: { label: 'Apri in FilmCraft', action: null },
      status: { text: 'Non installato', tone: 'muted' },
      canReopen: false,
    };
  }
  if (!fc) {
    return {
      button: { label: 'Apri in FilmCraft', action: 'open' },
      status: { text: 'Non ancora aperto', tone: 'muted' },
      canReopen: false,
    };
  }
  const returned = fc.returned;
  const inUse = returned !== null && project.render?.path === returned.path;
  const returnedAfterOpen = returned !== null && returned.createdAt >= fc.openedAt;
  if (returned && returnedAfterOpen && !inUse) {
    return {
      button: { label: 'Usa la versione rientrata', action: 'use' },
      status: {
        text: `Rientrato: ${fileName(returned.path)} · ${clockLabel(returned.createdAt)}`,
        tone: 'ok',
      },
      canReopen: !input.connected,
    };
  }
  if (inUse && returnedAfterOpen && !input.connected) {
    return {
      button: { label: 'Apri in FilmCraft', action: 'open' },
      status: {
        text: `Sincronizzato · video finale delle ${clockLabel(returned!.createdAt)}`,
        tone: 'pub',
      },
      canReopen: false,
    };
  }
  if (input.connected) {
    return {
      button: { label: 'Esporta da FilmCraft', action: 'export' },
      status: { text: 'Aperto in FilmCraft · in attesa dell’esportazione', tone: 'review' },
      canReopen: false,
    };
  }
  // Progetto creato ma FilmCraft chiuso (o aperto da un'altra sessione di Prisma): si può
  // esportare l'ultimo salvataggio o riaprirlo.
  return {
    button: { label: 'Esporta l’ultimo salvataggio', action: 'export' },
    status: {
      text: `Progetto FilmCraft delle ${clockLabel(fc.openedAt)} · chiuso`,
      tone: 'review',
    },
    canReopen: true,
  };
}
