CREATE TABLE "ai_action_evaluations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"ai_run_id" uuid NOT NULL,
	"action_name" varchar(40) NOT NULL,
	"action_schema_version" varchar(64) NOT NULL,
	"proposal_hash" "bytea" NOT NULL,
	"arguments_ciphertext" "bytea" NOT NULL,
	"validation_status" varchar(16) NOT NULL,
	"policy_reason_code" varchar(100),
	"application_status" varchar(16) NOT NULL,
	"target_aggregate_type" varchar(32),
	"target_aggregate_id" uuid,
	"result_hash" "bytea",
	"result_ciphertext" "bytea",
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ai_action_evaluations_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "ai_action_evaluations_organization_ai_run_unique" UNIQUE("organization_id","ai_run_id"),
	CONSTRAINT "ai_action_evaluations_id_uuid_v7_check" CHECK ("ai_action_evaluations"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "ai_action_evaluations_action_name_check" CHECK ("ai_action_evaluations"."action_name" in ('none', 'request_information', 'create_appointment_request', 'confirm_appointment', 'decline_appointment', 'request_handoff')),
	CONSTRAINT "ai_action_evaluations_action_schema_version_check" CHECK ("ai_action_evaluations"."action_schema_version" = btrim("ai_action_evaluations"."action_schema_version")
        and "ai_action_evaluations"."action_schema_version" !~ '[[:space:]]'),
	CONSTRAINT "ai_action_evaluations_proposal_hash_check" CHECK (octet_length("ai_action_evaluations"."proposal_hash") between 16 and 128),
	CONSTRAINT "ai_action_evaluations_arguments_ciphertext_check" CHECK (octet_length("ai_action_evaluations"."arguments_ciphertext") between 1 and 65536),
	CONSTRAINT "ai_action_evaluations_validation_status_check" CHECK ("ai_action_evaluations"."validation_status" in ('pending', 'allowed', 'denied', 'malformed')),
	CONSTRAINT "ai_action_evaluations_policy_reason_check" CHECK (("ai_action_evaluations"."validation_status" = 'pending' and "ai_action_evaluations"."policy_reason_code" is null)
        or ("ai_action_evaluations"."validation_status" in ('denied', 'malformed')
          and "ai_action_evaluations"."policy_reason_code" is not null
          and "ai_action_evaluations"."policy_reason_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$')
        or ("ai_action_evaluations"."validation_status" = 'allowed'
          and ("ai_action_evaluations"."policy_reason_code" is null
            or "ai_action_evaluations"."policy_reason_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'))),
	CONSTRAINT "ai_action_evaluations_application_status_check" CHECK ("ai_action_evaluations"."application_status" in ('not_applied', 'applied', 'failed', 'stale')),
	CONSTRAINT "ai_action_evaluations_authority_shape_check" CHECK ("ai_action_evaluations"."validation_status" = 'allowed'
        or "ai_action_evaluations"."application_status" = 'not_applied'),
	CONSTRAINT "ai_action_evaluations_target_shape_check" CHECK (("ai_action_evaluations"."target_aggregate_type" is null and "ai_action_evaluations"."target_aggregate_id" is null)
        or ("ai_action_evaluations"."target_aggregate_type" in ('conversation', 'appointment_request', 'handoff')
          and "ai_action_evaluations"."target_aggregate_id" is not null
          and "ai_action_evaluations"."target_aggregate_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')),
	CONSTRAINT "ai_action_evaluations_result_hash_check" CHECK ("ai_action_evaluations"."result_hash" is null or octet_length("ai_action_evaluations"."result_hash") between 16 and 128),
	CONSTRAINT "ai_action_evaluations_result_ciphertext_check" CHECK ("ai_action_evaluations"."result_ciphertext" is null
        or ("ai_action_evaluations"."result_hash" is not null
          and octet_length("ai_action_evaluations"."result_ciphertext") between 1 and 65536)),
	CONSTRAINT "ai_action_evaluations_lifecycle_check" CHECK (("ai_action_evaluations"."validation_status" = 'pending'
          and "ai_action_evaluations"."finished_at" is null
          and "ai_action_evaluations"."application_status" = 'not_applied')
        or ("ai_action_evaluations"."validation_status" <> 'pending'
          and "ai_action_evaluations"."finished_at" is not null
          and "ai_action_evaluations"."finished_at" >= "ai_action_evaluations"."started_at"))
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"trigger_message_id" uuid NOT NULL,
	"expected_conversation_version" bigint NOT NULL,
	"provider_id" varchar(64) NOT NULL,
	"requested_model_id" varchar(255) NOT NULL,
	"model_profile_version" varchar(128) NOT NULL,
	"provider_resolved_model_id" varchar(255),
	"orchestrator_version" varchar(128) NOT NULL,
	"prompt_template_version" varchar(128) NOT NULL,
	"decision_schema_version" varchar(64) NOT NULL,
	"policy_version" varchar(128) NOT NULL,
	"status" varchar(24) NOT NULL,
	"input_units" bigint,
	"output_units" bigint,
	"cached_input_units" bigint,
	"reasoning_units" bigint,
	"total_units" bigint,
	"estimated_cost_micros" bigint,
	"cost_currency" varchar(3) NOT NULL,
	"cost_catalog_version" varchar(128) NOT NULL,
	"latency_ms" integer,
	"attempt_no" integer NOT NULL,
	"failure_category" varchar(100),
	"knowledge_manifest_jsonb" jsonb NOT NULL,
	"input_hash" "bytea" NOT NULL,
	"output_hash" "bytea",
	"input_snapshot_ciphertext" "bytea",
	"output_snapshot_ciphertext" "bytea",
	"snapshot_capture_policy_id" uuid,
	"schema_valid" boolean,
	"policy_allowed" boolean,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"correlation_id" uuid NOT NULL,
	CONSTRAINT "ai_runs_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "ai_runs_trigger_attempt_provider_unique" UNIQUE("organization_id","trigger_message_id","attempt_no","provider_id"),
	CONSTRAINT "ai_runs_id_uuid_v7_check" CHECK ("ai_runs"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "ai_runs_correlation_uuid_v7_check" CHECK ("ai_runs"."correlation_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "ai_runs_expected_conversation_version_check" CHECK ("ai_runs"."expected_conversation_version" > 0),
	CONSTRAINT "ai_runs_provider_id_check" CHECK ("ai_runs"."provider_id" = lower(btrim("ai_runs"."provider_id"))
        and "ai_runs"."provider_id" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
	CONSTRAINT "ai_runs_model_identifiers_check" CHECK ("ai_runs"."requested_model_id" = btrim("ai_runs"."requested_model_id")
        and length("ai_runs"."requested_model_id") between 1 and 255
        and "ai_runs"."requested_model_id" !~ '[[:space:]]'
        and lower("ai_runs"."requested_model_id") <> 'latest'
        and ("ai_runs"."provider_resolved_model_id" is null
          or ("ai_runs"."provider_resolved_model_id" = btrim("ai_runs"."provider_resolved_model_id")
            and length("ai_runs"."provider_resolved_model_id") between 1 and 255
            and "ai_runs"."provider_resolved_model_id" !~ '[[:space:]]'))),
	CONSTRAINT "ai_runs_versions_check" CHECK ("ai_runs"."model_profile_version" = btrim("ai_runs"."model_profile_version")
        and "ai_runs"."model_profile_version" !~ '[[:space:]]'
        and "ai_runs"."orchestrator_version" = btrim("ai_runs"."orchestrator_version")
        and "ai_runs"."orchestrator_version" !~ '[[:space:]]'
        and "ai_runs"."prompt_template_version" = btrim("ai_runs"."prompt_template_version")
        and "ai_runs"."prompt_template_version" !~ '[[:space:]]'
        and "ai_runs"."decision_schema_version" = btrim("ai_runs"."decision_schema_version")
        and "ai_runs"."decision_schema_version" !~ '[[:space:]]'
        and "ai_runs"."policy_version" = btrim("ai_runs"."policy_version")
        and "ai_runs"."policy_version" !~ '[[:space:]]'
        and "ai_runs"."cost_catalog_version" = btrim("ai_runs"."cost_catalog_version")
        and "ai_runs"."cost_catalog_version" !~ '[[:space:]]'),
	CONSTRAINT "ai_runs_status_check" CHECK ("ai_runs"."status" in ('started', 'succeeded', 'failed', 'schema_rejected', 'policy_denied', 'stale')),
	CONSTRAINT "ai_runs_usage_check" CHECK (("ai_runs"."input_units" is null or "ai_runs"."input_units" >= 0)
        and ("ai_runs"."output_units" is null or "ai_runs"."output_units" >= 0)
        and ("ai_runs"."cached_input_units" is null or "ai_runs"."cached_input_units" >= 0)
        and ("ai_runs"."reasoning_units" is null or "ai_runs"."reasoning_units" >= 0)
        and ("ai_runs"."total_units" is null or "ai_runs"."total_units" >= 0)),
	CONSTRAINT "ai_runs_cost_check" CHECK ("ai_runs"."estimated_cost_micros" is null or "ai_runs"."estimated_cost_micros" >= 0),
	CONSTRAINT "ai_runs_cost_currency_check" CHECK ("ai_runs"."cost_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "ai_runs_attempt_no_check" CHECK ("ai_runs"."attempt_no" > 0),
	CONSTRAINT "ai_runs_failure_category_check" CHECK ("ai_runs"."failure_category" is null
        or "ai_runs"."failure_category" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'),
	CONSTRAINT "ai_runs_knowledge_manifest_check" CHECK (jsonb_typeof("ai_runs"."knowledge_manifest_jsonb") = 'object'
        and pg_column_size("ai_runs"."knowledge_manifest_jsonb") <= 65536),
	CONSTRAINT "ai_runs_input_hash_check" CHECK (octet_length("ai_runs"."input_hash") between 16 and 128),
	CONSTRAINT "ai_runs_output_hash_check" CHECK ("ai_runs"."output_hash" is null or octet_length("ai_runs"."output_hash") between 16 and 128),
	CONSTRAINT "ai_runs_snapshot_ciphertext_check" CHECK (("ai_runs"."input_snapshot_ciphertext" is null
          or octet_length("ai_runs"."input_snapshot_ciphertext") between 1 and 65536)
        and ("ai_runs"."output_snapshot_ciphertext" is null
          or octet_length("ai_runs"."output_snapshot_ciphertext") between 1 and 65536)),
	CONSTRAINT "ai_runs_snapshot_capture_policy_check" CHECK (("ai_runs"."input_snapshot_ciphertext" is null
          and "ai_runs"."output_snapshot_ciphertext" is null
          and "ai_runs"."snapshot_capture_policy_id" is null)
        or (("ai_runs"."input_snapshot_ciphertext" is not null
            or "ai_runs"."output_snapshot_ciphertext" is not null)
          and "ai_runs"."snapshot_capture_policy_id" is not null)),
	CONSTRAINT "ai_runs_validation_order_check" CHECK ("ai_runs"."policy_allowed" is null or "ai_runs"."schema_valid" is true),
	CONSTRAINT "ai_runs_lifecycle_check" CHECK (("ai_runs"."status" = 'started'
          and "ai_runs"."finished_at" is null
          and "ai_runs"."latency_ms" is null)
        or ("ai_runs"."status" <> 'started'
          and "ai_runs"."finished_at" is not null
          and "ai_runs"."finished_at" >= "ai_runs"."started_at"
          and "ai_runs"."latency_ms" >= 0)),
	CONSTRAINT "ai_runs_outcome_shape_check" CHECK (("ai_runs"."status" = 'succeeded'
          and "ai_runs"."schema_valid" is true
          and "ai_runs"."policy_allowed" is true
          and "ai_runs"."provider_resolved_model_id" is not null
          and "ai_runs"."output_hash" is not null
          and "ai_runs"."failure_category" is null)
        or ("ai_runs"."status" = 'schema_rejected'
          and "ai_runs"."schema_valid" is false
          and "ai_runs"."policy_allowed" is null
          and "ai_runs"."provider_resolved_model_id" is not null
          and "ai_runs"."output_hash" is not null)
        or ("ai_runs"."status" = 'policy_denied'
          and "ai_runs"."schema_valid" is true
          and "ai_runs"."policy_allowed" is false
          and "ai_runs"."provider_resolved_model_id" is not null
          and "ai_runs"."output_hash" is not null)
        or ("ai_runs"."status" = 'failed' and "ai_runs"."failure_category" is not null)
        or "ai_runs"."status" in ('started', 'stale'))
);
--> statement-breakpoint
ALTER TABLE "ai_action_evaluations" ADD CONSTRAINT "ai_action_evaluations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ai_action_evaluations" ADD CONSTRAINT "ai_action_evaluations_ai_run_fk" FOREIGN KEY ("organization_id","ai_run_id") REFERENCES "public"."ai_runs"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversations"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_trigger_message_fk" FOREIGN KEY ("organization_id","conversation_id","trigger_message_id") REFERENCES "public"."messages"("organization_id","conversation_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_snapshot_capture_policy_fk" FOREIGN KEY ("organization_id","snapshot_capture_policy_id") REFERENCES "public"."retention_policies"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "ai_action_evaluations_org_action_validation_started_idx" ON "ai_action_evaluations" USING btree ("organization_id","action_name","validation_status","started_at");--> statement-breakpoint
CREATE INDEX "ai_runs_organization_conversation_started_idx" ON "ai_runs" USING btree ("organization_id","conversation_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_runs_organization_status_started_idx" ON "ai_runs" USING btree ("organization_id","status","started_at");--> statement-breakpoint
CREATE INDEX "ai_runs_organization_model_started_idx" ON "ai_runs" USING btree ("organization_id","requested_model_id","started_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ai_run_fk" FOREIGN KEY ("organization_id","ai_run_id") REFERENCES "public"."ai_runs"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_ai_action_evaluation_target_tenant"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	target_exists boolean;
BEGIN
	IF NEW.target_aggregate_type IS NULL THEN
		RETURN NEW;
	END IF;

	CASE NEW.target_aggregate_type
		WHEN 'conversation' THEN
			SELECT EXISTS (
				SELECT 1 FROM conversations
				WHERE organization_id = NEW.organization_id AND id = NEW.target_aggregate_id
			) INTO target_exists;
		WHEN 'appointment_request' THEN
			SELECT EXISTS (
				SELECT 1 FROM appointment_requests
				WHERE organization_id = NEW.organization_id AND id = NEW.target_aggregate_id
			) INTO target_exists;
		WHEN 'handoff' THEN
			SELECT EXISTS (
				SELECT 1 FROM handoffs
				WHERE organization_id = NEW.organization_id AND id = NEW.target_aggregate_id
			) INTO target_exists;
		ELSE
			target_exists := false;
	END CASE;

	IF NOT target_exists THEN
		RAISE foreign_key_violation
			USING CONSTRAINT = 'ai_action_evaluations_target_tenant_fk',
				MESSAGE = 'AI action evaluation target must belong to its organization';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_action_evaluations_target_tenant_trigger"
BEFORE INSERT OR UPDATE OF "organization_id", "target_aggregate_type", "target_aggregate_id"
ON "ai_action_evaluations"
FOR EACH ROW
EXECUTE FUNCTION "enforce_ai_action_evaluation_target_tenant"();
