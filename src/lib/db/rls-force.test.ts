import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "./index";

// FORCE ROW LEVEL SECURITY nie ma odpowiednika w Drizzle DSL (tylko .enableRLS()) —
// dopisywane ręcznie do wygenerowanej migracji (patrz DECISIONS.md). Bez FORCE,
// RLS jest pomijane nie tylko dla superusera, ale i dla WŁAŚCICIELA tabeli — a
// kandydo_app jest właścicielem wszystkich tabel aplikacji (docker/postgres-init).
// Ten test to jedyny automatyczny alarm, gdyby przyszła migracja o tym zapomniała.
describe("RLS: FORCE jest ustawione na każdej tabeli z włączonym RLS", () => {
  it("relforcerowsecurity = true wszędzie, gdzie relrowsecurity = true", async () => {
    const rows = await db.execute<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(sql`
      select relname, relrowsecurity, relforcerowsecurity
      from pg_class
      where relnamespace = 'public'::regnamespace
        and relkind = 'r'
        and relrowsecurity = true
    `);

    expect(rows.length).toBeGreaterThan(0);
    const notForced = rows.filter((r) => !r.relforcerowsecurity);
    expect(notForced.map((r) => r.relname)).toEqual([]);
  });
});
