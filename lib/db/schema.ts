import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Mirrors the string-union types in types/index.ts — kept as Postgres native
// enums so an invalid value is rejected at the DB layer, not just in TS.
export const roleEnum = pgEnum("role", ["cook", "director", "waiter", "superadmin"]);
export const categoryEnum = pgEnum("category", ["frais", "sec", "sucre", "viande", "boissons"]);
export const zoneEnum = pgEnum("zone", ["cuisine", "salle"]);
export const reminderKindEnum = pgEnum("reminder_kind", ["daily-sales", "monthly-inventory"]);
export const tenantStatusEnum = pgEnum("tenant_status", ["trial", "active", "past_due", "canceled", "suspended"]);
export const planEnum = pgEnum("plan", ["essentiel", "pro"]);
export const orderKindEnum = pgEnum("order_kind", ["table", "takeaway"]);
export const orderStatusEnum = pgEnum("order_status", ["open", "sent", "ready", "served", "paid", "cancelled"]);
export const orderItemStatusEnum = pgEnum("order_item_status", ["pending", "ready"]);
export const paymentMethodEnum = pgEnum("payment_method", ["cash", "card", "twint", "other"]);
export const menuCategoryEnum = pgEnum("menu_category", ["salee", "sucree", "boisson", "autre"]);
export const stockMovementReasonEnum = pgEnum("stock_movement_reason", ["sale", "count", "adjust", "waste", "import"]);
export const captureSourceEnum = pgEnum("capture_source", [
  "native",
  "zelty",
  "addition",
  "lightspeed",
  "square",
  "ocr",
  "backfill",
]);
export const captureEventTypeEnum = pgEnum("capture_event_type", [
  "order.created",
  "order.sent",
  "order.ready",
  "order.served",
  "order.paid",
  "order.cancelled",
  "order.appended",
  "stock.sale",
  "stock.count",
  "stock.waste",
  "stock.adjust",
]);

// One row per customer chain (the SaaS "tenant"). Every business row below
// carries tenant_id so isolation is enforced by query, never by convention.
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  brandColor: text("brand_color"),
  logoUrl: text("logo_url"),
  currency: text("currency").notNull().default("CHF"),
  status: tenantStatusEnum("status").notNull().default("trial"),
  plan: planEnum("plan").notNull().default("essentiel"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  billingEmail: text("billing_email"),
  legalName: text("legal_name"),
  legalAddress: text("legal_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // Short code a staff tablet types once to bind itself to this site.
    deviceCode: text("device_code").notNull().unique(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sites_tenant_id_idx").on(table.tenantId),
    unique("sites_tenant_slug_unique").on(table.tenantId, table.slug),
  ]
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (table) => [index("suppliers_tenant_id_idx").on(table.tenantId)]
);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    zone: zoneEnum("zone").notNull(),
    unit: text("unit").notNull(),
    unitsPerPackage: integer("units_per_package").notNull().default(1),
    packageContentLabel: text("package_content_label"),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    // Below this quantity the item is flagged "à commander"; null = no alert.
    lowStockThreshold: numeric("low_stock_threshold", { precision: 12, scale: 3 }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    visibleToManager: boolean("visible_to_manager").notNull().default(true),
    visibleToServer: boolean("visible_to_server").notNull().default(false),
    category: categoryEnum("category").notNull(),
  },
  (table) => [
    index("inventory_items_site_id_idx").on(table.siteId),
    index("inventory_items_tenant_id_idx").on(table.tenantId),
  ]
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull().default("0"),
    category: menuCategoryEnum("category").notNull().default("autre"),
    available: boolean("available").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("menu_items_site_id_idx").on(table.siteId), index("menu_items_tenant_id_idx").on(table.tenantId)]
);

