DO $role$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'lead_agent_signup_definer') THEN
		CREATE ROLE lead_agent_signup_definer NOLOGIN NOINHERIT NOCREATEDB NOCREATEROLE;
	END IF;
END
$role$;
--> statement-breakpoint
ALTER ROLE lead_agent_signup_definer NOLOGIN NOINHERIT NOCREATEDB NOCREATEROLE;
--> statement-breakpoint
DO $role_security$
BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_catalog.pg_roles
		WHERE rolname = 'lead_agent_signup_definer' AND (rolsuper OR rolreplication OR rolbypassrls)
	) THEN
		RAISE EXCEPTION 'First-owner registration definer cannot hold restricted PostgreSQL privileges';
	END IF;
END
$role_security$;
--> statement-breakpoint
REVOKE lead_agent_signup_definer FROM lead_agent_auth, lead_agent_runtime, lead_agent_ingress;
--> statement-breakpoint
CREATE TABLE app.first_owner_registrations (
	external_identity_id uuid PRIMARY KEY REFERENCES public.external_identities (id),
	organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations (id)
);
--> statement-breakpoint
REVOKE ALL ON app.first_owner_registrations FROM PUBLIC, lead_agent_auth, lead_agent_runtime, lead_agent_ingress;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public, app TO lead_agent_signup_definer;
--> statement-breakpoint
GRANT SELECT, INSERT ON app.first_owner_registrations TO lead_agent_signup_definer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_organization_id() TO lead_agent_signup_definer;
--> statement-breakpoint
GRANT SELECT (id, status), INSERT (id, slug, display_name, status, default_locale, default_time_zone)
	ON public.organizations TO lead_agent_signup_definer;
--> statement-breakpoint
GRANT SELECT (id, status), INSERT (id, status) ON public.users TO lead_agent_signup_definer;
--> statement-breakpoint
GRANT SELECT (id, user_id, issuer, subject, status), INSERT (id, user_id, issuer, subject, status, linked_at)
	ON public.external_identities TO lead_agent_signup_definer;
--> statement-breakpoint
GRANT SELECT (organization_id, user_id, role, status),
	INSERT (id, organization_id, user_id, role, status, location_scope, activated_at)
	ON public.memberships TO lead_agent_signup_definer;
--> statement-breakpoint
GRANT INSERT (id, organization_id, event_type, actor_type, actor_id, actor_membership_id,
	target_type, target_id, action, result, request_id, trace_id, correlation_id, occurred_at)
	ON public.audit_events TO lead_agent_signup_definer;
--> statement-breakpoint
CREATE POLICY organizations_first_owner_signup ON public.organizations
	TO lead_agent_signup_definer
	USING (id = app.current_organization_id())
	WITH CHECK (id = app.current_organization_id());
--> statement-breakpoint
CREATE POLICY memberships_first_owner_signup ON public.memberships
	TO lead_agent_signup_definer
	USING (organization_id = app.current_organization_id())
	WITH CHECK (organization_id = app.current_organization_id() AND role = 'owner' AND status = 'active');
--> statement-breakpoint
CREATE POLICY audit_first_owner_signup ON public.audit_events
	FOR INSERT TO lead_agent_signup_definer
	WITH CHECK (organization_id = app.current_organization_id());
