DO $role_provisioning$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_catalog.pg_roles
		WHERE rolname = 'lead_agent_membership_definer'
	) THEN
		CREATE ROLE lead_agent_membership_definer NOLOGIN;
	END IF;
END
$role_provisioning$;
--> statement-breakpoint
ALTER ROLE lead_agent_membership_definer
	NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
--> statement-breakpoint
REVOKE lead_agent_membership_definer
	FROM lead_agent_auth, lead_agent_identity_definer, lead_agent_ingress, lead_agent_runtime;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
	FROM lead_agent_membership_definer;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
	FROM lead_agent_membership_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public, app FROM lead_agent_membership_definer;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public, app TO lead_agent_membership_definer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_organization_id()
	TO lead_agent_membership_definer;
--> statement-breakpoint
GRANT SELECT (
	id, organization_id, target_ciphertext, target_lookup_hash, role,
	location_scope, status, expires_at, version
), INSERT (
	id, organization_id, target_ciphertext, target_lookup_hash, role,
	location_scope, token_hash, status, invited_by_membership_id, expires_at,
	created_at, updated_at, version
), UPDATE (
	status, accepted_at, accepted_by_user_id, revoked_at,
	revoked_by_membership_id, revocation_reason, expired_at, updated_at, version
) ON TABLE public.membership_invitations TO lead_agent_runtime;
--> statement-breakpoint
GRANT SELECT (organization_id, membership_id, location_id), INSERT (
	organization_id, membership_id, location_id, created_at, created_by_user_id
), DELETE ON TABLE public.membership_location_scopes TO lead_agent_runtime;
--> statement-breakpoint
GRANT SELECT (id, status)
	ON TABLE public.organizations TO lead_agent_membership_definer;
--> statement-breakpoint
GRANT SELECT (
	id, organization_id, target_ciphertext, target_lookup_hash, role,
	location_scope, token_hash, status, invited_by_membership_id, expires_at, version
), UPDATE (
	status, accepted_at, accepted_by_user_id, expired_at, updated_at, version
) ON TABLE public.membership_invitations TO lead_agent_membership_definer;
--> statement-breakpoint
GRANT SELECT (id, status, email_ciphertext, email_lookup_hash), UPDATE (status), INSERT (
	id, email_ciphertext, email_lookup_hash, display_name_ciphertext, status,
	last_authenticated_at, created_at, updated_at, version
) ON TABLE public.users TO lead_agent_membership_definer;
--> statement-breakpoint
GRANT SELECT (id, user_id, issuer, subject, status), UPDATE (status), INSERT (
	id, user_id, issuer, subject, status, linked_at, last_authenticated_at,
	disabled_at, unlinked_at, created_at, updated_at, version
) ON TABLE public.external_identities TO lead_agent_membership_definer;
--> statement-breakpoint
GRANT SELECT (
	id, organization_id, user_id, role, status, location_scope,
	invited_by_user_id, invited_at, activated_at, revoked_at, version
), INSERT (
	id, organization_id, user_id, role, status, location_scope,
	invited_by_user_id, invited_at, activated_at, revoked_at,
	created_at, updated_at, version
), UPDATE (
	role, status, location_scope, activated_at, revoked_at, updated_at, version
) ON TABLE public.memberships TO lead_agent_membership_definer;
--> statement-breakpoint
GRANT SELECT (user_id, status), UPDATE (status, revoked_at, revocation_reason)
	ON TABLE public.auth_sessions TO lead_agent_membership_definer;
--> statement-breakpoint
GRANT INSERT (
	id, organization_id, event_type, actor_type, actor_id, actor_membership_id,
	impersonation_session_id, support_grant_id, target_type, target_id, action,
	result, reason_code, request_id, trace_id, correlation_id, source_ip_prefix,
	user_agent_hash, metadata_redacted_jsonb, occurred_at
) ON TABLE public.audit_events TO lead_agent_membership_definer;
--> statement-breakpoint
DROP POLICY IF EXISTS organizations_membership_onboarding ON public.organizations;
--> statement-breakpoint
CREATE POLICY organizations_membership_onboarding ON public.organizations
	FOR SELECT TO lead_agent_membership_definer
	USING (id = app.current_organization_id());
--> statement-breakpoint
DROP POLICY IF EXISTS membership_invitations_onboarding_select
	ON public.membership_invitations;
--> statement-breakpoint
CREATE POLICY membership_invitations_onboarding_select
	ON public.membership_invitations
	FOR SELECT TO lead_agent_membership_definer
	USING (organization_id = app.current_organization_id());
