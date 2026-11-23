import { describe, expect, it } from 'vitest';
import { IdeaInputSchema } from './idea.js';
import { ScheduleSchema } from './publication.js';
import { VariantMetadataSchema, VariantTransitionSchema } from './variant.js';
import { GenerateContentSchema } from './content.js';

describe('schemi DTO', () => {
  it('applica i default a una nuova idea', () => {
    const idea = IdeaInputSchema.parse({ text: '  Ollama in locale  ' });
    expect(idea).toEqual({
      text: 'Ollama in locale',
      source: 'scritta',
      tagIds: [],
      targetPlatforms: [],
    });
  });

  it('rifiuta idee vuote e piattaforme duplicate', () => {
    expect(IdeaInputSchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(
      IdeaInputSchema.safeParse({ text: 'x', targetPlatforms: ['linkedin', 'linkedin'] }).success,
    ).toBe(false);
  });

  it('normalizza gli hashtag', () => {
    const meta = VariantMetadataSchema.parse({ hashtags: ['dotnet', '#PyQGIS', 'clean_code'] });
    expect(meta.hashtags).toEqual(['#dotnet', '#PyQGIS', '#clean_code']);
    expect(VariantMetadataSchema.safeParse({ hashtags: ['due parole'] }).success).toBe(false);
  });

  it('accetta solo istanti con offset esplicito per la programmazione', () => {
    const base = { variantId: 1, socialAccountId: 1 };
    expect(ScheduleSchema.safeParse({ ...base, scheduledAt: '2026-11-22T16:00:00Z' }).success).toBe(
      true,
    );
    expect(
      ScheduleSchema.safeParse({ ...base, scheduledAt: '2026-11-22T17:00:00+01:00' }).success,
    ).toBe(true);
    expect(ScheduleSchema.safeParse({ ...base, scheduledAt: '2026-11-22 17:00' }).success).toBe(
      false,
    );
  });

  it('non espone le azioni di sistema come transizioni utente', () => {
    expect(
      VariantTransitionSchema.safeParse({ action: 'approve', expectedVersion: 0 }).success,
    ).toBe(true);
    expect(
      VariantTransitionSchema.safeParse({ action: 'publishSucceeded', expectedVersion: 0 }).success,
    ).toBe(false);
  });

  it('richiede almeno una piattaforma per generare contenuti', () => {
    expect(GenerateContentSchema.safeParse({ ideaId: 1, platforms: [] }).success).toBe(false);
  });
});
