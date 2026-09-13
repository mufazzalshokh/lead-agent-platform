GRANT EXECUTE ON FUNCTION public.is_bounded_locale_map(jsonb, integer)
	TO lead_agent_runtime;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.reject_location_published_history_mutation()
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
		MESSAGE = TG_TABLE_NAME || ' rows are immutable published history';
END
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.reject_location_published_history_mutation()
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress;
--> statement-breakpoint
DROP TRIGGER IF EXISTS location_versions_immutable_history
	ON public.location_versions;
--> statement-breakpoint
CREATE TRIGGER location_versions_immutable_history
	BEFORE UPDATE OR DELETE ON public.location_versions
	FOR EACH ROW EXECUTE FUNCTION app.reject_location_published_history_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS location_business_hours_immutable_history
	ON public.location_business_hours;
--> statement-breakpoint
CREATE TRIGGER location_business_hours_immutable_history
	BEFORE UPDATE OR DELETE ON public.location_business_hours
	FOR EACH ROW EXECUTE FUNCTION app.reject_location_published_history_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.enforce_location_closure_history()
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
			MESSAGE = 'location closure history cannot be deleted';
	END IF;

	IF OLD.status <> 'active'
		OR NEW.status NOT IN ('superseded', 'cancelled')
		OR NEW.id IS DISTINCT FROM OLD.id
		OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
		OR NEW.location_id IS DISTINCT FROM OLD.location_id
		OR NEW.local_date IS DISTINCT FROM OLD.local_date
		OR NEW.kind IS DISTINCT FROM OLD.kind
		OR NEW.opens_at_local IS DISTINCT FROM OLD.opens_at_local
		OR NEW.closes_at_local IS DISTINCT FROM OLD.closes_at_local
		OR NEW.reason_i18n IS DISTINCT FROM OLD.reason_i18n
		OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
		OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
		OR NEW.created_at IS DISTINCT FROM OLD.created_at
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'location closure facts and terminal history are immutable';
	END IF;

	RETURN NEW;
END
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.enforce_location_closure_history()
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress;
--> statement-breakpoint
DROP TRIGGER IF EXISTS location_closures_history_guard
	ON public.location_closures;
--> statement-breakpoint
CREATE TRIGGER location_closures_history_guard
	BEFORE UPDATE OR DELETE ON public.location_closures
	FOR EACH ROW EXECUTE FUNCTION app.enforce_location_closure_history();
