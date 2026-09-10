ALTER TABLE public.auth_sessions DROP CONSTRAINT auth_sessions_lifetime_check;
--> statement-breakpoint
ALTER TABLE public.auth_sessions ADD COLUMN rotated_at timestamp with time zone;
--> statement-breakpoint
UPDATE public.auth_sessions SET rotated_at = created_at WHERE rotated_at IS NULL;
--> statement-breakpoint
ALTER TABLE public.auth_sessions
	ALTER COLUMN rotated_at SET DEFAULT pg_catalog.now(),
	ALTER COLUMN rotated_at SET NOT NULL;
--> statement-breakpoint
ALTER TABLE public.auth_sessions ADD CONSTRAINT auth_sessions_lifetime_check CHECK (
	authentication_time <= last_seen_at
	AND rotated_at >= created_at
	AND last_seen_at >= created_at
	AND idle_expires_at > last_seen_at
	AND idle_expires_at <= absolute_expires_at
	AND absolute_expires_at > created_at
);
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public.auth_sessions
	FROM lead_agent_auth, lead_agent_identity_definer;
--> statement-breakpoint
GRANT SELECT (
	id, user_id, session_token_hash, status, authentication_time,
	authentication_level, created_at, rotated_at, last_seen_at,
	idle_expires_at, absolute_expires_at
) ON TABLE public.auth_sessions TO lead_agent_identity_definer;
--> statement-breakpoint
GRANT INSERT (
	id, user_id, session_token_hash, csrf_secret_hash, status,
	authentication_time, authentication_level, created_at, rotated_at,
	last_seen_at, idle_expires_at, absolute_expires_at, revoked_at,
	revocation_reason, source_ip_hash, user_agent_hash
) ON TABLE public.auth_sessions TO lead_agent_identity_definer;
--> statement-breakpoint
GRANT UPDATE (
	session_token_hash, csrf_secret_hash, status, authentication_time,
	authentication_level, rotated_at, last_seen_at, idle_expires_at,
	revoked_at, revocation_reason
) ON TABLE public.auth_sessions TO lead_agent_identity_definer;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.create_application_session(
	p_session_id uuid,
	p_user_id uuid,
	p_session_token_hash bytea,
	p_csrf_secret_hash bytea,
	p_authentication_time timestamp with time zone,
	p_authentication_level character varying,
	p_source_ip_hash bytea,
	p_user_agent_hash bytea
)
RETURNS TABLE (
	resolution_state text,
	session_id uuid,
	user_id uuid,
	authentication_time timestamp with time zone,
	authentication_level character varying,
	created_at timestamp with time zone,
	rotated_at timestamp with time zone,
	last_seen_at timestamp with time zone,
	idle_expires_at timestamp with time zone,
	absolute_expires_at timestamp with time zone,
	rotation_due boolean,
	evicted_session_count integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
	v_active_count integer;
	v_evicted_count integer;
	v_now timestamp with time zone := pg_catalog.statement_timestamp();
	v_user_status character varying;
BEGIN
	IF pg_catalog.octet_length(p_session_token_hash) <> 32
		OR pg_catalog.octet_length(p_csrf_secret_hash) <> 32
		OR p_session_token_hash = p_csrf_secret_hash
		OR p_authentication_time > v_now
		OR p_authentication_level IS NULL
		OR pg_catalog.char_length(p_authentication_level) NOT BETWEEN 1 AND 32
		OR p_authentication_level <> pg_catalog.lower(pg_catalog.btrim(p_authentication_level))
		OR p_authentication_level !~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
		OR (p_source_ip_hash IS NOT NULL AND pg_catalog.octet_length(p_source_ip_hash) NOT BETWEEN 16 AND 128)
		OR (p_user_agent_hash IS NOT NULL AND pg_catalog.octet_length(p_user_agent_hash) NOT BETWEEN 16 AND 128)
	THEN
		RETURN;
	END IF;

	PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 63003));
	SELECT application_user.status
		INTO v_user_status
		FROM public.users AS application_user
		WHERE application_user.id = p_user_id;
	IF v_user_status IS DISTINCT FROM 'active' THEN
		RETURN;
	END IF;

	UPDATE public.auth_sessions AS expired_session
		SET status = 'expired'
		WHERE expired_session.user_id = p_user_id
			AND expired_session.status = 'active'
			AND (expired_session.idle_expires_at <= v_now OR expired_session.absolute_expires_at <= v_now);

	SELECT pg_catalog.count(*)::integer
		INTO v_active_count
		FROM public.auth_sessions AS active_session
		WHERE active_session.user_id = p_user_id
			AND active_session.status = 'active';
	v_evicted_count := GREATEST(v_active_count - 4, 0);

	WITH oldest_sessions AS (
		SELECT active_session.id
			FROM public.auth_sessions AS active_session
			WHERE active_session.user_id = p_user_id
				AND active_session.status = 'active'
			ORDER BY active_session.created_at ASC, active_session.id ASC
			LIMIT v_evicted_count
			FOR UPDATE
	)
	UPDATE public.auth_sessions AS evicted_session
		SET status = 'revoked',
			revoked_at = v_now,
			revocation_reason = 'session_limit'
		FROM oldest_sessions
		WHERE evicted_session.id = oldest_sessions.id;

	INSERT INTO public.auth_sessions (
		id, user_id, session_token_hash, csrf_secret_hash, status,
		authentication_time, authentication_level, created_at, rotated_at,
		last_seen_at, idle_expires_at, absolute_expires_at, revoked_at,
		revocation_reason, source_ip_hash, user_agent_hash
	) VALUES (
		p_session_id, p_user_id, p_session_token_hash, p_csrf_secret_hash, 'active',
		p_authentication_time, p_authentication_level, v_now, v_now,
		v_now, v_now + interval '60 minutes', v_now + interval '12 hours', NULL,
		NULL, p_source_ip_hash, p_user_agent_hash
	);

	RETURN QUERY SELECT
		'authenticated'::text, p_session_id, p_user_id, p_authentication_time,
		p_authentication_level, v_now, v_now, v_now,
		v_now + interval '60 minutes', v_now + interval '12 hours', FALSE,
		v_evicted_count;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.resolve_application_session(p_session_token_hash bytea)
