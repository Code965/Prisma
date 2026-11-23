import type { Content, PublicationView } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { placePublications } from './calendar';
import { greeting, longDate, weekStrip, weekTitle } from './dashboard';
import {
  checkChips,
  countdown,
  countdownLabel,
  countdownShort,
  logDetail,
  logPublications,
  nextRunAt,
  queueSubtitle,
  captionFor,
  logStatusLabel,
  queueSummary,
  queuedPublications,
  waitingDrafts,
} from './queue';

function pub(
  id: number,
  status: PublicationView['status'],
  scheduledAt: string,
  extra: Partial<PublicationView> = {},
): PublicationView {
  return {
    id,
    variantId: id,
    socialAccountId: 1,
    scheduledAt,
    status,
    attempts: 0,
    maxAttempts: 5,
    nextAttemptAt: null,
    externalId: null,
    externalUrl: null,
    lastError: null,
    publishedAt: null,
    createdAt: scheduledAt,
    updatedAt: scheduledAt,
    platform: 'linkedin',
    format: 'post',
    contentId: 1,
    contentTitle: 'Titolo',
    ...extra,
  };
}

describe('coda', () => {
  const list = [
    pub(1, 'programmato', '2026-11-23T08:00:00.000Z'),
    pub(2, 'programmato', '2026-11-22T16:00:00.000Z'),
    pub(3, 'pubblicato', '2026-11-20T12:00:00.000Z', { publishedAt: '2026-11-20T12:00:05.000Z' }),
    pub(4, 'errore', '2026-11-21T19:00:00.000Z', {
      updatedAt: '2026-11-21T19:01:00.000Z',
      lastError: 'timeout',
    }),
    pub(5, 'annullato', '2026-11-19T07:00:00.000Z'),
  ];

  it('separa i post in uscita dal log', () => {
    expect(queuedPublications(list).map((p) => p.id)).toEqual([2, 1]);
    expect(logPublications(list).map((p) => p.id)).toEqual([4, 3, 5]);
  });

  it('conta alla rovescia e non va sotto zero', () => {
    const now = new Date('2026-11-22T12:17:55Z');
    expect(countdown('2026-11-22T16:00:00.000Z', now)).toBe('3:42:05');
    expect(countdown('2026-11-22T12:00:00.000Z', now)).toBe('0:00:00');
    expect(countdownShort('2026-11-22T16:00:00.000Z', now)).toBe('tra 3:42');
  });

  it('descrive formato e orario in italiano', () => {
    expect(queueSubtitle(list[1]!)).toBe('Post · dom 22 nov · 17:00');
  });

  it('TikTok: «Inviato a TikTok», istruzioni e didascalia da copiare', () => {
    const sent = pub(7, 'pubblicato', '2026-11-22T16:00:00.000Z', {
      platform: 'tiktok',
      format: 'video',
      externalId: 'v_inbox_file~1',
      lastError: 'Avviso: Inviato alla casella di TikTok',
    });
    expect(logStatusLabel(sent)).toBe('Inviato a TikTok');
    expect(logDetail(sent).text).toMatch(/^nella casella dell’app/);
    expect(logStatusLabel(pub(8, 'pubblicato', '2026-11-22T16:00:00.000Z'))).toBe('Pubblicato');
    const contents = [
      {
        variants: [{ id: 7, body: 'Da 30 s a 20 ms ', metadata: { hashtags: ['#mysql', '#sql'] } }],
      },
    ] as unknown as Content[];
    expect(captionFor(contents, sent)).toBe('Da 30 s a 20 ms\n\n#mysql #sql');
    expect(captionFor([], sent)).toBeNull();
  });

  it('per i video caricati in anticipo mostra lo stato del caricamento', () => {
    const at = '2026-11-22T16:00:00.000Z';
    const youtube = { platform: 'youtube' as const, format: 'short' as const };
    expect(queueSubtitle(pub(5, 'programmato', at, { ...youtube, externalId: 'v1' }))).toBe(
      'Short · dom 22 nov · 17:00 · già caricato, esce da solo all’orario',
    );
    expect(
      queueSubtitle(
        pub(6, 'programmato', at, {
          ...youtube,
          lastError: 'Caricamento anticipato non riuscito: quota',
        }),
      ),
    ).toBe('Short · dom 22 nov · 17:00 · Caricamento anticipato non riuscito: quota');
  });

  it('spiega ogni riga del log', () => {
    expect(logDetail(list[3]!)).toEqual({ text: 'timeout', isError: true });
    expect(
      logDetail(
        pub(6, 'pubblicato', '2026-11-20T12:00:00.000Z', {
          externalUrl: 'https://www.linkedin.com/feed/update/urn:li:share:7000/',
          lastError: 'Avviso: primo commento non aggiunto',
        }),
      ).text,
    ).toBe('linkedin.com/feed/update/urn:li:shar… · Avviso: primo commento non aggiunto');
    expect(logDetail(list[4]!).text).toMatch(/tolto dalla coda/);
  });

  it('ordina i controlli mettendo prima ciò che blocca', () => {
    expect(
      checkChips([
        { level: 'ok', message: 'Post di testo' },
        { level: 'error', message: 'Token scaduto' },
        { level: 'warning', message: 'Link nel testo' },
      ]).map((c) => `${c.mark} ${c.text}`),
    ).toEqual(['✕ Token scaduto', '! Link nel testo', 'OK Post di testo']);
  });

  it('riassume coda e bozze in attesa', () => {
    const contents = [
      { variants: [{ status: 'bozza' }, { status: 'approvato' }, { status: 'da_approvare' }] },
    ] as Content[];
    expect(waitingDrafts(contents)).toBe(2);
    expect(queueSummary(4, 1)).toBe(
      '4 post approvati in uscita · 1 bozza resta fuori finché non la approvi',
    );
    expect(queueSummary(1, 0)).toBe('1 post approvato in uscita');
    expect(queueSummary(2, 3)).toBe(
      '2 post approvati in uscita · 3 bozze restano fuori finché non le approvi',
    );
  });
});

