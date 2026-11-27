import { PLATFORMS } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import { createPromptLibrary, renderTemplate } from './prompts.js';

describe('prompt', () => {
  it('sostituisce i segnaposto', () => {
    expect(renderTemplate('Ciao {{ nome }}, {{nome}}!', { nome: 'Dom' })).toBe('Ciao Dom, Dom!');
  });

  it('segnala le variabili mancanti invece di lasciare vuoti', () => {
    expect(() => renderTemplate('{{idea}}', {})).toThrow(/idea/);
  });

  it('i prompt reali hanno tutte le variabili che il codice fornisce', () => {
    const prompts = createPromptLibrary();
    const generate = prompts.render('generate-variants.user', {
      ideaText: 'x',
      tags: 'x',
      platforms: 'x',
      guidelines: 'x',
    });
    expect(generate).toContain('x');
    expect(prompts.render('generate-variants.system', { brandName: 'Brand', voice: 'V' })).toMatch(
      /json/,
    );
    expect(
      prompts.render('edit-variant.system', {
        brandName: 'B',
        platformLabel: 'P',
        guidelines: 'G',
        voice: 'V',
      }),
    ).toMatch(/json/);
    expect(
      prompts.render('edit-variant.user', {
        contentTitle: 't',
        currentVariant: '{}',
        history: 'h',
        instruction: 'i',
      }),
    ).toContain('i');
    expect(
      prompts.render('generate-article.system', {
        brandName: 'B',
        guidelines: 'G',
        voice: 'V',
      }),
    ).toMatch(/json/);
    expect(prompts.render('generate-article.user', { ideaText: 'i', tags: 't' })).toContain('i');
    expect(
      prompts.render('generate-carousel.system', {
        brandName: 'B',
        platformLabel: 'P',
        voice: 'V',
      }),
    ).toMatch(/json/);
    expect(prompts.render('generate-carousel.user', { contentTitle: 't', body: 'b' })).toContain(
      'b',
    );
    expect(
      prompts.render('edit-carousel.system', {
        brandName: 'B',
        platformLabel: 'P',
        slideNumber: '2',
        voice: 'V',
      }),
    ).toMatch(/json/);
    expect(
      prompts.render('edit-carousel.user', {
        contentTitle: 't',
        carousel: '{}',
        slideNumber: '2',
        instruction: 'i',
      }),
    ).toContain('i');
    expect(
      prompts.render('generate-shorts.system', {
        brandName: 'B',
        voice: 'V',
        minSeconds: '10',
        maxSeconds: '90',
      }),
    ).toMatch(/json/);
    expect(
      prompts.render('generate-shorts.user', {
        videoTitle: 'v',
        duration: '1:00',
        count: '3',
        platforms: 'p',
        guidelines: 'g',
        segments: '[0] s',
      }),
    ).toContain('[0] s');
    expect(prompts.render('generate-insights.system', { brandName: 'B' })).toMatch(/json/);
    expect(prompts.render('generate-trends.system', { brandName: 'B', tags: 'T' })).toMatch(/json/);
    expect(prompts.render('generate-trends.user', { keywords: 'K', items: 'I' })).toContain('I');
    expect(prompts.render('generate-competitors.system', { brandName: 'B' })).toMatch(/json/);
    expect(prompts.render('generate-competitors.user', { posts: 'P' })).toContain('P');
    expect(prompts.render('inspire.system', { brandName: 'B', voice: 'V' })).toMatch(/json/);
    expect(
      prompts.render('inspire.user', { origin: 'O', original: 'T', numbers: 'N', topic: 'A' }),
    ).toContain('T');
    expect(
      prompts.render('generate-insights.user', {
        weekStart: '2026-11-23',
        series: 'S',
        posts: 'P',
        slots: 'L',
      }),
    ).toContain('P');
    for (const platform of PLATFORMS) {
      expect(prompts.render(`platforms/${platform}`)).toMatch(/^### /);
    }
  });
});
