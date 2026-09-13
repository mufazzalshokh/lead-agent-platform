CREATE OR REPLACE FUNCTION app.enforce_faq_history()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL RESTRICTED
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF current_user <> 'lead_agent_runtime' THEN
		IF TG_OP = 'DELETE' THEN
			RETURN OLD;
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'FAQ history cannot be deleted';
	END IF;

	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
		OR NEW.faq_key IS DISTINCT FROM OLD.faq_key
		OR NEW.created_at IS DISTINCT FROM OLD.created_at
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'FAQ identity and history are immutable';
	END IF;

	IF OLD.status = 'draft' AND NEW.status = 'draft' THEN
		IF NEW.version_no <= OLD.version_no
			OR NEW.effective_from IS NOT NULL
			OR NEW.effective_to IS NOT NULL
			OR NEW.published_by_user_id IS NOT NULL
		THEN
			RAISE EXCEPTION USING
				ERRCODE = '23514',
				MESSAGE = 'draft FAQ updates require a monotonic version';
		END IF;
		RETURN NEW;
	END IF;

	IF OLD.status = 'draft' AND NEW.status = 'published' THEN
		IF NEW.version_no IS DISTINCT FROM OLD.version_no
			OR NEW.service_id IS DISTINCT FROM OLD.service_id
			OR NEW.location_id IS DISTINCT FROM OLD.location_id
			OR NEW.question_i18n IS DISTINCT FROM OLD.question_i18n
			OR NEW.answer_i18n IS DISTINCT FROM OLD.answer_i18n
			OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
			OR NEW.effective_from IS NULL
			OR NEW.effective_to IS NOT NULL
			OR NEW.published_by_user_id IS NULL
		THEN
			RAISE EXCEPTION USING
				ERRCODE = '23514',
				MESSAGE = 'published FAQ facts must match the accepted draft';
		END IF;
		RETURN NEW;
	END IF;

	IF OLD.status = 'published' AND NEW.status = 'retired' THEN
		IF NEW.version_no IS DISTINCT FROM OLD.version_no
			OR NEW.service_id IS DISTINCT FROM OLD.service_id
			OR NEW.location_id IS DISTINCT FROM OLD.location_id
			OR NEW.question_i18n IS DISTINCT FROM OLD.question_i18n
			OR NEW.answer_i18n IS DISTINCT FROM OLD.answer_i18n
			OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
			OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
			OR NEW.effective_to IS NULL
			OR NEW.effective_to <= OLD.effective_from
			OR NEW.published_by_user_id IS DISTINCT FROM OLD.published_by_user_id
		THEN
			RAISE EXCEPTION USING
				ERRCODE = '23514',
				MESSAGE = 'retired FAQ history is immutable';
		END IF;
		RETURN NEW;
	END IF;

	RAISE EXCEPTION USING
		ERRCODE = '23514',
		MESSAGE = 'unsupported FAQ lifecycle transition';
END
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.enforce_faq_history()
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress;
--> statement-breakpoint
DROP TRIGGER IF EXISTS faqs_history_guard
	ON public.faqs;
--> statement-breakpoint
CREATE TRIGGER faqs_history_guard
	BEFORE UPDATE OR DELETE ON public.faqs
	FOR EACH ROW EXECUTE FUNCTION app.enforce_faq_history();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.enforce_business_policy_history()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL RESTRICTED
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
	qualification_v1_rules CONSTANT jsonb := '{
		"disqualification_reasons": [
			"service_not_offered",
			"location_not_served",
			"not_interested",
			"outside_business_scope",
			"spam_or_abuse"
		],
		"require_budget": false,
		"require_contactability": true,
		"require_medical_eligibility": false,
		"require_positive_next_step_intent": true,
		"require_preferred_time": false,
		"require_service_interest": true,
		"require_supported_service_location": true
	}'::jsonb;
BEGIN
	IF current_user <> 'lead_agent_runtime' THEN
		IF TG_OP = 'DELETE' THEN
			RETURN OLD;
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'INSERT' THEN
		IF NEW.policy_type <> 'qualification'
			OR NEW.schema_version <> 1
			OR NEW.rules_jsonb <> qualification_v1_rules
		THEN
			RAISE EXCEPTION USING
				ERRCODE = '23514',
				MESSAGE = 'only Qualification Policy V1 is mutable in S7';
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'Business Policy history cannot be deleted';
	END IF;

	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
		OR NEW.policy_key IS DISTINCT FROM OLD.policy_key
		OR NEW.policy_type IS DISTINCT FROM OLD.policy_type
		OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
		OR NEW.created_at IS DISTINCT FROM OLD.created_at
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'Business Policy identity and schema are immutable';
	END IF;

	IF NEW.policy_type <> 'qualification'
		OR NEW.schema_version <> 1
		OR NEW.rules_jsonb <> qualification_v1_rules
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'only Qualification Policy V1 is mutable in S7';
	END IF;

	IF OLD.status = 'draft' AND NEW.status = 'draft' THEN
		IF NEW.version_no <= OLD.version_no
			OR NEW.effective_from IS NOT NULL
			OR NEW.effective_to IS NOT NULL
			OR NEW.published_by_user_id IS NOT NULL
		THEN
			RAISE EXCEPTION USING
				ERRCODE = '23514',
				MESSAGE = 'draft Business Policy updates require a monotonic version';
		END IF;
		RETURN NEW;
	END IF;

	IF OLD.status = 'draft' AND NEW.status = 'published' THEN
		IF NEW.version_no IS DISTINCT FROM OLD.version_no
			OR NEW.rules_jsonb IS DISTINCT FROM OLD.rules_jsonb
			OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
			OR NEW.effective_from IS NULL
			OR NEW.effective_to IS NOT NULL
			OR NEW.published_by_user_id IS NULL
		THEN
			RAISE EXCEPTION USING
				ERRCODE = '23514',
				MESSAGE = 'published Business Policy facts must match the accepted draft';
		END IF;
		RETURN NEW;
	END IF;

	IF OLD.status = 'published' AND NEW.status = 'retired' THEN
		IF NEW.version_no IS DISTINCT FROM OLD.version_no
			OR NEW.rules_jsonb IS DISTINCT FROM OLD.rules_jsonb
			OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
			OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
			OR NEW.effective_to IS NULL
			OR NEW.effective_to <= OLD.effective_from
			OR NEW.published_by_user_id IS DISTINCT FROM OLD.published_by_user_id
		THEN
			RAISE EXCEPTION USING
				ERRCODE = '23514',
				MESSAGE = 'retired Business Policy history is immutable';
		END IF;
		RETURN NEW;
	END IF;

	RAISE EXCEPTION USING
		ERRCODE = '23514',
		MESSAGE = 'unsupported Business Policy lifecycle transition';
END
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.enforce_business_policy_history()
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress;
--> statement-breakpoint
DROP TRIGGER IF EXISTS business_policies_history_guard
	ON public.business_policies;
--> statement-breakpoint
CREATE TRIGGER business_policies_history_guard
	BEFORE INSERT OR UPDATE OR DELETE ON public.business_policies
	FOR EACH ROW EXECUTE FUNCTION app.enforce_business_policy_history();