RETURNS TABLE (
	resolution_state text,
	session_id uuid,
	user_id uuid,
	authentication_time timestamp with time zone,
	authentication_level character varying,
	created_at timestamp with time zone,
	rotated_at timestamp with time zone,
	last_seen_at timestamp with time zone,
	idle_expires_at timestamp with time zone,
	absolute_expires_at timestamp with time zone,
	rotation_due boolean
)
LANGUAGE plpgsql
VOLATILE
STRICT
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
	v_now timestamp with time zone := pg_catalog.statement_timestamp();
	v_session record;
BEGIN
	IF pg_catalog.octet_length(p_session_token_hash) <> 32 THEN
		RETURN;
	END IF;

	SELECT session_row.id, session_row.user_id, session_row.status,
			session_row.authentication_time, session_row.authentication_level,
			session_row.created_at, session_row.rotated_at, session_row.last_seen_at,
			session_row.idle_expires_at, session_row.absolute_expires_at,
			application_user.status AS user_status
		INTO v_session
		FROM public.auth_sessions AS session_row
		JOIN public.users AS application_user ON application_user.id = session_row.user_id
		WHERE session_row.session_token_hash = p_session_token_hash
		FOR UPDATE OF session_row;
	IF NOT FOUND THEN
		RETURN;
	END IF;

	IF v_session.status <> 'active' THEN
		RETURN;
	ELSIF v_session.user_status <> 'active' THEN
		UPDATE public.auth_sessions AS denied_session
			SET status = 'revoked', revoked_at = v_now, revocation_reason = 'user_inactive'
			WHERE denied_session.id = v_session.id;
		RETURN;
	ELSIF v_session.idle_expires_at <= v_now OR v_session.absolute_expires_at <= v_now THEN
		UPDATE public.auth_sessions AS expired_session
			SET status = 'expired'
			WHERE expired_session.id = v_session.id;
		RETURN;
	END IF;

	RETURN QUERY
	UPDATE public.auth_sessions AS active_session
		SET last_seen_at = GREATEST(active_session.last_seen_at, v_now),
			idle_expires_at = LEAST(
				active_session.absolute_expires_at,
				GREATEST(active_session.idle_expires_at, v_now + interval '60 minutes')
			)
		WHERE active_session.id = v_session.id
		RETURNING
			'authenticated'::text,
			active_session.id,
			active_session.user_id,
			active_session.authentication_time,
			active_session.authentication_level,
			active_session.created_at,
			active_session.rotated_at,
			active_session.last_seen_at,
			active_session.idle_expires_at,
			active_session.absolute_expires_at,
			v_now >= active_session.rotated_at + interval '4 hours';
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.rotate_application_session(
	p_current_session_token_hash bytea,
	p_replacement_session_token_hash bytea,
	p_replacement_csrf_secret_hash bytea,
	p_authenticated_user_id uuid,
	p_authentication_time timestamp with time zone,
	p_authentication_level character varying
)
RETURNS TABLE (
	resolution_state text,
	session_id uuid,
	user_id uuid,
	authentication_time timestamp with time zone,
	authentication_level character varying,
	created_at timestamp with time zone,
	rotated_at timestamp with time zone,
	last_seen_at timestamp with time zone,
	idle_expires_at timestamp with time zone,
	absolute_expires_at timestamp with time zone,
	rotation_due boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
	v_now timestamp with time zone := pg_catalog.statement_timestamp();
	v_session record;
BEGIN
	IF pg_catalog.octet_length(p_current_session_token_hash) <> 32
		OR pg_catalog.octet_length(p_replacement_session_token_hash) <> 32
		OR pg_catalog.octet_length(p_replacement_csrf_secret_hash) <> 32
		OR p_current_session_token_hash = p_replacement_session_token_hash
		OR p_replacement_session_token_hash = p_replacement_csrf_secret_hash
		OR ((p_authenticated_user_id IS NULL) <> (p_authentication_time IS NULL))
		OR ((p_authenticated_user_id IS NULL) <> (p_authentication_level IS NULL))
	THEN
		RETURN;
	END IF;

	SELECT session_row.id, session_row.user_id, session_row.status,
			session_row.authentication_time, session_row.authentication_level,
			session_row.created_at, session_row.rotated_at, session_row.last_seen_at,
			session_row.idle_expires_at, session_row.absolute_expires_at,
			application_user.status AS user_status
		INTO v_session
		FROM public.auth_sessions AS session_row
		JOIN public.users AS application_user ON application_user.id = session_row.user_id
		WHERE session_row.session_token_hash = p_current_session_token_hash
		FOR UPDATE OF session_row;
	IF NOT FOUND OR v_session.status <> 'active' THEN
		RETURN;
	ELSIF v_session.user_status <> 'active' THEN
		UPDATE public.auth_sessions AS denied_session
			SET status = 'revoked', revoked_at = v_now, revocation_reason = 'user_inactive'
			WHERE denied_session.id = v_session.id;
		RETURN;
	ELSIF v_session.idle_expires_at <= v_now OR v_session.absolute_expires_at <= v_now THEN
		UPDATE public.auth_sessions AS expired_session
			SET status = 'expired'
			WHERE expired_session.id = v_session.id;
		RETURN;
	ELSIF p_authenticated_user_id IS NOT NULL AND (
		p_authenticated_user_id <> v_session.user_id
		OR p_authentication_time < v_session.authentication_time
		OR p_authentication_time > v_now
		OR pg_catalog.char_length(p_authentication_level) NOT BETWEEN 1 AND 32
		OR p_authentication_level <> pg_catalog.lower(pg_catalog.btrim(p_authentication_level))
		OR p_authentication_level !~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
	) THEN
		RETURN;
	END IF;

	RETURN QUERY
	UPDATE public.auth_sessions AS rotated_session
		SET session_token_hash = p_replacement_session_token_hash,
			csrf_secret_hash = p_replacement_csrf_secret_hash,
			authentication_time = COALESCE(p_authentication_time, rotated_session.authentication_time),
			authentication_level = COALESCE(p_authentication_level, rotated_session.authentication_level),
			rotated_at = v_now,
			last_seen_at = GREATEST(rotated_session.last_seen_at, v_now),
			idle_expires_at = LEAST(
				rotated_session.absolute_expires_at,
				GREATEST(rotated_session.idle_expires_at, v_now + interval '60 minutes')
			)
		WHERE rotated_session.id = v_session.id
		RETURNING
			'authenticated'::text,
			rotated_session.id,
			rotated_session.user_id,
			rotated_session.authentication_time,
			rotated_session.authentication_level,
			rotated_session.created_at,
			rotated_session.rotated_at,
			rotated_session.last_seen_at,
			rotated_session.idle_expires_at,
			rotated_session.absolute_expires_at,
			FALSE;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.revoke_application_session(p_session_token_hash bytea)
RETURNS void
LANGUAGE plpgsql
VOLATILE
STRICT
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF pg_catalog.octet_length(p_session_token_hash) = 32 THEN
		UPDATE public.auth_sessions AS active_session
			SET status = 'revoked',
				revoked_at = pg_catalog.statement_timestamp(),
				revocation_reason = 'sign_out'
			WHERE active_session.session_token_hash = p_session_token_hash
				AND active_session.status = 'active';
	END IF;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.revoke_user_application_sessions(
	p_user_id uuid,
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
	v_revoked_count integer;
BEGIN
	IF p_reason NOT IN ('membership_changed', 'privilege_changed', 'security_recovery', 'sign_out_all') THEN
		RETURN 0;
	END IF;
	PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 63003));
	UPDATE public.auth_sessions AS active_session
		SET status = 'revoked',
			revoked_at = pg_catalog.statement_timestamp(),
			revocation_reason = p_reason
		WHERE active_session.user_id = p_user_id
			AND active_session.status = 'active';
	GET DIAGNOSTICS v_revoked_count = ROW_COUNT;
	RETURN v_revoked_count;
