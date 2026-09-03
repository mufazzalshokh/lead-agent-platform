CREATE TABLE "appointment_confirmation_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"appointment_request_id" uuid NOT NULL,
	"offer_version" integer NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"source" varchar(32) NOT NULL,
	"customer_contact_id" uuid NOT NULL,
	"recorded_by_membership_id" uuid,
	"source_message_id" uuid,
	"external_reference_hash" "bytea",
	"customer_acted_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"attestation_method" varchar(16),
	"attestation_reason_code" varchar(100),
	"evidence_ciphertext" "bytea",
	"correlation_id" uuid NOT NULL,
	CONSTRAINT "appointment_confirmation_evidence_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "appointment_confirmation_evidence_id_uuid_v7_check" CHECK ("appointment_confirmation_evidence"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "appointment_confirmation_evidence_correlation_uuid_check" CHECK ("appointment_confirmation_evidence"."correlation_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "appointment_confirmation_evidence_offer_version_check" CHECK ("appointment_confirmation_evidence"."offer_version" > 0),
	CONSTRAINT "appointment_confirmation_evidence_outcome_check" CHECK ("appointment_confirmation_evidence"."outcome" in ('confirmed', 'declined')),
	CONSTRAINT "appointment_confirmation_evidence_source_check" CHECK ("appointment_confirmation_evidence"."source" in ('customer_session', 'telegram', 'staff_attested_external')),
	CONSTRAINT "appointment_confirmation_evidence_source_shape_check" CHECK (("appointment_confirmation_evidence"."source" = 'customer_session'
          and "appointment_confirmation_evidence"."recorded_by_membership_id" is null
          and "appointment_confirmation_evidence"."source_message_id" is null
          and "appointment_confirmation_evidence"."attestation_method" is null
          and "appointment_confirmation_evidence"."attestation_reason_code" is null)
        or ("appointment_confirmation_evidence"."source" = 'telegram'
          and "appointment_confirmation_evidence"."recorded_by_membership_id" is null
          and "appointment_confirmation_evidence"."source_message_id" is not null
          and "appointment_confirmation_evidence"."attestation_method" is null
          and "appointment_confirmation_evidence"."attestation_reason_code" is null)
        or ("appointment_confirmation_evidence"."source" = 'staff_attested_external'
          and "appointment_confirmation_evidence"."outcome" = 'confirmed'
          and "appointment_confirmation_evidence"."recorded_by_membership_id" is not null
          and "appointment_confirmation_evidence"."source_message_id" is null
          and "appointment_confirmation_evidence"."attestation_method" in ('phone', 'in_person')
          and "appointment_confirmation_evidence"."attestation_reason_code" is not null)),
	CONSTRAINT "appointment_confirmation_evidence_reason_code_check" CHECK ("appointment_confirmation_evidence"."attestation_reason_code" is null
        or "appointment_confirmation_evidence"."attestation_reason_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'),
	CONSTRAINT "appointment_confirmation_evidence_external_hash_check" CHECK ("appointment_confirmation_evidence"."external_reference_hash" is null
        or octet_length("appointment_confirmation_evidence"."external_reference_hash") between 16 and 128),
	CONSTRAINT "appointment_confirmation_evidence_ciphertext_check" CHECK ("appointment_confirmation_evidence"."evidence_ciphertext" is null
        or octet_length("appointment_confirmation_evidence"."evidence_ciphertext") between 1 and 65536),
	CONSTRAINT "appointment_confirmation_evidence_timestamps_check" CHECK ("appointment_confirmation_evidence"."recorded_at" >= "appointment_confirmation_evidence"."customer_acted_at")
);
--> statement-breakpoint
CREATE TABLE "appointment_request_attendance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"appointment_request_id" uuid NOT NULL,
	"outcome" varchar(24) NOT NULL,
	"occurred_at" timestamp with time zone,
	"recorded_by_membership_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"source" varchar(24) NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"supersedes_id" uuid,
	"reason_code" varchar(100),
	CONSTRAINT "appointment_request_attendance_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "appointment_request_attendance_request_id_unique" UNIQUE("organization_id","appointment_request_id","id"),
	CONSTRAINT "appointment_request_attendance_id_uuid_v7_check" CHECK ("appointment_request_attendance"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "appointment_request_attendance_outcome_check" CHECK ("appointment_request_attendance"."outcome" in ('attended', 'did_not_attend', 'unknown')),
	CONSTRAINT "appointment_request_attendance_source_check" CHECK ("appointment_request_attendance"."source" in ('staff_manual', 'approved_import')),
	CONSTRAINT "appointment_request_attendance_supersedes_check" CHECK ("appointment_request_attendance"."supersedes_id" is null or "appointment_request_attendance"."supersedes_id" <> "appointment_request_attendance"."id"),
	CONSTRAINT "appointment_request_attendance_reason_code_check" CHECK ("appointment_request_attendance"."reason_code" is null
        or "appointment_request_attendance"."reason_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "appointment_request_preferences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"appointment_request_id" uuid NOT NULL,
	"preference_order" smallint NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"time_zone" varchar(255) NOT NULL,
	"original_local_text_ciphertext" "bytea",
	"local_start" timestamp,
	"local_end" timestamp,
	"precision" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_request_preferences_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "appointment_request_preferences_request_order_unique" UNIQUE("organization_id","appointment_request_id","preference_order"),
	CONSTRAINT "appointment_request_preferences_id_uuid_v7_check" CHECK ("appointment_request_preferences"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "appointment_request_preferences_order_check" CHECK ("appointment_request_preferences"."preference_order" > 0),
	CONSTRAINT "appointment_request_preferences_time_zone_check" CHECK ("appointment_request_preferences"."time_zone" = btrim("appointment_request_preferences"."time_zone")
        and length("appointment_request_preferences"."time_zone") between 1 and 255
        and ("appointment_request_preferences"."time_zone" = 'UTC'
          or "appointment_request_preferences"."time_zone" ~ '^[A-Za-z_+-]+(?:/[A-Za-z0-9_+-]+)+$')
        and timezone("appointment_request_preferences"."time_zone", timestamptz '2000-01-01 00:00:00+00') is not null),
	CONSTRAINT "appointment_request_preferences_precision_check" CHECK ("appointment_request_preferences"."precision" in ('exact', 'part_of_day', 'date_only', 'free_text')),
	CONSTRAINT "appointment_request_preferences_ciphertext_check" CHECK ("appointment_request_preferences"."original_local_text_ciphertext" is null
        or octet_length("appointment_request_preferences"."original_local_text_ciphertext") between 1 and 8192),
	CONSTRAINT "appointment_request_preferences_shape_check" CHECK (("appointment_request_preferences"."precision" in ('exact', 'part_of_day', 'date_only')
          and "appointment_request_preferences"."start_at" is not null
          and "appointment_request_preferences"."end_at" is not null
          and "appointment_request_preferences"."start_at" < "appointment_request_preferences"."end_at"
          and "appointment_request_preferences"."local_start" is not null
          and "appointment_request_preferences"."local_end" is not null
          and "appointment_request_preferences"."local_start" < "appointment_request_preferences"."local_end")
        or ("appointment_request_preferences"."precision" = 'free_text'
          and "appointment_request_preferences"."original_local_text_ciphertext" is not null
          and "appointment_request_preferences"."start_at" is null
          and "appointment_request_preferences"."end_at" is null
          and "appointment_request_preferences"."local_start" is null
          and "appointment_request_preferences"."local_end" is null))
);
--> statement-breakpoint
CREATE TABLE "appointment_request_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"appointment_request_id" uuid NOT NULL,
	"from_status" varchar(40),
	"to_status" varchar(40) NOT NULL,
	"aggregate_version" bigint NOT NULL,
	"command" varchar(48) NOT NULL,
	"offer_version" integer,
	"actor_type" varchar(16) NOT NULL,
	"actor_contact_id" uuid,
	"actor_membership_id" uuid,
	"reason_code" varchar(100),
	"source_message_id" uuid,
	"correlation_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"metadata_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "appointment_request_transitions_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "appointment_request_transitions_request_version_unique" UNIQUE("organization_id","appointment_request_id","aggregate_version"),
	CONSTRAINT "appointment_request_transitions_id_uuid_v7_check" CHECK ("appointment_request_transitions"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "appointment_request_transitions_correlation_uuid_v7_check" CHECK ("appointment_request_transitions"."correlation_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "appointment_request_transitions_from_status_check" CHECK ("appointment_request_transitions"."from_status" is null
        or "appointment_request_transitions"."from_status" in ('requested', 'staff_accepted', 'awaiting_customer_confirmation', 'confirmed', 'rejected', 'cancelled', 'expired')),
	CONSTRAINT "appointment_request_transitions_to_status_check" CHECK ("appointment_request_transitions"."to_status" in ('requested', 'staff_accepted', 'awaiting_customer_confirmation', 'confirmed', 'rejected', 'cancelled', 'expired')),
	CONSTRAINT "appointment_request_transitions_status_change_check" CHECK ("appointment_request_transitions"."from_status" is null or "appointment_request_transitions"."from_status" <> "appointment_request_transitions"."to_status"),
	CONSTRAINT "appointment_request_transitions_command_check" CHECK ("appointment_request_transitions"."command" in ('create_appointment_request', 'staff_accept_appointment_request', 'reject_appointment_request', 'prepare_customer_confirmation', 'confirm_appointment_request', 'cancel_appointment_request', 'expire_appointment_request')),
	CONSTRAINT "appointment_request_transitions_version_check" CHECK ("appointment_request_transitions"."aggregate_version" > 0
        and ("appointment_request_transitions"."offer_version" is null or "appointment_request_transitions"."offer_version" > 0)),
	CONSTRAINT "appointment_request_transitions_actor_type_check" CHECK ("appointment_request_transitions"."actor_type" in ('customer', 'member', 'system')),
	CONSTRAINT "appointment_request_transitions_actor_shape_check" CHECK (("appointment_request_transitions"."actor_type" = 'customer'
          and "appointment_request_transitions"."actor_contact_id" is not null
          and "appointment_request_transitions"."actor_membership_id" is null)
        or ("appointment_request_transitions"."actor_type" = 'member'
          and "appointment_request_transitions"."actor_contact_id" is null
          and "appointment_request_transitions"."actor_membership_id" is not null)
        or ("appointment_request_transitions"."actor_type" = 'system'
          and "appointment_request_transitions"."actor_contact_id" is null
          and "appointment_request_transitions"."actor_membership_id" is null)),
	CONSTRAINT "appointment_request_transitions_reason_code_check" CHECK ("appointment_request_transitions"."reason_code" is null
        or "appointment_request_transitions"."reason_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'),
	CONSTRAINT "appointment_request_transitions_metadata_check" CHECK (jsonb_typeof("appointment_request_transitions"."metadata_jsonb") = 'object'
        and pg_column_size("appointment_request_transitions"."metadata_jsonb") <= 16384)
);
--> statement-breakpoint
CREATE TABLE "appointment_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"source_message_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"service_version_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"location_version_id" uuid NOT NULL,
	"business_policy_id" uuid NOT NULL,
	"status" varchar(40) NOT NULL,
	"request_dedupe_key" varchar(128) NOT NULL,
	"customer_notes_ciphertext" "bytea",
	"staff_decided_by_membership_id" uuid,
	"staff_decided_at" timestamp with time zone,
	"staff_decision_reason_code" varchar(100),
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"offered_time_zone" varchar(255),
	"offered_local_start" timestamp,
	"offer_version" integer DEFAULT 0 NOT NULL,
	"confirmation_issued_at" timestamp with time zone,
	"offer_expires_at" timestamp with time zone,
	"confirmation_token_hash" "bytea",
	"confirmation_token_consumed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirmation_source" varchar(32),
	"rejection_reason_code" varchar(100),
	"cancellation_reason_code" varchar(100),
	"cancelled_by_type" varchar(16),
	"expired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "appointment_requests_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "appointment_requests_organization_contact_id_unique" UNIQUE("organization_id","contact_id","id"),
	CONSTRAINT "appointment_requests_organization_dedupe_unique" UNIQUE("organization_id","request_dedupe_key"),
	CONSTRAINT "appointment_requests_id_uuid_v7_check" CHECK ("appointment_requests"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "appointment_requests_status_check" CHECK ("appointment_requests"."status" in ('requested', 'staff_accepted', 'awaiting_customer_confirmation', 'confirmed', 'rejected', 'cancelled', 'expired')),
	CONSTRAINT "appointment_requests_dedupe_key_check" CHECK ("appointment_requests"."request_dedupe_key" = btrim("appointment_requests"."request_dedupe_key")
        and length("appointment_requests"."request_dedupe_key") between 8 and 128),
	CONSTRAINT "appointment_requests_notes_ciphertext_check" CHECK ("appointment_requests"."customer_notes_ciphertext" is null
        or octet_length("appointment_requests"."customer_notes_ciphertext") between 1 and 65536),
	CONSTRAINT "appointment_requests_staff_decision_check" CHECK (("appointment_requests"."staff_decided_by_membership_id" is null) = ("appointment_requests"."staff_decided_at" is null)),
	CONSTRAINT "appointment_requests_reason_codes_check" CHECK (("appointment_requests"."staff_decision_reason_code" is null
          or "appointment_requests"."staff_decision_reason_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$')
        and ("appointment_requests"."rejection_reason_code" is null
          or "appointment_requests"."rejection_reason_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$')
        and ("appointment_requests"."cancellation_reason_code" is null
          or "appointment_requests"."cancellation_reason_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$')),
	CONSTRAINT "appointment_requests_offer_shape_check" CHECK (("appointment_requests"."start_at" is null
          and "appointment_requests"."end_at" is null
          and "appointment_requests"."offered_time_zone" is null
          and "appointment_requests"."offered_local_start" is null
          and "appointment_requests"."offer_version" = 0)
        or ("appointment_requests"."start_at" is not null
          and "appointment_requests"."end_at" is not null
          and "appointment_requests"."start_at" < "appointment_requests"."end_at"
          and "appointment_requests"."offered_time_zone" is not null
          and "appointment_requests"."offered_local_start" is not null
          and "appointment_requests"."offer_version" > 0)),
	CONSTRAINT "appointment_requests_offered_time_zone_check" CHECK ("appointment_requests"."offered_time_zone" is null
        or ("appointment_requests"."offered_time_zone" = btrim("appointment_requests"."offered_time_zone")
          and length("appointment_requests"."offered_time_zone") between 1 and 255
          and ("appointment_requests"."offered_time_zone" = 'UTC'
            or "appointment_requests"."offered_time_zone" ~ '^[A-Za-z_+-]+(?:/[A-Za-z0-9_+-]+)+$')
          and timezone("appointment_requests"."offered_time_zone", timestamptz '2000-01-01 00:00:00+00') is not null)),
	CONSTRAINT "appointment_requests_confirmation_interval_check" CHECK (("appointment_requests"."confirmation_issued_at" is null and "appointment_requests"."offer_expires_at" is null)
        or ("appointment_requests"."confirmation_issued_at" is not null
          and "appointment_requests"."offer_expires_at" is not null
          and "appointment_requests"."confirmation_issued_at" < "appointment_requests"."offer_expires_at"
          and "appointment_requests"."offer_version" > 0)),
	CONSTRAINT "appointment_requests_confirmation_token_check" CHECK (("appointment_requests"."confirmation_token_hash" is null
          or octet_length("appointment_requests"."confirmation_token_hash") between 16 and 128)
        and ("appointment_requests"."confirmation_token_consumed_at" is null
          or ("appointment_requests"."confirmation_token_hash" is not null
            and "appointment_requests"."confirmation_issued_at" is not null
            and "appointment_requests"."offer_expires_at" is not null
            and "appointment_requests"."confirmation_token_consumed_at" >= "appointment_requests"."confirmation_issued_at"
            and "appointment_requests"."confirmation_token_consumed_at" < "appointment_requests"."offer_expires_at"))),
	CONSTRAINT "appointment_requests_confirmation_source_check" CHECK ("appointment_requests"."confirmation_source" is null
        or "appointment_requests"."confirmation_source" in ('customer_session', 'telegram', 'staff_attested_external')),
	CONSTRAINT "appointment_requests_confirmation_result_check" CHECK (("appointment_requests"."confirmed_at" is null and "appointment_requests"."confirmation_source" is null)
        or ("appointment_requests"."confirmed_at" is not null
          and "appointment_requests"."confirmation_source" is not null
          and "appointment_requests"."confirmation_issued_at" is not null
          and "appointment_requests"."offer_expires_at" is not null
          and "appointment_requests"."confirmed_at" >= "appointment_requests"."confirmation_issued_at"
          and "appointment_requests"."confirmed_at" < "appointment_requests"."offer_expires_at")),
	CONSTRAINT "appointment_requests_terminal_reason_shape_check" CHECK (("appointment_requests"."status" = 'rejected') = ("appointment_requests"."rejection_reason_code" is not null)
        and ("appointment_requests"."status" = 'cancelled') = ("appointment_requests"."cancellation_reason_code" is not null)
        and ("appointment_requests"."status" = 'cancelled') = ("appointment_requests"."cancelled_by_type" is not null)
        and ("appointment_requests"."status" = 'expired') = ("appointment_requests"."expired_at" is not null)
        and ("appointment_requests"."cancelled_by_type" is null
          or "appointment_requests"."cancelled_by_type" in ('customer', 'member'))),
	CONSTRAINT "appointment_requests_lifecycle_shape_check" CHECK (("appointment_requests"."status" = 'requested'
          and "appointment_requests"."staff_decided_at" is null
          and "appointment_requests"."start_at" is null
          and "appointment_requests"."confirmation_issued_at" is null
          and "appointment_requests"."confirmed_at" is null)
        or ("appointment_requests"."status" = 'rejected'
          and "appointment_requests"."staff_decided_at" is not null
          and "appointment_requests"."staff_decision_reason_code" is not null
          and "appointment_requests"."staff_decision_reason_code" = "appointment_requests"."rejection_reason_code"
          and "appointment_requests"."start_at" is null
          and "appointment_requests"."confirmation_issued_at" is null
          and "appointment_requests"."confirmed_at" is null)
        or ("appointment_requests"."status" in ('staff_accepted', 'awaiting_customer_confirmation', 'confirmed')
          and "appointment_requests"."staff_decided_at" is not null
          and "appointment_requests"."start_at" is not null
          and ("appointment_requests"."status" <> 'staff_accepted' or "appointment_requests"."confirmation_issued_at" is null)
          and ("appointment_requests"."status" <> 'awaiting_customer_confirmation'
            or ("appointment_requests"."confirmation_issued_at" is not null and "appointment_requests"."confirmed_at" is null))
          and ("appointment_requests"."status" <> 'confirmed' or "appointment_requests"."confirmed_at" is not null))
        or "appointment_requests"."status" in ('cancelled', 'expired')),
	CONSTRAINT "appointment_requests_chronology_check" CHECK (("appointment_requests"."staff_decided_at" is null or "appointment_requests"."staff_decided_at" >= "appointment_requests"."created_at")
        and ("appointment_requests"."start_at" is null
          or "appointment_requests"."staff_decided_at" is null
          or "appointment_requests"."start_at" > "appointment_requests"."staff_decided_at")
        and ("appointment_requests"."confirmation_issued_at" is null
          or "appointment_requests"."staff_decided_at" is null
          or "appointment_requests"."confirmation_issued_at" >= "appointment_requests"."staff_decided_at")
        and ("appointment_requests"."expired_at" is null or "appointment_requests"."expired_at" >= "appointment_requests"."created_at")),
	CONSTRAINT "appointment_requests_version_check" CHECK ("appointment_requests"."version" > 0),
	CONSTRAINT "appointment_requests_timestamps_check" CHECK ("appointment_requests"."updated_at" >= "appointment_requests"."created_at")
);
--> statement-breakpoint
CREATE TABLE "appointment_revenue_attributions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"appointment_request_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"entry_type" varchar(16) NOT NULL,
	"category_code" varchar(100) NOT NULL,
	"recognized_at" timestamp with time zone NOT NULL,
	"recorded_by_membership_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"source" varchar(24) NOT NULL,
	"reverses_attribution_id" uuid,
	"external_reference_hash" "bytea",
	"reason_code" varchar(100),
	CONSTRAINT "appointment_revenue_attributions_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "appointment_revenue_attributions_request_currency_id_unique" UNIQUE("organization_id","appointment_request_id","currency","id"),
	CONSTRAINT "appointment_revenue_attributions_id_uuid_v7_check" CHECK ("appointment_revenue_attributions"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "appointment_revenue_attributions_amount_check" CHECK ("appointment_revenue_attributions"."amount_minor" > 0),
	CONSTRAINT "appointment_revenue_attributions_currency_check" CHECK ("appointment_revenue_attributions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "appointment_revenue_attributions_entry_type_check" CHECK ("appointment_revenue_attributions"."entry_type" in ('charge', 'adjustment', 'reversal')),
	CONSTRAINT "appointment_revenue_attributions_entry_shape_check" CHECK (("appointment_revenue_attributions"."entry_type" = 'reversal' and "appointment_revenue_attributions"."reverses_attribution_id" is not null)
        or ("appointment_revenue_attributions"."entry_type" in ('charge', 'adjustment')
          and "appointment_revenue_attributions"."reverses_attribution_id" is null)),
	CONSTRAINT "appointment_revenue_attributions_category_check" CHECK ("appointment_revenue_attributions"."category_code" = lower(btrim("appointment_revenue_attributions"."category_code"))
        and "appointment_revenue_attributions"."category_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'),
	CONSTRAINT "appointment_revenue_attributions_source_check" CHECK ("appointment_revenue_attributions"."source" in ('staff_manual', 'approved_import')),
	CONSTRAINT "appointment_revenue_attributions_external_hash_check" CHECK ("appointment_revenue_attributions"."external_reference_hash" is null
        or octet_length("appointment_revenue_attributions"."external_reference_hash") between 16 and 128),
	CONSTRAINT "appointment_revenue_attributions_reason_code_check" CHECK ("appointment_revenue_attributions"."reason_code" is null
        or "appointment_revenue_attributions"."reason_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"channel_connection_id" uuid NOT NULL,
	"external_thread_hash" "bytea",
	"status" varchar(24) NOT NULL,
	"preferred_locale" varchar(2) NOT NULL,
	"automation_mode" varchar(16) NOT NULL,
	"active_handoff_id" uuid,
	"next_sequence_no" bigint DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "conversations_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "conversations_organization_channel_id_unique" UNIQUE("organization_id","channel_connection_id","id"),
	CONSTRAINT "conversations_organization_contact_id_unique" UNIQUE("organization_id","contact_id","id"),
	CONSTRAINT "conversations_organization_contact_lead_id_unique" UNIQUE("organization_id","contact_id","lead_id","id"),
	CONSTRAINT "conversations_id_uuid_v7_check" CHECK ("conversations"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "conversations_active_handoff_uuid_v7_check" CHECK ("conversations"."active_handoff_id" is null
        or "conversations"."active_handoff_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "conversations_external_thread_hash_check" CHECK ("conversations"."external_thread_hash" is null
        or octet_length("conversations"."external_thread_hash") between 16 and 128),
	CONSTRAINT "conversations_status_check" CHECK ("conversations"."status" in ('open', 'awaiting_lead', 'awaiting_staff', 'resolved', 'closed')),
	CONSTRAINT "conversations_preferred_locale_check" CHECK ("conversations"."preferred_locale" in ('uz', 'ru', 'en')),
	CONSTRAINT "conversations_automation_mode_check" CHECK ("conversations"."automation_mode" in ('ai', 'paused', 'staff')),
	CONSTRAINT "conversations_state_ownership_shape_check" CHECK (("conversations"."status" = 'open'
          and "conversations"."automation_mode" = 'ai'
          and "conversations"."active_handoff_id" is null)
        or ("conversations"."status" = 'awaiting_lead'
          and (("conversations"."automation_mode" = 'ai' and "conversations"."active_handoff_id" is null)
            or ("conversations"."automation_mode" = 'staff' and "conversations"."active_handoff_id" is not null)))
        or ("conversations"."status" = 'awaiting_staff'
          and "conversations"."automation_mode" in ('paused', 'staff')
          and "conversations"."active_handoff_id" is not null)
        or ("conversations"."status" in ('resolved', 'closed')
          and "conversations"."automation_mode" = 'paused'
          and "conversations"."active_handoff_id" is null)),
	CONSTRAINT "conversations_next_sequence_no_check" CHECK ("conversations"."next_sequence_no" > 0),
	CONSTRAINT "conversations_activity_timestamps_check" CHECK ("conversations"."last_activity_at" >= "conversations"."started_at"),
	CONSTRAINT "conversations_lifecycle_timestamps_check" CHECK (("conversations"."status" in ('resolved', 'closed')) = ("conversations"."resolved_at" is not null)
        and ("conversations"."status" = 'closed') = ("conversations"."closed_at" is not null)
        and ("conversations"."resolved_at" is null or "conversations"."resolved_at" >= "conversations"."started_at")
        and ("conversations"."closed_at" is null
          or ("conversations"."resolved_at" is not null and "conversations"."closed_at" >= "conversations"."resolved_at"))),
	CONSTRAINT "conversations_version_check" CHECK ("conversations"."version" > 0),
	CONSTRAINT "conversations_timestamps_check" CHECK ("conversations"."updated_at" >= "conversations"."created_at")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel_connection_id" uuid NOT NULL,
	"direction" varchar(16) NOT NULL,
	"sender_type" varchar(16) NOT NULL,
	"sender_contact_id" uuid,
	"sender_membership_id" uuid,
	"sequence_no" bigint NOT NULL,
	"external_event_id" varchar(255),
	"external_message_id" varchar(255),
	"external_sent_at" timestamp with time zone,
	"external_sequence" bigint,
	"content_type" varchar(32) NOT NULL,
	"body_ciphertext" "bytea",
	"body_hash" "bytea" NOT NULL,
	"locale" varchar(2),
	"processing_status" varchar(16) NOT NULL,
	"delivery_status" varchar(16) NOT NULL,
	"reply_to_message_id" uuid,
	"ai_run_id" uuid,
	"knowledge_manifest_jsonb" jsonb,
	"redacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "messages_organization_conversation_id_unique" UNIQUE("organization_id","conversation_id","id"),
	CONSTRAINT "messages_organization_conversation_sequence_unique" UNIQUE("organization_id","conversation_id","sequence_no"),
	CONSTRAINT "messages_id_uuid_v7_check" CHECK ("messages"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "messages_ai_run_uuid_v7_check" CHECK ("messages"."ai_run_id" is null
        or "messages"."ai_run_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "messages_direction_check" CHECK ("messages"."direction" in ('inbound', 'outbound', 'staff_internal')),
	CONSTRAINT "messages_sender_type_check" CHECK ("messages"."sender_type" in ('customer', 'member', 'system')),
	CONSTRAINT "messages_sender_shape_check" CHECK (("messages"."sender_type" = 'customer'
          and "messages"."direction" = 'inbound'
          and "messages"."sender_contact_id" is not null
          and "messages"."sender_membership_id" is null)
        or ("messages"."sender_type" = 'member'
          and "messages"."direction" in ('outbound', 'staff_internal')
          and "messages"."sender_contact_id" is null
          and "messages"."sender_membership_id" is not null)
        or ("messages"."sender_type" = 'system'
          and "messages"."direction" = 'outbound'
          and "messages"."sender_contact_id" is null
          and "messages"."sender_membership_id" is null)),
	CONSTRAINT "messages_sequence_no_check" CHECK ("messages"."sequence_no" > 0),
	CONSTRAINT "messages_external_event_id_check" CHECK ("messages"."external_event_id" is null
        or ("messages"."external_event_id" = btrim("messages"."external_event_id")
          and length("messages"."external_event_id") between 1 and 255)),
	CONSTRAINT "messages_external_message_id_check" CHECK ("messages"."external_message_id" is null
        or ("messages"."external_message_id" = btrim("messages"."external_message_id")
          and length("messages"."external_message_id") between 1 and 255)),
	CONSTRAINT "messages_external_sequence_check" CHECK ("messages"."external_sequence" is null or "messages"."external_sequence" >= 0),
	CONSTRAINT "messages_content_type_check" CHECK ("messages"."content_type" = btrim("messages"."content_type")
        and length("messages"."content_type") between 1 and 32),
	CONSTRAINT "messages_body_ciphertext_check" CHECK ("messages"."body_ciphertext" is null
        or octet_length("messages"."body_ciphertext") between 1 and 65536),
	CONSTRAINT "messages_body_hash_check" CHECK (octet_length("messages"."body_hash") between 16 and 128),
	CONSTRAINT "messages_locale_check" CHECK ("messages"."locale" is null or "messages"."locale" in ('uz', 'ru', 'en')),
	CONSTRAINT "messages_processing_status_check" CHECK ("messages"."processing_status" in ('accepted', 'processing', 'processed', 'failed', 'suppressed')),
	CONSTRAINT "messages_delivery_status_check" CHECK ("messages"."delivery_status" in ('not_applicable', 'queued', 'sent', 'delivered', 'failed')),
	CONSTRAINT "messages_delivery_direction_check" CHECK ("messages"."direction" = 'outbound' or "messages"."delivery_status" = 'not_applicable'),
	CONSTRAINT "messages_knowledge_manifest_check" CHECK ("messages"."knowledge_manifest_jsonb" is null
        or (jsonb_typeof("messages"."knowledge_manifest_jsonb") = 'object'
          and pg_column_size("messages"."knowledge_manifest_jsonb") <= 65536)),
	CONSTRAINT "messages_redaction_check" CHECK ("messages"."redacted_at" is null or "messages"."body_ciphertext" is null)
);
--> statement-breakpoint
ALTER TABLE "appointment_confirmation_evidence" ADD CONSTRAINT "appointment_confirmation_evidence_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_confirmation_evidence" ADD CONSTRAINT "appointment_confirmation_evidence_request_fk" FOREIGN KEY ("organization_id","appointment_request_id") REFERENCES "public"."appointment_requests"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_confirmation_evidence" ADD CONSTRAINT "appointment_confirmation_evidence_customer_fk" FOREIGN KEY ("organization_id","customer_contact_id","appointment_request_id") REFERENCES "public"."appointment_requests"("organization_id","contact_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_confirmation_evidence" ADD CONSTRAINT "appointment_confirmation_evidence_member_fk" FOREIGN KEY ("organization_id","recorded_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_confirmation_evidence" ADD CONSTRAINT "appointment_confirmation_evidence_message_fk" FOREIGN KEY ("organization_id","source_message_id") REFERENCES "public"."messages"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_request_attendance" ADD CONSTRAINT "appointment_request_attendance_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_request_attendance" ADD CONSTRAINT "appointment_request_attendance_request_fk" FOREIGN KEY ("organization_id","appointment_request_id") REFERENCES "public"."appointment_requests"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_request_attendance" ADD CONSTRAINT "appointment_request_attendance_member_fk" FOREIGN KEY ("organization_id","recorded_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_request_attendance" ADD CONSTRAINT "appointment_request_attendance_superseded_fk" FOREIGN KEY ("organization_id","appointment_request_id","supersedes_id") REFERENCES "public"."appointment_request_attendance"("organization_id","appointment_request_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_request_preferences" ADD CONSTRAINT "appointment_request_preferences_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_request_preferences" ADD CONSTRAINT "appointment_request_preferences_request_fk" FOREIGN KEY ("organization_id","appointment_request_id") REFERENCES "public"."appointment_requests"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_request_transitions" ADD CONSTRAINT "appointment_request_transitions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_request_transitions" ADD CONSTRAINT "appointment_request_transitions_request_fk" FOREIGN KEY ("organization_id","appointment_request_id") REFERENCES "public"."appointment_requests"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_request_transitions" ADD CONSTRAINT "appointment_request_transitions_customer_actor_fk" FOREIGN KEY ("organization_id","actor_contact_id","appointment_request_id") REFERENCES "public"."appointment_requests"("organization_id","contact_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_request_transitions" ADD CONSTRAINT "appointment_request_transitions_member_actor_fk" FOREIGN KEY ("organization_id","actor_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_request_transitions" ADD CONSTRAINT "appointment_request_transitions_source_message_fk" FOREIGN KEY ("organization_id","source_message_id") REFERENCES "public"."messages"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."leads"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversations"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_conversation_context_fk" FOREIGN KEY ("organization_id","contact_id","lead_id","conversation_id") REFERENCES "public"."conversations"("organization_id","contact_id","lead_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_source_message_fk" FOREIGN KEY ("organization_id","conversation_id","source_message_id") REFERENCES "public"."messages"("organization_id","conversation_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_service_version_fk" FOREIGN KEY ("organization_id","service_id","service_version_id") REFERENCES "public"."service_versions"("organization_id","service_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_location_fk" FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_location_version_fk" FOREIGN KEY ("organization_id","location_id","location_version_id") REFERENCES "public"."location_versions"("organization_id","location_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_business_policy_fk" FOREIGN KEY ("organization_id","business_policy_id") REFERENCES "public"."business_policies"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_staff_decider_fk" FOREIGN KEY ("organization_id","staff_decided_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_revenue_attributions" ADD CONSTRAINT "appointment_revenue_attributions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_revenue_attributions" ADD CONSTRAINT "appointment_revenue_attributions_request_fk" FOREIGN KEY ("organization_id","appointment_request_id") REFERENCES "public"."appointment_requests"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_revenue_attributions" ADD CONSTRAINT "appointment_revenue_attributions_member_fk" FOREIGN KEY ("organization_id","recorded_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "appointment_revenue_attributions" ADD CONSTRAINT "appointment_revenue_attributions_reversed_entry_fk" FOREIGN KEY ("organization_id","appointment_request_id","currency","reverses_attribution_id") REFERENCES "public"."appointment_revenue_attributions"("organization_id","appointment_request_id","currency","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_contact_id_unique" UNIQUE("organization_id","contact_id","id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."leads"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_contact_fk" FOREIGN KEY ("organization_id","contact_id","lead_id") REFERENCES "public"."leads"("organization_id","contact_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_connection_fk" FOREIGN KEY ("organization_id","channel_connection_id") REFERENCES "public"."channel_connections"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_connection_fk" FOREIGN KEY ("organization_id","channel_connection_id") REFERENCES "public"."channel_connections"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_channel_fk" FOREIGN KEY ("organization_id","channel_connection_id","conversation_id") REFERENCES "public"."conversations"("organization_id","channel_connection_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_contact_fk" FOREIGN KEY ("organization_id","sender_contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_membership_fk" FOREIGN KEY ("organization_id","sender_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_message_fk" FOREIGN KEY ("organization_id","conversation_id","reply_to_message_id") REFERENCES "public"."messages"("organization_id","conversation_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_confirmation_evidence_offer_unique" ON "appointment_confirmation_evidence" USING btree ("organization_id","appointment_request_id","offer_version") WHERE "appointment_confirmation_evidence"."outcome" in ('confirmed', 'declined');--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_confirmation_evidence_external_unique" ON "appointment_confirmation_evidence" USING btree ("organization_id","source","external_reference_hash") WHERE "appointment_confirmation_evidence"."external_reference_hash" is not null;--> statement-breakpoint
CREATE INDEX "appointment_confirmation_evidence_request_recorded_idx" ON "appointment_confirmation_evidence" USING btree ("organization_id","appointment_request_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "appointment_confirmation_evidence_source_recorded_idx" ON "appointment_confirmation_evidence" USING btree ("organization_id","source","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_request_attendance_one_current_unique" ON "appointment_request_attendance" USING btree ("organization_id","appointment_request_id") WHERE "appointment_request_attendance"."is_current" = true;--> statement-breakpoint
CREATE INDEX "appointment_request_attendance_outcome_occurred_idx" ON "appointment_request_attendance" USING btree ("organization_id","outcome","occurred_at");--> statement-breakpoint
CREATE INDEX "appointment_request_attendance_request_recorded_idx" ON "appointment_request_attendance" USING btree ("organization_id","appointment_request_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "appointment_request_preferences_request_order_idx" ON "appointment_request_preferences" USING btree ("organization_id","appointment_request_id","preference_order");--> statement-breakpoint
CREATE INDEX "appointment_request_preferences_organization_start_idx" ON "appointment_request_preferences" USING btree ("organization_id","start_at");--> statement-breakpoint
CREATE INDEX "appointment_request_transitions_request_occurred_idx" ON "appointment_request_transitions" USING btree ("organization_id","appointment_request_id","occurred_at");--> statement-breakpoint
CREATE INDEX "appointment_request_transitions_status_occurred_idx" ON "appointment_request_transitions" USING btree ("organization_id","to_status","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_requests_source_message_unique" ON "appointment_requests" USING btree ("organization_id","source_message_id") WHERE "appointment_requests"."source_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_requests_confirmation_token_unique" ON "appointment_requests" USING btree ("confirmation_token_hash") WHERE "appointment_requests"."confirmation_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "appointment_requests_organization_status_created_idx" ON "appointment_requests" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "appointment_requests_organization_location_status_idx" ON "appointment_requests" USING btree ("organization_id","location_id","status","created_at");--> statement-breakpoint
CREATE INDEX "appointment_requests_organization_lead_created_idx" ON "appointment_requests" USING btree ("organization_id","lead_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "appointment_requests_organization_offer_expiry_idx" ON "appointment_requests" USING btree ("organization_id","offer_expires_at") WHERE "appointment_requests"."status" in ('staff_accepted', 'awaiting_customer_confirmation');--> statement-breakpoint
CREATE INDEX "appointment_requests_organization_staff_decision_idx" ON "appointment_requests" USING btree ("organization_id","staff_decided_by_membership_id","staff_decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_revenue_attributions_import_reference_unique" ON "appointment_revenue_attributions" USING btree ("organization_id","source","external_reference_hash") WHERE "appointment_revenue_attributions"."source" = 'approved_import' and "appointment_revenue_attributions"."external_reference_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_revenue_attributions_one_reversal_unique" ON "appointment_revenue_attributions" USING btree ("organization_id","reverses_attribution_id") WHERE "appointment_revenue_attributions"."reverses_attribution_id" is not null;--> statement-breakpoint
CREATE INDEX "appointment_revenue_attributions_recognized_currency_idx" ON "appointment_revenue_attributions" USING btree ("organization_id","recognized_at","currency");--> statement-breakpoint
CREATE INDEX "appointment_revenue_attributions_request_recorded_idx" ON "appointment_revenue_attributions" USING btree ("organization_id","appointment_request_id","recorded_at");--> statement-breakpoint
CREATE INDEX "conversations_organization_status_activity_idx" ON "conversations" USING btree ("organization_id","status","last_activity_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversations_organization_lead_started_idx" ON "conversations" USING btree ("organization_id","lead_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversations_organization_contact_started_idx" ON "conversations" USING btree ("organization_id","contact_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversations_organization_connection_activity_idx" ON "conversations" USING btree ("organization_id","channel_connection_id","last_activity_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_message_dedupe_unique" ON "messages" USING btree ("organization_id","channel_connection_id","external_message_id") WHERE "messages"."external_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_event_dedupe_unique" ON "messages" USING btree ("organization_id","channel_connection_id","external_event_id") WHERE "messages"."external_event_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_organization_conversation_sequence_idx" ON "messages" USING btree ("organization_id","conversation_id","sequence_no");--> statement-breakpoint
CREATE INDEX "messages_organization_processing_created_idx" ON "messages" USING btree ("organization_id","processing_status","created_at");--> statement-breakpoint
CREATE INDEX "messages_organization_delivery_created_idx" ON "messages" USING btree ("organization_id","delivery_status","created_at");--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversations"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_conversation_contact_fk" FOREIGN KEY ("organization_id","contact_id","conversation_id") REFERENCES "public"."conversations"("organization_id","contact_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_source_message_fk" FOREIGN KEY ("organization_id","source_message_id") REFERENCES "public"."messages"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_conversation_message_fk" FOREIGN KEY ("organization_id","conversation_id","source_message_id") REFERENCES "public"."messages"("organization_id","conversation_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lead_qualification_evidence" ADD CONSTRAINT "lead_qualification_evidence_message_fk" FOREIGN KEY ("organization_id","message_id") REFERENCES "public"."messages"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "widget_sessions" ADD CONSTRAINT "widget_sessions_conversation_fk" FOREIGN KEY ("organization_id","channel_connection_id","conversation_id") REFERENCES "public"."conversations"("organization_id","channel_connection_id","id") ON DELETE restrict ON UPDATE restrict;
