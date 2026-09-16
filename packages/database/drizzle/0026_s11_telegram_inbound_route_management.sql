GRANT USAGE ON SCHEMA app TO lead_agent_inbound_route_definer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_organization_id() TO lead_agent_inbound_route_definer;
--> statement-breakpoint
GRANT INSERT (id, route_type, route_key_hash, organization_id, channel_connection_id, status, rotated_at, created_at),
      UPDATE (route_key_hash, status, rotated_at)
ON TABLE public.inbound_routes TO lead_agent_inbound_route_definer;
--> statement-breakpoint
GRANT SELECT (organization_id, id, channel_type, status)
ON TABLE public.channel_connections TO lead_agent_inbound_route_definer;
--> statement-breakpoint
CREATE FUNCTION app.create_telegram_inbound_route(
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
             AND channel_type = 'telegram' AND status = 'pending'
       ) THEN
        RETURN false;
    END IF;
    INSERT INTO public.inbound_routes
        (id, route_type, route_key_hash, organization_id, channel_connection_id,
         status, rotated_at, created_at)
    VALUES (input_route_id, 'telegram_webhook', input_route_key_hash, tenant_id,
            input_channel_connection_id, 'active', NULL, clock_timestamp())
    ON CONFLICT DO NOTHING;
    -- Exact replay is safe; conflicting hashes/owners are never replaced or exposed.
    RETURN EXISTS (
        SELECT 1 FROM public.inbound_routes
        WHERE organization_id = tenant_id AND channel_connection_id = input_channel_connection_id
          AND route_type = 'telegram_webhook' AND status = 'active'
          AND route_key_hash = input_route_key_hash
    );
END
$function$;
--> statement-breakpoint
CREATE FUNCTION app.rotate_telegram_inbound_route(
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
             AND channel_type = 'telegram' AND status IN ('pending', 'active')
       ) THEN
        RETURN false;
    END IF;
    UPDATE public.inbound_routes
    SET route_key_hash = input_new_route_key_hash, rotated_at = changed_at
    WHERE organization_id = tenant_id AND channel_connection_id = input_channel_connection_id
      AND route_type = 'telegram_webhook' AND status = 'active'
      AND route_key_hash = input_expected_route_key_hash;
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows > 1 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Telegram route invariant violation';
    END IF;
    RETURN changed_rows = 1;
EXCEPTION WHEN unique_violation THEN
    RETURN false;
END
$function$;
--> statement-breakpoint
CREATE FUNCTION app.disable_telegram_inbound_route(input_channel_connection_id uuid)
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
          AND channel_type = 'telegram'
    ) THEN
        RETURN false;
    END IF;
    UPDATE public.inbound_routes SET status = 'disabled', rotated_at = clock_timestamp()
    WHERE organization_id = tenant_id AND channel_connection_id = input_channel_connection_id
      AND route_type = 'telegram_webhook' AND status = 'active';
    RETURN true;
END
$function$;
--> statement-breakpoint
ALTER FUNCTION app.create_telegram_inbound_route(uuid, uuid, bytea) OWNER TO lead_agent_inbound_route_definer;
--> statement-breakpoint
ALTER FUNCTION app.rotate_telegram_inbound_route(uuid, bytea, bytea) OWNER TO lead_agent_inbound_route_definer;
--> statement-breakpoint
ALTER FUNCTION app.disable_telegram_inbound_route(uuid) OWNER TO lead_agent_inbound_route_definer;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.create_telegram_inbound_route(uuid, uuid, bytea),
    app.rotate_telegram_inbound_route(uuid, bytea, bytea),
    app.disable_telegram_inbound_route(uuid) FROM PUBLIC, lead_agent_ingress;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_telegram_inbound_route(uuid, uuid, bytea),
    app.rotate_telegram_inbound_route(uuid, bytea, bytea),
    app.disable_telegram_inbound_route(uuid) TO lead_agent_runtime;
