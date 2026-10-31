DO $role_provisioning$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_catalog.pg_roles
		WHERE rolname = 'lead_agent_first_tenant_bootstrap_definer'
	) THEN
		CREATE ROLE lead_agent_first_tenant_bootstrap_definer NOLOGIN;
	END IF;
END
$role_provisioning$;
--> statement-breakpoint
ALTER ROLE lead_agent_first_tenant_bootstrap_definer
	NOLOGIN NOINHERIT NOCREATEDB NOCREATEROLE;
--> statement-breakpoint
DO $role_security$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_catalog.pg_roles
		WHERE rolname = 'lead_agent_first_tenant_bootstrap_definer'
			AND (rolsuper OR rolreplication OR rolbypassrls)
	) THEN
		RAISE EXCEPTION 'Lead Agent first-tenant bootstrap definer must not hold restricted PostgreSQL privileges';
	END IF;
END
$role_security$;
--> statement-breakpoint
REVOKE lead_agent_first_tenant_bootstrap_definer
	FROM lead_agent_runtime, lead_agent_auth, lead_agent_ingress,
		lead_agent_queue_runtime, lead_agent_identity_definer,
		lead_agent_membership_definer, lead_agent_inbound_route_definer;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
	FROM lead_agent_first_tenant_bootstrap_definer;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
	FROM lead_agent_first_tenant_bootstrap_definer;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public
	FROM lead_agent_first_tenant_bootstrap_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public, app
	FROM lead_agent_first_tenant_bootstrap_definer;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public, app
	TO lead_agent_first_tenant_bootstrap_definer;
--> statement-breakpoint
GRANT SELECT, INSERT (
	id, slug, display_name, status, default_locale, default_time_zone,
	current_retention_policy_id, created_at, updated_at, version, closed_at
) ON TABLE public.organizations TO lead_agent_first_tenant_bootstrap_definer;
--> statement-breakpoint
GRANT SELECT, INSERT (
	id, email_ciphertext, email_lookup_hash, display_name_ciphertext, status,
	last_authenticated_at, created_at, updated_at, version
) ON TABLE public.users TO lead_agent_first_tenant_bootstrap_definer;
--> statement-breakpoint
GRANT SELECT, INSERT (
	id, user_id, issuer, subject, status, linked_at, last_authenticated_at,
	disabled_at, unlinked_at, created_at, updated_at, version
) ON TABLE public.external_identities TO lead_agent_first_tenant_bootstrap_definer;
--> statement-breakpoint
GRANT SELECT, INSERT (
	id, organization_id, user_id, role, status, location_scope,
	invited_by_user_id, invited_at, activated_at, revoked_at,
	created_at, updated_at, version
) ON TABLE public.memberships TO lead_agent_first_tenant_bootstrap_definer;
--> statement-breakpoint
GRANT SELECT, INSERT (
	id, operator_principal_id, action, target_organization_id, target_type,
	target_id, approval_reference, reason_code, result, request_id,
	source_ip_hash, occurred_at, metadata_jsonb
) ON TABLE public.platform_audit_events TO lead_agent_first_tenant_bootstrap_definer;
--> statement-breakpoint
DROP POLICY IF EXISTS organizations_first_tenant_bootstrap_select
	ON public.organizations;
--> statement-breakpoint
CREATE POLICY organizations_first_tenant_bootstrap_select
	ON public.organizations
	FOR SELECT
	TO lead_agent_first_tenant_bootstrap_definer
	USING (true);
--> statement-breakpoint
DROP POLICY IF EXISTS organizations_first_tenant_bootstrap_insert
	ON public.organizations;
--> statement-breakpoint
CREATE POLICY organizations_first_tenant_bootstrap_insert
	ON public.organizations
	FOR INSERT
	TO lead_agent_first_tenant_bootstrap_definer
	WITH CHECK (
		id = '01a0ee39-91a9-7293-82c0-5b7046c10115'::uuid
		AND slug = 'lead-agent-staging'
		AND display_name = 'Lead Agent Staging'
		AND status = 'active'
		AND default_locale = 'uz'
		AND default_time_zone = 'Asia/Tashkent'
		AND current_retention_policy_id IS NULL
		AND closed_at IS NULL
		AND version = 1
	);
--> statement-breakpoint
DROP POLICY IF EXISTS memberships_first_tenant_bootstrap_select
	ON public.memberships;