--> statement-breakpoint
DROP POLICY IF EXISTS membership_invitations_onboarding_update
	ON public.membership_invitations;
--> statement-breakpoint
CREATE POLICY membership_invitations_onboarding_update
	ON public.membership_invitations
	FOR UPDATE TO lead_agent_membership_definer
	USING (organization_id = app.current_organization_id())
	WITH CHECK (organization_id = app.current_organization_id());
--> statement-breakpoint
DROP POLICY IF EXISTS memberships_onboarding_insert ON public.memberships;
--> statement-breakpoint
DROP POLICY IF EXISTS memberships_onboarding_select ON public.memberships;
--> statement-breakpoint
CREATE POLICY memberships_onboarding_select ON public.memberships
	FOR SELECT TO lead_agent_membership_definer
	USING (organization_id = app.current_organization_id());
--> statement-breakpoint
CREATE POLICY memberships_onboarding_insert ON public.memberships
	FOR INSERT TO lead_agent_membership_definer
	WITH CHECK (organization_id = app.current_organization_id());
--> statement-breakpoint
DROP POLICY IF EXISTS memberships_onboarding_update ON public.memberships;
--> statement-breakpoint
CREATE POLICY memberships_onboarding_update ON public.memberships
	FOR UPDATE TO lead_agent_membership_definer
	USING (organization_id = app.current_organization_id())
	WITH CHECK (organization_id = app.current_organization_id());
--> statement-breakpoint
DROP POLICY IF EXISTS audit_events_membership_onboarding_insert ON public.audit_events;
--> statement-breakpoint
CREATE POLICY audit_events_membership_onboarding_insert ON public.audit_events
	FOR INSERT TO lead_agent_membership_definer
	WITH CHECK (organization_id = app.current_organization_id());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.revoke_membership_user_sessions(
	p_membership_id uuid,
	p_reason character varying
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
STRICT
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
	v_organization_id uuid := app.current_organization_id();
	v_revoked_count integer;
	v_user_id uuid;
BEGIN
	IF v_organization_id IS NULL
		OR p_reason NOT IN ('membership_changed', 'privilege_changed')
	THEN
		RETURN 0;
	END IF;

	SELECT membership.user_id
		INTO v_user_id
		FROM public.memberships AS membership
		WHERE membership.organization_id = v_organization_id
			AND membership.id = p_membership_id;
	IF NOT FOUND THEN
		RETURN 0;
	END IF;

	PERFORM pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended(v_user_id::text, 63003)
	);
	UPDATE public.auth_sessions AS active_session
		SET status = 'revoked',
			revoked_at = pg_catalog.statement_timestamp(),
			revocation_reason = p_reason
		WHERE active_session.user_id = v_user_id
			AND active_session.status = 'active';
	GET DIAGNOSTICS v_revoked_count = ROW_COUNT;
	RETURN v_revoked_count;
