import type { DragEvent } from 'react';

/** Cosa si sta trascinando: una pubblicazione da spostare o una variant approvata da programmare. */
export type DragItem = { kind: 'publication'; id: number } | { kind: 'variant'; id: number };

const MIME = 'application/x-prisma';

export function startDrag(event: DragEvent, item: DragItem): void {
  event.dataTransfer.setData(MIME, JSON.stringify(item));
  event.dataTransfer.setData('text/plain', `${item.kind}:${item.id}`);
  event.dataTransfer.effectAllowed = 'move';
}

export function readDrag(event: DragEvent): DragItem | null {
  try {
    const raw = event.dataTransfer.getData(MIME);
    if (!raw) return null;
    const item = JSON.parse(raw) as DragItem;
    return (item.kind === 'publication' || item.kind === 'variant') && Number.isInteger(item.id)
      ? item
      : null;
  } catch {
    return null;
  }
}
