import { createConnection, type Socket } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Client del canale di controllo di FilmCraft (`filmcraft --control <porta>`, docs/control-protocol.md):
 * TCP solo su 127.0.0.1, una richiesta JSON per riga `{id, token, method, params}`, una risposta
 * per riga `{id, ok, result | error}`. Il token (64 caratteri esadecimali) passa a FilmCraft
 * nell'ambiente e non compare mai sulla riga di comando né nei log.
 */

export interface ControlReply {
  id?: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface ControlClient {
  /** Metodo del protocollo (es. `engine.execute`, `app.quit`). */
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Comando del motore (`engine.execute {command, params}`). */
  exec(command: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

export class ControlError extends Error {}

/** Risposta di FilmCraft appena avviato: la richiesta va ripetuta. */
const STARTING = /still starting/i;

interface ClientOptions {
  port: number;
  token: string;
  /** Tempo massimo per una risposta (l'export con `wait: false` risponde subito). */
  timeoutMs?: number;
  /** Tempo massimo per la prima connessione e per l'avvio dell'app. */
  startupMs?: number;
  connect?: (port: number) => Promise<Socket>;
}

function connectLocal(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => resolve(socket));
    socket.once('error', reject);
  });
}

export function createControlClient(options: ClientOptions): ControlClient {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const startupMs = options.startupMs ?? 60_000;
  const connect = options.connect ?? connectLocal;
  let socket: Socket | null = null;
  let buffer = '';
  let nextId = 0;
  const pending = new Map<number, (reply: ControlReply) => void>();

  function failAll(message: string) {
    for (const resolve of pending.values()) resolve({ ok: false, error: message });
    pending.clear();
  }

  function attach(next: Socket) {
    next.setEncoding('utf8');
    next.on('data', (chunk: string) => {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let reply: ControlReply;
        try {
          reply = JSON.parse(line) as ControlReply;
        } catch {
          continue;
        }
        if (typeof reply.id !== 'number') {
          // Riga malformata o token rifiutato: FilmCraft chiude la connessione.
          failAll(reply.error ?? 'Risposta non valida da FilmCraft');
          continue;
        }
        pending.get(reply.id)?.(reply);
        pending.delete(reply.id);
      }
    });
    // Dopo 2 minuti senza richieste FilmCraft chiude il socket: alla prossima si riconnette.
    next.on('close', () => {
      if (socket === next) socket = null;
      failAll('Connessione con FilmCraft chiusa');
    });
    next.on('error', () => undefined);
  }

  async function ensureSocket(deadline: number): Promise<Socket> {
    if (socket && !socket.destroyed) return socket;
    for (;;) {
      try {
        const next = await connect(options.port);
        buffer = '';
        attach(next);
        socket = next;
        return next;
      } catch (error) {
        if (Date.now() >= deadline) {
          throw new ControlError('FilmCraft non risponde: è ancora aperto?', { cause: error });
        }
        await sleep(300);
      }
    }
  }

  async function send(method: string, params: Record<string, unknown> | undefined) {
    const deadline = Date.now() + startupMs;
    for (;;) {
      const current = await ensureSocket(deadline);
      const id = ++nextId;
      const reply = await new Promise<ControlReply>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, error: 'FilmCraft non ha risposto in tempo' });
        }, timeoutMs);
        pending.set(id, (value) => {
          clearTimeout(timer);
          resolve(value);
        });
        current.write(`${JSON.stringify({ id, token: options.token, method, params })}\n`);
      });
      if (reply.ok) return reply.result;
      if (reply.error && STARTING.test(reply.error) && Date.now() < deadline) {
        await sleep(300);
        continue;
      }
      throw new ControlError(reply.error ?? 'Errore di FilmCraft');
    }
  }

  return {
    call: (method, params) => send(method, params),
    exec: (command, params = {}) => send('engine.execute', { command, params }),
    close() {
      socket?.end();
      socket = null;
    },
  };
}

/** Stato di un lavoro in `jobs.list` (export). */
export interface FilmcraftJob {
  id: number;
  finished: boolean;
  progress: number;
  status?: string;
  result?: { path?: string; bytes?: number } | null;
}

export function findJob(list: unknown, id: number): FilmcraftJob | null {
  if (!Array.isArray(list)) return null;
  const job = (list as FilmcraftJob[]).find((j) => j && j.id === id);
  return job ?? null;
}
