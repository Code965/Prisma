export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RawResponse {
  /** 0 = server non raggiungibile o token mancante. */
  status: number;
  body: unknown;
}

/**
 * Come arrivano le richieste al server:
 * - in Electron passano dal main process (`window.prisma.request`), che aggiunge il token;
 * - nell'anteprima nel browser passano dal proxy `/api` di Vite, che fa lo stesso lato Node.
 */
export async function sendRequest(
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<RawResponse> {
  if (window.prisma) return window.prisma.request({ method, path, body });

  try {
    const response = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    try {
      return { status: response.status, body: text ? JSON.parse(text) : null };
    } catch {
      return { status: response.status, body: text };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 0, body: { error: 'server_non_raggiungibile', message } };
  }
}