END
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.create_application_session(
	uuid, uuid, bytea, bytea, timestamp with time zone, character varying, bytea, bytea
) FROM PUBLIC, lead_agent_runtime, lead_agent_ingress, lead_agent_auth;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.resolve_application_session(bytea)
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress, lead_agent_auth;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.rotate_application_session(
	bytea, bytea, bytea, uuid, timestamp with time zone, character varying
) FROM PUBLIC, lead_agent_runtime, lead_agent_ingress, lead_agent_auth;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.revoke_application_session(bytea)
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress, lead_agent_auth;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.revoke_user_application_sessions(uuid, character varying)
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress, lead_agent_auth;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_application_session(
	uuid, uuid, bytea, bytea, timestamp with time zone, character varying, bytea, bytea
) TO lead_agent_auth;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.resolve_application_session(bytea) TO lead_agent_auth;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.rotate_application_session(
	bytea, bytea, bytea, uuid, timestamp with time zone, character varying
) TO lead_agent_auth;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.revoke_application_session(bytea) TO lead_agent_auth;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.revoke_user_application_sessions(uuid, character varying)
	TO lead_agent_auth;
--> statement-breakpoint
ALTER FUNCTION app.create_application_session(
	uuid, uuid, bytea, bytea, timestamp with time zone, character varying, bytea, bytea
) OWNER TO lead_agent_identity_definer;
--> statement-breakpoint
ALTER FUNCTION app.resolve_application_session(bytea) OWNER TO lead_agent_identity_definer;
--> statement-breakpoint
ALTER FUNCTION app.rotate_application_session(
	bytea, bytea, bytea, uuid, timestamp with time zone, character varying
) OWNER TO lead_agent_identity_definer;
--> statement-breakpoint
ALTER FUNCTION app.revoke_application_session(bytea) OWNER TO lead_agent_identity_definer;
--> statement-breakpoint
ALTER FUNCTION app.revoke_user_application_sessions(uuid, character varying)
	OWNER TO lead_agent_identity_definer;
