import type { SocialAccount } from '@prisma-app/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { InvalidOAuthStateError } from '../../auth/oauth-state.js';
import { toErrorResponse } from '../../http/error-handler.js';
import type { InstagramOAuthService } from './instagram-service.js';
import { OAuthDeniedError, type LinkedInOAuthService } from './linkedin-service.js';
import type { TikTokOAuthService } from './tiktok-service.js';
import type { YouTubeOAuthService } from './youtube-service.js';

export const OAUTH_CALLBACK_PATHS = [
  '/oauth/linkedin/callback',
  '/oauth/instagram/callback',
  '/oauth/youtube/callback',
  '/oauth/tiktok/callback',
] as const;

const StartQuerySchema = z.object({ brandId: z.coerce.number().int().positive() });
const CallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

type CallbackQuery = z.infer<typeof CallbackQuerySchema>;

interface OAuthProvider {
  start(brandId: number): Promise<{ url: string }>;
  complete(query: CallbackQuery): Promise<SocialAccount>;
}

export function oauthRoutes(
  app: FastifyInstance,
  providers: {
    linkedin: LinkedInOAuthService;
    instagram: InstagramOAuthService;
    youtube: YouTubeOAuthService;
    tiktok: TikTokOAuthService;
  },
): void {
  register(app, 'linkedin', 'LinkedIn', providers.linkedin);
  register(app, 'instagram', 'Instagram', providers.instagram);
  register(app, 'youtube', 'YouTube', providers.youtube);
  register(app, 'tiktok', 'TikTok', providers.tiktok);
}

function register(app: FastifyInstance, path: string, label: string, provider: OAuthProvider) {
  // Chiamata dal desktop (con token API): restituisce l'URL da aprire nel browser.
  app.get(`/oauth/${path}/start`, (request) =>
    provider.start(StartQuerySchema.parse(request.query).brandId),
  );

  // Raggiunta dal browser dopo il consenso: è pubblica e risponde con una pagina leggibile.
  app.get(`/oauth/${path}/callback`, async (request, reply) => {
    try {
      const account = await provider.complete(CallbackQuerySchema.parse(request.query));
      return page(
        reply,
        200,
        'Account collegato',
        `${label}: ${account.displayName}. Puoi chiudere questa finestra e tornare a Prisma.`,
      );
    } catch (error) {
      if (error instanceof InvalidOAuthStateError) {
        return page(
          reply,
          401,
          'Richiesta non valida',
          'Il collegamento è scaduto o non è partito da Prisma. Riprova dall’app.',
        );
      }
      if (error instanceof OAuthDeniedError) {
        return page(reply, 400, 'Collegamento annullato', error.message);
      }
      request.log.error({ err: error }, `Callback OAuth ${label} fallita`);
      const { status, body } = toErrorResponse(error);
      return page(reply, status, 'Collegamento non riuscito', body.message);
    }
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function page(reply: FastifyReply, status: number, title: string, message: string) {
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${escapeHtml(title)} · Prisma</title>
<style>body{font-family:Inter,system-ui,sans-serif;background:#F5F6F8;color:#101318;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fff;border:1px solid #E4E7EC;border-radius:12px;padding:28px 32px;max-width:420px}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#344054;margin:0;line-height:1.5}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
  return reply.code(status).type('text/html; charset=utf-8').send(html);
}
