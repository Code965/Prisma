import { PLATFORM_LABELS, type VoiceExample } from '@prisma-app/shared';

/** Quanti esempi e quanti caratteri per esempio entrano in un prompt (costo e attenzione del modello). */
export const VOICE_PROMPT_EXAMPLES = 6;
const EXAMPLE_MAX_CHARS = 1200;

/**
 * Sezione «voce dell'autore» per i prompt di generazione e modifica: regole del brand kit ed
 * esempi di post reali. Senza indicazioni restituisce una frase neutra (il segnaposto non può
 * restare vuoto).
 */
export function formatVoice(rules: readonly string[], examples: readonly VoiceExample[]): string {
  if (rules.length === 0 && examples.length === 0) {
    return 'Nessuna indicazione aggiuntiva sulla voce: segui le regole di scrittura sopra.';
  }
  const parts = [
    "Voce dell'autore: rispetta queste regole e imita lo stile degli esempi (ritmo, lessico, struttura), senza copiarne frasi o contenuti.",
  ];
  if (rules.length > 0) parts.push(['Regole:', ...rules.map((rule) => `- ${rule}`)].join('\n'));
  if (examples.length > 0) {
    const items = examples.slice(0, VOICE_PROMPT_EXAMPLES).map((example) => {
      const text =
        example.text.length > EXAMPLE_MAX_CHARS
          ? `${example.text.slice(0, EXAMPLE_MAX_CHARS)}…`
          : example.text;
      const note = example.note ? ` (${example.note})` : '';
      return `[${PLATFORM_LABELS[example.platform]}${note}]\n"""\n${text}\n"""`;
    });
    parts.push(["Esempi di post scritti dall'autore:", ...items].join('\n\n'));
  }
  return parts.join('\n\n');
}
