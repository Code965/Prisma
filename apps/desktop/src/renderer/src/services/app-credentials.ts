import type { AppCredentialKey, AppCredentialView, Platform } from '@prisma-app/shared';

/** Guida per creare l'app sviluppatore di ogni piattaforma (e l'archivio R2). */
export interface AppGuide {
  label: string;
  /** Pagina dove si crea l'app (si apre nel browser di sistema). */
  portalUrl: string;
  idLabel: string;
  secretLabel: string;
  steps: readonly string[];
  /** Se l'indirizzo di ritorno va registrato nell'app della piattaforma. */
  registerRedirect: boolean;
}

export const APP_GUIDES: Record<AppCredentialKey, AppGuide> = {
  linkedin: {
    label: 'LinkedIn',
    portalUrl: 'https://www.linkedin.com/developers/apps',
    idLabel: 'Client ID',
    secretLabel: 'Primary Client Secret',
    registerRedirect: true,
    steps: [
      'Crea un’app (serve una pagina LinkedIn da associare).',
      'In «Products» aggiungi «Share on LinkedIn» e «Sign In with LinkedIn using OpenID Connect».',
      'In «Auth» aggiungi come «Authorized redirect URL» l’indirizzo qui sotto.',
      'Copia Client ID e Primary Client Secret.',
    ],
  },
  instagram: {
    label: 'Instagram',
    portalUrl: 'https://developers.facebook.com/apps',
    idLabel: 'Instagram App ID',
    secretLabel: 'Instagram App Secret',
    registerRedirect: true,
    steps: [
      'Crea un’app di tipo «Business» e aggiungi il prodotto «Instagram».',
      'In «API setup with Instagram login» aggiungi il tuo account professionale (Business o Creator) con un ruolo sull’app.',
      'In «Business login settings» aggiungi l’indirizzo qui sotto agli «OAuth redirect URIs».',
      'Copia Instagram App ID e Instagram App Secret.',
    ],
  },
  youtube: {
    label: 'YouTube',
    portalUrl: 'https://console.cloud.google.com/apis/credentials',
    idLabel: 'Client ID',
    secretLabel: 'Client secret',
    registerRedirect: false,
    steps: [
      'Crea un progetto e abilita «YouTube Data API v3» e «YouTube Analytics API».',
      'Configura la schermata di consenso OAuth (esterna) e pubblicala «In production», altrimenti l’accesso scade dopo 7 giorni.',
      'In «Credenziali» crea un «ID client OAuth» di tipo «App desktop»: nessun indirizzo da registrare.',
      'Copia Client ID e Client secret.',
    ],
  },
  tiktok: {
    label: 'TikTok',
    portalUrl: 'https://developers.tiktok.com/apps',
    idLabel: 'Client key',
    secretLabel: 'Client secret',
    registerRedirect: true,
    steps: [
      'Crea un’app con piattaforma «Desktop» e aggiungi Login Kit e Content Posting API.',
      'Scope: user.info.basic, video.upload, video.list, user.info.stats.',
      'Aggiungi l’indirizzo qui sotto come «Redirect URI».',
      'Copia Client key e Client secret. Lo scope video.upload va approvato da TikTok; intanto puoi provare in sandbox con il tuo account.',
    ],
  },
  r2: {
    label: 'Cloudflare R2',
    portalUrl: 'https://dash.cloudflare.com/',
    idLabel: 'Access Key ID',
    secretLabel: 'Secret Access Key',
    registerRedirect: false,
    steps: [
      'In R2 crea un bucket e attiva l’accesso pubblico (dominio r2.dev o un tuo dominio su Cloudflare): Instagram scarica le immagini da lì.',
      'In R2 › «API Tokens» crea un token «Object Read & Write» limitato al bucket.',
      'Copia Access Key ID e Secret Access Key (il segreto si vede una volta sola) e l’Account ID.',
    ],
  },
};

const OAUTH_KEY: Partial<Record<Platform, AppCredentialKey>> = {
  linkedin: 'linkedin',
  instagram: 'instagram',
  youtube: 'youtube',
  tiktok: 'tiktok',
};

/** L'app sviluppatore da configurare per collegare un account della piattaforma (null per il blog). */
export function appKeyFor(platform: Platform): AppCredentialKey | null {
  return OAUTH_KEY[platform] ?? null;
}

export function isAppConfigured(view: AppCredentialView | undefined): boolean {
  return Boolean(view && view.source !== 'nessuna' && view.publicId && view.hasSecret);
}

/** Riga di stato dell'app o dell'archivio. */
export function appStatusLabel(view: AppCredentialView | undefined): string {
  if (!view || view.source === 'nessuna') return 'App non configurata';
  const where = view.source === 'env' ? ' (dal file .env)' : '';
  return view.hasSecret ? `App configurata${where}` : `Manca il segreto${where}`;
}
