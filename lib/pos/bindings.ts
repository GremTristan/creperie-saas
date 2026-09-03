import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { posBindings } from "@/lib/db/schema";
import type { CaptureSource, PosBinding, SiteId } from "@/types";

type Row = typeof posBindings.$inferSelect;

function toBinding(row: Row): PosBinding {
  return {
    id: row.id,
    tenantId: row.tenantId,
    siteId: row.siteId,
    source: row.source,
    externalId: row.externalId,
  };
}

export async function getPosBindingByExternal(
  source: CaptureSource,
  externalId: string
): Promise<PosBinding | undefined> {
  const id = externalId.trim();
  if (!id) return undefined;
  const [row] = await db
    .select()
    .from(posBindings)
    .where(and(eq(posBindings.source, source), eq(posBindings.externalId, id)));
  return row ? toBinding(row) : undefined;
}

export async function listPosBindings(tenantId: string, source?: CaptureSource): Promise<PosBinding[]> {
  const rows = source
    ? await db
        .select()
        .from(posBindings)
        .where(and(eq(posBindings.tenantId, tenantId), eq(posBindings.source, source)))
    : await db.select().from(posBindings).where(eq(posBindings.tenantId, tenantId));
  return rows.map(toBinding);
}

export async function upsertPosBinding(input: {
  tenantId: string;
  siteId: SiteId;
  source: CaptureSource;
  externalId: string;
}): Promise<PosBinding> {
  const externalId = input.externalId.trim();
  if (!externalId) throw new Error("Identifiant POS requis");

  const existingForSite = await db
    .select()
    .from(posBindings)
    .where(
      and(
        eq(posBindings.tenantId, input.tenantId),
        eq(posBindings.siteId, input.siteId),
        eq(posBindings.source, input.source)
      )
    );

  if (existingForSite[0]) {
    const [row] = await db
      .update(posBindings)
      .set({ externalId })
      .where(eq(posBindings.id, existingForSite[0].id))
      .returning();
    return toBinding(row);
  }

  const [row] = await db
    .insert(posBindings)
    .values({
      tenantId: input.tenantId,
      siteId: input.siteId,
      source: input.source,
      externalId,
    })
    .returning();
  return toBinding(row);
}

export async function deletePosBinding(tenantId: string, siteId: SiteId, source: CaptureSource): Promise<void> {
  await db
    .delete(posBindings)
    .where(and(eq(posBindings.tenantId, tenantId), eq(posBindings.siteId, siteId), eq(posBindings.source, source)));
}
