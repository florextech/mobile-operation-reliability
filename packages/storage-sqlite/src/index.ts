export { SQLiteOperationStore } from './store.js';
export type { InspectionQuery } from './store.js';
export type { SQLiteConnection, SqlRow, SqlValue } from './driver.js';
/** Shared record codec for storage adapters. It contains no Node APIs. */
export { decodeChange, decodeEvent, decodeOperation, encode } from './codec.js';
export { ensure, mutationError, storageError } from './errors.js';
