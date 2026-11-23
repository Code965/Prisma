/** Legge un file scelto dall'utente come data URL (per il logo del brand kit). */
export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Lettura del file non riuscita'));
    reader.readAsDataURL(file);
  });
}
