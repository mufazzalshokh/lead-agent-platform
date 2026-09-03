CREATE TABLE "handoff_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"handoff_id" uuid NOT NULL,
	"from_status" varchar(24),
	"to_status" varchar(24) NOT NULL,
	"aggregate_version" bigint NOT NULL,
	"actor_type" varchar(16) NOT NULL,
	"actor_contact_id" uuid,
	"actor_membership_id" uuid,
	"from_assignee_id" uuid,
	"to_assignee_id" uuid,
	"conversation_disposition" varchar(32),
	"reason_code" varchar(100),
	"correlation_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "handoff_transitions_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "handoff_transitions_handoff_version_unique" UNIQUE("organization_id","handoff_id","aggregate_version"),
	CONSTRAINT "handoff_transitions_id_uuid_v7_check" CHECK ("handoff_transitions"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "handoff_transitions_correlation_uuid_v7_check" CHECK ("handoff_transitions"."correlation_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "handoff_transitions_status_check" CHECK (("handoff_transitions"."from_status" is null
          or "handoff_transitions"."from_status" in ('requested', 'assigned', 'in_progress', 'resolved', 'cancelled', 'expired'))
        and "handoff_transitions"."to_status" in ('requested', 'assigned', 'in_progress', 'resolved', 'cancelled', 'expired')),
	CONSTRAINT "handoff_transitions_creation_shape_check" CHECK (("handoff_transitions"."from_status" is null) = ("handoff_transitions"."to_status" = 'requested' and "handoff_transitions"."aggregate_version" = 1)),
	CONSTRAINT "handoff_transitions_version_check" CHECK ("handoff_transitions"."aggregate_version" > 0),
	CONSTRAINT "handoff_transitions_actor_shape_check" CHECK (("handoff_transitions"."actor_type" = 'customer'
          and "handoff_transitions"."actor_contact_id" is not null
          and "handoff_transitions"."actor_membership_id" is null)
        or ("handoff_transitions"."actor_type" = 'member'
          and "handoff_transitions"."actor_contact_id" is null
          and "handoff_transitions"."actor_membership_id" is not null)
        or ("handoff_transitions"."actor_type" = 'system'
          and "handoff_transitions"."actor_contact_id" is null
          and "handoff_transitions"."actor_membership_id" is null)),
	CONSTRAINT "handoff_transitions_reassignment_check" CHECK ("handoff_transitions"."from_status" <> 'assigned'
        or "handoff_transitions"."to_status" <> 'assigned'
        or ("handoff_transitions"."from_assignee_id" is not null
          and "handoff_transitions"."to_assignee_id" is not null
          and "handoff_transitions"."from_assignee_id" <> "handoff_transitions"."to_assignee_id")),
	CONSTRAINT "handoff_transitions_disposition_check" CHECK (("handoff_transitions"."to_status" in ('resolved', 'cancelled', 'expired')
          and "handoff_transitions"."conversation_disposition" in ('resume_ai', 'resolve_conversation', 'successor_handoff')
          and "handoff_transitions"."reason_code" is not null)
        or ("handoff_transitions"."to_status" in ('requested', 'assigned', 'in_progress')
          and "handoff_transitions"."conversation_disposition" is null
          and "handoff_transitions"."reason_code" is null)),
	CONSTRAINT "handoff_transitions_reason_code_check" CHECK ("handoff_transitions"."reason_code" is null
        or "handoff_transitions"."reason_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"location_id" uuid,
	"status" varchar(24) NOT NULL,
	"trigger_reason" varchar(48) NOT NULL,
	"queue_key" varchar(100) NOT NULL,
	"assigned_membership_id" uuid,
	"requested_at" timestamp with time zone NOT NULL,
	"assigned_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"sla_due_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "handoffs_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "handoffs_organization_conversation_id_unique" UNIQUE("organization_id","conversation_id","id"),
	CONSTRAINT "handoffs_id_uuid_v7_check" CHECK ("handoffs"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "handoffs_status_check" CHECK ("handoffs"."status" in ('requested', 'assigned', 'in_progress', 'resolved', 'cancelled', 'expired')),
	CONSTRAINT "handoffs_trigger_reason_check" CHECK ("handoffs"."trigger_reason" in ('customer_requested', 'missing_authoritative_information', 'medical_or_safety', 'low_confidence', 'policy_blocked', 'ai_unavailable', 'delivery_problem', 'staff_created', 'other')),
	CONSTRAINT "handoffs_queue_key_check" CHECK ("handoffs"."queue_key" = lower(btrim("handoffs"."queue_key"))
        and "handoffs"."queue_key" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'),
	CONSTRAINT "handoffs_resolution_code_check" CHECK ("handoffs"."resolution_code" is null
        or "handoffs"."resolution_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'),
	CONSTRAINT "handoffs_lifecycle_shape_check" CHECK (("handoffs"."status" = 'requested'
          and "handoffs"."assigned_membership_id" is null
          and "handoffs"."assigned_at" is null
          and "handoffs"."started_at" is null
          and "handoffs"."resolved_at" is null
          and "handoffs"."resolution_code" is null)
        or ("handoffs"."status" = 'assigned'
          and "handoffs"."assigned_membership_id" is not null
          and "handoffs"."assigned_at" is not null
          and "handoffs"."started_at" is null
          and "handoffs"."resolved_at" is null
          and "handoffs"."resolution_code" is null)
        or ("handoffs"."status" = 'in_progress'
          and "handoffs"."assigned_membership_id" is not null
          and "handoffs"."assigned_at" is not null
          and "handoffs"."started_at" is not null
          and "handoffs"."resolved_at" is null
          and "handoffs"."resolution_code" is null)
        or ("handoffs"."status" = 'resolved'
          and "handoffs"."assigned_membership_id" is not null
          and "handoffs"."assigned_at" is not null
          and "handoffs"."started_at" is not null
          and "handoffs"."resolved_at" is not null
          and "handoffs"."resolution_code" is not null)
        or ("handoffs"."status" in ('cancelled', 'expired')
          and "handoffs"."resolved_at" is null
          and "handoffs"."resolution_code" is null
          and (("handoffs"."assigned_membership_id" is null
              and "handoffs"."assigned_at" is null
              and "handoffs"."started_at" is null)
            or ("handoffs"."assigned_membership_id" is not null
              and "handoffs"."assigned_at" is not null)))),
	CONSTRAINT "handoffs_lifecycle_timestamps_check" CHECK ("handoffs"."sla_due_at" > "handoffs"."requested_at"
        and ("handoffs"."assigned_at" is null or "handoffs"."assigned_at" >= "handoffs"."requested_at")
        and ("handoffs"."started_at" is null
          or ("handoffs"."assigned_at" is not null and "handoffs"."started_at" >= "handoffs"."assigned_at"))
        and ("handoffs"."resolved_at" is null
          or ("handoffs"."started_at" is not null and "handoffs"."resolved_at" >= "handoffs"."started_at"))),
	CONSTRAINT "handoffs_version_check" CHECK ("handoffs"."version" > 0),
	CONSTRAINT "handoffs_timestamps_check" CHECK ("handoffs"."updated_at" >= "handoffs"."created_at")
);
--> statement-breakpoint
CREATE TABLE "notification_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"adapter" varchar(16) NOT NULL,
	"attempt_no" integer NOT NULL,
	"provider_request_key" varchar(255) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"outcome" varchar(24) NOT NULL,
	"provider_status_code" integer,
	"error_category" varchar(100),
	"provider_message_id_hash" "bytea",
	"latency_ms" integer NOT NULL,
	CONSTRAINT "notification_attempts_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "notification_attempts_notification_adapter_attempt_unique" UNIQUE("organization_id","notification_id","adapter","attempt_no"),
	CONSTRAINT "notification_attempts_provider_request_key_unique" UNIQUE("organization_id","adapter","provider_request_key"),
	CONSTRAINT "notification_attempts_id_uuid_v7_check" CHECK ("notification_attempts"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "notification_attempts_adapter_check" CHECK ("notification_attempts"."adapter" in ('in_app', 'widget', 'telegram', 'email', 'sms', 'push')),
	CONSTRAINT "notification_attempts_attempt_no_check" CHECK ("notification_attempts"."attempt_no" > 0),
	CONSTRAINT "notification_attempts_provider_request_key_check" CHECK ("notification_attempts"."provider_request_key" = btrim("notification_attempts"."provider_request_key")
        and length("notification_attempts"."provider_request_key") between 8 and 255),
	CONSTRAINT "notification_attempts_outcome_check" CHECK ("notification_attempts"."outcome" in ('delivered', 'retryable_failure', 'permanent_failure')),
	CONSTRAINT "notification_attempts_error_shape_check" CHECK (("notification_attempts"."outcome" = 'delivered' and "notification_attempts"."error_category" is null)
        or ("notification_attempts"."outcome" in ('retryable_failure', 'permanent_failure')
          and "notification_attempts"."error_category" is not null)),
	CONSTRAINT "notification_attempts_error_category_check" CHECK ("notification_attempts"."error_category" is null
        or "notification_attempts"."error_category" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'),
	CONSTRAINT "notification_attempts_provider_status_code_check" CHECK ("notification_attempts"."provider_status_code" is null or "notification_attempts"."provider_status_code" between 100 and 599),
	CONSTRAINT "notification_attempts_provider_message_hash_check" CHECK ("notification_attempts"."provider_message_id_hash" is null
        or octet_length("notification_attempts"."provider_message_id_hash") between 16 and 128),
	CONSTRAINT "notification_attempts_timing_check" CHECK ("notification_attempts"."finished_at" >= "notification_attempts"."started_at" and "notification_attempts"."latency_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"notification_type" varchar(24) NOT NULL,
	"audience_type" varchar(16) NOT NULL,
	"recipient_membership_id" uuid,
	"recipient_contact_id" uuid,
	"queue_key" varchar(100),
	"related_resource_type" varchar(32) NOT NULL,
	"related_resource_id" uuid NOT NULL,
	"originating_outbox_event_id" uuid NOT NULL,
	"template_key" varchar(128) NOT NULL,
	"template_version" integer NOT NULL,
	"payload_ciphertext" "bytea",
	"status" varchar(24) NOT NULL,
	"dedupe_key" varchar(128) NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"claimed_by_membership_id" uuid,
	"last_error_category" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "notifications_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "notifications_organization_dedupe_key_unique" UNIQUE("organization_id","dedupe_key"),
	CONSTRAINT "notifications_id_uuid_v7_check" CHECK ("notifications"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "notifications_related_resource_uuid_v7_check" CHECK ("notifications"."related_resource_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "notifications_originating_outbox_uuid_v7_check" CHECK ("notifications"."originating_outbox_event_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."notification_type" in ('staff_task', 'customer_message', 'staff_alert')),
	CONSTRAINT "notifications_audience_shape_check" CHECK (("notifications"."audience_type" = 'membership'
          and "notifications"."recipient_membership_id" is not null
          and "notifications"."recipient_contact_id" is null
          and "notifications"."queue_key" is null)
        or ("notifications"."audience_type" = 'contact'
          and "notifications"."recipient_membership_id" is null
          and "notifications"."recipient_contact_id" is not null
          and "notifications"."queue_key" is null)
        or ("notifications"."audience_type" = 'queue'
          and "notifications"."recipient_membership_id" is null
          and "notifications"."recipient_contact_id" is null
          and "notifications"."queue_key" is not null)),
	CONSTRAINT "notifications_queue_key_check" CHECK ("notifications"."queue_key" is null
        or ("notifications"."queue_key" = lower(btrim("notifications"."queue_key"))
          and "notifications"."queue_key" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$')),
	CONSTRAINT "notifications_related_resource_type_check" CHECK ("notifications"."related_resource_type" in ('appointment_request', 'handoff', 'conversation', 'lead', 'channel_connection', 'ai_run')),
	CONSTRAINT "notifications_template_check" CHECK ("notifications"."template_key" = lower(btrim("notifications"."template_key"))
        and "notifications"."template_key" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
        and "notifications"."template_version" > 0),
	CONSTRAINT "notifications_payload_ciphertext_check" CHECK ("notifications"."payload_ciphertext" is null
        or octet_length("notifications"."payload_ciphertext") between 1 and 65536),
	CONSTRAINT "notifications_status_check" CHECK ("notifications"."status" in ('pending', 'processing', 'delivered', 'failed', 'dead_lettered', 'cancelled')),
	CONSTRAINT "notifications_dedupe_key_check" CHECK ("notifications"."dedupe_key" = btrim("notifications"."dedupe_key")
        and length("notifications"."dedupe_key") between 8 and 128),
	CONSTRAINT "notifications_attempt_count_check" CHECK ("notifications"."attempt_count" >= 0),
	CONSTRAINT "notifications_delivery_shape_check" CHECK (("notifications"."status" = 'delivered') = ("notifications"."delivered_at" is not null)),
	CONSTRAINT "notifications_retry_timestamps_check" CHECK ("notifications"."next_attempt_at" is null or "notifications"."next_attempt_at" >= "notifications"."available_at"),
	CONSTRAINT "notifications_last_error_category_check" CHECK ("notifications"."last_error_category" is null
        or "notifications"."last_error_category" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'),
	CONSTRAINT "notifications_version_check" CHECK ("notifications"."version" > 0),
	CONSTRAINT "notifications_timestamps_check" CHECK ("notifications"."updated_at" >= "notifications"."created_at")
);
--> statement-breakpoint
ALTER TABLE "handoff_transitions" ADD CONSTRAINT "handoff_transitions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "handoff_transitions" ADD CONSTRAINT "handoff_transitions_handoff_fk" FOREIGN KEY ("organization_id","handoff_id") REFERENCES "public"."handoffs"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "handoff_transitions" ADD CONSTRAINT "handoff_transitions_actor_contact_fk" FOREIGN KEY ("organization_id","actor_contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "handoff_transitions" ADD CONSTRAINT "handoff_transitions_actor_membership_fk" FOREIGN KEY ("organization_id","actor_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "handoff_transitions" ADD CONSTRAINT "handoff_transitions_from_assignee_fk" FOREIGN KEY ("organization_id","from_assignee_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "handoff_transitions" ADD CONSTRAINT "handoff_transitions_to_assignee_fk" FOREIGN KEY ("organization_id","to_assignee_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversations"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."leads"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_lead_id_unique" UNIQUE("organization_id","lead_id","id");--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_conversation_lead_fk" FOREIGN KEY ("organization_id","lead_id","conversation_id") REFERENCES "public"."conversations"("organization_id","lead_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_location_fk" FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_assigned_membership_fk" FOREIGN KEY ("organization_id","assigned_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_notification_fk" FOREIGN KEY ("organization_id","notification_id") REFERENCES "public"."notifications"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_membership_fk" FOREIGN KEY ("organization_id","recipient_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_contact_fk" FOREIGN KEY ("organization_id","recipient_contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_claimer_membership_fk" FOREIGN KEY ("organization_id","claimed_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "handoff_transitions_handoff_occurred_idx" ON "handoff_transitions" USING btree ("organization_id","handoff_id","occurred_at");--> statement-breakpoint
CREATE INDEX "handoff_transitions_assignee_occurred_idx" ON "handoff_transitions" USING btree ("organization_id","to_assignee_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "handoffs_one_active_per_conversation_unique" ON "handoffs" USING btree ("organization_id","conversation_id") WHERE "handoffs"."status" in ('requested', 'assigned', 'in_progress');--> statement-breakpoint
CREATE INDEX "handoffs_organization_status_sla_due_idx" ON "handoffs" USING btree ("organization_id","status","sla_due_at");--> statement-breakpoint
CREATE INDEX "handoffs_organization_queue_status_requested_idx" ON "handoffs" USING btree ("organization_id","queue_key","status","requested_at");--> statement-breakpoint
CREATE INDEX "handoffs_organization_assignee_status_idx" ON "handoffs" USING btree ("organization_id","assigned_membership_id","status");--> statement-breakpoint
CREATE INDEX "handoffs_organization_lead_requested_idx" ON "handoffs" USING btree ("organization_id","lead_id","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_attempts_notification_attempt_idx" ON "notification_attempts" USING btree ("organization_id","notification_id","attempt_no");--> statement-breakpoint
CREATE INDEX "notification_attempts_outcome_finished_idx" ON "notification_attempts" USING btree ("organization_id","outcome","finished_at");--> statement-breakpoint
CREATE INDEX "notification_attempts_provider_message_hash_idx" ON "notification_attempts" USING btree ("organization_id","adapter","provider_message_id_hash");--> statement-breakpoint
CREATE INDEX "notifications_organization_status_available_idx" ON "notifications" USING btree ("organization_id","status","available_at");--> statement-breakpoint
CREATE INDEX "notifications_organization_queue_status_created_idx" ON "notifications" USING btree ("organization_id","queue_key","status","created_at");--> statement-breakpoint
CREATE INDEX "notifications_organization_recipient_read_created_idx" ON "notifications" USING btree ("organization_id","recipient_membership_id","read_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_organization_resource_created_idx" ON "notifications" USING btree ("organization_id","related_resource_type","related_resource_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_active_handoff_fk" FOREIGN KEY ("organization_id","id","active_handoff_id") REFERENCES "public"."handoffs"("organization_id","conversation_id","id") ON DELETE restrict ON UPDATE restrict;
