import { eq, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "./index";

// Druga, niezależna warstwa ochrony obok RLS (schema.ts) — patrz
// docs/architecture.md sekcja 2/23 i CLAUDE.md "Twarde zasady" punkt 2.
// Nie polegaj tylko na jednej z tych dwóch warstw.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// set_config(..., true) zachowuje się jak `SET LOCAL` (cofa się po commit/rollback),
// ale w przeciwieństwie do `SET LOCAL x = $1`, przyjmuje realny bind parameter —
// `SET LOCAL` nie wspiera parametryzacji w protokole Postgresa.
export async function withUserScope<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_user_id', ${userId}, true)`,
    );
    return fn(tx);
  });
}

export function ownedBy<T extends { userId: AnyPgColumn }>(
  table: T,
  userId: string,
) {
  return eq(table.userId, userId);
}
