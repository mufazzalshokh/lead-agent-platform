REVOKE ALL PRIVILEGES ON FUNCTION app.claim_outbox_events(character varying, integer, integer)
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress, lead_agent_auth,
	lead_agent_queue_runtime;
--> statement-breakpoint
DROP FUNCTION app.claim_outbox_events(character varying, integer, integer);
--> statement-breakpoint
CREATE FUNCTION app.claim_outbox_events(
	input_dispatcher_id character varying,
	input_event_types character varying[],
	input_schema_versions character varying[],
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

	IF input_event_types IS NULL
		OR input_schema_versions IS NULL
		OR pg_catalog.cardinality(input_event_types) <> pg_catalog.cardinality(input_schema_versions)
		OR pg_catalog.cardinality(input_event_types) > 64
		OR EXISTS (
			SELECT 1
			FROM pg_catalog.unnest(input_event_types) WITH ORDINALITY
				AS event_route(event_type, route_ordinal)
			JOIN pg_catalog.unnest(input_schema_versions) WITH ORDINALITY
				AS version_route(schema_version, route_ordinal)
				USING (route_ordinal)
			WHERE event_route.event_type IS NULL
				OR event_route.event_type !~ '^[a-z][a-z0-9_]*(?:[.][a-z][a-z0-9_]*)+$'
				OR pg_catalog.char_length(event_route.event_type) > 100
				OR version_route.schema_version IS NULL
				OR version_route.schema_version !~ '^[1-9][0-9]{0,5}$'
		)
		OR (
			SELECT pg_catalog.count(*) <>
				pg_catalog.count(DISTINCT (event_route.event_type, version_route.schema_version))
			FROM pg_catalog.unnest(input_event_types) WITH ORDINALITY
				AS event_route(event_type, route_ordinal)
			JOIN pg_catalog.unnest(input_schema_versions) WITH ORDINALITY
				AS version_route(schema_version, route_ordinal)
				USING (route_ordinal)
		)
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '22023',
			MESSAGE = 'invalid active outbox route set';
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
	active_routes AS MATERIALIZED (
		SELECT event_route.event_type, version_route.schema_version
		FROM pg_catalog.unnest(input_event_types) WITH ORDINALITY
			AS event_route(event_type, route_ordinal)
		JOIN pg_catalog.unnest(input_schema_versions) WITH ORDINALITY
			AS version_route(schema_version, route_ordinal)
			USING (route_ordinal)
	),
	eligible_tenants AS MATERIALIZED (
		SELECT event.organization_id
		FROM public.outbox_events AS event
		JOIN active_routes AS route
			ON route.event_type = event.event_type
			AND route.schema_version = event.schema_version
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
			JOIN active_routes AS route
				ON route.event_type = event.event_type
				AND route.schema_version = event.schema_version
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
			AND EXISTS (
				SELECT 1
				FROM active_routes AS route
				WHERE route.event_type = event.event_type
					AND route.schema_version = event.schema_version
			)
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
REVOKE ALL PRIVILEGES ON FUNCTION app.claim_outbox_events(character varying, character varying[], character varying[], integer, integer)
	FROM PUBLIC, lead_agent_runtime, lead_agent_ingress, lead_agent_auth,
	lead_agent_queue_runtime;
--> statement-breakpoint
ALTER FUNCTION app.claim_outbox_events(character varying, character varying[], character varying[], integer, integer)
	OWNER TO lead_agent_outbox_relay_definer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.claim_outbox_events(character varying, character varying[], character varying[], integer, integer)
	TO lead_agent_queue_runtime;
