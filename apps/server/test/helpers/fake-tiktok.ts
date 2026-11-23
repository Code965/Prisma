import type { Readable } from 'node:stream';
import type { RawResponse, StreamPut } from '../../src/publishers/stream-put.js';
import type { FetchFn, TikTokPublishStatus } from '../../src/publishers/tiktok/client.js';

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

interface Upload {
  size: number;
  received: Buffer;
  statuses: TikTokPublishStatus[];
}

/**
 * TikTok finto: OAuth (refresh token che ruota), profilo, casella con i pezzi ricevuti davvero e
 * una sequenza di stati configurabile per `status/fetch`.
 */
export class FakeTikTok {
  readonly uploads = new Map<string, Upload>();
  readonly calls: string[] = [];
  /** Stati restituiti da `status/fetch` dopo il caricamento (l'ultimo si ripete). */
  statuses: TikTokPublishStatus[] = ['PROCESSING_UPLOAD', 'SEND_TO_USER_INBOX'];
  failReason: string | null = null;
  initError: { status: number; code: string } | null = null;
  /** Id del post pubblico restituito da `status/fetch` (dopo che l'autore ha pubblicato). */
  postIds: string[] = [];
  private refreshes = 0;
  private nextUpload = 0;

  readonly fetch: FetchFn = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    this.calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    const ok = (data: unknown) => Response.json({ data, error: { code: 'ok', message: '' } });
    if (url.pathname === '/v2/oauth/token/') {
      const body = new URLSearchParams(String(init?.body));
      const n = body.get('grant_type') === 'refresh_token' ? ++this.refreshes : 0;
      return Response.json({
        access_token: n ? `accesso-${n + 1}` : 'accesso-1',
        expires_in: 7200,
        refresh_token: n ? `refresh-${n + 1}` : 'refresh-1',
        refresh_expires_in: 15_552_000,
        open_id: 'open-123',
        scope: 'user.info.basic,video.upload',
        token_type: 'Bearer',
      });
    }
    if (url.pathname === '/v2/user/info/') {
      if (url.searchParams.get('fields') === 'follower_count')
        return ok({ user: { follower_count: 830 } });
      return ok({ user: { open_id: 'open-123', display_name: 'Marta Dev' } });
    }
    if (url.pathname === '/v2/video/query/') {
      const body = JSON.parse(String(init?.body)) as { filters: { video_ids: string[] } };
      const id = body.filters.video_ids[0];
      return ok({
        videos:
          id === '7311'
            ? [
                {
                  id: '7311',
                  share_url: 'https://www.tiktok.com/@d/video/7311',
                  view_count: 18200,
                  like_count: 1100,
                  comment_count: 90,
                  share_count: 50,
                },
              ]
            : [],
      });
    }
    if (url.pathname === '/v2/post/publish/inbox/video/init/') {
      if (this.initError) {
        return Response.json(
          { data: {}, error: { code: this.initError.code, message: 'rifiutato' } },
          { status: this.initError.status },
        );
      }
      const body = JSON.parse(String(init?.body)) as { source_info: { video_size: number } };
      const id = `v_inbox_file~${++this.nextUpload}`;
      this.uploads.set(id, {
        size: body.source_info.video_size,
        received: Buffer.alloc(0),
        statuses: [...this.statuses],
      });
      return ok({
        publish_id: id,
        upload_url: `https://upload.tiktok.test/${encodeURIComponent(id)}`,
      });
    }
    if (url.pathname === '/v2/post/publish/status/fetch/') {
      const { publish_id } = JSON.parse(String(init?.body)) as { publish_id: string };
      const upload = this.uploads.get(publish_id);
      if (!upload)
        return Response.json(
          { data: {}, error: { code: 'invalid_publish_id', message: 'x' } },
          { status: 400 },
        );
      const status = upload.statuses.length > 1 ? upload.statuses.shift()! : upload.statuses[0]!;
      return ok({
        status,
        fail_reason: status === 'FAILED' ? this.failReason : undefined,
        publicaly_available_post_id: this.postIds,
      });
    }
    return new Response(`Nessuna risposta finta per ${url.href}`, { status: 404 });
  };

  readonly put: StreamPut = async (url, headers, body): Promise<RawResponse> => {
    const id = decodeURIComponent(url.split('/').pop()!);
    const upload = this.uploads.get(id);
    if (!upload || !body) return { status: 404, headers: {}, body: '' };
    const [, first, last, total] = /bytes (\d+)-(\d+)\/(\d+)/
      .exec(headers['Content-Range']!)!
      .map(Number);
    if (first !== upload.received.length || total !== upload.size)
      return { status: 416, headers: {}, body: '' };
    const bytes = await readAll(body);
    if (bytes.length !== last! - first! + 1)
      return { status: 400, headers: {}, body: 'size mismatch' };
    upload.received = Buffer.concat([upload.received, bytes]);
    return { status: upload.received.length === upload.size ? 201 : 206, headers: {}, body: '' };
  };
}
