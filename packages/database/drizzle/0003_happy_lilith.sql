CREATE TABLE "channel_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_type" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"provider_account_id_hash" "bytea",
	"credential_secret_ref" varchar(512),
	"webhook_secret_hash" "bytea",
	"configuration_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "channel_connections_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "channel_connections_organization_type_provider_unique" UNIQUE("organization_id","channel_type","provider_account_id_hash"),
	CONSTRAINT "channel_connections_id_uuid_v7_check" CHECK ("channel_connections"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "channel_connections_channel_type_check" CHECK ("channel_connections"."channel_type" in ('widget', 'telegram', 'instagram', 'whatsapp')),
	CONSTRAINT "channel_connections_status_check" CHECK ("channel_connections"."status" in ('pending', 'active', 'disabled', 'revoked')),
	CONSTRAINT "channel_connections_display_name_check" CHECK ("channel_connections"."display_name" = btrim("channel_connections"."display_name") and length("channel_connections"."display_name") between 1 and 200),
	CONSTRAINT "channel_connections_provider_account_hash_check" CHECK ("channel_connections"."provider_account_id_hash" is null or octet_length("channel_connections"."provider_account_id_hash") between 16 and 128),
	CONSTRAINT "channel_connections_credential_secret_ref_check" CHECK ("channel_connections"."credential_secret_ref" is null
        or ("channel_connections"."credential_secret_ref" = btrim("channel_connections"."credential_secret_ref")
          and length("channel_connections"."credential_secret_ref") between 6 and 512
          and "channel_connections"."credential_secret_ref" ~ '^[a-z][a-z0-9+.-]{1,31}://[^[:space:]]+$')),
	CONSTRAINT "channel_connections_webhook_secret_hash_check" CHECK ("channel_connections"."webhook_secret_hash" is null or octet_length("channel_connections"."webhook_secret_hash") between 16 and 128),
	CONSTRAINT "channel_connections_configuration_check" CHECK (jsonb_typeof("channel_connections"."configuration_jsonb") = 'object'
        and pg_column_size("channel_connections"."configuration_jsonb") <= 65536),
	CONSTRAINT "channel_connections_credential_version_check" CHECK ("channel_connections"."credential_version" > 0),
	CONSTRAINT "channel_connections_version_check" CHECK ("channel_connections"."version" > 0),
	CONSTRAINT "channel_connections_timestamps_check" CHECK ("channel_connections"."updated_at" >= "channel_connections"."created_at")
);
--> statement-breakpoint
CREATE TABLE "widget_allowed_origins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_connection_id" uuid NOT NULL,
	"match_type" varchar(24) NOT NULL,
	"scheme" varchar(8) NOT NULL,
	"normalized_host" varchar(253) NOT NULL,
	"port" integer,
	"status" varchar(16) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "widget_allowed_origins_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "widget_allowed_origins_connection_id_id_unique" UNIQUE("organization_id","channel_connection_id","id"),
	CONSTRAINT "widget_allowed_origins_id_uuid_v7_check" CHECK ("widget_allowed_origins"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "widget_allowed_origins_match_type_check" CHECK ("widget_allowed_origins"."match_type" in ('exact', 'subdomain_wildcard')),
	CONSTRAINT "widget_allowed_origins_scheme_check" CHECK ("widget_allowed_origins"."scheme" = 'https'),
	CONSTRAINT "widget_allowed_origins_host_check" CHECK ("widget_allowed_origins"."normalized_host" = lower(btrim("widget_allowed_origins"."normalized_host"))
        and length("widget_allowed_origins"."normalized_host") between 3 and 253
		and "widget_allowed_origins"."normalized_host" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:[.][a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'),
	CONSTRAINT "widget_allowed_origins_port_check" CHECK ("widget_allowed_origins"."port" is null or ("widget_allowed_origins"."port" between 1 and 65535 and "widget_allowed_origins"."port" <> 443)),
	CONSTRAINT "widget_allowed_origins_wildcard_port_check" CHECK ("widget_allowed_origins"."match_type" <> 'subdomain_wildcard' or "widget_allowed_origins"."port" is null),
	CONSTRAINT "widget_allowed_origins_status_check" CHECK ("widget_allowed_origins"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "widget_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_connection_id" uuid NOT NULL,
	"widget_allowed_origin_id" uuid NOT NULL,
	"session_token_jti_hash" "bytea" NOT NULL,
	"participant_lookup_hash" "bytea" NOT NULL,
	"status" varchar(16) NOT NULL,
	"requested_locale" varchar(2) NOT NULL,
	"contact_id" uuid,
	"conversation_id" uuid,
	"issued_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "widget_sessions_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "widget_sessions_organization_jti_hash_unique" UNIQUE("organization_id","session_token_jti_hash"),
	CONSTRAINT "widget_sessions_id_uuid_v7_check" CHECK ("widget_sessions"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "widget_sessions_contact_uuid_v7_check" CHECK ("widget_sessions"."contact_id" is null or "widget_sessions"."contact_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "widget_sessions_conversation_uuid_v7_check" CHECK ("widget_sessions"."conversation_id" is null or "widget_sessions"."conversation_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "widget_sessions_session_token_hash_check" CHECK (octet_length("widget_sessions"."session_token_jti_hash") between 16 and 128),
	CONSTRAINT "widget_sessions_participant_lookup_hash_check" CHECK (octet_length("widget_sessions"."participant_lookup_hash") between 16 and 128),
	CONSTRAINT "widget_sessions_status_check" CHECK ("widget_sessions"."status" in ('active', 'expired', 'revoked')),
	CONSTRAINT "widget_sessions_requested_locale_check" CHECK ("widget_sessions"."requested_locale" in ('uz', 'ru', 'en')),
	CONSTRAINT "widget_sessions_lifetime_check" CHECK ("widget_sessions"."expires_at" > "widget_sessions"."issued_at"
        and "widget_sessions"."last_seen_at" >= "widget_sessions"."issued_at"
        and "widget_sessions"."last_seen_at" < "widget_sessions"."expires_at"),
	CONSTRAINT "widget_sessions_revocation_check" CHECK (("widget_sessions"."status" = 'revoked'
          and "widget_sessions"."revoked_at" is not null
          and "widget_sessions"."revoked_at" >= "widget_sessions"."issued_at"
          and "widget_sessions"."revoked_at" < "widget_sessions"."expires_at")
        or ("widget_sessions"."status" <> 'revoked' and "widget_sessions"."revoked_at" is null)),
	CONSTRAINT "widget_sessions_revocation_reason_check" CHECK ("widget_sessions"."revocation_reason" is null
        or ("widget_sessions"."status" = 'revoked'
          and "widget_sessions"."revocation_reason" = btrim("widget_sessions"."revocation_reason")
          and length("widget_sessions"."revocation_reason") between 1 and 500)),
	CONSTRAINT "widget_sessions_version_check" CHECK ("widget_sessions"."version" > 0),
	CONSTRAINT "widget_sessions_timestamps_check" CHECK ("widget_sessions"."updated_at" >= "widget_sessions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "widget_allowed_origins" ADD CONSTRAINT "widget_allowed_origins_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "widget_allowed_origins" ADD CONSTRAINT "widget_allowed_origins_channel_connection_fk" FOREIGN KEY ("organization_id","channel_connection_id") REFERENCES "public"."channel_connections"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "widget_allowed_origins" ADD CONSTRAINT "widget_allowed_origins_creator_membership_fk" FOREIGN KEY ("organization_id","created_by_user_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "widget_sessions" ADD CONSTRAINT "widget_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "widget_sessions" ADD CONSTRAINT "widget_sessions_channel_connection_fk" FOREIGN KEY ("organization_id","channel_connection_id") REFERENCES "public"."channel_connections"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "widget_sessions" ADD CONSTRAINT "widget_sessions_allowed_origin_fk" FOREIGN KEY ("organization_id","channel_connection_id","widget_allowed_origin_id") REFERENCES "public"."widget_allowed_origins"("organization_id","channel_connection_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_connections_organization_display_name_unique" ON "channel_connections" USING btree ("organization_id",lower("display_name"));--> statement-breakpoint
CREATE INDEX "channel_connections_organization_type_status_idx" ON "channel_connections" USING btree ("organization_id","channel_type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "widget_allowed_origins_canonical_origin_unique" ON "widget_allowed_origins" USING btree ("organization_id","channel_connection_id","match_type","scheme","normalized_host",coalesce("port", 0));--> statement-breakpoint
CREATE INDEX "widget_allowed_origins_organization_status_idx" ON "widget_allowed_origins" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "widget_sessions_one_active_participant_unique" ON "widget_sessions" USING btree ("organization_id","channel_connection_id","participant_lookup_hash") WHERE "widget_sessions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "widget_sessions_organization_status_expiry_idx" ON "widget_sessions" USING btree ("organization_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "widget_sessions_organization_conversation_idx" ON "widget_sessions" USING btree ("organization_id","conversation_id");--> statement-breakpoint
CREATE INDEX "widget_sessions_organization_connection_idx" ON "widget_sessions" USING btree ("organization_id","channel_connection_id");--> statement-breakpoint
ALTER TABLE "inbound_routes" ADD CONSTRAINT "inbound_routes_channel_connection_fk" FOREIGN KEY ("organization_id","channel_connection_id") REFERENCES "public"."channel_connections"("organization_id","id") ON DELETE restrict ON UPDATE restrict;
