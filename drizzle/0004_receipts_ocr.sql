CREATE TYPE "public"."image_media_type" AS ENUM('image/jpeg', 'image/png', 'image/webp');--> statement-breakpoint
CREATE TYPE "public"."receipt_status" AS ENUM('pending', 'proposed', 'validated', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."receipt_line_status" AS ENUM('proposed', 'accepted', 'ignored');--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"supplier_id" uuid,
	"submitted_by_user_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"image_media_type" "image_media_type",
	"image_data" text,
	"status" "receipt_status" DEFAULT 'pending' NOT NULL,
	"supplier_name_raw" text,
	"invoice_date" text,
	"invoice_ref" text,
	"currency" text DEFAULT 'CHF' NOT NULL,
	"ocr_raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ocr_error" text,
	"validated_by_user_id" uuid,
	"validated_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"raw_label" text NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"unit" text,
	"unit_price" numeric(12, 2),
	"line_total" numeric(12, 2),
	"proposed_inventory_item_id" uuid,
	"match_score" numeric(4, 3),
	"status" "receipt_line_status" DEFAULT 'proposed' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
CREATE TABLE "supplier_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"unit" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"receipt_id" uuid,
	"receipt_line_id" uuid
);--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_proposed_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("proposed_inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_receipt_line_id_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."receipt_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_tenant_submitted_idx" ON "receipts" USING btree ("tenant_id","submitted_at");--> statement-breakpoint
CREATE INDEX "receipts_site_status_idx" ON "receipts" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "receipt_lines_receipt_idx" ON "receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "receipt_lines_tenant_idx" ON "receipt_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "supplier_prices_item_observed_idx" ON "supplier_prices" USING btree ("inventory_item_id","observed_at");--> statement-breakpoint
CREATE INDEX "supplier_prices_tenant_idx" ON "supplier_prices" USING btree ("tenant_id");
