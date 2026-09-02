CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "locations_organization_id_code_unique" UNIQUE("organization_id","code"),
	CONSTRAINT "locations_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "locations_id_uuid_v7_check" CHECK ("locations"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "locations_code_normalized_check" CHECK ("locations"."code" = lower(btrim("locations"."code")) and "locations"."code" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "locations_status_check" CHECK ("locations"."status" in ('active', 'inactive')),
	CONSTRAINT "locations_current_version_uuid_v7_check" CHECK ("locations"."current_version_id" is null or "locations"."current_version_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "locations_version_check" CHECK ("locations"."version" > 0),
	CONSTRAINT "locations_timestamps_check" CHECK ("locations"."updated_at" >= "locations"."created_at")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"location_scope" varchar(16) NOT NULL,
	"invited_by_user_id" uuid,
	"invited_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "memberships_organization_id_user_id_unique" UNIQUE("organization_id","user_id"),
	CONSTRAINT "memberships_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "memberships_id_uuid_v7_check" CHECK ("memberships"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "memberships_role_check" CHECK ("memberships"."role" in ('owner', 'admin', 'staff', 'analyst')),
	CONSTRAINT "memberships_status_check" CHECK ("memberships"."status" in ('invited', 'active', 'suspended', 'revoked')),
	CONSTRAINT "memberships_location_scope_check" CHECK ("memberships"."location_scope" in ('all', 'restricted')),
	CONSTRAINT "memberships_lifecycle_timestamps_check" CHECK (("memberships"."status" <> 'invited' or "memberships"."invited_at" is not null)
        and ("memberships"."status" <> 'active' or "memberships"."activated_at" is not null)
        and ("memberships"."status" <> 'revoked' or "memberships"."revoked_at" is not null)),
	CONSTRAINT "memberships_version_check" CHECK ("memberships"."version" > 0),
	CONSTRAINT "memberships_timestamps_check" CHECK ("memberships"."updated_at" >= "memberships"."created_at")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(63) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"status" varchar(16) NOT NULL,
	"default_locale" varchar(2) NOT NULL,
	"default_time_zone" varchar(255) NOT NULL,
	"current_retention_policy_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_id_uuid_v7_check" CHECK ("organizations"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "organizations_slug_normalized_check" CHECK ("organizations"."slug" = lower(btrim("organizations"."slug")) and "organizations"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "organizations_display_name_check" CHECK (length(btrim("organizations"."display_name")) between 1 and 200),
	CONSTRAINT "organizations_status_check" CHECK ("organizations"."status" in ('active', 'suspended', 'closed')),
	CONSTRAINT "organizations_default_locale_check" CHECK ("organizations"."default_locale" in ('uz', 'ru', 'en')),
	CONSTRAINT "organizations_default_time_zone_check" CHECK ("organizations"."default_time_zone" = btrim("organizations"."default_time_zone")
        and length("organizations"."default_time_zone") between 1 and 255
        and ("organizations"."default_time_zone" = 'UTC' or "organizations"."default_time_zone" ~ '^[A-Za-z_+-]+(?:/[A-Za-z0-9_+-]+)+$')
        and timezone("organizations"."default_time_zone", timestamptz '2000-01-01 00:00:00+00') is not null),
	CONSTRAINT "organizations_retention_policy_uuid_v7_check" CHECK ("organizations"."current_retention_policy_id" is null or "organizations"."current_retention_policy_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "organizations_version_check" CHECK ("organizations"."version" > 0),
	CONSTRAINT "organizations_timestamps_check" CHECK ("organizations"."updated_at" >= "organizations"."created_at"),
	CONSTRAINT "organizations_closed_at_check" CHECK (("organizations"."status" = 'closed') = ("organizations"."closed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email_ciphertext" "bytea",
	"email_lookup_hash" "bytea",
	"display_name_ciphertext" "bytea",
	"status" varchar(16) NOT NULL,
	"last_authenticated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "users_id_uuid_v7_check" CHECK ("users"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "users_email_pair_check" CHECK (("users"."email_ciphertext" is null) = ("users"."email_lookup_hash" is null)),
	CONSTRAINT "users_status_check" CHECK ("users"."status" in ('active', 'suspended', 'deleted')),
	CONSTRAINT "users_deleted_pii_check" CHECK ("users"."status" <> 'deleted' or ("users"."email_ciphertext" is null and "users"."email_lookup_hash" is null and "users"."display_name_ciphertext" is null)),
	CONSTRAINT "users_version_check" CHECK ("users"."version" > 0),
	CONSTRAINT "users_timestamps_check" CHECK ("users"."updated_at" >= "users"."created_at")
);
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "locations_organization_status_code_idx" ON "locations" USING btree ("organization_id","status","code");--> statement-breakpoint
CREATE INDEX "memberships_organization_status_role_idx" ON "memberships" USING btree ("organization_id","status","role");--> statement-breakpoint
CREATE INDEX "memberships_user_status_idx" ON "memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "organizations_status_idx" ON "organizations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_status_last_authenticated_at_idx" ON "users" USING btree ("status","last_authenticated_at");