// Recipe line: selling one unit of the menu item consumes `quantity` stock
// units of the inventory item. Drives the automatic stock decrement when an
// order is sent to the kitchen.
export const menuItemIngredients = pgTable(
  "menu_item_ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    menuItemId: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
  },
  (table) => [
    index("menu_item_ingredients_menu_item_idx").on(table.menuItemId),
    unique("menu_item_ingredients_unique").on(table.menuItemId, table.inventoryItemId),
  ]
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    // Per-site, per-day ticket number shown to staff ("Commande n° 12").
    number: integer("number").notNull(),
    serviceDate: text("service_date").notNull(), // "YYYY-MM-DD"
    kind: orderKindEnum("kind").notNull(),
    tableLabel: text("table_label"),
    status: orderStatusEnum("status").notNull().default("open"),
    note: text("note"),
    total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
    paymentMethod: paymentMethodEnum("payment_method"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    servedAt: timestamp("served_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidByUserId: uuid("paid_by_user_id"),
    // Client-generated idempotency key so an offline retry never duplicates.
    clientId: text("client_id"),
  },
  (table) => [
    index("orders_site_status_idx").on(table.siteId, table.status),
    index("orders_site_date_idx").on(table.siteId, table.serviceDate),
    index("orders_tenant_id_idx").on(table.tenantId),
    unique("orders_client_id_unique").on(table.siteId, table.clientId),
  ]
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    menuItemId: uuid("menu_item_id").references(() => menuItems.id, { onDelete: "set null" }),
    // Snapshots: menu renames/price changes never rewrite history.
    name: text("name").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    status: orderItemStatusEnum("status").notNull().default("pending"),
    note: text("note"),
  },
  (table) => [index("order_items_order_id_idx").on(table.orderId)]
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    delta: numeric("delta", { precision: 12, scale: 4 }).notNull(),
    reason: stockMovementReasonEnum("reason").notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    userId: uuid("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("stock_movements_item_idx").on(table.inventoryItemId)]
);

// One row per (siteId, date) — the end-of-day till closure ("clôture de
// caisse"). Upserted, never duplicated.
export const dailySalesEntries = pgTable(
  "daily_sales_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // "YYYY-MM-DD"
    cardRevenue: numeric("card_revenue", { precision: 12, scale: 2 }).notNull(),
    twintRevenue: numeric("twint_revenue", { precision: 12, scale: 2 }).notNull().default("0"),
    netRevenue: numeric("net_revenue", { precision: 12, scale: 2 }).notNull(),
    // menuItemId -> quantity. May reference ids for since-deleted menu items;
    // callers skip unknown ids at render time (see types/index.ts).
    quantities: jsonb("quantities").$type<Record<string, number>>().notNull().default({}),
    recordedByUserId: uuid("recorded_by_user_id").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("daily_sales_site_date_unique").on(table.siteId, table.date),
    index("daily_sales_tenant_id_idx").on(table.tenantId),
  ]
);

export const reminderCompletions = pgTable(
  "reminder_completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    kind: reminderKindEnum("kind").notNull(),
    period: text("period").notNull(), // "YYYY-MM-DD" or "YYYY-MM"
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
    completedByUserId: uuid("completed_by_user_id").notNull(),
  },
  (table) => [unique("reminder_completions_site_kind_period_unique").on(table.siteId, table.kind, table.period)]
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null only for the SaaS editor's own super-admin accounts.
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: roleEnum("role").notNull(),
    // Set for cooks/waiters; directors and super-admins span sites.
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "cascade" }),
    // Directors / super-admins sign in with email + password.
    email: text("email").unique(),
    passwordHash: text("password_hash"),
    // Cooks / waiters sign in on a site-bound tablet with a short PIN.
    pinHash: text("pin_hash"),
    active: boolean("active").notNull().default(true),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("users_site_id_idx").on(table.siteId), index("users_tenant_id_idx").on(table.tenantId)]
);

// Append-only native/POS events. Writes go through lib/capture.ts and must
// never fail a till action (unique idempotency_key).
export const captureEvents = pgTable(
  "capture_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    type: captureEventTypeEnum("type").notNull(),
    source: captureSourceEnum("source").notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    inventoryItemId: uuid("inventory_item_id").references(() => inventoryItems.id, { onDelete: "set null" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (table) => [
    unique("capture_events_idempotency_key_unique").on(table.idempotencyKey),
    index("capture_events_tenant_occurred_idx").on(table.tenantId, table.occurredAt),
    index("capture_events_site_occurred_idx").on(table.siteId, table.occurredAt),
  ]
);

// Append-only trail of security-relevant actions (account changes, price
// changes, deletions, subscription events).
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id"),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_logs_tenant_created_idx").on(table.tenantId, table.createdAt)]
);
