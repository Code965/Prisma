import { z } from 'zod';

export const IDEA_STATUSES = ['nuova', 'in_lavorazione', 'usata', 'archiviata'] as const;
export const IdeaStatusSchema = z.enum(IDEA_STATUSES);
export type IdeaStatus = z.infer<typeof IdeaStatusSchema>;

export const IDEA_SOURCES = ['scritta', 'vocale', 'suggerita'] as const;
export const IdeaSourceSchema = z.enum(IDEA_SOURCES);
export type IdeaSource = z.infer<typeof IdeaSourceSchema>;
