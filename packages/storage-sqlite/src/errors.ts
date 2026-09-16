import { DomainError } from '@florextech/core';
import type { MutationResult, OperationError } from '@florextech/core';

export class StoreError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'StoreError'; }
}
export function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new StoreError(code);
}
export function storageError(error: unknown): OperationError {
  let code = 'StorageFailure';
  if (error instanceof StoreError) code = error.code;
  else if (error instanceof DomainError) code = error.code;
  else if (error && typeof error === 'object' && 'errcode' in error) {
    switch (Number(error.errcode) & 0xff) {
      case 5: case 6: code = 'StorageBusy'; break;
      case 13: code = 'StorageFull'; break;
      case 11: case 26: code = 'StorageCorrupt'; break;
      case 8: code = 'StorageReadOnly'; break;
    }
  }
  return Object.freeze({ code, category: 'STORAGE', certainty: 'NOT_APPLICABLE', scope: 'LOCAL', action: 'HOLD', message: code });
}
export function mutationError(error: unknown): MutationResult {
  if (error instanceof DomainError) {
    switch (error.code) {
      case 'RevisionConflict': case 'LeaseLost': case 'StaleAttempt': case 'NotEligible':
        return { kind: 'CONFLICT', code: error.code };
    }
  }
  return { kind: 'ERROR', error: storageError(error) };
}
