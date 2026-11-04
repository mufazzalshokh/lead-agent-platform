CREATE FUNCTION app.replace_widget_inbound_route(
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
    inserted_rows integer;
    changed_at timestamptz := clock_timestamp();
BEGIN
    IF tenant_id IS NULL OR input_route_id IS NULL
       OR input_route_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR input_route_key_hash IS NULL OR octet_length(input_route_key_hash) <> 32
       OR NOT EXISTS (
           SELECT 1 FROM public.channel_connections
           WHERE organization_id = tenant_id AND id = input_channel_connection_id
             AND channel_type = 'widget' AND status = 'active'
       ) THEN
        RETURN false;
    END IF;

    UPDATE public.inbound_routes
    SET status = 'disabled', rotated_at = changed_at
    WHERE organization_id = tenant_id
      AND channel_connection_id = input_channel_connection_id
      AND route_type = 'widget_key' AND status = 'active';

    INSERT INTO public.inbound_routes
        (id, route_type, route_key_hash, organization_id, channel_connection_id,
         status, rotated_at, created_at)
    VALUES (input_route_id, 'widget_key', input_route_key_hash, tenant_id,
            input_channel_connection_id, 'active', NULL, changed_at)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS inserted_rows = ROW_COUNT;
    RETURN inserted_rows = 1;
EXCEPTION WHEN unique_violation THEN
    RETURN false;
END
$function$;
--> statement-breakpoint
CREATE FUNCTION app.has_active_widget_inbound_route(input_channel_connection_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.inbound_routes AS route
        JOIN public.channel_connections AS connection
          ON connection.organization_id = route.organization_id
         AND connection.id = route.channel_connection_id
        WHERE route.organization_id = app.current_organization_id()
          AND route.channel_connection_id = input_channel_connection_id
          AND route.route_type = 'widget_key'
          AND route.status = 'active'
          AND connection.channel_type = 'widget'
          AND connection.status = 'active'
    )
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.replace_widget_inbound_route(uuid, uuid, bytea),
    app.has_active_widget_inbound_route(uuid)
FROM PUBLIC, lead_agent_ingress, lead_agent_auth, lead_agent_queue_runtime;
--> statement-breakpoint
GRANT lead_agent_inbound_route_definer TO CURRENT_USER WITH INHERIT FALSE;
--> statement-breakpoint
GRANT lead_agent_inbound_route_definer TO CURRENT_USER WITH SET TRUE;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA app TO lead_agent_inbound_route_definer;
--> statement-breakpoint
ALTER FUNCTION app.replace_widget_inbound_route(uuid, uuid, bytea)
    OWNER TO lead_agent_inbound_route_definer;
--> statement-breakpoint
ALTER FUNCTION app.has_active_widget_inbound_route(uuid)
    OWNER TO lead_agent_inbound_route_definer;
--> statement-breakpoint
SET ROLE lead_agent_inbound_route_definer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.replace_widget_inbound_route(uuid, uuid, bytea),
    app.has_active_widget_inbound_route(uuid)
TO lead_agent_runtime;
--> statement-breakpoint
RESET ROLE;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM lead_agent_inbound_route_definer;
--> statement-breakpoint
GRANT lead_agent_inbound_route_definer TO CURRENT_USER WITH SET FALSE;
