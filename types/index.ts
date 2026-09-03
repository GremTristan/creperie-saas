export type Role = "cook" | "director" | "waiter" | "superadmin";

// Business vocabulary only — never the internal enum value.
export const ROLE_LABELS: Record<Role, string> = {
  cook: "Cuisine",
  director: "Direction",
  waiter: "Service",
  superadmin: "Éditeur",
};

// Roles a director can create for their team.
export const STAFF_ROLES: Exclude<Role, "director" | "superadmin">[] = ["waiter", "cook"];

export type TenantStatus = "trial" | "active" | "past_due" | "canceled" | "suspended";
export type Plan = "essentiel" | "pro";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  brandColor: string | null;
  logoUrl: string | null;
  currency: string;
  status: TenantStatus;
  plan: Plan;
  trialEndsAt: string | null; // ISO
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  billingEmail: string | null;
  legalName: string | null;
  legalAddress: string | null;
  createdAt: string; // ISO
}

// Site ids are uuids now; the alias is kept so call sites read as intent.
export type SiteId = string;

export interface Site {
  id: SiteId;
  tenantId: string;
  name: string;
  slug: string;
  deviceCode: string;
  active: boolean;
}

export interface User {
  id: string;
  tenantId: string | null;
  name: string;
  role: Role;
  // Set for cooks/waiters; null for directors (all sites) and super-admins.
  siteId: SiteId | null;
  email: string | null;
  active: boolean;
}

// Server-only shape carrying credential hashes. Never returned to a Client
// Component — lib/user-store.ts strips them before returning a User.
export interface AuthUser extends User {
  passwordHash: string | null;
  pinHash: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
}

export interface Supplier {
  id: string;
  tenantId: string;
  name: string;
}

export type Category = "frais" | "sec" | "sucre" | "viande" | "boissons";

export const CATEGORY_LABELS: Record<Category, string> = {
  frais: "Produits frais",
  sec: "Produits secs",
  sucre: "Produits sucrés",
  viande: "Viande",
  boissons: "Boissons",
};

// Fixed display order (not alphabetical): mirrors a physical stockroom
// walk-through — chilled goods first (most perishable), then dry, sweet,
// meat, drinks.
export const CATEGORY_ORDER: Category[] = ["frais", "sec", "sucre", "viande", "boissons"];

export const CATEGORY_COLORS: Record<Category, { dot: string; border: string }> = {
  frais: { dot: "bg-category-frais", border: "border-category-frais" },
  sec: { dot: "bg-category-sec", border: "border-category-sec" },
  sucre: { dot: "bg-category-sucre", border: "border-category-sucre" },
  viande: { dot: "bg-category-viande", border: "border-category-viande" },
  boissons: { dot: "bg-category-boissons", border: "border-category-boissons" },
};

export type Zone = "cuisine" | "salle";

export const ZONE_LABELS: Record<Zone, string> = {
  cuisine: "Cuisine",
  salle: "Salle",
};

export interface InventoryItem {
  id: string;
  tenantId: string;
  siteId: SiteId;
  name: string;
  zone: Zone;
  unit: string;
  unitsPerPackage: number;
  packageContentLabel?: string;
  quantity: number;
  unitPrice: number;
  // Below this quantity the item is flagged as running out; null = no alert.
  lowStockThreshold: number | null;
  supplierId: string | null;
  visibleToManager: boolean;
  visibleToServer: boolean;
  category: Category;
}

// Cost-free projection handed to operational roles (cook, waiter): they
// count stock, they never see purchase prices or stock value.
export type StaffInventoryItem = Omit<InventoryItem, "unitPrice" | "supplierId">;

export interface InventoryItemWithValue extends InventoryItem {
  stockValue: number;
}

export interface SiteInventoryValue {
  siteId: SiteId;
  siteName: string;
  totalValue: number;
  itemCount: number;
}

export type MenuCategory = "salee" | "sucree" | "boisson" | "autre";

export const MENU_CATEGORY_LABELS: Record<MenuCategory, string> = {
  salee: "Salées",
  sucree: "Sucrées",
  boisson: "Boissons",
  autre: "Autres",
};

export const MENU_CATEGORY_ORDER: MenuCategory[] = ["salee", "sucree", "boisson", "autre"];

// Sellable product (crêpe, drink…) — distinct from InventoryItem (stock).
export interface MenuItem {
  id: string;
  tenantId: string;
  siteId: SiteId;
  name: string;
  price: number;
  category: MenuCategory;
  available: boolean;
  sortOrder: number;
}

export interface MenuItemIngredient {
  id: string;
  menuItemId: string;
  inventoryItemId: string;
  quantity: number;
}

export type OrderKind = "table" | "takeaway";
export type OrderStatus = "open" | "sent" | "ready" | "served" | "paid" | "cancelled";
export type OrderItemStatus = "pending" | "ready";
export type PaymentMethod = "cash" | "card" | "twint" | "other";

export type CaptureSource = "native" | "zelty" | "addition" | "lightspeed" | "square" | "ocr" | "backfill";
export type CaptureEventType =
  | "order.created"
  | "order.sent"
  | "order.ready"
  | "order.served"
  | "order.paid"
  | "order.cancelled"
  | "order.appended"
  | "stock.sale"
  | "stock.count"
  | "stock.waste"
  | "stock.adjust";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Espèces",
  card: "Carte",
  twint: "TWINT",
  other: "Autre",
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  open: "En cours de saisie",
  sent: "En cuisine",
  ready: "Prête",
  served: "Servie",
  paid: "Encaissée",
  cancelled: "Annulée",
};

export interface OrderItem {
  id: string;
  orderId: string;
  menuItemId: string | null;
  name: string;
  unitPrice: number;
  quantity: number;
  status: OrderItemStatus;
  note: string | null;
}

export interface Order {
  id: string;
  tenantId: string;
  siteId: SiteId;
  number: number;
  serviceDate: string; // "YYYY-MM-DD"
  kind: OrderKind;
  tableLabel: string | null;
  status: OrderStatus;
  note: string | null;
  total: number;
  paymentMethod: PaymentMethod | null;
  createdByUserId: string;
  createdAt: string; // ISO
  sentAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  paidAt: string | null;
  items: OrderItem[];
}

// One record per (siteId, date): the end-of-day till closure.
export interface DailySalesEntry {
  id: string;
  tenantId: string;
  siteId: SiteId;
  date: string; // "YYYY-MM-DD"
  cardRevenue: number;
  twintRevenue: number;
  // Total revenue, all payment methods combined. Cash is derived as
  // netRevenue - cardRevenue - twintRevenue at display time.
  netRevenue: number;
  // menuItemId -> quantity sold. May contain ids for deleted menu items.
  quantities: Record<string, number>;
  recordedByUserId: string;
  recordedAt: string; // ISO timestamp
}

export type ReminderKind = "daily-sales" | "monthly-inventory";

export interface ReminderCompletion {
  id: string;
  siteId: SiteId;
  kind: ReminderKind;
  period: string; // "YYYY-MM-DD" for daily-sales, "YYYY-MM" for monthly-inventory
  completedAt: string; // ISO timestamp
  completedByUserId: string;
}

export interface AuditLogEntry {
  id: string;
  tenantId: string | null;
  siteId: string | null;
  userId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}
