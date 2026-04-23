import type { PoolClient, QueryResult, QueryResultRow } from "pg";

export function firstRow<T extends QueryResultRow>(result: QueryResult<T>): T | null {
  return result.rows[0] ?? null;
}

export function requireRow<T extends QueryResultRow>(
  result: QueryResult<T>,
  message = "Expected query to return a row"
): T {
  const row = result.rows[0];
  if (!row) {
    throw new Error(message);
  }
  return row;
}

export function hasRows<T extends QueryResultRow>(result: QueryResult<T>): boolean {
  return (result.rowCount ?? 0) > 0;
}

export type DbExecutor = Pick<PoolClient, "query">;
