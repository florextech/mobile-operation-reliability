/** Structural subset of expo-sqlite async APIs. The app opens the database with
 * SQLite.openDatabaseAsync and passes it here, keeping expo-sqlite optional. */
export type SqlValue = string | number | null;
export type SqlRow = Readonly<Record<string, unknown>>;
export interface ExpoSQLiteTransaction {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: SqlValue[]): Promise<{ readonly changes: number }>;
  getFirstAsync<T extends SqlRow>(sql: string, params: SqlValue[]): Promise<T | null>;
  getAllAsync<T extends SqlRow>(sql: string, params: SqlValue[]): Promise<readonly T[]>;
}
export interface ExpoSQLiteDatabase extends ExpoSQLiteTransaction {
  withExclusiveTransactionAsync(work: (transaction: ExpoSQLiteTransaction) => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}
