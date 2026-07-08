import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { profiles, user } from "./schema";
import { ownedBy, withUserScope } from "./scoped";

// Test integracyjny na żywym lokalnym Postgresie (docker-compose) — RLS to
// dokładnie ten rodzaj logiki, który "wygląda dobrze" w code review, a mimo to
// ma race conditions/luki bez realnego uruchomienia. Patrz CLAUDE.md "Jak Piotr
// review'uje" punkt 7.

const userAId = "rls-test-user-a";
const userBId = "rls-test-user-b";

describe("RLS: profiles isolation", () => {
  afterAll(async () => {
    await withUserScope(userAId, (tx) =>
      tx.delete(profiles).where(ownedBy(profiles, userAId)),
    );
    await withUserScope(userBId, (tx) =>
      tx.delete(profiles).where(ownedBy(profiles, userBId)),
    );
    await db.delete(user).where(eq(user.id, userAId));
    await db.delete(user).where(eq(user.id, userBId));
  });

  it("blocks a user from reading another user's row, even without an explicit .where()", async () => {
    await db.insert(user).values([
      { id: userAId, name: "Alice", email: `${userAId}@example.com` },
      { id: userBId, name: "Bob", email: `${userBId}@example.com` },
    ]);

    await withUserScope(userAId, (tx) =>
      tx
        .insert(profiles)
        .values({ userId: userAId, firstName: "Alice-profile" }),
    );
    await withUserScope(userBId, (tx) =>
      tx.insert(profiles).values({ userId: userBId, firstName: "Bob-profile" }),
    );

    const aliceView = await withUserScope(userAId, (tx) =>
      tx.select().from(profiles),
    );
    expect(aliceView.map((p) => p.userId)).toEqual([userAId]);

    const bobView = await withUserScope(userBId, (tx) =>
      tx.select().from(profiles),
    );
    expect(bobView.map((p) => p.userId)).toEqual([userBId]);
  });

  it("blocks a cross-user UPDATE that explicitly targets another user's row (impersonation attempt)", async () => {
    const result = await withUserScope(userAId, (tx) =>
      tx
        .update(profiles)
        .set({ firstName: "HACKED" })
        .where(eq(profiles.userId, userBId)),
    );
    expect(result.count).toBe(0);

    const bobProfile = await withUserScope(userBId, (tx) =>
      tx.select().from(profiles).where(ownedBy(profiles, userBId)),
    );
    expect(bobProfile[0]?.firstName).toBe("Bob-profile");
  });

  it("a where-less UPDATE only touches the acting user's own row — RLS alone protects even if the app-level .where(userId) is fully omitted", async () => {
    const result = await withUserScope(userAId, (tx) =>
      tx.update(profiles).set({ firstName: "Alice-updated" }),
    );
    expect(result.count).toBe(1);

    const bobProfile = await withUserScope(userBId, (tx) =>
      tx.select().from(profiles).where(ownedBy(profiles, userBId)),
    );
    expect(bobProfile[0]?.firstName).toBe("Bob-profile");

    const aliceProfile = await withUserScope(userAId, (tx) =>
      tx.select().from(profiles).where(ownedBy(profiles, userAId)),
    );
    expect(aliceProfile[0]?.firstName).toBe("Alice-updated");
  });

  it("returns zero rows when no user context is set", async () => {
    const rows = await db.select().from(profiles);
    expect(rows).toEqual([]);
  });
});
