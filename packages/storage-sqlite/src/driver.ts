export type SqlValue = string | number | null;
export type SqlRow = Readonly<Record<string, unknown>>;

/** A dedicated connection, exclusively owned by the store. Calls are synchronous:
 * transactions must not yield to unrelated JavaScript between BEGIN and COMMIT. */
export interface SQLiteConnection {
  readonly inTransaction: boolean;
  exec(sql: string): void;
  run(sql: string, params: readonly SqlValue[]): number;
  get(sql: string, params?: readonly SqlValue[]): SqlRow | undefined;
  all(sql: string, params?: readonly SqlValue[]): readonly SqlRow[];
  close(): void;
}
