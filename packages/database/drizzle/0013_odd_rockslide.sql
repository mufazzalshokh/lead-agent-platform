CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_token_hash" "bytea" NOT NULL,
	"csrf_secret_hash" "bytea" NOT NULL,
	"status" varchar(16) NOT NULL,
	"authentication_time" timestamp with time zone NOT NULL,
	"authentication_level" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_reason" varchar(500),
	"source_ip_hash" "bytea",
	"user_agent_hash" "bytea",
	CONSTRAINT "auth_sessions_session_token_hash_unique" UNIQUE("session_token_hash"),
	CONSTRAINT "auth_sessions_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "auth_sessions_id_uuid_v7_check" CHECK ("auth_sessions"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "auth_sessions_session_token_hash_check" CHECK (octet_length("auth_sessions"."session_token_hash") between 16 and 128),
	CONSTRAINT "auth_sessions_csrf_secret_hash_check" CHECK (octet_length("auth_sessions"."csrf_secret_hash") between 16 and 128),
	CONSTRAINT "auth_sessions_status_check" CHECK ("auth_sessions"."status" in ('active', 'revoked', 'expired')),
	CONSTRAINT "auth_sessions_authentication_level_check" CHECK ("auth_sessions"."authentication_level" = lower(btrim("auth_sessions"."authentication_level"))
        and "auth_sessions"."authentication_level" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
	CONSTRAINT "auth_sessions_lifetime_check" CHECK ("auth_sessions"."authentication_time" <= "auth_sessions"."created_at"
        and "auth_sessions"."last_seen_at" >= "auth_sessions"."created_at"
        and "auth_sessions"."idle_expires_at" > "auth_sessions"."last_seen_at"
        and "auth_sessions"."idle_expires_at" <= "auth_sessions"."absolute_expires_at"
        and "auth_sessions"."absolute_expires_at" > "auth_sessions"."created_at"),
	CONSTRAINT "auth_sessions_revocation_check" CHECK (("auth_sessions"."status" = 'revoked'
          and "auth_sessions"."revoked_at" is not null
          and "auth_sessions"."revocation_reason" is not null)
        or ("auth_sessions"."status" <> 'revoked'
          and "auth_sessions"."revoked_at" is null
          and "auth_sessions"."revocation_reason" is null)),
	CONSTRAINT "auth_sessions_revocation_timestamp_check" CHECK ("auth_sessions"."revoked_at" is null or "auth_sessions"."revoked_at" >= "auth_sessions"."created_at"),
	CONSTRAINT "auth_sessions_revocation_reason_check" CHECK ("auth_sessions"."revocation_reason" is null
        or ("auth_sessions"."revocation_reason" = btrim("auth_sessions"."revocation_reason")
          and length("auth_sessions"."revocation_reason") between 1 and 500)),
	CONSTRAINT "auth_sessions_source_ip_hash_check" CHECK ("auth_sessions"."source_ip_hash" is null or octet_length("auth_sessions"."source_ip_hash") between 16 and 128),
	CONSTRAINT "auth_sessions_user_agent_hash_check" CHECK ("auth_sessions"."user_agent_hash" is null or octet_length("auth_sessions"."user_agent_hash") between 16 and 128)
);
--> statement-breakpoint
CREATE TABLE "external_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"issuer" varchar(2048) NOT NULL,
	"subject" varchar(512) NOT NULL,
	"status" varchar(16) NOT NULL,
	"linked_at" timestamp with time zone NOT NULL,
	"last_authenticated_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"unlinked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "external_identities_issuer_subject_unique" UNIQUE("issuer","subject"),
	CONSTRAINT "external_identities_id_uuid_v7_check" CHECK ("external_identities"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "external_identities_issuer_check" CHECK ("external_identities"."issuer" = btrim("external_identities"."issuer") and length("external_identities"."issuer") between 1 and 2048),
	CONSTRAINT "external_identities_subject_check" CHECK (length("external_identities"."subject") between 1 and 512),
	CONSTRAINT "external_identities_status_check" CHECK ("external_identities"."status" in ('active', 'disabled', 'unlinked')),
	CONSTRAINT "external_identities_lifecycle_check" CHECK (("external_identities"."status" = 'active'
          and "external_identities"."disabled_at" is null
          and "external_identities"."unlinked_at" is null)
        or ("external_identities"."status" = 'disabled'
          and "external_identities"."disabled_at" is not null
          and "external_identities"."unlinked_at" is null)
        or ("external_identities"."status" = 'unlinked'
          and "external_identities"."unlinked_at" is not null)),
	CONSTRAINT "external_identities_lifecycle_timestamps_check" CHECK ("external_identities"."last_authenticated_at" is null or "external_identities"."last_authenticated_at" >= "external_identities"."linked_at"),
	CONSTRAINT "external_identities_terminal_timestamps_check" CHECK (("external_identities"."disabled_at" is null or "external_identities"."disabled_at" >= "external_identities"."linked_at")
        and ("external_identities"."unlinked_at" is null or "external_identities"."unlinked_at" >= "external_identities"."linked_at")),
	CONSTRAINT "external_identities_version_check" CHECK ("external_identities"."version" > 0),
	CONSTRAINT "external_identities_timestamps_check" CHECK ("external_identities"."linked_at" >= "external_identities"."created_at" and "external_identities"."updated_at" >= "external_identities"."created_at")
);
--> statement-breakpoint
CREATE TABLE "membership_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"target_ciphertext" "bytea" NOT NULL,
	"target_lookup_hash" "bytea" NOT NULL,
	"role" varchar(16) NOT NULL,
	"location_scope" varchar(16) NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"status" varchar(16) NOT NULL,
	"invited_by_membership_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_membership_id" uuid,
	"revocation_reason" varchar(500),
	"expired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "membership_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "membership_invitations_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "membership_invitations_id_uuid_v7_check" CHECK ("membership_invitations"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "membership_invitations_target_ciphertext_check" CHECK (octet_length("membership_invitations"."target_ciphertext") between 1 and 8192),
	CONSTRAINT "membership_invitations_target_lookup_hash_check" CHECK (octet_length("membership_invitations"."target_lookup_hash") between 16 and 128),
	CONSTRAINT "membership_invitations_token_hash_check" CHECK (octet_length("membership_invitations"."token_hash") between 16 and 128),
	CONSTRAINT "membership_invitations_role_check" CHECK ("membership_invitations"."role" in ('owner', 'admin', 'staff', 'analyst')),
	CONSTRAINT "membership_invitations_location_scope_check" CHECK ("membership_invitations"."location_scope" in ('all', 'restricted')
        and ("membership_invitations"."role" not in ('owner', 'admin') or "membership_invitations"."location_scope" = 'all')),
	CONSTRAINT "membership_invitations_status_check" CHECK ("membership_invitations"."status" in ('active', 'accepted', 'revoked', 'expired')),
	CONSTRAINT "membership_invitations_lifetime_check" CHECK ("membership_invitations"."expires_at" = "membership_invitations"."created_at" + interval '7 days'),
	CONSTRAINT "membership_invitations_lifecycle_check" CHECK (("membership_invitations"."status" = 'active'
          and "membership_invitations"."accepted_at" is null
          and "membership_invitations"."accepted_by_user_id" is null
          and "membership_invitations"."revoked_at" is null
          and "membership_invitations"."revoked_by_membership_id" is null
          and "membership_invitations"."revocation_reason" is null
          and "membership_invitations"."expired_at" is null)
        or ("membership_invitations"."status" = 'accepted'
          and "membership_invitations"."accepted_at" is not null
          and "membership_invitations"."accepted_by_user_id" is not null
          and "membership_invitations"."revoked_at" is null
          and "membership_invitations"."revoked_by_membership_id" is null
          and "membership_invitations"."revocation_reason" is null
          and "membership_invitations"."expired_at" is null)
        or ("membership_invitations"."status" = 'revoked'
          and "membership_invitations"."accepted_at" is null
          and "membership_invitations"."accepted_by_user_id" is null
          and "membership_invitations"."revoked_at" is not null
          and "membership_invitations"."revoked_by_membership_id" is not null
          and "membership_invitations"."revocation_reason" is not null
          and "membership_invitations"."expired_at" is null)
        or ("membership_invitations"."status" = 'expired'
          and "membership_invitations"."accepted_at" is null
          and "membership_invitations"."accepted_by_user_id" is null
          and "membership_invitations"."revoked_at" is null
          and "membership_invitations"."revoked_by_membership_id" is null
          and "membership_invitations"."revocation_reason" is null
          and "membership_invitations"."expired_at" is not null)),
	CONSTRAINT "membership_invitations_lifecycle_timestamps_check" CHECK (("membership_invitations"."accepted_at" is null
          or ("membership_invitations"."accepted_at" >= "membership_invitations"."created_at"
            and "membership_invitations"."accepted_at" < "membership_invitations"."expires_at"))
        and ("membership_invitations"."revoked_at" is null or "membership_invitations"."revoked_at" >= "membership_invitations"."created_at")
        and ("membership_invitations"."expired_at" is null or "membership_invitations"."expired_at" >= "membership_invitations"."expires_at")
        and "membership_invitations"."updated_at" >= "membership_invitations"."created_at"),
	CONSTRAINT "membership_invitations_revocation_reason_check" CHECK ("membership_invitations"."revocation_reason" is null
        or ("membership_invitations"."revocation_reason" = btrim("membership_invitations"."revocation_reason")
          and length("membership_invitations"."revocation_reason") between 1 and 500)),
	CONSTRAINT "membership_invitations_version_check" CHECK ("membership_invitations"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "membership_location_scopes" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	CONSTRAINT "membership_location_scopes_pk" PRIMARY KEY("organization_id","membership_id","location_id")
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "membership_invitations" ADD CONSTRAINT "membership_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "membership_invitations" ADD CONSTRAINT "membership_invitations_inviter_membership_fk" FOREIGN KEY ("organization_id","invited_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "membership_invitations" ADD CONSTRAINT "membership_invitations_accepted_by_user_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "membership_invitations" ADD CONSTRAINT "membership_invitations_revoker_membership_fk" FOREIGN KEY ("organization_id","revoked_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "membership_location_scopes" ADD CONSTRAINT "membership_location_scopes_membership_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "membership_location_scopes" ADD CONSTRAINT "membership_location_scopes_location_fk" FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "membership_location_scopes" ADD CONSTRAINT "membership_location_scopes_creator_membership_fk" FOREIGN KEY ("organization_id","created_by_user_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "auth_sessions_user_status_last_seen_at_idx" ON "auth_sessions" USING btree ("user_id","status","last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "auth_sessions_status_idle_expires_at_idx" ON "auth_sessions" USING btree ("status","idle_expires_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_status_absolute_expires_at_idx" ON "auth_sessions" USING btree ("status","absolute_expires_at");--> statement-breakpoint
CREATE INDEX "external_identities_user_status_idx" ON "external_identities" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_invitations_one_active_target_unique" ON "membership_invitations" USING btree ("organization_id","target_lookup_hash") WHERE "membership_invitations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "membership_invitations_organization_status_expires_at_idx" ON "membership_invitations" USING btree ("organization_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "membership_location_scopes_organization_location_membership_idx" ON "membership_location_scopes" USING btree ("organization_id","location_id","membership_id");--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_location_scope_check" CHECK ("memberships"."role" not in ('owner', 'admin') or "memberships"."location_scope" = 'all');
--> statement-breakpoint
ALTER TABLE public.membership_invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.membership_invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY membership_invitations_tenant_isolation ON public.membership_invitations
	TO lead_agent_runtime
	USING (organization_id = app.current_organization_id())
	WITH CHECK (organization_id = app.current_organization_id());
--> statement-breakpoint
ALTER TABLE public.membership_location_scopes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.membership_location_scopes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY membership_location_scopes_tenant_isolation ON public.membership_location_scopes
	TO lead_agent_runtime
	USING (organization_id = app.current_organization_id())
	WITH CHECK (organization_id = app.current_organization_id());
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE
	public.external_identities,
	public.membership_invitations,
	public.auth_sessions,
	public.membership_location_scopes
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress, lead_agent_inbound_route_definer;
