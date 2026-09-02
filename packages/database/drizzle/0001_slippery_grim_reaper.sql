CREATE TABLE "inbound_routes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"route_type" varchar(32) NOT NULL,
	"route_key_hash" "bytea" NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_connection_id" uuid NOT NULL,
	"status" varchar(16) NOT NULL,
	"rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_routes_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "inbound_routes_route_type_route_key_hash_unique" UNIQUE("route_type","route_key_hash"),
	CONSTRAINT "inbound_routes_id_uuid_v7_check" CHECK ("inbound_routes"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "inbound_routes_channel_connection_uuid_v7_check" CHECK ("inbound_routes"."channel_connection_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "inbound_routes_route_type_check" CHECK ("inbound_routes"."route_type" in ('widget_key', 'telegram_webhook')),
	CONSTRAINT "inbound_routes_route_key_hash_check" CHECK (octet_length("inbound_routes"."route_key_hash") > 0),
	CONSTRAINT "inbound_routes_status_check" CHECK ("inbound_routes"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"status" varchar(16) NOT NULL,
	"jurisdiction_profile" varchar(128) NOT NULL,
	"effective_from" timestamp with time zone,
	"published_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_policies_organization_id_version_no_unique" UNIQUE("organization_id","version_no"),
	CONSTRAINT "retention_policies_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "retention_policies_id_uuid_v7_check" CHECK ("retention_policies"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "retention_policies_version_no_check" CHECK ("retention_policies"."version_no" > 0),
	CONSTRAINT "retention_policies_status_check" CHECK ("retention_policies"."status" in ('draft', 'published', 'retired')),
	CONSTRAINT "retention_policies_jurisdiction_profile_check" CHECK ("retention_policies"."jurisdiction_profile" = lower(btrim("retention_policies"."jurisdiction_profile"))
        and "retention_policies"."jurisdiction_profile" ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
	CONSTRAINT "retention_policies_publication_check" CHECK ("retention_policies"."status" = 'draft'
        or ("retention_policies"."effective_from" is not null
          and "retention_policies"."published_by_user_id" is not null
          and "retention_policies"."approved_by_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "retention_policy_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"retention_policy_id" uuid NOT NULL,
	"data_class" varchar(128) NOT NULL,
	"purpose" varchar(128) NOT NULL,
	"trigger_event" varchar(128) NOT NULL,
	"duration_days" integer NOT NULL,
	"expiry_action" varchar(16) NOT NULL,
	"jurisdiction_reference" varchar(255) NOT NULL,
	"legal_basis_reference" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_policy_rules_organization_id_policy_rule_unique" UNIQUE("organization_id","retention_policy_id","data_class","purpose","trigger_event"),
	CONSTRAINT "retention_policy_rules_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "retention_policy_rules_id_uuid_v7_check" CHECK ("retention_policy_rules"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "retention_policy_rules_identifiers_check" CHECK ("retention_policy_rules"."data_class" = lower(btrim("retention_policy_rules"."data_class"))
        and "retention_policy_rules"."data_class" ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
        and "retention_policy_rules"."purpose" = lower(btrim("retention_policy_rules"."purpose"))
        and "retention_policy_rules"."purpose" ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
        and "retention_policy_rules"."trigger_event" = lower(btrim("retention_policy_rules"."trigger_event"))
        and "retention_policy_rules"."trigger_event" ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
	CONSTRAINT "retention_policy_rules_duration_days_check" CHECK ("retention_policy_rules"."duration_days" >= 0),
	CONSTRAINT "retention_policy_rules_expiry_action_check" CHECK ("retention_policy_rules"."expiry_action" in ('purge', 'anonymize', 'aggregate')),
	CONSTRAINT "retention_policy_rules_references_check" CHECK (length(btrim("retention_policy_rules"."jurisdiction_reference")) between 1 and 255
        and length(btrim("retention_policy_rules"."legal_basis_reference")) between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "inbound_routes" ADD CONSTRAINT "inbound_routes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_publisher_membership_fk" FOREIGN KEY ("organization_id","published_by_user_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_approver_membership_fk" FOREIGN KEY ("organization_id","approved_by_user_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "retention_policy_rules" ADD CONSTRAINT "retention_policy_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "retention_policy_rules" ADD CONSTRAINT "retention_policy_rules_retention_policy_fk" FOREIGN KEY ("organization_id","retention_policy_id") REFERENCES "public"."retention_policies"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_routes_one_active_per_connection_type_unique" ON "inbound_routes" USING btree ("organization_id","channel_connection_id","route_type") WHERE "inbound_routes"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "retention_policies_one_published_per_organization_unique" ON "retention_policies" USING btree ("organization_id") WHERE "retention_policies"."status" = 'published';--> statement-breakpoint
CREATE INDEX "retention_policies_organization_status_effective_from_idx" ON "retention_policies" USING btree ("organization_id","status","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "retention_policy_rules_organization_policy_idx" ON "retention_policy_rules" USING btree ("organization_id","retention_policy_id");--> statement-breakpoint
CREATE INDEX "retention_policy_rules_organization_class_trigger_idx" ON "retention_policy_rules" USING btree ("organization_id","data_class","trigger_event");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_current_retention_policy_fk" FOREIGN KEY ("id","current_retention_policy_id") REFERENCES "public"."retention_policies"("organization_id","id") ON DELETE restrict ON UPDATE restrict;