--> statement-breakpoint
CREATE POLICY memberships_first_tenant_bootstrap_select
	ON public.memberships
	FOR SELECT
	TO lead_agent_first_tenant_bootstrap_definer
	USING (true);
--> statement-breakpoint
DROP POLICY IF EXISTS memberships_first_tenant_bootstrap_insert
	ON public.memberships;
--> statement-breakpoint
CREATE POLICY memberships_first_tenant_bootstrap_insert
	ON public.memberships
	FOR INSERT
	TO lead_agent_first_tenant_bootstrap_definer
	WITH CHECK (
		id = '01a0ee39-91b0-72c2-a2bb-f45d5bcc3ee4'::uuid
		AND organization_id = '01a0ee39-91a9-7293-82c0-5b7046c10115'::uuid
		AND user_id = '01a0ee39-91af-7bfa-945f-b87959be6f0b'::uuid
		AND role = 'owner'
		AND status = 'active'
		AND location_scope = 'all'
		AND invited_by_user_id IS NULL
		AND invited_at IS NULL
		AND activated_at IS NOT NULL
		AND revoked_at IS NULL
		AND version = 1
	);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.bootstrap_first_staging_owner(
	p_issuer character varying,
	p_subject character varying
)
RETURNS TABLE (
	outcome text,
	organization_id uuid,
	user_id uuid,
	membership_id uuid,
	membership_status character varying,
	membership_role character varying,
	audit_event_id uuid
)
LANGUAGE plpgsql
VOLATILE
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
ROWS 1
AS $function$
DECLARE
	v_now timestamp with time zone := pg_catalog.statement_timestamp();
	v_organization_id constant uuid := '01a0ee39-91a9-7293-82c0-5b7046c10115'::uuid;
	v_user_id constant uuid := '01a0ee39-91af-7bfa-945f-b87959be6f0b'::uuid;
	v_external_identity_id constant uuid := '01a0ee39-91af-7d4c-baf2-9a28dc854028'::uuid;
	v_membership_id constant uuid := '01a0ee39-91b0-72c2-a2bb-f45d5bcc3ee4'::uuid;
	v_audit_id constant uuid := '01a0ee39-91b0-7cb5-9bb6-bc34d73137f2'::uuid;
	v_operator_principal_id constant uuid := '01a0ee39-91b0-75da-a654-2042586c8f56'::uuid;
