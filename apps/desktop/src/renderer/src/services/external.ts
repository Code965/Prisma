/** Apre un indirizzo nel browser di sistema (in Electron passa dal main, che lo verifica). */
export async function openExternal(url: string): Promise<void> {
  if (window.prisma) {
    await window.prisma.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}
