CREATE OR REPLACE FUNCTION app.reject_service_published_history_mutation()
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

	RAISE EXCEPTION USING
		ERRCODE = '23514',
		MESSAGE = 'service versions are immutable published history';
END
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.reject_service_published_history_mutation()
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress;
--> statement-breakpoint
DROP TRIGGER IF EXISTS service_versions_immutable_history
	ON public.service_versions;
--> statement-breakpoint
CREATE TRIGGER service_versions_immutable_history
	BEFORE UPDATE OR DELETE ON public.service_versions
	FOR EACH ROW EXECUTE FUNCTION app.reject_service_published_history_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.enforce_service_location_history()
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
			MESSAGE = 'service/location history cannot be deleted';
	END IF;

	IF OLD.status <> 'active'
		OR NEW.status <> 'inactive'
		OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
		OR NEW.service_id IS DISTINCT FROM OLD.service_id
		OR NEW.location_id IS DISTINCT FROM OLD.location_id
		OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
		OR NEW.effective_to IS NULL
		OR NEW.effective_to <= OLD.effective_from
		OR NEW.created_at IS DISTINCT FROM OLD.created_at
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'service/location facts and terminal history are immutable';
	END IF;

	RETURN NEW;
END
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.enforce_service_location_history()
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress;
--> statement-breakpoint
DROP TRIGGER IF EXISTS service_locations_history_guard
	ON public.service_locations;
--> statement-breakpoint
CREATE TRIGGER service_locations_history_guard
	BEFORE UPDATE OR DELETE ON public.service_locations
	FOR EACH ROW EXECUTE FUNCTION app.enforce_service_location_history();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.enforce_service_price_history()
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
			MESSAGE = 'service price history cannot be deleted';
	END IF;

	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
		OR NEW.service_id IS DISTINCT FROM OLD.service_id
		OR NEW.created_at IS DISTINCT FROM OLD.created_at
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'service price identity and history are immutable';
	END IF;

	IF OLD.status = 'draft' AND NEW.status = 'draft' THEN
		IF NEW.version_no <= OLD.version_no
			OR NEW.effective_from IS NOT NULL
			OR NEW.effective_to IS NOT NULL
			OR NEW.published_by_user_id IS NOT NULL
		THEN
			RAISE EXCEPTION USING
				ERRCODE = '23514',
				MESSAGE = 'draft service price updates require a monotonic version';
		END IF;
		RETURN NEW;
	END IF;

	IF OLD.status = 'draft' AND NEW.status = 'published' THEN
		IF NEW.location_id IS DISTINCT FROM OLD.location_id
			OR NEW.price_type IS DISTINCT FROM OLD.price_type
			OR NEW.currency IS DISTINCT FROM OLD.currency
			OR NEW.min_amount_minor IS DISTINCT FROM OLD.min_amount_minor
			OR NEW.max_amount_minor IS DISTINCT FROM OLD.max_amount_minor
			OR NEW.display_text_i18n IS DISTINCT FROM OLD.display_text_i18n
			OR NEW.version_no IS DISTINCT FROM OLD.version_no
			OR NEW.effective_from IS NULL
			OR NEW.effective_to IS NOT NULL
			OR NEW.published_by_user_id IS NULL
		THEN
			RAISE EXCEPTION USING
				ERRCODE = '23514',
				MESSAGE = 'published service price facts must match the accepted draft';
		END IF;
		RETURN NEW;
	END IF;

	IF OLD.status = 'published' AND NEW.status = 'retired' THEN
		IF NEW.location_id IS DISTINCT FROM OLD.location_id
			OR NEW.price_type IS DISTINCT FROM OLD.price_type
			OR NEW.currency IS DISTINCT FROM OLD.currency
			OR NEW.min_amount_minor IS DISTINCT FROM OLD.min_amount_minor
			OR NEW.max_amount_minor IS DISTINCT FROM OLD.max_amount_minor
			OR NEW.display_text_i18n IS DISTINCT FROM OLD.display_text_i18n
			OR NEW.version_no IS DISTINCT FROM OLD.version_no
			OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
			OR NEW.effective_to IS NULL
			OR NEW.effective_to <= OLD.effective_from
			OR NEW.published_by_user_id IS DISTINCT FROM OLD.published_by_user_id
		THEN
			RAISE EXCEPTION USING
				ERRCODE = '23514',
				MESSAGE = 'retired service price history is immutable';
		END IF;
		RETURN NEW;
	END IF;

	RAISE EXCEPTION USING
		ERRCODE = '23514',
		MESSAGE = 'unsupported service price lifecycle transition';
END
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.enforce_service_price_history()
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress;
--> statement-breakpoint
DROP TRIGGER IF EXISTS service_prices_history_guard
	ON public.service_prices;
--> statement-breakpoint
CREATE TRIGGER service_prices_history_guard
	BEFORE UPDATE OR DELETE ON public.service_prices
	FOR EACH ROW EXECUTE FUNCTION app.enforce_service_price_history();
