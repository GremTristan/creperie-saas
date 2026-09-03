// Black-box permission test: forges a valid session for each role found in the
// database and hits every protected URL, asserting who gets in.
// Usage (server running): npm run check:permissions -- http://localhost:3000
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { sites, tenants, users } from "../lib/db/schema";
import { SESSION_COOKIE, signToken, type SessionPayload } from "../lib/auth/token";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

type Outcome = "ok" | "login" | "forbidden" | "own-site" | "not-found";

const PROBE_SLUG = "permission-probe";
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const db = drizzle(neon(url));

async function outcomeOf(path: string, cookie?: string): Promise<{ outcome: Outcome; detail: string }> {
  const res = await fetch(base + path, { redirect: "manual", headers: cookie ? { cookie } : {} });
  const loc = res.headers.get("location") ?? "";
  if (res.status === 200) return { outcome: "ok", detail: "200" };
  if (res.status === 404) return { outcome: "not-found", detail: "404" };
  if (res.status === 401 || res.status === 403) return { outcome: "forbidden", detail: String(res.status) };
  if (res.status >= 300 && res.status < 400) {
    const target = new URL(loc, base).pathname;
    if (target.startsWith("/connexion")) return { outcome: "login", detail: `→ ${target}` };
    if (target.startsWith("/acces-refuse")) return { outcome: "forbidden", detail: `→ ${target}` };
    if (/^\/s\/[^/]+$/.test(target)) return { outcome: "own-site", detail: `→ ${target}` };
    return { outcome: "ok", detail: `→ ${target}` };
  }
  return { outcome: "forbidden", detail: String(res.status) };
}

async function ensureForeignSite() {
  const existing = await db.select().from(tenants).where(eq(tenants.slug, PROBE_SLUG));
  let tenantId = existing[0]?.id;
  if (!tenantId) {
    const [created] = await db
      .insert(tenants)
      .values({
        name: "Permission Probe",
        slug: PROBE_SLUG,
        status: "suspended",
        plan: "essentiel",
      })
      .returning({ id: tenants.id });
    tenantId = created.id;
  }
  const existingSites = await db.select().from(sites).where(eq(sites.tenantId, tenantId));
  if (existingSites[0]) return existingSites[0];
  const [site] = await db
    .insert(sites)
    .values({
      tenantId,
      name: "Probe Site",
      slug: "probe",
      deviceCode: "PROBE1",
      active: true,
    })
    .returning();
  return site;
}

