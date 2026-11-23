import type { Platform, Variant } from '@prisma-app/shared';
import {
  PublishError,
  type AdvanceUpload,
  type PublishMedia,
  type PublishRequest,
  type PublishResult,
  type PublisherAdapter,
  type ValidationIssue,
} from '../../src/publishers/types.js';

export type FakeBehaviour = 'success' | 'transient' | 'permanent' | 'crash';

/** Adapter finto: registra le chiamate ed esegue i comportamenti accodati (default: successo). */
export class FakePublisher implements PublisherAdapter {
  readonly calls: PublishRequest[] = [];
  readonly behaviours: FakeBehaviour[] = [];
  issues: ValidationIssue[] = [];
  delayMs = 0;
  warnings: string[] = [];

  constructor(readonly platform: Platform = 'linkedin') {}

  /** File ricevuti dall'ultima `validate()`, per controllare che lo scheduler li passi. */
  validatedMedia: readonly PublishMedia[] | undefined;

  validate(_variant: Variant, media?: readonly PublishMedia[]): ValidationIssue[] {
    this.validatedMedia = media;
    return this.issues;
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    this.calls.push(request);
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const behaviour = this.behaviours.shift() ?? 'success';
    if (behaviour === 'transient') throw new PublishError('Rate limit, riprova più tardi', true);
    if (behaviour === 'permanent') throw new PublishError('Contenuto rifiutato', false);
    if (behaviour === 'crash') throw new Error('ECONNRESET');
    return {
      externalId: `post-${request.publicationId}`,
      externalUrl: `https://example.test/post/${request.publicationId}`,
      warnings: this.warnings,
    };
  }
}

/**
 * Adapter finto con caricamento anticipato (come YouTube): registra prepare, finalize, withdraw
 * e reschedule; `failNext` fa fallire la prossima chiamata.
 */
export class FakeAdvancePublisher extends FakePublisher {
  readonly log: string[] = [];
  failNext: PublishError | null = null;

  constructor(platform: Platform = 'youtube') {
    super(platform);
  }

  private check(entry: string) {
    this.log.push(entry);
    const failure = this.failNext;
    this.failNext = null;
    if (failure) throw failure;
  }

  readonly advance: AdvanceUpload = {
    minLeadMs: 15 * 60_000,
    prepare: async (request) => {
      this.check(`prepare ${request.publicationId} ${request.scheduledAt.toISOString()}`);
      await request.uploadSession?.save('sessione-1');
      return { externalId: `video-${request.publicationId}`, externalUrl: null };
    },
    finalize: async (request) => {
      this.check(`finalize ${request.externalId} ${request.account.accessToken}`);
      return {
        externalId: request.externalId,
        externalUrl: `https://video.test/${request.externalId}`,
      };
    },
    withdraw: async (account, externalId) => {
      this.check(`withdraw ${externalId} ${account.accessToken}`);
    },
    reschedule: async (_account, externalId, scheduledAt) => {
      this.check(`reschedule ${externalId} ${scheduledAt.toISOString()}`);
    },
  };
}
