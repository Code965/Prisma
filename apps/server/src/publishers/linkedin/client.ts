/**
 * Client HTTP minimale per le API LinkedIn usate da Prisma. Riferimenti verificati (novembre 2026):
 * - OAuth: learn.microsoft.com/linkedin/shared/authentication/authorization-code-flow
 * - Profilo: learn.microsoft.com/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
 * - Post: learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api
 * - Commenti: learn.microsoft.com/linkedin/marketing/community-management/shares/comments-api
 * - Documenti (caroselli PDF): learn.microsoft.com/linkedin/marketing/community-management/shares/documents-api
 */

export const LINKEDIN_AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
export const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
export const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
export const LINKEDIN_REST_URL = 'https://api.linkedin.com/rest';

/** `openid profile` per l'id del membro, `w_member_social` per pubblicare a suo nome. */
export const LINKEDIN_SCOPES = ['openid', 'profile', 'w_member_social'] as const;

export type FetchFn = typeof fetch;

export interface LinkedInClientOptions {
  apiVersion: string;
  fetch?: FetchFn;
}

export interface TokenResponse {
  accessToken: string;
  expiresInSeconds: number;
  scope: string;
  refreshToken: string | null;
  refreshExpiresInSeconds: number | null;
}

export interface DocumentUpload {
  uploadUrl: string;
  /** `urn:li:document:…` da mettere in `content.media.id` del post. */
  document: string;
}

/** Stati del documento (MediaStatus): si pubblica quando è `AVAILABLE`. */
export type DocumentStatus = 'WAITING_UPLOAD' | 'PROCESSING' | 'AVAILABLE' | 'PROCESSING_FAILED';

/** Il token va solo a LinkedIn: l'indirizzo di caricamento deve essere un suo dominio https. */
export function isLinkedInUploadUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === 'https:' && (hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com'))
    );
  } catch {
    return false;
  }
}

export interface UserInfo {
  sub: string;
  name: string;
}

/** Risposta HTTP non riuscita: lo status decide se ritentare. */
export class LinkedInHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`LinkedIn ha risposto ${status}: ${body.slice(0, 300)}`);
    this.name = 'LinkedInHttpError';
  }
}

export function createLinkedInClient(options: LinkedInClientOptions) {
  const doFetch = options.fetch ?? fetch;

  async function send(url: string, init: RequestInit): Promise<Response> {
    const response = await doFetch(url, init);
    if (!response.ok) throw new LinkedInHttpError(response.status, await response.text());
    return response;
  }

  function restHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'LinkedIn-Version': options.apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    };
  }

  /** L'id della risorsa creata arriva nell'header `x-restli-id`, non nel corpo. */
  function createdId(response: Response): string {
    const id = response.headers.get('x-restli-id');
    if (!id) throw new Error('LinkedIn non ha restituito l’id della risorsa creata (x-restli-id)');
    return id;
  }

  return {
    async exchangeCode(params: {
      code: string;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    }): Promise<TokenResponse> {
      const response = await send(LINKEDIN_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: params.code,
          client_id: params.clientId,
          client_secret: params.clientSecret,
          redirect_uri: params.redirectUri,
        }),
      });
      const json = (await response.json()) as Record<string, unknown>;
      if (typeof json.access_token !== 'string' || typeof json.expires_in !== 'number') {
        throw new Error('Risposta del token LinkedIn non valida');
      }
      return {
        accessToken: json.access_token,
        expiresInSeconds: json.expires_in,
        scope: typeof json.scope === 'string' ? json.scope : '',
        // I refresh token arrivano solo alle app abilitate (partner MDP); di norma sono assenti.
        refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
        refreshExpiresInSeconds:
          typeof json.refresh_token_expires_in === 'number' ? json.refresh_token_expires_in : null,
      };
    },

    async getUserInfo(accessToken: string): Promise<UserInfo> {
      const response = await send(LINKEDIN_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await response.json()) as Record<string, unknown>;
      if (typeof json.sub !== 'string') throw new Error('Profilo LinkedIn senza identificativo');
      return {
        sub: json.sub,
        name: typeof json.name === 'string' ? json.name : 'Profilo LinkedIn',
      };
    },

    /** Primo passo di un post con documento: LinkedIn restituisce dove caricare il file. */
    async initializeDocumentUpload(accessToken: string, ownerUrn: string): Promise<DocumentUpload> {
      const response = await send(`${LINKEDIN_REST_URL}/documents?action=initializeUpload`, {
        method: 'POST',
        headers: restHeaders(accessToken),
        body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
      });
      const json = (await response.json()) as {
        value?: { uploadUrl?: unknown; document?: unknown };
      };
      const { uploadUrl, document } = json.value ?? {};
      if (typeof uploadUrl !== 'string' || typeof document !== 'string') {
        throw new Error('Risposta di initializeUpload senza uploadUrl o document');
      }
      if (!isLinkedInUploadUrl(uploadUrl)) {
        throw new Error('Indirizzo di caricamento del documento non di LinkedIn');
      }
      return { uploadUrl, document };
    },

    /** Caricamento dei byte (la documentazione usa `curl --upload-file`, cioè PUT). */
    async uploadDocument(accessToken: string, uploadUrl: string, bytes: Uint8Array): Promise<void> {
      if (!isLinkedInUploadUrl(uploadUrl)) throw new Error('Indirizzo di caricamento non valido');
      await send(uploadUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: bytes,
      });
    },

    async documentStatus(accessToken: string, documentUrn: string): Promise<DocumentStatus> {
      const response = await send(
        `${LINKEDIN_REST_URL}/documents/${encodeURIComponent(documentUrn)}`,
        { headers: restHeaders(accessToken) },
      );
      const json = (await response.json()) as { status?: unknown };
      if (typeof json.status !== 'string') throw new Error('Documento LinkedIn senza stato');
      return json.status as DocumentStatus;
    },

    /** Post di testo, oppure con un documento (carosello PDF) in `content.media`. */
    async createPost(
      accessToken: string,
      authorUrn: string,
      commentary: string,
      media?: { id: string; title: string },
    ): Promise<string> {
      const response = await send(`${LINKEDIN_REST_URL}/posts`, {
        method: 'POST',
        headers: restHeaders(accessToken),
        body: JSON.stringify({
          author: authorUrn,
          commentary,
          ...(media ? { content: { media } } : {}),
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        }),
      });
      return createdId(response);
    },

    async createComment(
      accessToken: string,
      actorUrn: string,
      postUrn: string,
      text: string,
    ): Promise<string> {
      const response = await send(
        `${LINKEDIN_REST_URL}/socialActions/${encodeURIComponent(postUrn)}/comments`,
        {
          method: 'POST',
          headers: restHeaders(accessToken),
          body: JSON.stringify({ actor: actorUrn, object: postUrn, message: { text } }),
        },
      );
      return createdId(response);
    },
  };
}

export type LinkedInClient = ReturnType<typeof createLinkedInClient>;

export function authorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    state: params.state,
    scope: LINKEDIN_SCOPES.join(' '),
  });
  return `${LINKEDIN_AUTHORIZE_URL}?${query.toString()}`;
}

export function personUrn(memberId: string): string {
  return `urn:li:person:${memberId}`;
}

export function postUrl(postUrn: string): string {
  return `https://www.linkedin.com/feed/update/${postUrn}/`;
}
