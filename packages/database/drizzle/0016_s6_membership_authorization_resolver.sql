GRANT USAGE ON SCHEMA public, app TO lead_agent_identity_definer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_organization_id() TO lead_agent_identity_definer;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public.memberships, public.membership_location_scopes
	FROM lead_agent_auth, lead_agent_identity_definer;
--> statement-breakpoint
GRANT SELECT (id, organization_id, user_id, role, status, location_scope)
	ON TABLE public.memberships TO lead_agent_identity_definer;
--> statement-breakpoint
GRANT SELECT (organization_id, membership_id, location_id)
	ON TABLE public.membership_location_scopes TO lead_agent_identity_definer;
--> statement-breakpoint
DROP POLICY IF EXISTS memberships_authorization_resolution ON public.memberships;
--> statement-breakpoint
CREATE POLICY memberships_authorization_resolution ON public.memberships
	FOR SELECT
	TO lead_agent_identity_definer
	USING (organization_id = app.current_organization_id());
--> statement-breakpoint
DROP POLICY IF EXISTS membership_location_scopes_authorization_resolution
	ON public.membership_location_scopes;
--> statement-breakpoint
CREATE POLICY membership_location_scopes_authorization_resolution
	ON public.membership_location_scopes
	FOR SELECT
	TO lead_agent_identity_definer
	USING (organization_id = app.current_organization_id());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.resolve_membership_authorization(
	input_user_id uuid,
	input_organization_id uuid
)
RETURNS TABLE (
	resolution_state text,
	membership_id uuid,
	organization_id uuid,
	user_id uuid,
	status character varying,
	role character varying,
	location_scope character varying,
	allowed_location_ids uuid[]
)
LANGUAGE plpgsql
VOLATILE
STRICT
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
ROWS 1
AS $function$
BEGIN
	PERFORM pg_catalog.set_config('app.organization_id', input_organization_id::text, true);

	RETURN QUERY
	SELECT
		'authorized'::text,
		membership.id,
		membership.organization_id,
		membership.user_id,
		membership.status,
		membership.role,
		membership.location_scope,
		CASE
			WHEN membership.location_scope = 'restricted' THEN
				COALESCE(
					pg_catalog.array_agg(scope.location_id ORDER BY scope.location_id)
						FILTER (WHERE scope.location_id IS NOT NULL),
					ARRAY[]::uuid[]
				)
			ELSE ARRAY[]::uuid[]
		END
	FROM public.memberships AS membership
	LEFT JOIN public.membership_location_scopes AS scope
		ON scope.organization_id = membership.organization_id
		AND scope.membership_id = membership.id
		AND membership.location_scope = 'restricted'
	WHERE membership.user_id = input_user_id
		AND membership.organization_id = input_organization_id
		AND membership.status = 'active'
	GROUP BY
		membership.id,
		membership.organization_id,
		membership.user_id,
		membership.status,
		membership.role,
		membership.location_scope;
END
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.resolve_membership_authorization(uuid, uuid)
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress,
		lead_agent_inbound_route_definer, lead_agent_auth;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.resolve_membership_authorization(uuid, uuid)
	TO lead_agent_auth;
--> statement-breakpoint
ALTER FUNCTION app.resolve_membership_authorization(uuid, uuid)
	OWNER TO lead_agent_identity_definer;
