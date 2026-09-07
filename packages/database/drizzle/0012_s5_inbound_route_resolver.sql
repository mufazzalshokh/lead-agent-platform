GRANT USAGE ON SCHEMA app TO lead_agent_ingress;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA app
	FROM lead_agent_runtime, lead_agent_ingress, lead_agent_inbound_route_definer;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.resolve_inbound_route(
	input_route_type character varying,
	input_route_key_hash bytea
)
RETURNS TABLE (
	organization_id uuid,
	channel_connection_id uuid
)
LANGUAGE sql
STABLE
STRICT
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
ROWS 1
AS $function$
	SELECT route.organization_id, route.channel_connection_id
	FROM public.inbound_routes AS route
	WHERE route.route_type = input_route_type
		AND route.route_key_hash = input_route_key_hash
		AND route.status = 'active'
		AND input_route_type IN ('widget_key', 'telegram_webhook')
		AND pg_catalog.octet_length(input_route_key_hash) > 0
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.resolve_inbound_route(character varying, bytea)
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.resolve_inbound_route(character varying, bytea)
	TO lead_agent_ingress;
--> statement-breakpoint
ALTER FUNCTION app.resolve_inbound_route(character varying, bytea)
	OWNER TO lead_agent_inbound_route_definer;
