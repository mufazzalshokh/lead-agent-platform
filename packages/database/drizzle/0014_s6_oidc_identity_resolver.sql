DO $role_provisioning$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'lead_agent_auth') THEN
		CREATE ROLE lead_agent_auth LOGIN;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'lead_agent_identity_definer'
	) THEN
		CREATE ROLE lead_agent_identity_definer NOLOGIN;
	END IF;
END
$role_provisioning$;
--> statement-breakpoint
ALTER ROLE lead_agent_auth
	LOGIN NOSUPERUSER INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
--> statement-breakpoint
ALTER ROLE lead_agent_identity_definer
	NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
--> statement-breakpoint
REVOKE lead_agent_identity_definer
	FROM lead_agent_auth, lead_agent_runtime, lead_agent_ingress;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
	FROM lead_agent_auth, lead_agent_identity_definer;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
	FROM lead_agent_auth, lead_agent_identity_definer;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public
	FROM lead_agent_auth, lead_agent_identity_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public, app
	FROM lead_agent_auth, lead_agent_identity_definer;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO lead_agent_identity_definer;
--> statement-breakpoint
GRANT SELECT (user_id, issuer, subject, status)
	ON TABLE public.external_identities TO lead_agent_identity_definer;
--> statement-breakpoint
GRANT SELECT (id, status)
	ON TABLE public.users TO lead_agent_identity_definer;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO lead_agent_auth;
--> statement-breakpoint
DO $database_connect$
BEGIN
	EXECUTE pg_catalog.format(
		'GRANT CONNECT ON DATABASE %I TO lead_agent_auth',
		pg_catalog.current_database()
	);
END
$database_connect$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.resolve_external_identity(
	input_issuer character varying,
	input_subject character varying
)
RETURNS TABLE (
	resolution_state text,
	user_id uuid
)
LANGUAGE sql
STABLE
STRICT
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
ROWS 1
AS $function$
	SELECT
		CASE
			WHEN identity.status = 'active' AND application_user.status = 'active'
				THEN 'authenticated'::text
			ELSE 'denied'::text
		END,
		CASE
			WHEN identity.status = 'active' AND application_user.status = 'active'
				THEN application_user.id
			ELSE NULL::uuid
		END
	FROM public.external_identities AS identity
	JOIN public.users AS application_user ON application_user.id = identity.user_id
	WHERE identity.issuer = input_issuer
		AND identity.subject = input_subject
		AND pg_catalog.char_length(input_issuer) BETWEEN 1 AND 2048
		AND pg_catalog.char_length(input_subject) BETWEEN 1 AND 512
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.resolve_external_identity(
	character varying,
	character varying
) FROM PUBLIC, lead_agent_runtime, lead_agent_ingress, lead_agent_auth;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.resolve_external_identity(
	character varying,
	character varying
) TO lead_agent_auth;
--> statement-breakpoint
ALTER FUNCTION app.resolve_external_identity(
	character varying,
	character varying
) OWNER TO lead_agent_identity_definer;
