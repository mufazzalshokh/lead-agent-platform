CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"schema_version" varchar(6) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"lead_id" uuid,
	"conversation_id" uuid,
	"appointment_request_id" uuid,
	"channel_type" varchar(16),
	"locale" varchar(2),
	"campaign_key" varchar(128),
	"service_id" uuid,
	"location_id" uuid,
	"confirmation_source" varchar(32),
	"dimensions_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"numeric_value_minor" bigint,
	"currency" varchar(3),
	"projected_at" timestamp with time zone NOT NULL,
	CONSTRAINT "analytics_events_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "analytics_events_source_projection_unique" UNIQUE("organization_id","source_event_id","event_type","schema_version"),
	CONSTRAINT "analytics_events_id_uuid_v7_check" CHECK ("analytics_events"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "analytics_events_source_event_uuid_v7_check" CHECK ("analytics_events"."source_event_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "analytics_events_event_type_check" CHECK ("analytics_events"."event_type" in (
        'organization.created', 'organization.status_changed',
        'membership.activated', 'membership.scope_changed', 'membership.revoked',
        'location.changed', 'service.published', 'service.deactivated', 'service_price.published',
        'faq.published', 'business_policy.published',
        'channel_connection.activated', 'channel_connection.disabled', 'channel_connection.credential_rotated',
        'contact.created', 'contact.identity_added', 'contact.anonymized',
        'consent.granted', 'consent.declined', 'consent.withdrawn', 'consent.not_required_recorded',
        'lead.created', 'lead.engaged', 'lead.qualified', 'lead.disqualified',
        'lead.booking_requested', 'lead.converted', 'lead.closed', 'lead.reopened',
        'conversation.started', 'message.received', 'message.response_queued', 'message.sent',
        'conversation.status_changed', 'conversation.automation_mode_changed',
        'conversation.active_handoff_changed', 'conversation.resolved', 'conversation.closed',
        'appointment_request.created', 'appointment_request.staff_accepted',
        'appointment_request.customer_confirmation_requested', 'appointment_request.confirmed',
        'appointment_request.rejected', 'appointment_request.cancelled', 'appointment_request.expired',
        'appointment.attendance_recorded', 'appointment.attendance_corrected',
        'appointment.revenue_attributed', 'appointment.revenue_reversed',
        'handoff.requested', 'handoff.assigned', 'handoff.started', 'handoff.resolved',
        'handoff.cancelled', 'handoff.expired',
        'notification.created', 'notification.delivered', 'notification.failed', 'notification.dead_lettered',
        'ai_run.completed', 'ai_run.failed', 'ai_run.schema_rejected', 'ai_run.policy_denied')),
	CONSTRAINT "analytics_events_schema_version_check" CHECK (("analytics_events"."event_type" = 'lead.reopened' and "analytics_events"."schema_version" in ('1', '2'))
        or ("analytics_events"."event_type" <> 'lead.reopened' and "analytics_events"."schema_version" = '1')),
	CONSTRAINT "analytics_events_channel_locale_check" CHECK (("analytics_events"."channel_type" is null
          or "analytics_events"."channel_type" in ('widget', 'telegram', 'instagram', 'whatsapp'))
        and ("analytics_events"."locale" is null or "analytics_events"."locale" in ('uz', 'ru', 'en'))),
	CONSTRAINT "analytics_events_campaign_key_check" CHECK ("analytics_events"."campaign_key" is null
        or ("analytics_events"."campaign_key" = lower(btrim("analytics_events"."campaign_key"))
          and "analytics_events"."campaign_key" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$')),
	CONSTRAINT "analytics_events_confirmation_source_check" CHECK ("analytics_events"."confirmation_source" is null
        or "analytics_events"."confirmation_source" in ('customer_session', 'telegram', 'staff_attested_external')),
	CONSTRAINT "analytics_events_dimensions_check" CHECK (jsonb_typeof("analytics_events"."dimensions_jsonb") = 'object'
        and pg_column_size("analytics_events"."dimensions_jsonb") <= 16384),
	CONSTRAINT "analytics_events_money_shape_check" CHECK (("analytics_events"."numeric_value_minor" is null and "analytics_events"."currency" is null)
        or ("analytics_events"."numeric_value_minor" is not null
          and "analytics_events"."currency" is not null
          and "analytics_events"."currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "analytics_events_timestamps_check" CHECK ("analytics_events"."projected_at" >= "analytics_events"."occurred_at")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"actor_type" varchar(24) NOT NULL,
	"actor_id" uuid,
	"actor_membership_id" uuid,
	"impersonation_session_id" uuid,
	"support_grant_id" uuid,
	"target_type" varchar(64) NOT NULL,
	"target_id" uuid,
	"action" varchar(128) NOT NULL,
	"result" varchar(16) NOT NULL,
	"reason_code" varchar(100),
	"request_id" varchar(128) NOT NULL,
	"trace_id" varchar(128),
	"correlation_id" uuid NOT NULL,
	"source_ip_prefix" "cidr",
	"user_agent_hash" "bytea",
	"metadata_redacted_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "audit_events_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "audit_events_id_uuid_v7_check" CHECK ("audit_events"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "audit_events_event_action_target_check" CHECK ("audit_events"."event_type" = lower(btrim("audit_events"."event_type"))
        and "audit_events"."event_type" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
        and "audit_events"."action" = lower(btrim("audit_events"."action"))
        and "audit_events"."action" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
        and "audit_events"."target_type" = lower(btrim("audit_events"."target_type"))
        and "audit_events"."target_type" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
	CONSTRAINT "audit_events_actor_check" CHECK (("audit_events"."actor_type" = 'system'
          and "audit_events"."actor_id" is null
          and "audit_events"."actor_membership_id" is null)
        or ("audit_events"."actor_type" = 'member'
          and "audit_events"."actor_id" is not null
          and "audit_events"."actor_membership_id" is not null)
        or ("audit_events"."actor_type" in ('customer', 'platform_operator')
          and "audit_events"."actor_id" is not null
          and "audit_events"."actor_membership_id" is null)),
	CONSTRAINT "audit_events_reference_uuid_v7_check" CHECK (("audit_events"."actor_id" is null or "audit_events"."actor_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
        and ("audit_events"."target_id" is null or "audit_events"."target_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
        and ("audit_events"."impersonation_session_id" is null
          or "audit_events"."impersonation_session_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
        and ("audit_events"."support_grant_id" is null
          or "audit_events"."support_grant_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
        and "audit_events"."correlation_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "audit_events_result_check" CHECK ("audit_events"."result" in ('succeeded', 'denied', 'failed')),
	CONSTRAINT "audit_events_reason_code_check" CHECK ("audit_events"."reason_code" is null or "audit_events"."reason_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'),
	CONSTRAINT "audit_events_request_trace_check" CHECK ("audit_events"."request_id" ~ '^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,126}[A-Za-z0-9])$'
        and ("audit_events"."trace_id" is null or "audit_events"."trace_id" ~ '^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,126}[A-Za-z0-9])$')),
	CONSTRAINT "audit_events_source_ip_prefix_check" CHECK ("audit_events"."source_ip_prefix" is null
        or (family("audit_events"."source_ip_prefix") = 4 and masklen("audit_events"."source_ip_prefix") <= 24)
        or (family("audit_events"."source_ip_prefix") = 6 and masklen("audit_events"."source_ip_prefix") <= 64)),
	CONSTRAINT "audit_events_user_agent_hash_check" CHECK ("audit_events"."user_agent_hash" is null
        or octet_length("audit_events"."user_agent_hash") between 16 and 128),
	CONSTRAINT "audit_events_metadata_check" CHECK (jsonb_typeof("audit_events"."metadata_redacted_jsonb") = 'object'
        and pg_column_size("audit_events"."metadata_redacted_jsonb") <= 16384)
);
--> statement-breakpoint
CREATE TABLE "legal_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_type" varchar(32) NOT NULL,
	"scope_id" uuid,
	"data_class" varchar(128),
	"status" varchar(16) NOT NULL,
	"reason_ciphertext" "bytea" NOT NULL,
	"placed_by_user_id" uuid NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"released_by_user_id" uuid,
	"released_at" timestamp with time zone,
	"approval_reference" varchar(255) NOT NULL,
	CONSTRAINT "legal_holds_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "legal_holds_id_uuid_v7_check" CHECK ("legal_holds"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "legal_holds_scope_check" CHECK (("legal_holds"."scope_type" = 'organization'
          and "legal_holds"."scope_id" is null
          and "legal_holds"."data_class" is null)
        or ("legal_holds"."scope_type" in ('contact', 'conversation', 'appointment_request')
          and "legal_holds"."scope_id" is not null
          and "legal_holds"."scope_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          and "legal_holds"."data_class" is null)
        or ("legal_holds"."scope_type" = 'data_class'
          and "legal_holds"."scope_id" is null
          and "legal_holds"."data_class" is not null
          and "legal_holds"."data_class" = lower(btrim("legal_holds"."data_class"))
          and "legal_holds"."data_class" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$')),
	CONSTRAINT "legal_holds_status_check" CHECK ("legal_holds"."status" in ('active', 'released')),
	CONSTRAINT "legal_holds_reason_check" CHECK (octet_length("legal_holds"."reason_ciphertext") between 1 and 65536),
	CONSTRAINT "legal_holds_release_check" CHECK (("legal_holds"."status" = 'active'
          and "legal_holds"."released_by_user_id" is null
          and "legal_holds"."released_at" is null)
        or ("legal_holds"."status" = 'released'
          and "legal_holds"."released_by_user_id" is not null
          and "legal_holds"."released_at" is not null
          and "legal_holds"."released_at" >= "legal_holds"."placed_at")),
	CONSTRAINT "legal_holds_approval_reference_check" CHECK ("legal_holds"."approval_reference" = btrim("legal_holds"."approval_reference")
        and length("legal_holds"."approval_reference") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "platform_audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operator_principal_id" uuid NOT NULL,
	"action" varchar(128) NOT NULL,
	"target_organization_id" uuid,
	"target_type" varchar(64) NOT NULL,
	"target_id" uuid,
	"approval_reference" varchar(255) NOT NULL,
	"reason_code" varchar(100) NOT NULL,
	"result" varchar(16) NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"source_ip_hash" "bytea" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"metadata_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "platform_audit_events_id_uuid_v7_check" CHECK ("platform_audit_events"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "platform_audit_events_operator_target_uuid_v7_check" CHECK ("platform_audit_events"."operator_principal_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ("platform_audit_events"."target_id" is null or "platform_audit_events"."target_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')),
	CONSTRAINT "platform_audit_events_action_target_check" CHECK ("platform_audit_events"."action" = lower(btrim("platform_audit_events"."action"))
        and "platform_audit_events"."action" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
        and "platform_audit_events"."target_type" = lower(btrim("platform_audit_events"."target_type"))
        and "platform_audit_events"."target_type" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
	CONSTRAINT "platform_audit_events_reference_reason_check" CHECK ("platform_audit_events"."approval_reference" = btrim("platform_audit_events"."approval_reference")
        and length("platform_audit_events"."approval_reference") between 1 and 255
        and "platform_audit_events"."reason_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'),
	CONSTRAINT "platform_audit_events_result_check" CHECK ("platform_audit_events"."result" in ('succeeded', 'denied', 'failed')),
	CONSTRAINT "platform_audit_events_request_id_check" CHECK ("platform_audit_events"."request_id" ~ '^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,126}[A-Za-z0-9])$'),
	CONSTRAINT "platform_audit_events_source_ip_hash_check" CHECK (octet_length("platform_audit_events"."source_ip_hash") between 16 and 128),
	CONSTRAINT "platform_audit_events_metadata_check" CHECK (jsonb_typeof("platform_audit_events"."metadata_jsonb") = 'object'
        and pg_column_size("platform_audit_events"."metadata_jsonb") <= 16384)
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid,
	"request_type" varchar(16) NOT NULL,
	"status" varchar(24) NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"request_channel" varchar(64) NOT NULL,
	"handled_by_membership_id" uuid,
	"reason_code" varchar(100),
	"request_details_ciphertext" "bytea" NOT NULL,
	"export_artifact_ref" varchar(512),
	"artifact_expires_at" timestamp with time zone,
	"legal_hold_blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "privacy_requests_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "privacy_requests_id_uuid_v7_check" CHECK ("privacy_requests"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "privacy_requests_request_type_check" CHECK ("privacy_requests"."request_type" in ('access', 'export', 'correct', 'restrict', 'erase')),
	CONSTRAINT "privacy_requests_status_check" CHECK ("privacy_requests"."status" in ('received', 'identity_verification', 'in_progress', 'completed', 'rejected', 'cancelled')),
	CONSTRAINT "privacy_requests_timestamps_check" CHECK ("privacy_requests"."due_at" >= "privacy_requests"."requested_at"
        and ("privacy_requests"."verified_at" is null or "privacy_requests"."verified_at" >= "privacy_requests"."requested_at")
        and ("privacy_requests"."completed_at" is null or "privacy_requests"."completed_at" >= "privacy_requests"."requested_at")
        and ("privacy_requests"."status" = 'completed') = ("privacy_requests"."completed_at" is not null)
        and "privacy_requests"."updated_at" >= "privacy_requests"."created_at"),
	CONSTRAINT "privacy_requests_request_channel_check" CHECK ("privacy_requests"."request_channel" = lower(btrim("privacy_requests"."request_channel"))
        and "privacy_requests"."request_channel" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
	CONSTRAINT "privacy_requests_reason_code_check" CHECK ("privacy_requests"."reason_code" is null or "privacy_requests"."reason_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'),
	CONSTRAINT "privacy_requests_details_check" CHECK (octet_length("privacy_requests"."request_details_ciphertext") between 1 and 65536),
	CONSTRAINT "privacy_requests_artifact_check" CHECK (("privacy_requests"."export_artifact_ref" is null and "privacy_requests"."artifact_expires_at" is null)
        or ("privacy_requests"."export_artifact_ref" is not null
          and "privacy_requests"."export_artifact_ref" = btrim("privacy_requests"."export_artifact_ref")
          and length("privacy_requests"."export_artifact_ref") between 1 and 512
          and "privacy_requests"."artifact_expires_at" is not null
          and "privacy_requests"."artifact_expires_at" > "privacy_requests"."requested_at")),
	CONSTRAINT "privacy_requests_version_check" CHECK ("privacy_requests"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."leads"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversations"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_appointment_request_fk" FOREIGN KEY ("organization_id","appointment_request_id") REFERENCES "public"."appointment_requests"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_location_fk" FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_membership_fk" FOREIGN KEY ("organization_id","actor_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_placed_by_user_id_users_id_fk" FOREIGN KEY ("placed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_released_by_user_id_users_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_target_organization_fk" FOREIGN KEY ("target_organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_handler_membership_fk" FOREIGN KEY ("organization_id","handled_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "analytics_events_organization_occurred_event_idx" ON "analytics_events" USING btree ("organization_id","occurred_at","event_type");--> statement-breakpoint
CREATE INDEX "analytics_events_organization_lead_occurred_idx" ON "analytics_events" USING btree ("organization_id","lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_organization_appointment_occurred_idx" ON "analytics_events" USING btree ("organization_id","appointment_request_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_organization_occurred_idx" ON "audit_events" USING btree ("organization_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_organization_target_occurred_idx" ON "audit_events" USING btree ("organization_id","target_type","target_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_organization_actor_occurred_idx" ON "audit_events" USING btree ("organization_id","actor_type","actor_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "legal_holds_equivalent_active_unique" ON "legal_holds" USING btree ("organization_id","scope_type",coalesce("scope_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("data_class", '')) WHERE "legal_holds"."status" = 'active';--> statement-breakpoint
CREATE INDEX "legal_holds_organization_status_scope_idx" ON "legal_holds" USING btree ("organization_id","status","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "legal_holds_organization_data_class_status_idx" ON "legal_holds" USING btree ("organization_id","data_class","status");--> statement-breakpoint
CREATE INDEX "platform_audit_events_operator_occurred_idx" ON "platform_audit_events" USING btree ("operator_principal_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "platform_audit_events_target_organization_occurred_idx" ON "platform_audit_events" USING btree ("target_organization_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "privacy_requests_organization_status_due_idx" ON "privacy_requests" USING btree ("organization_id","status","due_at");--> statement-breakpoint
CREATE INDEX "privacy_requests_organization_contact_requested_idx" ON "privacy_requests" USING btree ("organization_id","contact_id","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reject_governance_fact_update"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23514',
    CONSTRAINT = TG_TABLE_NAME || '_immutability_check',
    MESSAGE = TG_TABLE_NAME || ' rows are immutable historical facts';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_events_immutability_trigger"
BEFORE UPDATE ON "audit_events"
FOR EACH ROW
EXECUTE FUNCTION "reject_governance_fact_update"();--> statement-breakpoint
CREATE TRIGGER "platform_audit_events_immutability_trigger"
BEFORE UPDATE ON "platform_audit_events"
FOR EACH ROW
EXECUTE FUNCTION "reject_governance_fact_update"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_privacy_request_provenance"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.request_type IS DISTINCT FROM OLD.request_type
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR NEW.request_channel IS DISTINCT FROM OLD.request_channel
    OR NEW.request_details_ciphertext IS DISTINCT FROM OLD.request_details_ciphertext
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (NEW.contact_id IS DISTINCT FROM OLD.contact_id
      AND NOT (OLD.contact_id IS NULL AND NEW.contact_id IS NOT NULL))
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'privacy_requests_provenance_immutability_check',
      MESSAGE = 'privacy request submission provenance is immutable';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "privacy_requests_provenance_immutability_trigger"
BEFORE UPDATE ON "privacy_requests"
FOR EACH ROW
EXECUTE FUNCTION "enforce_privacy_request_provenance"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_legal_hold_release"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.scope_type IS DISTINCT FROM OLD.scope_type
    OR NEW.scope_id IS DISTINCT FROM OLD.scope_id
    OR NEW.data_class IS DISTINCT FROM OLD.data_class
    OR NEW.reason_ciphertext IS DISTINCT FROM OLD.reason_ciphertext
    OR NEW.placed_by_user_id IS DISTINCT FROM OLD.placed_by_user_id
    OR NEW.placed_at IS DISTINCT FROM OLD.placed_at
    OR NEW.approval_reference IS DISTINCT FROM OLD.approval_reference
    OR (OLD.status = 'released' AND NEW IS DISTINCT FROM OLD)
    OR (OLD.status = 'active' AND NEW.status NOT IN ('active', 'released'))
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'legal_holds_release_immutability_check',
      MESSAGE = 'legal hold provenance is immutable and release is terminal';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "legal_holds_release_immutability_trigger"
BEFORE UPDATE ON "legal_holds"
FOR EACH ROW
EXECUTE FUNCTION "enforce_legal_hold_release"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_analytics_event_immutability"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.source_event_id IS DISTINCT FROM OLD.source_event_id
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
    OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
    OR NEW.channel_type IS DISTINCT FROM OLD.channel_type
    OR NEW.locale IS DISTINCT FROM OLD.locale
    OR NEW.service_id IS DISTINCT FROM OLD.service_id
    OR NEW.location_id IS DISTINCT FROM OLD.location_id
    OR NEW.confirmation_source IS DISTINCT FROM OLD.confirmation_source
    OR NEW.numeric_value_minor IS DISTINCT FROM OLD.numeric_value_minor
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.projected_at IS DISTINCT FROM OLD.projected_at
    OR (NEW.lead_id IS DISTINCT FROM OLD.lead_id
      AND NOT (OLD.lead_id IS NOT NULL AND NEW.lead_id IS NULL))
    OR (NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
      AND NOT (OLD.conversation_id IS NOT NULL AND NEW.conversation_id IS NULL))
    OR (NEW.appointment_request_id IS DISTINCT FROM OLD.appointment_request_id
      AND NOT (OLD.appointment_request_id IS NOT NULL AND NEW.appointment_request_id IS NULL))
    OR (NEW.campaign_key IS DISTINCT FROM OLD.campaign_key
      AND NOT (OLD.campaign_key IS NOT NULL AND NEW.campaign_key IS NULL))
    OR NOT (NEW.dimensions_jsonb <@ OLD.dimensions_jsonb)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'analytics_events_semantic_immutability_check',
      MESSAGE = 'analytics event facts are immutable except for privacy minimization';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "analytics_events_semantic_immutability_trigger"
BEFORE UPDATE ON "analytics_events"
FOR EACH ROW
EXECUTE FUNCTION "enforce_analytics_event_immutability"();
