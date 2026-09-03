CREATE TABLE "pos_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"source" "capture_source" NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_bindings_source_external_unique" UNIQUE("source","external_id"),
	CONSTRAINT "pos_bindings_tenant_site_source_unique" UNIQUE("tenant_id","site_id","source")
);--> statement-breakpoint
ALTER TABLE "pos_bindings" ADD CONSTRAINT "pos_bindings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_bindings" ADD CONSTRAINT "pos_bindings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_bindings_tenant_idx" ON "pos_bindings" USING btree ("tenant_id");
