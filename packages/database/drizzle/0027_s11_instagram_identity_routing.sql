ALTER TABLE "contact_identities" DROP CONSTRAINT "contact_identities_identity_type_check";--> statement-breakpoint
ALTER TABLE "inbound_routes" DROP CONSTRAINT "inbound_routes_route_type_check";--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_instagram_channel_required_check" CHECK ("contact_identities"."identity_type" <> 'instagram_user' or "contact_identities"."channel_connection_id" is not null);--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_identity_type_check" CHECK ("contact_identities"."identity_type" in ('widget_participant', 'telegram_user', 'instagram_user', 'phone', 'email'));--> statement-breakpoint
ALTER TABLE "inbound_routes" ADD CONSTRAINT "inbound_routes_route_type_check" CHECK ("inbound_routes"."route_type" in ('widget_key', 'telegram_webhook', 'instagram_webhook'));
--> statement-breakpoint
ALTER TABLE "analytics_events" DROP CONSTRAINT "analytics_events_schema_version_check";
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_schema_version_check" CHECK (("analytics_events"."event_type" in ('lead.reopened', 'contact.identity_added') and "analytics_events"."schema_version" in ('1', '2')) or ("analytics_events"."event_type" not in ('lead.reopened', 'contact.identity_added') and "analytics_events"."schema_version" = '1'));
--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_schema_version_check";
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_schema_version_check" CHECK (("outbox_events"."event_type" in ('lead.reopened', 'contact.identity_added') and "outbox_events"."schema_version" in ('1', '2')) or ("outbox_events"."event_type" not in ('lead.reopened', 'contact.identity_added') and "outbox_events"."schema_version" = '1'));
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
		AND input_route_type IN ('widget_key', 'telegram_webhook', 'instagram_webhook')
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
--> statement-breakpoint
CREATE FUNCTION app.create_instagram_inbound_route(
    input_route_id uuid,
    input_channel_connection_id uuid,
    input_route_key_hash bytea
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    tenant_id uuid := app.current_organization_id();
BEGIN
    IF tenant_id IS NULL OR input_route_id IS NULL
       OR input_route_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR input_route_key_hash IS NULL OR octet_length(input_route_key_hash) <> 32
       OR NOT EXISTS (
           SELECT 1 FROM public.channel_connections
           WHERE organization_id = tenant_id AND id = input_channel_connection_id
             AND channel_type = 'instagram' AND status = 'pending'
       ) THEN
        RETURN false;
    END IF;
    INSERT INTO public.inbound_routes
        (id, route_type, route_key_hash, organization_id, channel_connection_id,
         status, rotated_at, created_at)
    VALUES (input_route_id, 'instagram_webhook', input_route_key_hash, tenant_id,
            input_channel_connection_id, 'active', NULL, clock_timestamp())
    ON CONFLICT DO NOTHING;
    -- Exact replay is safe; conflicting hashes/owners are never replaced or exposed.
    RETURN EXISTS (
        SELECT 1 FROM public.inbound_routes
        WHERE organization_id = tenant_id AND channel_connection_id = input_channel_connection_id
          AND route_type = 'instagram_webhook' AND status = 'active'
          AND route_key_hash = input_route_key_hash
    );
END
$function$;
--> statement-breakpoint
CREATE FUNCTION app.rotate_instagram_inbound_route(
    input_channel_connection_id uuid,
    input_expected_route_key_hash bytea,
    input_new_route_key_hash bytea
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    tenant_id uuid := app.current_organization_id();
    changed_rows integer;
    changed_at timestamptz := clock_timestamp();
BEGIN
    IF tenant_id IS NULL OR input_expected_route_key_hash IS NULL
       OR input_new_route_key_hash IS NULL
       OR octet_length(input_expected_route_key_hash) <> 32
       OR octet_length(input_new_route_key_hash) <> 32
       OR input_expected_route_key_hash = input_new_route_key_hash
       OR NOT EXISTS (
           SELECT 1 FROM public.channel_connections
           WHERE organization_id = tenant_id AND id = input_channel_connection_id
             AND channel_type = 'instagram' AND status IN ('pending', 'active')
       ) THEN
        RETURN false;
    END IF;
    UPDATE public.inbound_routes
    SET route_key_hash = input_new_route_key_hash, rotated_at = changed_at
    WHERE organization_id = tenant_id AND channel_connection_id = input_channel_connection_id
      AND route_type = 'instagram_webhook' AND status = 'active'
      AND route_key_hash = input_expected_route_key_hash;
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows > 1 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Instagram route invariant violation';
    END IF;
    RETURN changed_rows = 1;
EXCEPTION WHEN unique_violation THEN
    RETURN false;
END
$function$;
--> statement-breakpoint
CREATE FUNCTION app.disable_instagram_inbound_route(input_channel_connection_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    tenant_id uuid := app.current_organization_id();
BEGIN
    IF tenant_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.channel_connections
        WHERE organization_id = tenant_id AND id = input_channel_connection_id
          AND channel_type = 'instagram'
    ) THEN
        RETURN false;
    END IF;
    UPDATE public.inbound_routes SET status = 'disabled', rotated_at = clock_timestamp()
    WHERE organization_id = tenant_id AND channel_connection_id = input_channel_connection_id
      AND route_type = 'instagram_webhook' AND status = 'active';
    RETURN true;
END
$function$;
--> statement-breakpoint
ALTER FUNCTION app.create_instagram_inbound_route(uuid, uuid, bytea) OWNER TO lead_agent_inbound_route_definer;
--> statement-breakpoint
ALTER FUNCTION app.rotate_instagram_inbound_route(uuid, bytea, bytea) OWNER TO lead_agent_inbound_route_definer;
--> statement-breakpoint
ALTER FUNCTION app.disable_instagram_inbound_route(uuid) OWNER TO lead_agent_inbound_route_definer;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.create_instagram_inbound_route(uuid, uuid, bytea),
    app.rotate_instagram_inbound_route(uuid, bytea, bytea),
    app.disable_instagram_inbound_route(uuid) FROM PUBLIC, lead_agent_ingress;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_instagram_inbound_route(uuid, uuid, bytea),
    app.rotate_instagram_inbound_route(uuid, bytea, bytea),
    app.disable_instagram_inbound_route(uuid) TO lead_agent_runtime;
