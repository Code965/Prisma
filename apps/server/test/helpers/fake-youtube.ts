import type { Readable } from 'node:stream';
import type {
  FetchFn,
  RawResponse,
  StreamPut,
  VideoStatus,
} from '../../src/publishers/youtube/client.js';

interface Session {
  metadata: { snippet: Record<string, unknown>; status: VideoStatus };
  size: number;
  received: Buffer;
  videoId: string | null;
}

/** Comportamento del prossimo PUT di byte: riuscito, interrotto a metà o risposta persa. */
export type PutBehaviour = 'ok' | 'drop-half' | 'lost-response' | 'error-500';

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

/**
 * YouTube finto: OAuth, canale, sessioni resumable con i byte ricevuti davvero, stato dei video,
 * modifica e cancellazione. Gli indirizzi sono quelli veri, intercettati da `fetch` e `put`.
 */
export class FakeYouTube {
  readonly sessions = new Map<string, Session>();
  readonly videos = new Map<string, { status: VideoStatus; snippet: Record<string, unknown> }>();
  readonly putBehaviours: PutBehaviour[] = [];
  readonly calls: string[] = [];
  refreshFails = false;
  readonly analyticsQueries: URLSearchParams[] = [];
  private nextSession = 0;
  private nextVideo = 0;

  readonly fetch: FetchFn = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init?.method ?? 'GET';
    this.calls.push(`${method} ${url.pathname}`);
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(String(init?.body));
      if (body.get('grant_type') === 'refresh_token') {
        if (this.refreshFails) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        return Response.json({ access_token: 'accesso-rinnovato', expires_in: 3599 });
      }
      return Response.json({
        access_token: 'accesso-1',
        refresh_token: 'refresh-1',
        expires_in: 3599,
      });
    }
    if (url.href.startsWith('https://youtubeanalytics.googleapis.com/v2/reports')) {
      this.analyticsQueries.push(url.searchParams);
      return Response.json({
        columnHeaders: [
          { name: 'day' },
          { name: 'views' },
          { name: 'subscribersGained' },
          { name: 'subscribersLost' },
        ],
        rows: [
          ['2026-11-20', 340, 5, 1],
          ['2026-11-21', 410, 7, 0],
        ],
      });
    }
    if (url.pathname === '/youtube/v3/channels' && url.searchParams.get('part') === 'statistics') {
      return Response.json({
        items: [{ id: 'UC123', statistics: { subscriberCount: '1250', viewCount: '90000' } }],
      });
    }
    if (url.pathname === '/youtube/v3/channels') {
      return Response.json({
        items: [{ id: 'UC123', snippet: { title: 'Marta Dev', customUrl: '@martadev' } }],
      });
    }
    if (url.pathname === '/upload/youtube/v3/videos' && method === 'POST') {
      const id = `s${++this.nextSession}`;
      this.sessions.set(id, {
        metadata: JSON.parse(String(init?.body)),
        size: Number(new Headers(init?.headers).get('x-upload-content-length')),
        received: Buffer.alloc(0),
        videoId: null,
      });
      return new Response(null, {
        status: 200,
        headers: { Location: `https://upload.test/session/${id}` },
      });
    }
    if (url.pathname === '/youtube/v3/videos') {
      const id = url.searchParams.get('id');
      if (method === 'GET' && url.searchParams.get('part') === 'statistics') {
        const video = id ? this.videos.get(id) : undefined;
        return Response.json({
          items: video
            ? [
                {
                  id,
                  statistics: {
                    viewCount: '1520',
                    likeCount: '96',
                    commentCount: '12',
                    favoriteCount: '0',
                  },
                },
              ]
            : [],
        });
      }
      if (method === 'GET') {
        const video = id ? this.videos.get(id) : undefined;
        return Response.json({ items: video ? [{ id, status: video.status }] : [] });
      }
      if (method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { id: string; status: VideoStatus };
        const video = this.videos.get(body.id);
        if (!video) return Response.json({ error: { message: 'not found' } }, { status: 404 });
        video.status = body.status;
        return Response.json({ id: body.id, status: body.status });
      }
      if (method === 'DELETE') {
        if (!id || !this.videos.delete(id)) return new Response(null, { status: 404 });
        return new Response(null, { status: 204 });
      }
    }
    return new Response(`Nessuna risposta finta per ${method} ${url.href}`, { status: 404 });
  };

  readonly put: StreamPut = async (url, headers, body): Promise<RawResponse> => {
    const id = url.split('/').pop()!;
    this.calls.push(`PUT session ${id}`);
    const session = this.sessions.get(id);
    if (!session) return { status: 404, headers: {}, body: '' };
    const range = headers['Content-Range'];
    if (!body) {
      // Domanda di stato: `bytes */TOTAL`.
      if (session.videoId) return this.done(session);
      return this.incomplete(session);
    }
    const start = range ? Number(/bytes (\d+)-/.exec(range)![1]) : 0;
    if (start !== session.received.length) return { status: 400, headers: {}, body: 'overlap' };
    const bytes = await readAll(body);
    const behaviour = this.putBehaviours.shift() ?? 'ok';
    if (behaviour === 'error-500')
      return { status: 500, headers: {}, body: '{"error":{"message":"backend"}}' };
    if (behaviour === 'drop-half') {
      session.received = Buffer.concat([
        session.received,
        bytes.subarray(0, Math.floor(bytes.length / 2)),
      ]);
      throw new Error('socket hang up');
    }
    session.received = Buffer.concat([session.received, bytes]);
    if (session.received.length < session.size) return this.incomplete(session);
    session.videoId = `v${++this.nextVideo}`;
    this.videos.set(session.videoId, {
      status: session.metadata.status,
      snippet: session.metadata.snippet,
    });
    if (behaviour === 'lost-response') throw new Error('ECONNRESET');
    return this.done(session);
  };

  private done(session: Session): RawResponse {
    return { status: 201, headers: {}, body: JSON.stringify({ id: session.videoId }) };
  }

  private incomplete(session: Session): RawResponse {
    const headers =
      session.received.length > 0 ? { range: `bytes=0-${session.received.length - 1}` } : {};
    return { status: 308, headers, body: '' };
  }
}