END
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.revoke_membership_user_sessions(
	uuid, character varying
) FROM PUBLIC, lead_agent_auth, lead_agent_ingress, lead_agent_runtime;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.revoke_membership_user_sessions(
	uuid, character varying
) TO lead_agent_runtime;
--> statement-breakpoint
ALTER FUNCTION app.revoke_membership_user_sessions(uuid, character varying)
	OWNER TO lead_agent_membership_definer;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.accept_membership_invitation(
	p_organization_id uuid,
	p_token_hash bytea,
	p_target_lookup_hash bytea,
	p_issuer character varying,
	p_subject character varying,
	p_new_user_id uuid,
	p_new_external_identity_id uuid,
	p_new_membership_id uuid,
	p_invitation_audit_id uuid,
	p_user_audit_id uuid,
	p_identity_audit_id uuid,
	p_membership_audit_id uuid,
	p_request_id character varying,
	p_correlation_id uuid,
	p_trace_id character varying
)
RETURNS TABLE (
	outcome text,
	user_id uuid,
	membership_id uuid,
	user_created boolean,
	external_identity_created boolean,
	membership_activated boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
ROWS 1
AS $function$
DECLARE
	v_identity record;
	v_invitation record;
	v_inviter_user_id uuid;
	v_membership record;
	v_membership_activated boolean := false;
	v_new_identity boolean := false;
	v_now timestamp with time zone := pg_catalog.statement_timestamp();
	v_outcome text;
	v_user_id uuid;
BEGIN
	IF pg_catalog.octet_length(p_token_hash) <> 32
		OR pg_catalog.octet_length(p_target_lookup_hash) <> 32
		OR pg_catalog.char_length(p_issuer) NOT BETWEEN 1 AND 2048
		OR p_issuer <> pg_catalog.btrim(p_issuer)
		OR pg_catalog.char_length(p_subject) NOT BETWEEN 1 AND 512
		OR p_request_id !~ '^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,126}[A-Za-z0-9])$'
		OR (p_trace_id IS NOT NULL
			AND p_trace_id !~ '^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,126}[A-Za-z0-9])$')
	THEN
		RETURN;
	END IF;

	PERFORM pg_catalog.set_config('app.organization_id', p_organization_id::text, true);
	IF NOT EXISTS (
		SELECT 1 FROM public.organizations AS organization
		WHERE organization.id = p_organization_id AND organization.status = 'active'
	) THEN
		RETURN;
	END IF;

	SELECT invitation.id, invitation.target_ciphertext,
			invitation.target_lookup_hash, invitation.role,
			invitation.location_scope, invitation.status,
			invitation.expires_at, invitation.invited_by_membership_id
		INTO v_invitation
		FROM public.membership_invitations AS invitation
		WHERE invitation.organization_id = p_organization_id
			AND invitation.token_hash = p_token_hash
		FOR UPDATE;
	IF NOT FOUND THEN
		RETURN;
	END IF;
	IF v_invitation.status <> 'active' THEN
		RETURN;
	END IF;
	IF v_invitation.expires_at <= v_now THEN
		UPDATE public.membership_invitations AS expired_invitation
			SET status = 'expired', expired_at = v_now,
				updated_at = v_now, version = expired_invitation.version + 1
			WHERE expired_invitation.organization_id = p_organization_id
				AND expired_invitation.id = v_invitation.id;
		RETURN;
	END IF;
	IF v_invitation.target_lookup_hash <> p_target_lookup_hash THEN
		RETURN;
	END IF;

	PERFORM pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended(p_issuer || pg_catalog.chr(31) || p_subject, 66007)
	);
	SELECT identity.id, identity.user_id, identity.status AS identity_status,
			application_user.status AS user_status
		INTO v_identity
		FROM public.external_identities AS identity
		JOIN public.users AS application_user ON application_user.id = identity.user_id
		WHERE identity.issuer = p_issuer AND identity.subject = p_subject
		FOR UPDATE OF identity, application_user;

	IF FOUND THEN
		IF v_identity.identity_status <> 'active' OR v_identity.user_status <> 'active' THEN
			RETURN;
		END IF;
		v_user_id := v_identity.user_id;
	ELSE
		INSERT INTO public.users (
			id, email_ciphertext, email_lookup_hash, display_name_ciphertext,
			status, last_authenticated_at, created_at, updated_at, version
		) VALUES (
			p_new_user_id, v_invitation.target_ciphertext,
			v_invitation.target_lookup_hash, NULL, 'active', v_now, v_now, v_now, 1
		);
		INSERT INTO public.external_identities (
			id, user_id, issuer, subject, status, linked_at,
			last_authenticated_at, disabled_at, unlinked_at,
			created_at, updated_at, version
		) VALUES (
			p_new_external_identity_id, p_new_user_id, p_issuer, p_subject,
			'active', v_now, v_now, NULL, NULL, v_now, v_now, 1
		);
		v_user_id := p_new_user_id;
		v_new_identity := true;
	END IF;

	SELECT membership.id, membership.status, membership.role,
			membership.location_scope
		INTO v_membership
		FROM public.memberships AS membership
		WHERE membership.organization_id = p_organization_id
			AND membership.user_id = v_user_id
		FOR UPDATE;
	IF FOUND AND v_membership.status IN ('suspended', 'revoked') THEN
		RETURN;
	ELSIF FOUND AND v_membership.status = 'active' THEN
		v_outcome := 'already_active';
	ELSIF FOUND AND v_membership.status = 'invited' THEN
		UPDATE public.memberships AS invited_membership
			SET role = v_invitation.role,
				location_scope = v_invitation.location_scope,
				status = 'active', activated_at = v_now, revoked_at = NULL,
				updated_at = v_now, version = invited_membership.version + 1
			WHERE invited_membership.organization_id = p_organization_id
				AND invited_membership.id = v_membership.id;
		v_membership_activated := true;
		v_outcome := 'activated';
	ELSE
		SELECT inviter.user_id
			INTO v_inviter_user_id
			FROM public.memberships AS inviter
			WHERE inviter.organization_id = p_organization_id
				AND inviter.id = v_invitation.invited_by_membership_id;
		IF NOT FOUND THEN
			RETURN;
		END IF;
		INSERT INTO public.memberships (
			id, organization_id, user_id, role, status, location_scope,
			invited_by_user_id, invited_at, activated_at, revoked_at,
			created_at, updated_at, version
		) VALUES (
			p_new_membership_id, p_organization_id, v_user_id,
			v_invitation.role, 'active', v_invitation.location_scope,
			v_inviter_user_id, v_now, v_now, NULL, v_now, v_now, 1
		);
		v_membership.id := p_new_membership_id;
		v_membership_activated := true;
		v_outcome := 'activated';
	END IF;

	UPDATE public.membership_invitations AS accepted_invitation
		SET status = 'accepted', accepted_at = v_now,
			accepted_by_user_id = v_user_id, updated_at = v_now,
			version = accepted_invitation.version + 1
		WHERE accepted_invitation.organization_id = p_organization_id
			AND accepted_invitation.id = v_invitation.id;

	INSERT INTO public.audit_events (
		id, organization_id, event_type, actor_type, actor_id,
		actor_membership_id, impersonation_session_id, support_grant_id,
		target_type, target_id, action, result, reason_code, request_id,
		trace_id, correlation_id, source_ip_prefix, user_agent_hash,
		metadata_redacted_jsonb, occurred_at
	) VALUES (
		p_invitation_audit_id, p_organization_id, 'invitation.accepted',
		'member', v_user_id, v_membership.id, NULL, NULL,
		'membership_invitation', v_invitation.id, 'invitation.accepted',
		'succeeded', NULL, p_request_id, p_trace_id, p_correlation_id,
		NULL, NULL, '{}'::jsonb, v_now
	);
	IF v_new_identity THEN
		INSERT INTO public.audit_events (
			id, organization_id, event_type, actor_type, actor_id,
			actor_membership_id, impersonation_session_id, support_grant_id,
			target_type, target_id, action, result, reason_code, request_id,
			trace_id, correlation_id, source_ip_prefix, user_agent_hash,
			metadata_redacted_jsonb, occurred_at
		) VALUES
			(p_user_audit_id, p_organization_id, 'user.onboarded', 'member',
			 v_user_id, v_membership.id, NULL, NULL, 'user', v_user_id,
			 'user.onboarded', 'succeeded', NULL, p_request_id, p_trace_id,
			 p_correlation_id, NULL, NULL, '{}'::jsonb, v_now),
			(p_identity_audit_id, p_organization_id, 'external_identity.linked',
			 'member', v_user_id, v_membership.id, NULL, NULL,
			 'external_identity', p_new_external_identity_id,
			 'external_identity.linked', 'succeeded', NULL, p_request_id,
			 p_trace_id, p_correlation_id, NULL, NULL, '{}'::jsonb, v_now);
	END IF;
	IF v_membership_activated THEN
		INSERT INTO public.audit_events (
			id, organization_id, event_type, actor_type, actor_id,
			actor_membership_id, impersonation_session_id, support_grant_id,
			target_type, target_id, action, result, reason_code, request_id,
			trace_id, correlation_id, source_ip_prefix, user_agent_hash,
			metadata_redacted_jsonb, occurred_at
		) VALUES (
			p_membership_audit_id, p_organization_id, 'membership.activated',
			'member', v_user_id, v_membership.id, NULL, NULL,
			'membership', v_membership.id, 'membership.activated', 'succeeded',
			NULL, p_request_id, p_trace_id, p_correlation_id, NULL, NULL,
			'{}'::jsonb, v_now
		);
	END IF;

	RETURN QUERY SELECT v_outcome, v_user_id, v_membership.id,
		v_new_identity, v_new_identity, v_membership_activated;
END
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.accept_membership_invitation(
	uuid, bytea, bytea, character varying, character varying,
	uuid, uuid, uuid, uuid, uuid, uuid, uuid,
	character varying, uuid, character varying
) FROM PUBLIC, lead_agent_runtime, lead_agent_ingress, lead_agent_auth;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.accept_membership_invitation(
	uuid, bytea, bytea, character varying, character varying,
	uuid, uuid, uuid, uuid, uuid, uuid, uuid,
	character varying, uuid, character varying
) TO lead_agent_auth;
--> statement-breakpoint
ALTER FUNCTION app.accept_membership_invitation(
	uuid, bytea, bytea, character varying, character varying,
	uuid, uuid, uuid, uuid, uuid, uuid, uuid,
	character varying, uuid, character varying
) OWNER TO lead_agent_membership_definer;
