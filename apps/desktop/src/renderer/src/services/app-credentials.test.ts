import type { AppCredentialView } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { APP_GUIDES, appKeyFor, appStatusLabel, isAppConfigured } from './app-credentials';

const view = (patch: Partial<AppCredentialView>): AppCredentialView => ({
  key: 'linkedin',
  source: 'impostazioni',
  publicId: '86abc',
  hasSecret: true,
  redirectUri: 'https://code965.github.io/Prisma/oauth/linkedin/',
  r2: null,
  updatedAt: null,
  ...patch,
});

describe('app delle piattaforme', () => {
  it('collega a ogni social la sua app, il blog non ne ha', () => {
    expect(appKeyFor('youtube')).toBe('youtube');
    expect(appKeyFor('blog')).toBeNull();
  });

  it('un’app è pronta solo con identificativo e segreto', () => {
    expect(isAppConfigured(view({}))).toBe(true);
    expect(isAppConfigured(view({ hasSecret: false }))).toBe(false);
    expect(isAppConfigured(view({ source: 'nessuna', publicId: null }))).toBe(false);
    expect(isAppConfigured(undefined)).toBe(false);
  });

  it('descrive lo stato e da dove arrivano le credenziali', () => {
    expect(appStatusLabel(view({}))).toBe('App configurata');
    expect(appStatusLabel(view({ source: 'env' }))).toBe('App configurata (dal file .env)');
    expect(appStatusLabel(undefined)).toBe('App non configurata');
  });

  it('solo YouTube e R2 non hanno un indirizzo da registrare', () => {
    const without = Object.entries(APP_GUIDES)
      .filter(([, guide]) => !guide.registerRedirect)
      .map(([key]) => key);
    expect(without).toEqual(['youtube', 'r2']);
  });
});
