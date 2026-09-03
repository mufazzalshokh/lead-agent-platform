CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid,
	"conversation_id" uuid,
	"contact_identity_id" uuid,
	"purpose" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"lawful_basis_code" varchar(100),
	"notice_key" varchar(128) NOT NULL,
	"notice_version" integer NOT NULL,
	"policy_url" varchar(2048),
	"locale" varchar(2) NOT NULL,
	"capture_channel" varchar(16) NOT NULL,
	"channel_connection_id" uuid,
	"source_message_id" uuid,
	"captured_by_type" varchar(16) NOT NULL,
	"captured_by_id" uuid,
	"captured_at" timestamp with time zone NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"supersedes_consent_id" uuid,
	"evidence_hash" "bytea" NOT NULL,
	"evidence_ciphertext" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_records_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "consent_records_id_uuid_v7_check" CHECK ("consent_records"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "consent_records_conversation_uuid_v7_check" CHECK ("consent_records"."conversation_id" is null
        or "consent_records"."conversation_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "consent_records_source_message_uuid_v7_check" CHECK ("consent_records"."source_message_id" is null
        or "consent_records"."source_message_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "consent_records_captured_by_uuid_v7_check" CHECK ("consent_records"."captured_by_id" is null
        or "consent_records"."captured_by_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "consent_records_purpose_check" CHECK ("consent_records"."purpose" in ('booking_follow_up', 'service_messages', 'analytics_optional', 'marketing')),
	CONSTRAINT "consent_records_status_check" CHECK ("consent_records"."status" in ('granted', 'declined', 'withdrawn', 'not_required')),
	CONSTRAINT "consent_records_lawful_basis_code_check" CHECK ("consent_records"."lawful_basis_code" is null
        or ("consent_records"."lawful_basis_code" = lower(btrim("consent_records"."lawful_basis_code"))
          and "consent_records"."lawful_basis_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$')),
	CONSTRAINT "consent_records_notice_key_check" CHECK ("consent_records"."notice_key" = lower(btrim("consent_records"."notice_key"))
        and "consent_records"."notice_key" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
	CONSTRAINT "consent_records_notice_version_check" CHECK ("consent_records"."notice_version" > 0),
	CONSTRAINT "consent_records_policy_url_check" CHECK ("consent_records"."policy_url" is null
        or ("consent_records"."policy_url" = btrim("consent_records"."policy_url")
          and length("consent_records"."policy_url") between 1 and 2048)),
	CONSTRAINT "consent_records_locale_check" CHECK ("consent_records"."locale" in ('uz', 'ru', 'en')),
	CONSTRAINT "consent_records_capture_channel_check" CHECK ("consent_records"."capture_channel" in ('widget', 'telegram', 'staff')),
	CONSTRAINT "consent_records_captured_by_type_check" CHECK ("consent_records"."captured_by_type" in ('customer', 'member', 'system')),
	CONSTRAINT "consent_records_subject_anchor_check" CHECK ("consent_records"."contact_id" is not null
        or "consent_records"."contact_identity_id" is not null
        or "consent_records"."conversation_id" is not null),
	CONSTRAINT "consent_records_withdrawal_check" CHECK (("consent_records"."status" = 'withdrawn'
          and "consent_records"."withdrawn_at" is not null
          and "consent_records"."withdrawn_at" >= "consent_records"."captured_at")
        or ("consent_records"."status" <> 'withdrawn' and "consent_records"."withdrawn_at" is null)),
	CONSTRAINT "consent_records_supersedes_check" CHECK ("consent_records"."supersedes_consent_id" is null or "consent_records"."supersedes_consent_id" <> "consent_records"."id"),
	CONSTRAINT "consent_records_evidence_hash_check" CHECK (octet_length("consent_records"."evidence_hash") between 16 and 128),
	CONSTRAINT "consent_records_evidence_ciphertext_check" CHECK ("consent_records"."evidence_ciphertext" is null
        or octet_length("consent_records"."evidence_ciphertext") between 1 and 65536)
);
--> statement-breakpoint
CREATE TABLE "contact_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"identity_type" varchar(32) NOT NULL,
	"channel_connection_id" uuid,
	"value_ciphertext" "bytea",
	"lookup_hash" "bytea",
	"hash_key_version" integer DEFAULT 1 NOT NULL,
	"display_redacted" varchar(255),
	"validation_status" varchar(16) NOT NULL,
	"verified_at" timestamp with time zone,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "contact_identities_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "contact_identities_contact_id_id_unique" UNIQUE("organization_id","contact_id","id"),
	CONSTRAINT "contact_identities_id_uuid_v7_check" CHECK ("contact_identities"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "contact_identities_identity_type_check" CHECK ("contact_identities"."identity_type" in ('widget_participant', 'telegram_user', 'phone', 'email')),
	CONSTRAINT "contact_identities_value_ciphertext_check" CHECK ("contact_identities"."value_ciphertext" is null or octet_length("contact_identities"."value_ciphertext") between 1 and 8192),
	CONSTRAINT "contact_identities_lookup_hash_check" CHECK ("contact_identities"."lookup_hash" is null or octet_length("contact_identities"."lookup_hash") between 16 and 128),
	CONSTRAINT "contact_identities_hash_key_version_check" CHECK ("contact_identities"."hash_key_version" > 0),
	CONSTRAINT "contact_identities_display_redacted_check" CHECK ("contact_identities"."display_redacted" is null
        or ("contact_identities"."display_redacted" = btrim("contact_identities"."display_redacted")
          and length("contact_identities"."display_redacted") between 1 and 255)),
	CONSTRAINT "contact_identities_validation_status_check" CHECK ("contact_identities"."validation_status" in ('unverified', 'valid', 'verified', 'invalid')),
	CONSTRAINT "contact_identities_verification_check" CHECK ("contact_identities"."validation_status" <> 'verified' or "contact_identities"."verified_at" is not null),
	CONSTRAINT "contact_identities_status_check" CHECK ("contact_identities"."status" in ('active', 'withdrawn', 'anonymized')),
	CONSTRAINT "contact_identities_anonymized_shape_check" CHECK (("contact_identities"."status" = 'anonymized'
          and "contact_identities"."value_ciphertext" is null
          and "contact_identities"."lookup_hash" is null
          and "contact_identities"."display_redacted" is null)
        or ("contact_identities"."status" <> 'anonymized' and "contact_identities"."lookup_hash" is not null)),
	CONSTRAINT "contact_identities_version_check" CHECK ("contact_identities"."version" > 0),
	CONSTRAINT "contact_identities_timestamps_check" CHECK ("contact_identities"."updated_at" >= "contact_identities"."created_at")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"display_name_ciphertext" "bytea",
	"preferred_locale" varchar(2),
	"status" varchar(16) NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "contacts_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "contacts_id_uuid_v7_check" CHECK ("contacts"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "contacts_display_name_ciphertext_check" CHECK ("contacts"."display_name_ciphertext" is null or octet_length("contacts"."display_name_ciphertext") between 1 and 8192),
	CONSTRAINT "contacts_preferred_locale_check" CHECK ("contacts"."preferred_locale" is null or "contacts"."preferred_locale" in ('uz', 'ru', 'en')),
	CONSTRAINT "contacts_status_check" CHECK ("contacts"."status" in ('active', 'anonymized', 'blocked')),
	CONSTRAINT "contacts_seen_at_check" CHECK ("contacts"."last_seen_at" >= "contacts"."first_seen_at"),
	CONSTRAINT "contacts_anonymized_shape_check" CHECK (("contacts"."status" = 'anonymized') = ("contacts"."anonymized_at" is not null)
        and ("contacts"."status" <> 'anonymized' or "contacts"."display_name_ciphertext" is null)),
	CONSTRAINT "contacts_version_check" CHECK ("contacts"."version" > 0),
	CONSTRAINT "contacts_timestamps_check" CHECK ("contacts"."updated_at" >= "contacts"."created_at")
);
--> statement-breakpoint
CREATE TABLE "lead_qualification_evaluations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"business_policy_id" uuid NOT NULL,
	"result" varchar(16) NOT NULL,
	"reason_codes" varchar(100)[] DEFAULT array[]::varchar(100)[] NOT NULL,
	"facts_jsonb" jsonb NOT NULL,
	"evaluated_by" varchar(16) NOT NULL,
	"member_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lead_qualification_evaluations_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "lead_qualification_evaluations_lead_id_unique" UNIQUE("organization_id","lead_id","id"),
	CONSTRAINT "lead_qualification_evaluations_id_uuid_v7_check" CHECK ("lead_qualification_evaluations"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "lead_qualification_evaluations_result_check" CHECK ("lead_qualification_evaluations"."result" in ('qualified', 'disqualified', 'incomplete')),
	CONSTRAINT "lead_qualification_evaluations_reason_codes_check" CHECK (cardinality("lead_qualification_evaluations"."reason_codes") between 0 and 16
        and array_position("lead_qualification_evaluations"."reason_codes", null) is null
        and (cardinality("lead_qualification_evaluations"."reason_codes") = 0
          or array_to_string("lead_qualification_evaluations"."reason_codes", ',')
            ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*(?:,[a-z][a-z0-9]*(?:_[a-z0-9]+)*)*$')),
	CONSTRAINT "lead_qualification_evaluations_facts_check" CHECK (jsonb_typeof("lead_qualification_evaluations"."facts_jsonb") = 'object'
        and pg_column_size("lead_qualification_evaluations"."facts_jsonb") <= 65536),
	CONSTRAINT "lead_qualification_evaluations_evaluator_check" CHECK (("lead_qualification_evaluations"."evaluated_by" = 'system' and "lead_qualification_evaluations"."member_id" is null)
        or ("lead_qualification_evaluations"."evaluated_by" = 'member' and "lead_qualification_evaluations"."member_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "lead_qualification_evidence" (
	"organization_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"field_key" varchar(128) NOT NULL,
	"evidence_kind" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_qualification_evidence_pk" PRIMARY KEY("organization_id","evaluation_id","message_id","field_key"),
	CONSTRAINT "lead_qualification_evidence_message_uuid_v7_check" CHECK ("lead_qualification_evidence"."message_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "lead_qualification_evidence_field_key_check" CHECK ("lead_qualification_evidence"."field_key" = lower(btrim("lead_qualification_evidence"."field_key"))
        and "lead_qualification_evidence"."field_key" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
	CONSTRAINT "lead_qualification_evidence_kind_check" CHECK ("lead_qualification_evidence"."evidence_kind" in ('customer_statement', 'staff_entry', 'derived'))
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" varchar(24) NOT NULL,
	"source_channel_connection_id" uuid NOT NULL,
	"campaign_key" varchar(128),
	"service_id" uuid,
	"location_id" uuid,
	"assigned_membership_id" uuid,
	"qualification_policy_id" uuid,
	"qualification_reason_codes" varchar(100)[] DEFAULT array[]::varchar(100)[] NOT NULL,
	"engaged_at" timestamp with time zone,
	"qualified_at" timestamp with time zone,
	"booking_requested_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_reason" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "leads_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "leads_id_uuid_v7_check" CHECK ("leads"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "leads_status_check" CHECK ("leads"."status" in ('new', 'engaged', 'qualified', 'booking_requested', 'converted', 'disqualified', 'closed')),
	CONSTRAINT "leads_campaign_key_check" CHECK ("leads"."campaign_key" is null
        or ("leads"."campaign_key" = lower(btrim("leads"."campaign_key"))
          and "leads"."campaign_key" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$')),
	CONSTRAINT "leads_qualification_reason_codes_check" CHECK (cardinality("leads"."qualification_reason_codes") between 0 and 16
        and array_position("leads"."qualification_reason_codes", null) is null
        and (cardinality("leads"."qualification_reason_codes") = 0
          or array_to_string("leads"."qualification_reason_codes", ',')
            ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*(?:,[a-z][a-z0-9]*(?:_[a-z0-9]+)*)*$')),
	CONSTRAINT "leads_closed_shape_check" CHECK (("leads"."status" = 'closed') = ("leads"."closed_at" is not null and "leads"."closed_reason" is not null)),
	CONSTRAINT "leads_closed_reason_check" CHECK ("leads"."closed_reason" is null
        or "leads"."closed_reason" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'),
	CONSTRAINT "leads_version_check" CHECK ("leads"."version" > 0),
	CONSTRAINT "leads_timestamps_check" CHECK ("leads"."updated_at" >= "leads"."created_at")
);
--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_contact_identity_fk" FOREIGN KEY ("organization_id","contact_identity_id") REFERENCES "public"."contact_identities"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_contact_identity_subject_fk" FOREIGN KEY ("organization_id","contact_id","contact_identity_id") REFERENCES "public"."contact_identities"("organization_id","contact_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_channel_connection_fk" FOREIGN KEY ("organization_id","channel_connection_id") REFERENCES "public"."channel_connections"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_superseded_record_fk" FOREIGN KEY ("organization_id","supersedes_consent_id") REFERENCES "public"."consent_records"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_channel_connection_fk" FOREIGN KEY ("organization_id","channel_connection_id") REFERENCES "public"."channel_connections"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lead_qualification_evaluations" ADD CONSTRAINT "lead_qualification_evaluations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lead_qualification_evaluations" ADD CONSTRAINT "lead_qualification_evaluations_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."leads"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lead_qualification_evaluations" ADD CONSTRAINT "lead_qualification_evaluations_policy_fk" FOREIGN KEY ("organization_id","business_policy_id") REFERENCES "public"."business_policies"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lead_qualification_evaluations" ADD CONSTRAINT "lead_qualification_evaluations_member_fk" FOREIGN KEY ("organization_id","member_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lead_qualification_evidence" ADD CONSTRAINT "lead_qualification_evidence_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lead_qualification_evidence" ADD CONSTRAINT "lead_qualification_evidence_evaluation_fk" FOREIGN KEY ("organization_id","evaluation_id") REFERENCES "public"."lead_qualification_evaluations"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_channel_connection_fk" FOREIGN KEY ("organization_id","source_channel_connection_id") REFERENCES "public"."channel_connections"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_location_fk" FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_membership_fk" FOREIGN KEY ("organization_id","assigned_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_qualification_policy_fk" FOREIGN KEY ("organization_id","qualification_policy_id") REFERENCES "public"."business_policies"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_records_source_event_dedupe_unique" ON "consent_records" USING btree ("organization_id","contact_id","purpose","source_message_id","status") WHERE "consent_records"."source_message_id" is not null;--> statement-breakpoint
CREATE INDEX "consent_records_organization_contact_purpose_captured_idx" ON "consent_records" USING btree ("organization_id","contact_id","purpose","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "consent_records_organization_identity_purpose_captured_idx" ON "consent_records" USING btree ("organization_id","contact_identity_id","purpose","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "consent_records_organization_purpose_status_idx" ON "consent_records" USING btree ("organization_id","purpose","status");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identities_active_lookup_unique" ON "contact_identities" USING btree ("organization_id","identity_type",coalesce("channel_connection_id", '00000000-0000-0000-0000-000000000000'::uuid),"lookup_hash") WHERE "contact_identities"."status" = 'active';--> statement-breakpoint
CREATE INDEX "contact_identities_organization_contact_status_idx" ON "contact_identities" USING btree ("organization_id","contact_id","status");--> statement-breakpoint
CREATE INDEX "contacts_organization_status_last_seen_idx" ON "contacts" USING btree ("organization_id","status","last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lead_qualification_evaluations_lead_occurred_idx" ON "lead_qualification_evaluations" USING btree ("organization_id","lead_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lead_qualification_evaluations_policy_idx" ON "lead_qualification_evaluations" USING btree ("organization_id","business_policy_id");--> statement-breakpoint
CREATE INDEX "lead_qualification_evidence_message_evaluation_idx" ON "lead_qualification_evidence" USING btree ("organization_id","message_id","evaluation_id");--> statement-breakpoint
CREATE INDEX "leads_organization_status_updated_idx" ON "leads" USING btree ("organization_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leads_organization_contact_created_idx" ON "leads" USING btree ("organization_id","contact_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leads_organization_assignee_status_idx" ON "leads" USING btree ("organization_id","assigned_membership_id","status");--> statement-breakpoint
ALTER TABLE "widget_sessions" ADD CONSTRAINT "widget_sessions_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE restrict ON UPDATE restrict;