import { z } from 'zod';

export const SOCIAL_ACCOUNT_STATUSES = [
  'collegato',
  'da_rinnovare',
  'errore',
  'scollegato',
] as const;
export const SocialAccountStatusSchema = z.enum(SOCIAL_ACCOUNT_STATUSES);
export type SocialAccountStatus = z.infer<typeof SocialAccountStatusSchema>;

/** Giorni prima della scadenza del token in cui l'account passa a `da_rinnovare`. */
export const TOKEN_RENEWAL_WINDOW_DAYS = 10;

export function deriveAccountStatus(
  tokenExpiresAt: Date | null,
  now: Date,
  hasError: boolean,
): SocialAccountStatus {
  if (hasError) return 'errore';
  if (!tokenExpiresAt) return 'collegato';
  if (tokenExpiresAt.getTime() <= now.getTime()) return 'scollegato';
  const windowMs = TOKEN_RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return tokenExpiresAt.getTime() - now.getTime() <= windowMs ? 'da_rinnovare' : 'collegato';
}
