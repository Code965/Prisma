import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extractJson } from './json-completion.js';
import { createOpenAiCompatibleProvider, type ChatCompletionsClient } from './openai-compatible.js';
import { LlmError } from './types.js';

type CreateParams = Parameters<ChatCompletionsClient['create']>[0];

/** Client finto: restituisce le risposte accodate e registra le richieste. */
function fakeClient(responses: (string | Error)[]) {
  const requests: CreateParams[] = [];
  const client: ChatCompletionsClient = {
    async create(params) {
      requests.push(params);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return { choices: [{ message: { content: next ?? '' } }] };
    },
  };
  return { client, requests };
}

const schema = z.object({ answer: z.string() });
const messages = [{ role: 'user' as const, content: 'Rispondi in json' }];

function provider(client: ChatCompletionsClient) {
  return createOpenAiCompatibleProvider({
    label: 'DeepSeek',
    apiKey: 'k',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    timeoutMs: 1000,
    client,
  });
}

describe('provider compatibile OpenAI', () => {
  it('chiede JSON mode e restituisce la risposta validata', async () => {
    const { client, requests } = fakeClient(['{"answer":"ok"}']);
    await expect(provider(client).completeJson({ messages, schema })).resolves.toEqual({
      answer: 'ok',
    });
    expect(requests[0]).toMatchObject({
      model: 'deepseek-flash',
      response_format: { type: 'json_object' },
    });
  });

  it('ritenta una risposta vuota o non JSON', async () => {
    const { client, requests } = fakeClient(['   ', 'non è json', '{"answer":"ok"}']);
    await expect(provider(client).completeJson({ messages, schema })).resolves.toEqual({
      answer: 'ok',
    });
    expect(requests).toHaveLength(3);
  });

  it('rimanda al modello gli errori di schema da correggere', async () => {
    const { client, requests } = fakeClient(['{"risposta":"ok"}', '{"answer":"ok"}']);
    await provider(client).completeJson({ messages, schema });
    const retry = requests[1]!.messages;
    expect(retry.at(-2)).toEqual({ role: 'assistant', content: '{"risposta":"ok"}' });
    expect(retry.at(-1)!.content).toMatch(/answer/);
  });

  it('si arrende dopo tre tentativi con un errore chiaro', async () => {
    const { client } = fakeClient(['', '', '']);
    await expect(provider(client).completeJson({ messages, schema })).rejects.toThrow(
      /risposta vuota/,
    );
  });

  it('trasforma gli errori di rete in LlmError', async () => {
    const { client } = fakeClient([new Error('401 Unauthorized')]);
    const promise = provider(client).completeJson({ messages, schema });
    await expect(promise).rejects.toBeInstanceOf(LlmError);
    await expect(promise).rejects.toThrow(/401/);
  });

  it('senza JSON mode supportato lo toglie e continua', async () => {
    const { client, requests } = fakeClient([
      new Error("400 'response_format.type' must be 'json_schema' or 'text'"),
      '```json\n{"answer":"ok"}\n```',
    ]);
    await expect(provider(client).completeJson({ messages, schema })).resolves.toEqual({
      answer: 'ok',
    });
    expect(requests[0]).toHaveProperty('response_format');
    expect(requests[1]).not.toHaveProperty('response_format');
  });
});

describe('estrazione del JSON', () => {
  it('prende il blocco ```json o il testo tra le graffe', () => {
    expect(extractJson('Ecco:\n```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('Certo! {"a":{"b":2}} Fine.')).toBe('{"a":{"b":2}}');
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
});