--> statement-breakpoint
CREATE FUNCTION app.register_first_owner(
	p_issuer varchar, p_subject varchar, p_display_name varchar, p_locale varchar, p_time_zone varchar,
	p_workspace_id uuid, p_user_id uuid, p_identity_id uuid, p_membership_id uuid,
	p_audit_id uuid, p_request_id varchar, p_correlation_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
	v_identity record;
	v_workspace_id uuid;
	v_owner_active boolean;
	-- Keep the custom tenant setting out of function DDL for restricted migrators.
	v_caller_organization_id text := pg_catalog.current_setting('app.organization_id', true);
BEGIN
	-- Share the identity lock with invitation acceptance so either flow can safely win.
	IF p_workspace_id IS NOT NULL THEN
		PERFORM pg_catalog.pg_advisory_xact_lock(
			pg_catalog.hashtextextended(p_issuer || pg_catalog.chr(31) || p_subject, 66007)
		);
	END IF;
	SELECT identity.id, identity.user_id, identity.status, application_user.status AS user_status
		INTO v_identity
		FROM public.external_identities AS identity
		JOIN public.users AS application_user ON application_user.id = identity.user_id
		WHERE identity.issuer = p_issuer AND identity.subject = p_subject;
	IF FOUND THEN
		IF v_identity.status <> 'active' OR v_identity.user_status <> 'active' THEN
			RETURN NULL;
		END IF;
		SELECT registration.organization_id INTO v_workspace_id
			FROM app.first_owner_registrations AS registration
			WHERE registration.external_identity_id = v_identity.id;
		IF NOT FOUND THEN
			RETURN NULL;
		END IF;
		PERFORM pg_catalog.set_config('app.organization_id', v_workspace_id::text, true);
		SELECT EXISTS (
			SELECT 1 FROM public.organizations AS organization
			JOIN public.memberships AS membership ON membership.organization_id = organization.id
			WHERE organization.id = v_workspace_id AND organization.status = 'active'
				AND membership.user_id = v_identity.user_id AND membership.status = 'active'
				AND membership.role = 'owner'
		) INTO v_owner_active;
		PERFORM pg_catalog.set_config('app.organization_id', COALESCE(v_caller_organization_id, ''), true);
		RETURN CASE WHEN v_owner_active THEN v_workspace_id ELSE NULL END;
	END IF;
	-- Ordinary sign-in only resolves a workspace created by this flow.
	IF p_workspace_id IS NULL THEN
		RETURN NULL;
	END IF;

	-- The workspace ID is freshly minted by the trusted auth runtime. A conflict aborts
	-- the transaction before any membership can be attached to an existing tenant.
	PERFORM pg_catalog.set_config('app.organization_id', p_workspace_id::text, true);
	INSERT INTO public.organizations (id, slug, display_name, status, default_locale, default_time_zone)
		VALUES (p_workspace_id, 'clinic-' || p_workspace_id::text, pg_catalog.btrim(p_display_name),
			'active', p_locale, p_time_zone);
	INSERT INTO public.users (id, status) VALUES (p_user_id, 'active');
	INSERT INTO public.external_identities (id, user_id, issuer, subject, status, linked_at)
		VALUES (p_identity_id, p_user_id, p_issuer, p_subject, 'active', pg_catalog.now());
	INSERT INTO public.memberships (id, organization_id, user_id, role, status, location_scope, activated_at)
		VALUES (p_membership_id, p_workspace_id, p_user_id, 'owner', 'active', 'all', pg_catalog.now());
	INSERT INTO app.first_owner_registrations (external_identity_id, organization_id)
		VALUES (p_identity_id, p_workspace_id);
	INSERT INTO public.audit_events (id, organization_id, event_type, actor_type, actor_id,
		actor_membership_id, target_type, target_id, action, result, request_id, trace_id, correlation_id, occurred_at)
		VALUES (p_audit_id, p_workspace_id, 'organization.created', 'member', p_user_id,
			p_membership_id, 'organization', p_workspace_id, 'organization.created', 'succeeded',
			p_request_id, p_request_id, p_correlation_id, pg_catalog.now());
	PERFORM pg_catalog.set_config('app.organization_id', COALESCE(v_caller_organization_id, ''), true);
	RETURN p_workspace_id;
END
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.register_first_owner(varchar, varchar, varchar, varchar, varchar,
	uuid, uuid, uuid, uuid, uuid, varchar, uuid) FROM PUBLIC, lead_agent_runtime, lead_agent_ingress;
--> statement-breakpoint
GRANT lead_agent_signup_definer TO CURRENT_USER WITH INHERIT FALSE;
--> statement-breakpoint
GRANT lead_agent_signup_definer TO CURRENT_USER WITH SET TRUE;
--> statement-breakpoint
GRANT CREATE ON SCHEMA app TO lead_agent_signup_definer;
--> statement-breakpoint
ALTER FUNCTION app.register_first_owner(varchar, varchar, varchar, varchar, varchar,
	uuid, uuid, uuid, uuid, uuid, varchar, uuid) OWNER TO lead_agent_signup_definer;
--> statement-breakpoint
SET ROLE lead_agent_signup_definer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.register_first_owner(varchar, varchar, varchar, varchar, varchar,
	uuid, uuid, uuid, uuid, uuid, varchar, uuid) TO lead_agent_auth;
--> statement-breakpoint
RESET ROLE;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM lead_agent_signup_definer;
--> statement-breakpoint
GRANT lead_agent_signup_definer TO CURRENT_USER WITH SET FALSE;
