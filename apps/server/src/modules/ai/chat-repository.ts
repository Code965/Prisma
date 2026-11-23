import type { ChatMessage } from '@prisma-app/shared';
import { asc, desc, eq } from 'drizzle-orm';
import { toIso, type DbExecutor } from '../../db/executor.js';
import { chatMessages } from '../../db/schema.js';

type ChatRow = typeof chatMessages.$inferSelect;

function toChatMessage(row: ChatRow): ChatMessage {
  return { ...row, createdAt: toIso(row.createdAt) };
}

export async function insertChatMessage(
  db: DbExecutor,
  values: {
    contentId: number;
    variantId: number;
    role: 'user' | 'assistant';
    text: string;
    revisionId?: number | null;
  },
): Promise<void> {
  await db.insert(chatMessages).values(values);
}

export async function listChatMessages(db: DbExecutor, contentId: number): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.contentId, contentId))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
  return rows.map(toChatMessage);
}

/** Ultimi messaggi su una variant, dal più vecchio al più recente. */
export async function recentVariantMessages(
  db: DbExecutor,
  variantId: number,
  limit: number,
): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.variantId, variantId))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(limit);
  return rows.reverse().map(toChatMessage);
}
