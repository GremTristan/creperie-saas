CREATE TYPE "public"."capture_source" AS ENUM('native', 'zelty', 'addition', 'lightspeed', 'square', 'ocr', 'backfill');--> statement-breakpoint
CREATE TYPE "public"."capture_event_type" AS ENUM('order.created', 'order.sent', 'order.ready', 'order.served', 'order.paid', 'order.cancelled', 'order.appended', 'stock.sale', 'stock.count', 'stock.waste', 'stock.adjust');--> statement-breakpoint
CREATE TABLE "capture_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"type" "capture_event_type" NOT NULL,
	"source" "capture_source" NOT NULL,
	"order_id" uuid,
	"inventory_item_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL
);--> statement-breakpoint
ALTER TABLE "capture_events" ADD CONSTRAINT "capture_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_events" ADD CONSTRAINT "capture_events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_events" ADD CONSTRAINT "capture_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_events" ADD CONSTRAINT "capture_events_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_events" ADD CONSTRAINT "capture_events_idempotency_key_unique" UNIQUE("idempotency_key");--> statement-breakpoint
CREATE INDEX "capture_events_tenant_occurred_idx" ON "capture_events" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "capture_events_site_occurred_idx" ON "capture_events" USING btree ("site_id","occurred_at");
