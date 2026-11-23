export class InvalidTransitionError extends Error {
  constructor(
    readonly entity: 'variant' | 'publication',
    readonly from: string,
    readonly action: string,
  ) {
    super(`Transizione non valida per ${entity}: "${action}" non è ammessa dallo stato "${from}"`);
    this.name = 'InvalidTransitionError';
  }
}