async function main() {
  const allUsers = await db.select().from(users).where(eq(users.active, true));
  const allSites = await db.select().from(sites);
  // Same tenant + same site for waiter/cook, otherwise mixed-tenant picks
  // look like permission bugs.
  const director =
    allUsers.find((u) => u.role === "director" && u.email?.endsWith("@creperies-group.ch")) ??
    allUsers.find((u) => u.role === "director" && u.tenantId);
  const waiter = director
    ? allUsers.find((u) => u.role === "waiter" && u.tenantId === director.tenantId && u.siteId)
    : undefined;
  const cook = waiter
    ? allUsers.find((u) => u.role === "cook" && u.tenantId === waiter.tenantId && u.siteId === waiter.siteId)
    : undefined;
  const admin = allUsers.find((u) => u.role === "superadmin");
  if (!waiter || !cook || !director) {
    throw new Error("Need at least one active waiter, cook and director on the same tenant/site.");
  }
  const ownSite = allSites.find((s) => s.id === waiter.siteId)!;
  const otherSiteSameTenant = allSites.find((s) => s.tenantId === waiter.tenantId && s.id !== waiter.siteId);
  // Always have a foreign tenant site so cross-tenant assertions run even on
  // a freshly seeded single-tenant database.
  const foreignSite = allSites.find((s) => s.tenantId !== director.tenantId) ?? (await ensureForeignSite());

  const exp = Math.floor(Date.now() / 1000) + 600;
  const session = async (u: typeof waiter) =>
    `${SESSION_COOKIE}=${await signToken({ v: 1, kind: "session", uid: u.id, tid: u.tenantId, role: u.role, sid: u.siteId, exp } satisfies SessionPayload)}`;
  const cookies = {
    anonymous: undefined,
    waiter: await session(waiter),
    cook: await session(cook),
    director: await session(director),
    superadmin: admin ? await session(admin) : undefined,
    forged: `${SESSION_COOKIE}=${(await session(director)).split("=")[1].replace(/.$/, (c) => (c === "A" ? "B" : "A"))}`,
    expired: `${SESSION_COOKIE}=${await signToken({ v: 1, kind: "session", uid: director.id, tid: director.tenantId, role: "director", sid: null, exp: exp - 1200 })}`,
  };
  type Who = keyof typeof cookies;

  const S = ownSite.id;
  const cases: { path: string; expect: Partial<Record<Who, Outcome | Outcome[]>> }[] = [
    { path: "/direction", expect: { anonymous: "login", waiter: "forbidden", cook: "forbidden", director: "ok", superadmin: "forbidden", forged: "login", expired: "login" } },
    { path: "/direction/equipe", expect: { waiter: "forbidden", cook: "forbidden", director: "ok" } },
    { path: "/direction/ventes", expect: { waiter: "forbidden", cook: "forbidden", director: "ok" } },
    { path: "/direction/activite", expect: { waiter: "forbidden", cook: "forbidden", director: "ok" } },
    { path: "/direction/abonnement", expect: { waiter: "forbidden", director: "ok" } },
    { path: "/admin", expect: { anonymous: "login", waiter: "forbidden", cook: "forbidden", director: "forbidden", superadmin: "ok" } },
    { path: `/s/${S}/service`, expect: { anonymous: "login", waiter: "ok", cook: "forbidden", director: "ok", superadmin: "forbidden" } },
    { path: `/s/${S}/commande`, expect: { waiter: "ok", cook: "forbidden", director: "ok" } },
    { path: `/s/${S}/caisse`, expect: { waiter: "ok", cook: "forbidden", director: "ok" } },
    { path: `/s/${S}/cuisine`, expect: { waiter: "forbidden", cook: "ok", director: "ok" } },
    { path: `/s/${S}/stock`, expect: { waiter: "forbidden", cook: "ok", director: "ok" } },
    { path: `/api/orders/${S}`, expect: { anonymous: "login", waiter: "ok", cook: "forbidden", director: "ok" } },
    { path: `/api/kds/${S}`, expect: { anonymous: "login", waiter: "forbidden", cook: "ok", director: "ok" } },
    { path: `/api/stock/${S}`, expect: { waiter: "forbidden", cook: "ok", director: "ok" } },
    { path: "/api/export/ventes?periode=jour", expect: { anonymous: "login", waiter: "forbidden", cook: "forbidden", director: "ok" } },
    { path: "/api/export/tickets?periode=jour", expect: { waiter: "forbidden", cook: "forbidden", director: "ok" } },
    { path: "/api/export/donnees", expect: { waiter: "forbidden", director: "ok" } },
    // Cross-tenant: proxy lets directors through on role, server must refuse on tenant.
    { path: `/s/${foreignSite.id}/service`, expect: { director: ["forbidden", "not-found"], waiter: "own-site" } },
    { path: `/api/orders/${foreignSite.id}`, expect: { director: ["forbidden", "not-found"] } },
  ];
  if (otherSiteSameTenant) {
    cases.push({ path: `/s/${otherSiteSameTenant.id}/service`, expect: { waiter: "own-site", director: "ok" } });
  }

  let failures = 0;
  let checks = 0;
  for (const c of cases) {
    for (const [who, expected] of Object.entries(c.expect) as [Who, Outcome | Outcome[]][]) {
      if (who === "superadmin" && !cookies.superadmin) continue;
      checks++;
      const { outcome, detail } = await outcomeOf(c.path, cookies[who]);
      const accepted = Array.isArray(expected) ? expected : [expected];
      const pass = accepted.includes(outcome);
      if (!pass) failures++;
      console.log(`${pass ? "PASS" : "FAIL"}  ${who.padEnd(10)} ${c.path.padEnd(48)} ${outcome.padEnd(9)} ${pass ? "" : `(expected ${accepted.join("|")}) ${detail}`}`);
    }
  }
  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (!admin) console.log("Note: no super-admin account found — /admin checks for that role were skipped.");
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