BEGIN
	IF p_issuer IS NULL
		OR p_issuer <> pg_catalog.btrim(p_issuer)
		OR pg_catalog.char_length(p_issuer) NOT BETWEEN 9 AND 2048
		OR p_issuer !~ '^https://[A-Za-z0-9.-]+/$'
		OR p_subject IS NULL
		OR p_subject !~ '^google-oauth2\|[0-9]{1,128}$'
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '22023',
			MESSAGE = 'Invalid first-tenant identity input';
	END IF;

	PERFORM pg_catalog.pg_advisory_xact_lock(721773420220030::bigint);

	IF (SELECT pg_catalog.count(*) FROM public.organizations) <> 0
		OR (SELECT pg_catalog.count(*) FROM public.users) <> 0
		OR (SELECT pg_catalog.count(*) FROM public.external_identities) <> 0
		OR (SELECT pg_catalog.count(*) FROM public.memberships) <> 0
	THEN
		RAISE EXCEPTION USING
			ERRCODE = 'P0001',
			MESSAGE = 'First-tenant bootstrap is not eligible',
			DETAIL = 'S22_BOOTSTRAP_NOT_EMPTY';
	END IF;

	INSERT INTO public.organizations (
		id, slug, display_name, status, default_locale, default_time_zone,
		current_retention_policy_id, created_at, updated_at, version, closed_at
	) VALUES (
		v_organization_id, 'lead-agent-staging', 'Lead Agent Staging',
		'active', 'uz', 'Asia/Tashkent', NULL, v_now, v_now, 1, NULL
	);

	INSERT INTO public.users (
		id, email_ciphertext, email_lookup_hash, display_name_ciphertext,
		status, last_authenticated_at, created_at, updated_at, version
	) VALUES (
		v_user_id, NULL, NULL, NULL, 'active', v_now, v_now, v_now, 1
	);

	INSERT INTO public.external_identities (
		id, user_id, issuer, subject, status, linked_at, last_authenticated_at,
		disabled_at, unlinked_at, created_at, updated_at, version
	) VALUES (
		v_external_identity_id, v_user_id, p_issuer, p_subject, 'active',
		v_now, v_now, NULL, NULL, v_now, v_now, 1
	);

	INSERT INTO public.memberships (
		id, organization_id, user_id, role, status, location_scope,
		invited_by_user_id, invited_at, activated_at, revoked_at,
		created_at, updated_at, version
	) VALUES (
		v_membership_id, v_organization_id, v_user_id, 'owner', 'active', 'all',
		NULL, NULL, v_now, NULL, v_now, v_now, 1
	);

	INSERT INTO public.platform_audit_events (
		id, operator_principal_id, action, target_organization_id, target_type,
		target_id, approval_reference, reason_code, result, request_id,
		source_ip_hash, occurred_at, metadata_jsonb
	) VALUES (
		v_audit_id, v_operator_principal_id, 'staging_owner_bootstrap',
		v_organization_id, 'membership', v_membership_id,
		'S22_OWNER_WORKSPACE_BOOTSTRAP_2026-09-29',
		'staging_owner_workspace', 'succeeded',
		'request:s22-staging-owner-bootstrap',
		pg_catalog.decode(
			'7e02f40fc2dece6ea3cc5328ba53f37bc0db17efb9d659ed08b566c3aa11fb1c',
			'hex'
		),
		v_now,
		pg_catalog.jsonb_build_object(
			'bootstrap_profile', 's22_staging_owner_workspace.v1',
			'identity_binding', 'exact_issuer_subject',
			'role', 'owner'
		)
	);

	IF (SELECT pg_catalog.count(*) FROM public.organizations) <> 1
		OR (SELECT pg_catalog.count(*) FROM public.users) <> 1
		OR (SELECT pg_catalog.count(*) FROM public.external_identities) <> 1
		OR (SELECT pg_catalog.count(*) FROM public.memberships) <> 1
		OR NOT EXISTS (
			SELECT 1
			FROM public.external_identities AS identity
			WHERE identity.id = v_external_identity_id
				AND identity.user_id = v_user_id
				AND identity.issuer = p_issuer
				AND identity.subject = p_subject
				AND identity.status = 'active'
		)
		OR NOT EXISTS (
			SELECT 1
			FROM public.memberships AS membership
			WHERE membership.id = v_membership_id
				AND membership.organization_id = v_organization_id
				AND membership.user_id = v_user_id
				AND membership.status = 'active'
				AND membership.role = 'owner'
				AND membership.location_scope = 'all'
		)
		OR NOT EXISTS (
			SELECT 1
			FROM public.platform_audit_events AS audit
			WHERE audit.id = v_audit_id
				AND audit.target_organization_id = v_organization_id
				AND audit.target_id = v_membership_id
				AND audit.action = 'staging_owner_bootstrap'
				AND audit.result = 'succeeded'
		)
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'First-tenant bootstrap postcondition failed';
	END IF;

	RETURN QUERY SELECT
		'created'::text,
		v_organization_id,
		v_user_id,
		v_membership_id,
		'active'::character varying,
		'owner'::character varying,
		v_audit_id;
END
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.bootstrap_first_staging_owner(
	character varying, character varying
) FROM PUBLIC, lead_agent_runtime, lead_agent_auth, lead_agent_ingress,
	lead_agent_queue_runtime, lead_agent_identity_definer,
	lead_agent_membership_definer, lead_agent_inbound_route_definer;
--> statement-breakpoint
GRANT lead_agent_first_tenant_bootstrap_definer TO CURRENT_USER WITH INHERIT FALSE;
--> statement-breakpoint
GRANT lead_agent_first_tenant_bootstrap_definer TO CURRENT_USER WITH SET TRUE;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA app TO lead_agent_first_tenant_bootstrap_definer;
--> statement-breakpoint
ALTER FUNCTION app.bootstrap_first_staging_owner(
	character varying, character varying
) OWNER TO lead_agent_first_tenant_bootstrap_definer;
--> statement-breakpoint
SET ROLE lead_agent_first_tenant_bootstrap_definer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.bootstrap_first_staging_owner(
	character varying, character varying
) TO SESSION_USER;
--> statement-breakpoint
RESET ROLE;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM lead_agent_first_tenant_bootstrap_definer;
--> statement-breakpoint
GRANT lead_agent_first_tenant_bootstrap_definer TO CURRENT_USER WITH SET FALSE;
