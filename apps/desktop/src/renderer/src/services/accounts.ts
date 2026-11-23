import {
  PLATFORMS,
  type Platform,
  type SocialAccount,
  type SocialAccountStatus,
} from '@prisma-app/shared';

export interface AccountRow {
  platform: Platform;
  account: SocialAccount | null;
  statusLabel: string;
  /** Token CSS del colore dello stato. */
  statusColor: string;
  /**
   * Azione disponibile: OAuth per i social (`collega`/`ricollega`), modulo con indirizzo e
   * chiave per il blog (`configura`), null se la piattaforma non è ancora supportata.
   */
  action: 'collega' | 'ricollega' | 'configura' | null;
  note: string | null;
}

const STATUS: Record<SocialAccountStatus, { label: string; color: string }> = {
  collegato: { label: 'Collegato', color: 'var(--s-pub)' },
  da_rinnovare: { label: 'Da rinnovare', color: 'var(--s-review)' },
  errore: { label: 'Errore', color: 'var(--s-err)' },
  scollegato: { label: 'Scollegato', color: 'var(--muted)' },
};

/** Piattaforme che si possono già collegare e quando arrivano le altre. */
const AVAILABILITY: Record<Platform, string | null> = {
  linkedin: null,
  instagram: null,
  tiktok: null,
  youtube: null,
  blog: null,
};

/** Una riga per piattaforma, nell'ordine del mockup, con stato e azione possibile. */
export function accountRows(accounts: readonly SocialAccount[], now: Date): AccountRow[] {
  return PLATFORMS.map((platform) => {
    // Dopo un cambio di indirizzo del blog resta anche il vecchio account, scollegato.
    const account =
      accounts.find((a) => a.platform === platform && a.status !== 'scollegato') ??
      accounts.find((a) => a.platform === platform) ??
      null;
    const unavailable = AVAILABILITY[platform];
    if (unavailable) {
      return {
        platform,
        account,
        statusLabel: 'Non disponibile',
        statusColor: 'var(--muted)',
        action: null,
        note: unavailable,
      };
    }
    if (!account) {
      return {
        platform,
        account,
        statusLabel: 'Non collegato',
        statusColor: 'var(--muted)',
        action: platform === 'blog' ? 'configura' : 'collega',
        note: platform === 'blog' ? 'Indirizzo della Blog API del tuo sito e chiave' : null,
      };
    }
    if (platform === 'blog') {
      const status = STATUS[account.status];
      return {
        platform,
        account,
        statusLabel: status.label,
        statusColor: status.color,
        action: 'configura',
        note: account.lastError,
      };
    }
    const status = STATUS[account.status];
    return {
      platform,
      account,
      statusLabel: status.label,
      statusColor: status.color,
      action: account.status === 'collegato' ? null : 'ricollega',
      note: account.lastError ?? accountNote(platform, account.tokenExpiresAt, now),
    };
  });
}

/**
 * Il token Instagram si rinnova da solo prima della scadenza, quello LinkedIn no; per YouTube
 * il server ne chiede uno nuovo a ogni uso.
 */
function accountNote(platform: Platform, tokenExpiresAt: string | null, now: Date): string | null {
  if (platform === 'youtube') return 'Accesso rinnovato a ogni caricamento';
  const expiry = expiryNote(tokenExpiresAt, now);
  // TikTok: la scadenza è quella del refresh token, che si rinnova a ogni uso.
  const renews = platform === 'instagram' || platform === 'tiktok';
  return renews && expiry ? `${expiry} · rinnovo automatico` : expiry;
}

function expiryNote(tokenExpiresAt: string | null, now: Date): string | null {
  if (!tokenExpiresAt) return null;
  const days = Math.ceil((new Date(tokenExpiresAt).getTime() - now.getTime()) / 86_400_000);
  if (days <= 0) return 'Token scaduto';
  return days === 1 ? 'Token valido ancora 1 giorno' : `Token valido ancora ${days} giorni`;
}

/** Piattaforme collegate con OAuth dal browser (il blog ha il suo modulo). */
export function oauthPlatform(
  platform: Platform,
): 'linkedin' | 'instagram' | 'youtube' | 'tiktok' | null {
  return platform === 'blog' ? null : platform;
}
