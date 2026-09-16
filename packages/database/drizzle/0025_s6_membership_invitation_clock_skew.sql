-- Normalize invitation acceptance to one database-owned lifecycle instant while
-- preserving the existing SECURITY DEFINER boundary and lifecycle constraints.
GRANT SELECT (created_at) ON TABLE public.membership_invitations
	TO lead_agent_membership_definer;
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
	v_database_now timestamp with time zone := pg_catalog.statement_timestamp();
	v_identity record;
	v_invitation record;
	v_inviter_user_id uuid;
	v_membership record;
	v_membership_activated boolean := false;
	v_new_identity boolean := false;
	v_now timestamp with time zone;
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
			invitation.expires_at, invitation.invited_by_membership_id,
			invitation.created_at
		INTO v_invitation
		FROM public.membership_invitations AS invitation
		WHERE invitation.organization_id = p_organization_id
			AND invitation.token_hash = p_token_hash
		FOR UPDATE;
	IF NOT FOUND THEN
		RETURN;
	END IF;

	v_now := GREATEST(v_database_now, v_invitation.created_at);

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
