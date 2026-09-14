ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_lifecycle_check";--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "published_claim_token" uuid;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_lease_token_uuid_v4_check" CHECK ("outbox_events"."lease_token" is null
        or "outbox_events"."lease_token"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_published_claim_token_uuid_v4_check" CHECK ("outbox_events"."published_claim_token" is null
        or "outbox_events"."published_claim_token"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_lifecycle_check" CHECK (("outbox_events"."status" = 'pending'
          and "outbox_events"."locked_by" is null
          and "outbox_events"."locked_until" is null
          and "outbox_events"."lease_token" is null
          and "outbox_events"."published_at" is null
          and "outbox_events"."published_claim_token" is null)
        or ("outbox_events"."status" = 'processing'
          and "outbox_events"."locked_by" is not null
          and "outbox_events"."locked_until" is not null
          and "outbox_events"."lease_token" is not null
          and "outbox_events"."published_at" is null
          and "outbox_events"."published_claim_token" is null)
        or ("outbox_events"."status" = 'published'
          and "outbox_events"."locked_by" is null
          and "outbox_events"."locked_until" is null
          and "outbox_events"."lease_token" is null
          and "outbox_events"."published_at" is not null
          and "outbox_events"."published_claim_token" is not null
          and "outbox_events"."last_error_category" is null)
        or ("outbox_events"."status" = 'dead_lettered'
          and "outbox_events"."locked_by" is null
          and "outbox_events"."locked_until" is null
          and "outbox_events"."lease_token" is null
          and "outbox_events"."published_at" is null
          and "outbox_events"."published_claim_token" is null
          and "outbox_events"."last_error_category" is not null));
--> statement-breakpoint
CREATE INDEX "outbox_events_relay_pending_tenant_idx"
	ON "outbox_events" USING btree ("organization_id", "available_at", "id")
	WHERE "outbox_events"."status" = 'pending';
--> statement-breakpoint
CREATE INDEX "outbox_events_relay_processing_tenant_idx"
	ON "outbox_events" USING btree ("organization_id", "locked_until", "id")
	WHERE "outbox_events"."status" = 'processing';
--> statement-breakpoint
DO $role_provisioning$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_catalog.pg_roles
		WHERE rolname = 'lead_agent_outbox_relay_definer'
	) THEN
		CREATE ROLE lead_agent_outbox_relay_definer NOLOGIN;
	END IF;
END
$role_provisioning$;
--> statement-breakpoint
ALTER ROLE lead_agent_outbox_relay_definer
	NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
--> statement-breakpoint
REVOKE lead_agent_outbox_relay_definer
	FROM lead_agent_runtime, lead_agent_ingress, lead_agent_auth,
	lead_agent_queue_runtime, lead_agent_inbound_route_definer,
	lead_agent_identity_definer, lead_agent_membership_definer;
--> statement-breakpoint
REVOKE lead_agent_runtime, lead_agent_ingress, lead_agent_auth,
	lead_agent_queue_runtime, lead_agent_inbound_route_definer,
	lead_agent_identity_definer, lead_agent_membership_definer
	FROM lead_agent_outbox_relay_definer;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
	FROM lead_agent_outbox_relay_definer;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
	FROM lead_agent_outbox_relay_definer;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public
	FROM lead_agent_outbox_relay_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public, app
	FROM lead_agent_outbox_relay_definer, lead_agent_queue_runtime;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public.outbox_events
	FROM lead_agent_queue_runtime;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO lead_agent_outbox_relay_definer;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO lead_agent_queue_runtime;
--> statement-breakpoint
GRANT SELECT (
	id, organization_id, event_type, schema_version, aggregate_type,
	aggregate_id, correlation_id, causation_id, status, attempt_count,
	available_at, locked_by, locked_until, lease_token, published_at,
	published_claim_token, last_error_category
) ON TABLE public.outbox_events TO lead_agent_outbox_relay_definer;
--> statement-breakpoint
GRANT UPDATE (
	status, attempt_count, available_at, locked_by, locked_until, lease_token,
	published_at, published_claim_token, last_error_category
) ON TABLE public.outbox_events TO lead_agent_outbox_relay_definer;
--> statement-breakpoint
CREATE POLICY outbox_events_relay_definer_select
	ON public.outbox_events
	FOR SELECT
	TO lead_agent_outbox_relay_definer
	USING (true);
