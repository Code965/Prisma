import { InvalidTransitionError } from '@prisma-app/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { LlmError, LlmNotConfiguredError } from '../llm/types.js';

export class NotFoundError extends Error {
  constructor(
    readonly entity: string,
    readonly id: number | string,
  ) {
    super(`${entity} ${id} non trovato`);
    this.name = 'NotFoundError';
  }
}

/** La risorsa è cambiata dopo che il client l'ha letta (lock ottimistico). */
export class VersionConflictError extends Error {
  constructor(
    readonly entity: string,
    readonly id: number,
  ) {
    super(`${entity} ${id} è stato modificato nel frattempo: ricarica e riprova`);
    this.name = 'VersionConflictError';
  }
}

/** Esiste già una risorsa con la stessa chiave univoca. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Richiesta ben formata ma contraria a una regola di dominio (es. piattaforma sbagliata). */
export class BusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusinessRuleError';
  }
}

/** Funzione che richiede una configurazione assente nel .env (es. credenziali LinkedIn). */
export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotConfiguredError';
  }
}

/** Riconosce la violazione di un indice univoco, anche se avvolta da Drizzle. */
export function isDuplicateKeyError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    // node:sqlite: SQLITE_CONSTRAINT_UNIQUE (2067) o PRIMARYKEY (1555), con il messaggio di SQLite.
    const { errcode, message } = current as { errcode?: number; message?: string };
    if (errcode === 2067 || errcode === 1555) return true;
    if (typeof message === 'string' && /UNIQUE constraint failed/.test(message)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

interface ErrorBody {
  error: string;
  message: string;
  details?: unknown;
}

export function toErrorResponse(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: { error: 'richiesta_non_valida', message: 'Dati non validi', details: error.issues },
    };
  }
  if (error instanceof NotFoundError) {
    return { status: 404, body: { error: 'non_trovato', message: error.message } };
  }
  if (error instanceof InvalidTransitionError) {
    return { status: 409, body: { error: 'transizione_non_valida', message: error.message } };
  }
  if (error instanceof VersionConflictError) {
    return { status: 409, body: { error: 'conflitto_versione', message: error.message } };
  }
  if (error instanceof ConflictError) {
    return { status: 409, body: { error: 'conflitto', message: error.message } };
  }
  if (isDuplicateKeyError(error)) {
    return { status: 409, body: { error: 'conflitto', message: 'Elemento già esistente' } };
  }
  if (error instanceof BusinessRuleError) {
    return { status: 422, body: { error: 'regola_violata', message: error.message } };
  }
  if (error instanceof NotConfiguredError) {
    return { status: 503, body: { error: 'non_configurato', message: error.message } };
  }
  if (error instanceof LlmNotConfiguredError) {
    return { status: 503, body: { error: 'llm_non_configurato', message: error.message } };
  }
  if (error instanceof LlmError) {
    return { status: 502, body: { error: 'errore_llm', message: error.message } };
  }
  const fastifyError = error as Partial<FastifyError>;
  if (fastifyError.statusCode && fastifyError.statusCode < 500) {
    return {
      status: fastifyError.statusCode,
      body: { error: fastifyError.code ?? 'errore_richiesta', message: fastifyError.message ?? '' },
    };
  }
  return { status: 500, body: { error: 'errore_interno', message: 'Errore interno del server' } };
}

export function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  const { status, body } = toErrorResponse(error);
  if (status >= 500) request.log.error({ err: error }, 'Errore non gestito');
  void reply.code(status).send(body);
}
