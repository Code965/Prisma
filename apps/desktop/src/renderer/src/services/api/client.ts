import type { ZodType } from 'zod';
import { sendRequest, type HttpMethod } from './transport';

/** Errore restituito dal server (o dal trasporto), con il codice e il messaggio in italiano. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnreachable(): boolean {
    return this.status === 0;
  }
}

function toApiError(status: number, body: unknown): ApiError {
  const data = (body ?? {}) as { error?: unknown; message?: unknown };
  const code = typeof data.error === 'string' ? data.error : 'errore';
  const message =
    typeof data.message === 'string' && data.message
      ? data.message
      : `Richiesta non riuscita (${status})`;
  return new ApiError(status, code, message);
}

/**
 * Esegue una richiesta e valida la risposta con lo schema condiviso: se il server cambia
 * formato, l'errore emerge qui e non come dato sbagliato in un componente.
 */
export async function apiRequest<T>(
  method: HttpMethod,
  path: string,
  schema: ZodType<T>,
  body?: unknown,
): Promise<T> {
  const { status, body: data } = await sendRequest(method, path, body);
  if (status < 200 || status >= 300) throw toApiError(status, data);
  return schema.parse(data);
}

/** Per le risposte senza corpo (204). */
export async function apiCommand(method: HttpMethod, path: string, body?: unknown): Promise<void> {
  const { status, body: data } = await sendRequest(method, path, body);
  if (status < 200 || status >= 300) throw toApiError(status, data);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Errore inatteso';
}