describe('prossimo tentativo', () => {
  it('conta verso next_attempt_at e cambia etichetta dopo un tentativo', () => {
    const retried = pub(9, 'programmato', '2026-11-22T16:00:00.000Z', {
      nextAttemptAt: '2026-11-22T12:01:00.000Z',
      attempts: 2,
    });
    expect(nextRunAt(retried)).toBe('2026-11-22T12:01:00.000Z');
    expect(countdownLabel(retried)).toBe('nuovo tentativo tra');
    expect(countdownLabel(pub(10, 'programmato', '2026-11-22T16:00:00.000Z'))).toBe('esce tra');
  });
});

describe('dashboard', () => {
  it('saluta in base all’ora italiana con il nome del brand', () => {
    expect(greeting(new Date('2026-11-21T08:00:00Z'), 'Marta Rossi')).toBe('Buongiorno, Marta');
    expect(greeting(new Date('2026-11-21T14:00:00Z'), 'Marta Rossi')).toBe(
      'Buon pomeriggio, Marta',
    );
    expect(greeting(new Date('2026-11-21T19:00:00Z'), undefined)).toBe('Buonasera');
  });

  it('scrive date e settimana come nel mockup', () => {
    expect(longDate(new Date('2026-11-21T10:00:00Z'))).toBe('sabato 21 novembre');
    expect(weekTitle('2026-11-16')).toBe('16 – 22 novembre');
    expect(weekTitle('2026-11-30')).toBe('30 novembre – 6 dicembre');
  });

  it('distribuisce le uscite nei giorni della settimana e chiama "oggi" il giorno corrente', () => {
    const placed = placePublications(
      [pub(1, 'programmato', '2026-11-22T16:00:00.000Z')],
      new Set(['linkedin'] as const),
    );
    const strip = weekStrip('2026-11-16', placed, new Date('2026-11-22T10:00:00Z'));
    expect(strip.map((d) => d.label)).toEqual([
      'lun 16',
      'mar 17',
      'mer 18',
      'gio 19',
      'ven 20',
      'sab 21',
      'oggi',
    ]);
    expect(strip[6]!.posts).toHaveLength(1);
  });
});
