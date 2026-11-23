import { describe, expect, it } from 'vitest';
import { slotsSourceNote } from './calendar';
import { weekMetricCards } from './dashboard';

describe('ultimi 7 giorni', () => {
  it('follower o iscritti, variazione e copertura della settimana', () => {
    const cards = weekMetricCards({
      platforms: [
        {
          platform: 'youtube',
          followers: 412,
          followersDelta: 18,
          reach: 3100,
          reachLabel: 'visualizzazioni',
        },
        {
          platform: 'instagram',
          followers: 637,
          followersDelta: -3,
          reach: null,
          reachLabel: 'account raggiunti',
        },
        {
          platform: 'linkedin',
          followers: null,
          followersDelta: null,
          reach: 9800,
          reachLabel: 'impressioni',
        },
      ],
    });
    expect(cards).toEqual([
      {
        platform: 'youtube',
        what: 'Iscritti',
        value: '412',
        delta: { text: '+18', positive: true },
        sub: '3,1k visualizzazioni',
      },
      {
        platform: 'instagram',
        what: 'Follower',
        value: '637',
        delta: { text: '-3', positive: false },
        sub: 'nessun dato di account raggiunti',
      },
      { platform: 'linkedin', what: 'Follower', value: '—', delta: null, sub: '9,8k impressioni' },
    ]);
    expect(weekMetricCards(undefined)).toEqual([]);
  });
});

describe('origine degli slot consigliati', () => {
  it('dai dati per le piattaforme con abbastanza post, predefiniti per le altre', () => {
    expect(slotsSourceNote(undefined)).toMatch(/predefiniti: diventano tuoi/);
    expect(
      slotsSourceNote({
        platforms: [
          { platform: 'instagram', slots: [{ weekday: 1, hour: 18 }], source: 'dati', basedOn: 12 },
          { platform: 'tiktok', slots: [], source: 'predefinito', basedOn: 3 },
        ],
      }),
    ).toBe(
      'Slot «consigliato» calcolati dai tuoi post per Instagram; predefiniti per le altre piattaforme.',
    );
  });
});
