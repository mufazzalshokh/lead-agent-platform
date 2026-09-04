CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" varchar(128) NOT NULL,
	"key_hash" "bytea" NOT NULL,
	"principal_type" varchar(24) NOT NULL,
	"principal_id_hash" "bytea" NOT NULL,
	"request_hash" "bytea" NOT NULL,
	"status" varchar(16) NOT NULL,
	"response_status" integer,
	"response_ciphertext" "bytea",
	"resource_type" varchar(64),
	"resource_id" uuid,
	"locked_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "idempotency_keys_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "idempotency_keys_tenant_principal_scope_key_unique" UNIQUE("organization_id","principal_type","principal_id_hash","scope","key_hash"),
	CONSTRAINT "idempotency_keys_id_uuid_v7_check" CHECK ("idempotency_keys"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "idempotency_keys_scope_check" CHECK ("idempotency_keys"."scope" = lower(btrim("idempotency_keys"."scope"))
        and length("idempotency_keys"."scope") between 1 and 128
        and "idempotency_keys"."scope" !~ '[[:space:]]'),
	CONSTRAINT "idempotency_keys_hashes_check" CHECK (octet_length("idempotency_keys"."key_hash") between 16 and 128
        and octet_length("idempotency_keys"."principal_id_hash") between 16 and 128
        and octet_length("idempotency_keys"."request_hash") between 16 and 128),
	CONSTRAINT "idempotency_keys_principal_type_check" CHECK ("idempotency_keys"."principal_type" in ('user', 'widget_session', 'channel_participant', 'system')),
	CONSTRAINT "idempotency_keys_status_check" CHECK ("idempotency_keys"."status" in ('in_progress', 'succeeded', 'failed')),
	CONSTRAINT "idempotency_keys_response_status_check" CHECK ("idempotency_keys"."response_status" is null or "idempotency_keys"."response_status" between 100 and 599),
	CONSTRAINT "idempotency_keys_response_ciphertext_check" CHECK ("idempotency_keys"."response_ciphertext" is null
        or octet_length("idempotency_keys"."response_ciphertext") between 1 and 65536),
	CONSTRAINT "idempotency_keys_resource_shape_check" CHECK (("idempotency_keys"."resource_type" is null and "idempotency_keys"."resource_id" is null)
        or ("idempotency_keys"."resource_type" is not null
          and "idempotency_keys"."resource_type" = lower(btrim("idempotency_keys"."resource_type"))
          and "idempotency_keys"."resource_type" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'
          and "idempotency_keys"."resource_id" is not null
          and "idempotency_keys"."resource_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')),
	CONSTRAINT "idempotency_keys_timestamps_check" CHECK ("idempotency_keys"."expires_at" >= "idempotency_keys"."created_at" + interval '24 hours'
        and ("idempotency_keys"."locked_until" is null or "idempotency_keys"."locked_until" >= "idempotency_keys"."created_at")
        and ("idempotency_keys"."completed_at" is null
          or ("idempotency_keys"."completed_at" >= "idempotency_keys"."created_at"
            and "idempotency_keys"."completed_at" < "idempotency_keys"."expires_at"))),
	CONSTRAINT "idempotency_keys_lifecycle_check" CHECK (("idempotency_keys"."status" = 'in_progress'
          and "idempotency_keys"."locked_until" is not null
          and "idempotency_keys"."completed_at" is null
          and "idempotency_keys"."response_status" is null
          and "idempotency_keys"."response_ciphertext" is null)
        or ("idempotency_keys"."status" in ('succeeded', 'failed')
          and "idempotency_keys"."locked_until" is null
          and "idempotency_keys"."completed_at" is not null
          and "idempotency_keys"."response_status" is not null))
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"schema_version" varchar(6) NOT NULL,
	"aggregate_type" varchar(32) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_version" bigint NOT NULL,
	"payload_jsonb" jsonb NOT NULL,
	"correlation_id" uuid NOT NULL,
	"causation_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"status" varchar(24) NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"locked_by" varchar(128),
	"locked_until" timestamp with time zone,
	"published_at" timestamp with time zone,
	"last_error_category" varchar(100),
	CONSTRAINT "outbox_events_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "outbox_events_aggregate_version_event_unique" UNIQUE("organization_id","aggregate_type","aggregate_id","aggregate_version","event_type"),
	CONSTRAINT "outbox_events_id_uuid_v7_check" CHECK ("outbox_events"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "outbox_events_aggregate_id_uuid_v7_check" CHECK ("outbox_events"."aggregate_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "outbox_events_correlation_uuid_v7_check" CHECK ("outbox_events"."correlation_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "outbox_events_causation_uuid_v7_check" CHECK ("outbox_events"."causation_id" is null
        or "outbox_events"."causation_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "outbox_events_event_aggregate_check" CHECK (("outbox_events"."aggregate_type" = 'organization'
          and "outbox_events"."event_type" in ('organization.created', 'organization.status_changed'))
        or ("outbox_events"."aggregate_type" = 'membership'
          and "outbox_events"."event_type" in ('membership.activated', 'membership.scope_changed', 'membership.revoked'))
        or ("outbox_events"."aggregate_type" = 'location'
          and "outbox_events"."event_type" = 'location.changed')
        or ("outbox_events"."aggregate_type" = 'service'
          and "outbox_events"."event_type" in ('service.published', 'service.deactivated', 'service_price.published'))
        or ("outbox_events"."aggregate_type" = 'faq'
          and "outbox_events"."event_type" = 'faq.published')
        or ("outbox_events"."aggregate_type" = 'business_policy'
          and "outbox_events"."event_type" = 'business_policy.published')
        or ("outbox_events"."aggregate_type" = 'channel_connection'
          and "outbox_events"."event_type" in ('channel_connection.activated', 'channel_connection.disabled', 'channel_connection.credential_rotated'))
        or ("outbox_events"."aggregate_type" = 'contact'
          and "outbox_events"."event_type" in ('contact.created', 'contact.identity_added', 'contact.anonymized', 'consent.granted', 'consent.declined', 'consent.withdrawn', 'consent.not_required_recorded'))
        or ("outbox_events"."aggregate_type" = 'lead'
          and "outbox_events"."event_type" in ('lead.created', 'lead.engaged', 'lead.qualified', 'lead.disqualified', 'lead.booking_requested', 'lead.converted', 'lead.closed', 'lead.reopened'))
        or ("outbox_events"."aggregate_type" = 'conversation'
          and "outbox_events"."event_type" in ('conversation.started', 'message.received', 'message.response_queued', 'message.sent', 'conversation.status_changed', 'conversation.automation_mode_changed', 'conversation.active_handoff_changed', 'conversation.resolved', 'conversation.closed'))
        or ("outbox_events"."aggregate_type" = 'appointment_request'
          and "outbox_events"."event_type" in ('appointment_request.created', 'appointment_request.staff_accepted', 'appointment_request.customer_confirmation_requested', 'appointment_request.confirmed', 'appointment_request.rejected', 'appointment_request.cancelled', 'appointment_request.expired', 'appointment.attendance_recorded', 'appointment.attendance_corrected', 'appointment.revenue_attributed', 'appointment.revenue_reversed'))
        or ("outbox_events"."aggregate_type" = 'handoff'
          and "outbox_events"."event_type" in ('handoff.requested', 'handoff.assigned', 'handoff.started', 'handoff.resolved', 'handoff.cancelled', 'handoff.expired'))
        or ("outbox_events"."aggregate_type" = 'notification'
          and "outbox_events"."event_type" in ('notification.created', 'notification.delivered', 'notification.failed', 'notification.dead_lettered'))
        or ("outbox_events"."aggregate_type" = 'ai_run'
          and "outbox_events"."event_type" in ('ai_run.completed', 'ai_run.failed', 'ai_run.schema_rejected', 'ai_run.policy_denied'))),
	CONSTRAINT "outbox_events_schema_version_check" CHECK (("outbox_events"."event_type" = 'lead.reopened' and "outbox_events"."schema_version" in ('1', '2'))
        or ("outbox_events"."event_type" <> 'lead.reopened' and "outbox_events"."schema_version" = '1')),
	CONSTRAINT "outbox_events_aggregate_version_check" CHECK ("outbox_events"."aggregate_version" > 0),
	CONSTRAINT "outbox_events_payload_check" CHECK (jsonb_typeof("outbox_events"."payload_jsonb") = 'object' and pg_column_size("outbox_events"."payload_jsonb") <= 65536),
	CONSTRAINT "outbox_events_status_check" CHECK ("outbox_events"."status" in ('pending', 'processing', 'published', 'dead_lettered')),
	CONSTRAINT "outbox_events_attempt_count_check" CHECK ("outbox_events"."attempt_count" >= 0),
	CONSTRAINT "outbox_events_locked_by_check" CHECK ("outbox_events"."locked_by" is null
        or ("outbox_events"."locked_by" = btrim("outbox_events"."locked_by")
          and "outbox_events"."locked_by" ~ '^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,126}[A-Za-z0-9])$')),
	CONSTRAINT "outbox_events_last_error_category_check" CHECK ("outbox_events"."last_error_category" is null
        or "outbox_events"."last_error_category" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'),
	CONSTRAINT "outbox_events_timestamps_check" CHECK ("outbox_events"."available_at" >= "outbox_events"."occurred_at"
        and ("outbox_events"."locked_until" is null or "outbox_events"."locked_until" >= "outbox_events"."available_at")
        and ("outbox_events"."published_at" is null or "outbox_events"."published_at" >= "outbox_events"."occurred_at")),
	CONSTRAINT "outbox_events_lifecycle_check" CHECK (("outbox_events"."status" = 'pending'
          and "outbox_events"."locked_by" is null
          and "outbox_events"."locked_until" is null
          and "outbox_events"."published_at" is null)
        or ("outbox_events"."status" = 'processing'
          and "outbox_events"."locked_by" is not null
          and "outbox_events"."locked_until" is not null
          and "outbox_events"."published_at" is null)
        or ("outbox_events"."status" = 'published'
          and "outbox_events"."locked_by" is null
          and "outbox_events"."locked_until" is null
          and "outbox_events"."published_at" is not null
          and "outbox_events"."last_error_category" is null)
        or ("outbox_events"."status" = 'dead_lettered'
          and "outbox_events"."locked_by" is null
          and "outbox_events"."locked_until" is null
          and "outbox_events"."published_at" is null
          and "outbox_events"."last_error_category" is not null))
);
--> statement-breakpoint
CREATE TABLE "webhook_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_connection_id" uuid NOT NULL,
	"provider" varchar(64) NOT NULL,
	"external_event_id" varchar(255) NOT NULL,
	"external_message_id" varchar(255),
	"payload_hash" "bytea" NOT NULL,
	"payload_ciphertext" "bytea",
	"signature_verified_at" timestamp with time zone NOT NULL,
	"provider_sent_at" timestamp with time zone,
	"provider_sequence" bigint,
	"status" varchar(32) NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"processed_message_id" uuid,
	"first_received_at" timestamp with time zone NOT NULL,
	"last_received_at" timestamp with time zone NOT NULL,
	"correlation_id" uuid NOT NULL,
	"last_error_category" varchar(100),
	CONSTRAINT "webhook_receipts_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "webhook_receipts_connection_external_event_unique" UNIQUE("organization_id","channel_connection_id","external_event_id"),
	CONSTRAINT "webhook_receipts_id_uuid_v7_check" CHECK ("webhook_receipts"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "webhook_receipts_correlation_uuid_v7_check" CHECK ("webhook_receipts"."correlation_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "webhook_receipts_provider_check" CHECK ("webhook_receipts"."provider" = lower(btrim("webhook_receipts"."provider"))
        and "webhook_receipts"."provider" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
	CONSTRAINT "webhook_receipts_external_ids_check" CHECK ("webhook_receipts"."external_event_id" = btrim("webhook_receipts"."external_event_id")
        and length("webhook_receipts"."external_event_id") between 1 and 255
        and ("webhook_receipts"."external_message_id" is null
          or ("webhook_receipts"."external_message_id" = btrim("webhook_receipts"."external_message_id")
            and length("webhook_receipts"."external_message_id") between 1 and 255))),
	CONSTRAINT "webhook_receipts_payload_hash_check" CHECK (octet_length("webhook_receipts"."payload_hash") between 16 and 128),
	CONSTRAINT "webhook_receipts_payload_ciphertext_check" CHECK ("webhook_receipts"."payload_ciphertext" is null
        or octet_length("webhook_receipts"."payload_ciphertext") between 1 and 65536),
	CONSTRAINT "webhook_receipts_provider_sequence_check" CHECK ("webhook_receipts"."provider_sequence" is null or "webhook_receipts"."provider_sequence" >= 0),
	CONSTRAINT "webhook_receipts_status_check" CHECK ("webhook_receipts"."status" in ('received', 'processing', 'processed', 'retryable_failure', 'permanent_failure')),
	CONSTRAINT "webhook_receipts_attempt_count_check" CHECK ("webhook_receipts"."attempt_count" >= 0),
	CONSTRAINT "webhook_receipts_timestamps_check" CHECK ("webhook_receipts"."last_received_at" >= "webhook_receipts"."first_received_at"
        and ("webhook_receipts"."next_attempt_at" is null or "webhook_receipts"."next_attempt_at" >= "webhook_receipts"."last_received_at")),
	CONSTRAINT "webhook_receipts_processing_shape_check" CHECK (("webhook_receipts"."status" = 'retryable_failure'
          and "webhook_receipts"."next_attempt_at" is not null
          and "webhook_receipts"."last_error_category" is not null)
        or ("webhook_receipts"."status" = 'permanent_failure'
          and "webhook_receipts"."next_attempt_at" is null
          and "webhook_receipts"."last_error_category" is not null)
        or ("webhook_receipts"."status" in ('received', 'processing', 'processed')
          and "webhook_receipts"."next_attempt_at" is null)),
	CONSTRAINT "webhook_receipts_processed_message_shape_check" CHECK ("webhook_receipts"."processed_message_id" is null or "webhook_receipts"."status" = 'processed'),
	CONSTRAINT "webhook_receipts_last_error_category_check" CHECK ("webhook_receipts"."last_error_category" is null
        or "webhook_receipts"."last_error_category" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "webhook_receipts" ADD CONSTRAINT "webhook_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "webhook_receipts" ADD CONSTRAINT "webhook_receipts_channel_connection_fk" FOREIGN KEY ("organization_id","channel_connection_id") REFERENCES "public"."channel_connections"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "webhook_receipts" ADD CONSTRAINT "webhook_receipts_processed_message_fk" FOREIGN KEY ("organization_id","processed_message_id") REFERENCES "public"."messages"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "idempotency_keys_organization_expires_idx" ON "idempotency_keys" USING btree ("organization_id","expires_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_organization_status_locked_idx" ON "idempotency_keys" USING btree ("organization_id","status","locked_until");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_available_idx" ON "outbox_events" USING btree ("status","available_at","id") WHERE "outbox_events"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_events_organization_occurred_idx" ON "outbox_events" USING btree ("organization_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outbox_events_locked_until_idx" ON "outbox_events" USING btree ("locked_until") WHERE "outbox_events"."locked_until" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_receipts_connection_external_message_unique" ON "webhook_receipts" USING btree ("organization_id","channel_connection_id","external_message_id") WHERE "webhook_receipts"."external_message_id" is not null;--> statement-breakpoint
CREATE INDEX "webhook_receipts_organization_status_next_attempt_idx" ON "webhook_receipts" USING btree ("organization_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_receipts_organization_connection_provider_sent_idx" ON "webhook_receipts" USING btree ("organization_id","channel_connection_id","provider_sent_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_originating_outbox_event_fk" FOREIGN KEY ("organization_id","originating_outbox_event_id") REFERENCES "public"."outbox_events"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_outbox_event_semantic_immutability"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
    OR NEW.aggregate_type IS DISTINCT FROM OLD.aggregate_type
    OR NEW.aggregate_id IS DISTINCT FROM OLD.aggregate_id
    OR NEW.aggregate_version IS DISTINCT FROM OLD.aggregate_version
    OR NEW.payload_jsonb IS DISTINCT FROM OLD.payload_jsonb
    OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
    OR NEW.causation_id IS DISTINCT FROM OLD.causation_id
    OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'outbox_events_semantic_immutability_check',
      MESSAGE = 'outbox event semantic fields are immutable';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "outbox_events_semantic_immutability_trigger"
BEFORE UPDATE ON "outbox_events"
FOR EACH ROW
EXECUTE FUNCTION "enforce_outbox_event_semantic_immutability"();