--> statement-breakpoint
CREATE POLICY outbox_events_relay_definer_update
	ON public.outbox_events
	FOR UPDATE
	TO lead_agent_outbox_relay_definer
	USING (true)
	WITH CHECK (true);
--> statement-breakpoint
CREATE FUNCTION app.claim_outbox_events(
	input_dispatcher_id character varying,
	input_batch_size integer DEFAULT 50,
	input_lease_seconds integer DEFAULT 60
)
RETURNS TABLE (
	outbox_event_id uuid,
	organization_id uuid,
	event_type character varying,
	schema_version character varying,
	aggregate_type character varying,
	aggregate_id uuid,
	correlation_id uuid,
	causation_id uuid,
	lease_token uuid,
	locked_until timestamp with time zone,
	attempt_number integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF input_dispatcher_id IS NULL
		OR pg_catalog.char_length(input_dispatcher_id) NOT BETWEEN 8 AND 128
		OR input_dispatcher_id !~ '^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,126}[A-Za-z0-9])$'
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '22023',
			MESSAGE = 'invalid outbox dispatcher identity';
	END IF;

	IF input_batch_size IS NULL OR input_batch_size NOT BETWEEN 1 AND 50 THEN
		RAISE EXCEPTION USING
			ERRCODE = '22023',
			MESSAGE = 'outbox claim batch must be between 1 and 50';
	END IF;

	IF input_lease_seconds IS NULL OR input_lease_seconds NOT BETWEEN 1 AND 300 THEN
		RAISE EXCEPTION USING
			ERRCODE = '22023',
			MESSAGE = 'outbox lease must be between 1 and 300 seconds';
	END IF;

	RETURN QUERY
	WITH effective_clock AS MATERIALIZED (
		SELECT pg_catalog.clock_timestamp() AS claimed_at
	),
	eligible_tenants AS MATERIALIZED (
		SELECT
			event.organization_id
		FROM public.outbox_events AS event
		CROSS JOIN effective_clock
		WHERE (event.status = 'pending' AND event.available_at <= effective_clock.claimed_at)
			OR (event.status = 'processing' AND event.locked_until <= effective_clock.claimed_at)
		GROUP BY event.organization_id
	),
	locked AS MATERIALIZED (
		SELECT candidate.id, candidate.organization_id, candidate.due_at
		FROM eligible_tenants AS tenant
		CROSS JOIN LATERAL (
			SELECT
				event.id,
				event.organization_id,
				CASE
					WHEN event.status = 'pending' THEN event.available_at
					ELSE event.locked_until
				END AS due_at
			FROM public.outbox_events AS event
			CROSS JOIN effective_clock
			WHERE event.organization_id = tenant.organization_id
				AND (
					(event.status = 'pending' AND event.available_at <= effective_clock.claimed_at)
					OR (event.status = 'processing' AND event.locked_until <= effective_clock.claimed_at)
				)
			ORDER BY
				CASE
					WHEN event.status = 'pending' THEN event.available_at
					ELSE event.locked_until
				END,
				event.id
			LIMIT 5
			FOR UPDATE OF event SKIP LOCKED
		) AS candidate
		ORDER BY candidate.due_at, candidate.id
		LIMIT input_batch_size
	),
	claimed AS (
		UPDATE public.outbox_events AS event
		SET status = 'processing',
			attempt_count = event.attempt_count + 1,
			locked_by = input_dispatcher_id,
			locked_until = effective_clock.claimed_at
				+ pg_catalog.make_interval(secs => input_lease_seconds),
			lease_token = pg_catalog.gen_random_uuid(),
			published_at = NULL,
			published_claim_token = NULL,
			last_error_category = NULL
		FROM locked
		CROSS JOIN effective_clock
		WHERE event.organization_id = locked.organization_id
			AND event.id = locked.id
			AND (
				(event.status = 'pending' AND event.available_at <= effective_clock.claimed_at)
				OR (event.status = 'processing' AND event.locked_until <= effective_clock.claimed_at)
			)
		RETURNING
			event.id AS outbox_event_id,
			event.organization_id,
			event.event_type,
			event.schema_version,
			event.aggregate_type,
			event.aggregate_id,
			event.correlation_id,
			event.causation_id,
			event.lease_token,
			event.locked_until,
			event.attempt_count AS attempt_number,
			locked.due_at
	)
	SELECT
		claimed.outbox_event_id,
		claimed.organization_id,
		claimed.event_type,
		claimed.schema_version,
		claimed.aggregate_type,
		claimed.aggregate_id,
		claimed.correlation_id,
		claimed.causation_id,
		claimed.lease_token,
		claimed.locked_until,
		claimed.attempt_number
	FROM claimed
	ORDER BY claimed.due_at, claimed.outbox_event_id;
END
$function$;
--> statement-breakpoint
CREATE FUNCTION app.renew_outbox_event_lease(
	input_organization_id uuid,
	input_outbox_event_id uuid,
	input_lease_token uuid,
	input_lease_seconds integer DEFAULT 60
)
RETURNS timestamp with time zone
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
	effective_now timestamp with time zone := pg_catalog.clock_timestamp();
	renewed_until timestamp with time zone;
BEGIN
	IF input_organization_id IS NULL
		OR input_outbox_event_id IS NULL
		OR input_lease_token IS NULL
		OR input_lease_seconds IS NULL
		OR input_lease_seconds NOT BETWEEN 1 AND 300
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '22023',
			MESSAGE = 'invalid outbox lease renewal input';
	END IF;

	UPDATE public.outbox_events AS event
	SET locked_until = effective_now + pg_catalog.make_interval(secs => input_lease_seconds)
	WHERE event.organization_id = input_organization_id
		AND event.id = input_outbox_event_id
		AND event.status = 'processing'
		AND event.lease_token = input_lease_token
		AND event.locked_until > effective_now
	RETURNING event.locked_until INTO renewed_until;

	RETURN renewed_until;
END
$function$;
--> statement-breakpoint
CREATE FUNCTION app.release_outbox_event_for_retry(
	input_organization_id uuid,
	input_outbox_event_id uuid,
	input_lease_token uuid,
	input_available_at timestamp with time zone,
	input_error_category character varying
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
	effective_now timestamp with time zone := pg_catalog.clock_timestamp();
BEGIN
	IF input_organization_id IS NULL
		OR input_outbox_event_id IS NULL
		OR input_lease_token IS NULL
		OR input_available_at IS NULL
		OR input_available_at < effective_now
		OR input_available_at > effective_now + pg_catalog.make_interval(hours => 24)
		OR input_error_category IS NULL
		OR input_error_category NOT IN ('transient', 'ambiguous_delivery', 'unknown')
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '22023',
			MESSAGE = 'invalid outbox retry release input';
	END IF;

	UPDATE public.outbox_events AS event
	SET status = 'pending',
		available_at = input_available_at,
		locked_by = NULL,
		locked_until = NULL,
		lease_token = NULL,
		published_at = NULL,
		published_claim_token = NULL,
		last_error_category = input_error_category
	WHERE event.organization_id = input_organization_id
		AND event.id = input_outbox_event_id
		AND event.status = 'processing'
		AND event.lease_token = input_lease_token
		AND event.locked_until > effective_now;

	RETURN FOUND;
END
$function$;
--> statement-breakpoint
CREATE FUNCTION app.mark_outbox_event_published(
	input_organization_id uuid,
	input_outbox_event_id uuid,
	input_lease_token uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
	effective_now timestamp with time zone := pg_catalog.clock_timestamp();
BEGIN
	IF input_organization_id IS NULL
		OR input_outbox_event_id IS NULL
		OR input_lease_token IS NULL
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '22023',
			MESSAGE = 'invalid outbox publication input';
	END IF;

	UPDATE public.outbox_events AS event
	SET status = 'published',
		locked_by = NULL,
		locked_until = NULL,
		lease_token = NULL,
		published_at = effective_now,
		published_claim_token = input_lease_token,
		last_error_category = NULL
	WHERE event.organization_id = input_organization_id
		AND event.id = input_outbox_event_id
		AND event.status = 'processing'
		AND event.lease_token = input_lease_token
		AND event.locked_until > effective_now;

	IF FOUND THEN
		RETURN 'published';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM public.outbox_events AS event
		WHERE event.organization_id = input_organization_id
			AND event.id = input_outbox_event_id
			AND event.status = 'published'
			AND event.published_claim_token = input_lease_token
	) THEN
		RETURN 'already_published';
	END IF;

	RETURN 'lease_lost';
END
$function$;
--> statement-breakpoint
CREATE FUNCTION app.mark_outbox_event_dead_lettered(
	input_organization_id uuid,
	input_outbox_event_id uuid,
	input_lease_token uuid,
	input_error_category character varying
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
	effective_now timestamp with time zone := pg_catalog.clock_timestamp();
BEGIN
	IF input_organization_id IS NULL
		OR input_outbox_event_id IS NULL
		OR input_lease_token IS NULL
		OR input_error_category IS NULL
		OR input_error_category NOT IN ('transient', 'ambiguous_delivery', 'permanent', 'unknown')
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '22023',
			MESSAGE = 'invalid outbox dead-letter input';
	END IF;

	UPDATE public.outbox_events AS event
	SET status = 'dead_lettered',
		locked_by = NULL,
		locked_until = NULL,
		lease_token = NULL,
		published_at = NULL,
		published_claim_token = NULL,
		last_error_category = input_error_category
	WHERE event.organization_id = input_organization_id
		AND event.id = input_outbox_event_id
		AND event.status = 'processing'
		AND event.lease_token = input_lease_token
		AND event.locked_until > effective_now;

	RETURN FOUND;
END
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.claim_outbox_events(character varying, integer, integer)
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress, lead_agent_auth,
	lead_agent_queue_runtime;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.renew_outbox_event_lease(uuid, uuid, uuid, integer)
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress, lead_agent_auth,
	lead_agent_queue_runtime;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.release_outbox_event_for_retry(uuid, uuid, uuid, timestamp with time zone, character varying)
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress, lead_agent_auth,
	lead_agent_queue_runtime;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.mark_outbox_event_published(uuid, uuid, uuid)
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress, lead_agent_auth,
	lead_agent_queue_runtime;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.mark_outbox_event_dead_lettered(uuid, uuid, uuid, character varying)
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress, lead_agent_auth,
	lead_agent_queue_runtime;
--> statement-breakpoint
ALTER FUNCTION app.claim_outbox_events(character varying, integer, integer)
	OWNER TO lead_agent_outbox_relay_definer;
--> statement-breakpoint
ALTER FUNCTION app.renew_outbox_event_lease(uuid, uuid, uuid, integer)
	OWNER TO lead_agent_outbox_relay_definer;
--> statement-breakpoint
ALTER FUNCTION app.release_outbox_event_for_retry(uuid, uuid, uuid, timestamp with time zone, character varying)
	OWNER TO lead_agent_outbox_relay_definer;
--> statement-breakpoint
ALTER FUNCTION app.mark_outbox_event_published(uuid, uuid, uuid)
	OWNER TO lead_agent_outbox_relay_definer;
--> statement-breakpoint
ALTER FUNCTION app.mark_outbox_event_dead_lettered(uuid, uuid, uuid, character varying)
	OWNER TO lead_agent_outbox_relay_definer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.claim_outbox_events(character varying, integer, integer)
	TO lead_agent_queue_runtime;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.renew_outbox_event_lease(uuid, uuid, uuid, integer)
	TO lead_agent_queue_runtime;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.release_outbox_event_for_retry(uuid, uuid, uuid, timestamp with time zone, character varying)
	TO lead_agent_queue_runtime;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.mark_outbox_event_published(uuid, uuid, uuid)
	TO lead_agent_queue_runtime;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.mark_outbox_event_dead_lettered(uuid, uuid, uuid, character varying)
	TO lead_agent_queue_runtime;
