-- S8.5 infrastructure only: durable handler execution identity, exact retry
-- preparation, workload DLQs, and audited platform-operator maintenance.
DO $roles$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'lead_agent_worker_reliability_definer'
  ) THEN
    CREATE ROLE lead_agent_worker_reliability_definer NOLOGIN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'lead_agent_async_maintenance_definer'
  ) THEN
    CREATE ROLE lead_agent_async_maintenance_definer NOLOGIN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'lead_agent_async_operator'
  ) THEN
    CREATE ROLE lead_agent_async_operator LOGIN;
  END IF;
END
$roles$;

ALTER ROLE lead_agent_worker_reliability_definer
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE lead_agent_async_maintenance_definer
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE lead_agent_async_operator
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

ALTER ROLE lead_agent_worker_reliability_definer SET search_path = pg_catalog;
ALTER ROLE lead_agent_async_maintenance_definer SET search_path = pg_catalog;
ALTER ROLE lead_agent_async_operator SET search_path = pg_catalog;

DO $database_grant$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO lead_agent_async_operator',
    current_database()
  );
END
$database_grant$;

REVOKE ALL PRIVILEGES ON SCHEMA public, app, pgboss
  FROM lead_agent_worker_reliability_definer,
       lead_agent_async_maintenance_definer,
       lead_agent_async_operator;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public, app, pgboss
  FROM lead_agent_worker_reliability_definer,
       lead_agent_async_maintenance_definer,
       lead_agent_async_operator;

REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public, app, pgboss
  FROM lead_agent_worker_reliability_definer,
       lead_agent_async_maintenance_definer,
       lead_agent_async_operator;
--> statement-breakpoint
CREATE TABLE app.worker_handler_executions (
  handler_version varchar(16) NOT NULL,
  outbox_event_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  input_fingerprint bytea NOT NULL,
  state varchar(32) NOT NULL,
  attempt_count integer NOT NULL,
  lease_token uuid,
  lease_expires_at timestamptz,
  safe_failure_category varchar(40),
  first_started_at timestamptz NOT NULL,
  last_started_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (handler_version, outbox_event_id),
  CONSTRAINT worker_handler_executions_outbox_fk
    FOREIGN KEY (organization_id, outbox_event_id)
    REFERENCES public.outbox_events (organization_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT worker_handler_executions_handler_version_check
    CHECK (handler_version ~ '^v[1-9][0-9]{0,5}$'),
  CONSTRAINT worker_handler_executions_fingerprint_check
    CHECK (octet_length(input_fingerprint) = 32),
  CONSTRAINT worker_handler_executions_state_check
    CHECK (state IN (
      'in_progress', 'retryable_failure', 'succeeded',
      'permanent_failure', 'reconciliation_required'
    )),
  CONSTRAINT worker_handler_executions_attempt_count_check
    CHECK (attempt_count BETWEEN 0 AND 5),
  CONSTRAINT worker_handler_executions_failure_category_check
    CHECK (safe_failure_category IS NULL OR safe_failure_category IN (
      'RETRYABLE_INFRASTRUCTURE', 'RATE_LIMITED', 'PERMANENT_VALIDATION',
      'UNSUPPORTED_VERSION', 'TENANT_INTEGRITY', 'PERMANENT_BUSINESS',
      'AMBIGUOUS_EXTERNAL_EFFECT'
    )),
  CONSTRAINT worker_handler_executions_timestamps_check
    CHECK (
      last_started_at >= first_started_at
      AND (lease_expires_at IS NULL OR lease_expires_at >= last_started_at)
      AND (completed_at IS NULL OR completed_at >= first_started_at)
    ),
  CONSTRAINT worker_handler_executions_lifecycle_check
    CHECK (
      (state = 'in_progress'
        AND attempt_count BETWEEN 1 AND 5
        AND lease_token IS NOT NULL
        AND lease_expires_at IS NOT NULL
        AND completed_at IS NULL)
      OR
      (state = 'retryable_failure'
        AND attempt_count BETWEEN 1 AND 4
        AND lease_token IS NULL
        AND lease_expires_at IS NULL
        AND completed_at IS NULL
        AND safe_failure_category IN ('RETRYABLE_INFRASTRUCTURE', 'RATE_LIMITED'))
      OR
      (state = 'reconciliation_required'
        AND lease_token IS NULL
        AND lease_expires_at IS NULL
        AND completed_at IS NULL
        AND safe_failure_category = 'AMBIGUOUS_EXTERNAL_EFFECT')
      OR
      (state = 'succeeded'
        AND attempt_count BETWEEN 1 AND 5
        AND lease_token IS NULL
        AND lease_expires_at IS NULL
        AND completed_at IS NOT NULL
        AND safe_failure_category IS NULL)
      OR
      (state = 'permanent_failure'
        AND attempt_count BETWEEN 1 AND 5
        AND lease_token IS NULL
        AND lease_expires_at IS NULL
        AND completed_at IS NOT NULL
        AND safe_failure_category IS NOT NULL)
    )
);

CREATE INDEX worker_handler_executions_tenant_state_idx
  ON app.worker_handler_executions (organization_id, state, last_started_at);
--> statement-breakpoint
CREATE FUNCTION app.acquire_worker_handler_execution(
  p_organization_id uuid,
  p_outbox_event_id uuid,
  p_handler_version varchar,
  p_input_fingerprint bytea,
  p_execution_number integer,
  p_lease_seconds integer
)
RETURNS TABLE (
  acquisition_state varchar,
  execution_lease_token uuid,
  execution_lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  execution app.worker_handler_executions%ROWTYPE;
  new_lease_token uuid;
  inserted integer;
BEGIN
  IF session_user <> 'lead_agent_queue_runtime'
    OR p_handler_version !~ '^v[1-9][0-9]{0,5}$'
    OR octet_length(p_input_fingerprint) <> 32
    OR p_execution_number NOT BETWEEN 1 AND 5
    OR p_lease_seconds NOT BETWEEN 10 AND 900
  THEN
    RAISE EXCEPTION 'invalid worker execution acquisition'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.outbox_events event
    WHERE event.organization_id = p_organization_id
      AND event.id = p_outbox_event_id
      AND event.status IN ('processing', 'published')
  ) THEN
    RETURN QUERY SELECT 'collision'::varchar, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  new_lease_token := gen_random_uuid();
  INSERT INTO app.worker_handler_executions (
    handler_version, outbox_event_id, organization_id, input_fingerprint,
    state, attempt_count, lease_token, lease_expires_at,
    first_started_at, last_started_at
  ) SELECT
    p_handler_version, p_outbox_event_id, p_organization_id, p_input_fingerprint,
    'in_progress', p_execution_number, new_lease_token,
    clock_timestamp() + p_lease_seconds * interval '1 second',
    clock_timestamp(), clock_timestamp()
  WHERE p_execution_number = 1
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;

  IF inserted = 1 THEN
    RETURN QUERY
      SELECT 'acquired'::varchar, new_lease_token,
             clock_timestamp() + p_lease_seconds * interval '1 second';
    RETURN;
  END IF;

  SELECT * INTO execution
  FROM app.worker_handler_executions stored
  WHERE stored.handler_version = p_handler_version
    AND stored.outbox_event_id = p_outbox_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'collision'::varchar, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  IF execution.organization_id <> p_organization_id
    OR execution.input_fingerprint <> p_input_fingerprint
  THEN
    RETURN QUERY SELECT 'collision'::varchar, NULL::uuid, NULL::timestamptz;
  ELSIF execution.state = 'succeeded' THEN
    RETURN QUERY SELECT 'known_success'::varchar, NULL::uuid, NULL::timestamptz;
  ELSIF execution.state = 'permanent_failure' THEN
    RETURN QUERY SELECT 'known_permanent_failure'::varchar, NULL::uuid, NULL::timestamptz;
  ELSIF execution.state = 'in_progress'
    AND execution.lease_expires_at > clock_timestamp()
  THEN
    RETURN QUERY SELECT 'busy'::varchar, NULL::uuid, execution.lease_expires_at;
  ELSIF p_execution_number <= execution.attempt_count THEN
    RETURN QUERY SELECT 'busy'::varchar, NULL::uuid, execution.lease_expires_at;
  ELSIF p_execution_number <> execution.attempt_count + 1 THEN
    RETURN QUERY SELECT 'collision'::varchar, NULL::uuid, NULL::timestamptz;
  ELSIF execution.state = 'reconciliation_required' THEN
    RETURN QUERY SELECT 'reconciliation_required'::varchar, NULL::uuid, NULL::timestamptz;
  ELSIF execution.state = 'in_progress' THEN
    UPDATE app.worker_handler_executions stored
    SET state = 'reconciliation_required',
        lease_token = NULL,
        lease_expires_at = NULL,
        safe_failure_category = 'AMBIGUOUS_EXTERNAL_EFFECT'
    WHERE stored.handler_version = p_handler_version
      AND stored.outbox_event_id = p_outbox_event_id;
    RETURN QUERY SELECT 'reconciliation_required'::varchar, NULL::uuid, NULL::timestamptz;
  ELSE
    UPDATE app.worker_handler_executions stored
    SET state = 'in_progress',
        attempt_count = p_execution_number,
        lease_token = new_lease_token,
        lease_expires_at = clock_timestamp() + p_lease_seconds * interval '1 second',
        safe_failure_category = NULL,
        last_started_at = clock_timestamp()
    WHERE stored.handler_version = p_handler_version
      AND stored.outbox_event_id = p_outbox_event_id;
    RETURN QUERY
      SELECT 'acquired'::varchar, new_lease_token,
             clock_timestamp() + p_lease_seconds * interval '1 second';
  END IF;
END
$function$;

CREATE FUNCTION app.resume_worker_handler_execution(
  p_organization_id uuid,
  p_outbox_event_id uuid,
  p_handler_version varchar,
  p_input_fingerprint bytea,
  p_execution_number integer,
  p_lease_seconds integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  new_lease_token uuid := gen_random_uuid();
BEGIN
  IF session_user <> 'lead_agent_queue_runtime'
    OR p_handler_version !~ '^v[1-9][0-9]{0,5}$'
    OR octet_length(p_input_fingerprint) <> 32
    OR p_execution_number NOT BETWEEN 1 AND 5
    OR p_lease_seconds NOT BETWEEN 10 AND 900
  THEN
    RAISE EXCEPTION 'invalid worker execution resume'
      USING ERRCODE = '22023';
  END IF;

  UPDATE app.worker_handler_executions execution
  SET state = 'in_progress',
      attempt_count = p_execution_number,
      lease_token = new_lease_token,
      lease_expires_at = clock_timestamp() + p_lease_seconds * interval '1 second',
      safe_failure_category = NULL,
      last_started_at = clock_timestamp()
  WHERE execution.handler_version = p_handler_version
    AND execution.outbox_event_id = p_outbox_event_id
    AND execution.organization_id = p_organization_id
    AND execution.input_fingerprint = p_input_fingerprint
    AND execution.state = 'reconciliation_required'
    AND p_execution_number = execution.attempt_count + 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN new_lease_token;
END
$function$;

CREATE FUNCTION app.finish_worker_handler_execution(
  p_organization_id uuid,
  p_outbox_event_id uuid,
  p_handler_version varchar,
  p_execution_lease_token uuid,
  p_next_state varchar,
  p_safe_failure_category varchar
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF session_user <> 'lead_agent_queue_runtime'
    OR p_next_state NOT IN (
      'retryable_failure', 'succeeded', 'permanent_failure',
      'reconciliation_required'
    )
    OR (p_next_state = 'succeeded' AND p_safe_failure_category IS NOT NULL)
    OR (p_next_state = 'retryable_failure'
      AND p_safe_failure_category NOT IN ('RETRYABLE_INFRASTRUCTURE', 'RATE_LIMITED'))
    OR (p_next_state = 'reconciliation_required'
      AND p_safe_failure_category <> 'AMBIGUOUS_EXTERNAL_EFFECT')
    OR (p_next_state = 'permanent_failure' AND p_safe_failure_category NOT IN (
      'RETRYABLE_INFRASTRUCTURE', 'RATE_LIMITED', 'PERMANENT_VALIDATION',
      'UNSUPPORTED_VERSION', 'TENANT_INTEGRITY', 'PERMANENT_BUSINESS',
      'AMBIGUOUS_EXTERNAL_EFFECT'
    ))
  THEN
    RAISE EXCEPTION 'invalid worker execution completion'
      USING ERRCODE = '22023';
  END IF;

  UPDATE app.worker_handler_executions execution
  SET state = p_next_state,
      lease_token = NULL,
      lease_expires_at = NULL,
      safe_failure_category = p_safe_failure_category,
      completed_at = CASE
        WHEN p_next_state IN ('succeeded', 'permanent_failure')
        THEN clock_timestamp()
        ELSE NULL
      END
  WHERE execution.handler_version = p_handler_version
    AND execution.outbox_event_id = p_outbox_event_id
    AND execution.organization_id = p_organization_id
    AND execution.state = 'in_progress'
    AND execution.lease_token = p_execution_lease_token;

  RETURN FOUND;
END
$function$;

CREATE FUNCTION app.resolve_worker_handler_reconciliation(
  p_organization_id uuid,
  p_outbox_event_id uuid,
  p_handler_version varchar,
  p_input_fingerprint bytea,
  p_resolution varchar,
  p_safe_failure_category varchar
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF session_user <> 'lead_agent_queue_runtime'
    OR p_resolution NOT IN ('succeeded', 'permanent_failure', 'unresolved')
    OR (p_resolution = 'succeeded' AND p_safe_failure_category IS NOT NULL)
    OR (p_resolution = 'permanent_failure'
      AND p_safe_failure_category NOT IN ('PERMANENT_BUSINESS', 'TENANT_INTEGRITY'))
    OR (p_resolution = 'unresolved'
      AND p_safe_failure_category <> 'AMBIGUOUS_EXTERNAL_EFFECT')
  THEN
    RAISE EXCEPTION 'invalid worker reconciliation resolution'
      USING ERRCODE = '22023';
  END IF;

  UPDATE app.worker_handler_executions execution
  SET state = CASE WHEN p_resolution = 'unresolved'
                   THEN 'reconciliation_required' ELSE p_resolution END,
      safe_failure_category = p_safe_failure_category,
      completed_at = CASE WHEN p_resolution = 'unresolved'
                          THEN NULL ELSE clock_timestamp() END
  WHERE execution.handler_version = p_handler_version
    AND execution.outbox_event_id = p_outbox_event_id
    AND execution.organization_id = p_organization_id
    AND execution.input_fingerprint = p_input_fingerprint
    AND execution.state = 'reconciliation_required';

  RETURN FOUND;
END
$function$;

CREATE FUNCTION app.prepare_worker_job_retry(
  p_queue_name varchar,
  p_physical_job_id uuid,
  p_expected_retry_count integer,
  p_retry_delay_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF session_user <> 'lead_agent_queue_runtime'
    OR p_queue_name NOT IN (
      'inbound', 'ai', 'outbound_message', 'staff_notification',
      'analytics', 'maintenance'
    )
    OR p_expected_retry_count NOT BETWEEN 0 AND 3
    OR p_retry_delay_seconds NOT BETWEEN 0 AND 300
  THEN
    RAISE EXCEPTION 'invalid worker retry preparation'
      USING ERRCODE = '22023';
  END IF;

  UPDATE pgboss.job job
  SET retry_delay = p_retry_delay_seconds,
      retry_backoff = false,
      retry_delay_max = NULL
  WHERE job.name = p_queue_name
    AND job.id = p_physical_job_id
    AND job.state = 'active'
    AND job.retry_count = p_expected_retry_count
    AND job.retry_limit = 4;

  RETURN FOUND;
END
$function$;
--> statement-breakpoint
DO $queues$
DECLARE
  workload varchar;
  v_dead_letter varchar;
BEGIN
  FOREACH workload IN ARRAY ARRAY[
    'inbound', 'ai', 'outbound_message', 'staff_notification',
    'analytics', 'maintenance'
  ]::varchar[]
  LOOP
    v_dead_letter := workload || '_dlq';
    PERFORM pgboss.create_queue(
      v_dead_letter,
      jsonb_build_object(
        'policy', 'standard',
        'retryLimit', 0,
        'retryDelay', 0,
        'retryBackoff', false,
        'expireInSeconds', 900,
        'retentionSeconds', 2147483647,
        'deleteAfterSeconds', 2592000,
        'heartbeatSeconds', 60
      )
    );

    UPDATE pgboss.queue
    SET retry_limit = 0,
        retry_delay = 0,
        retry_backoff = false,
        retry_delay_max = NULL,
        expire_seconds = 900,
        retention_seconds = 2147483647,
        deletion_seconds = 2592000,
        heartbeat_seconds = 60,
        dead_letter = NULL,
        updated_on = clock_timestamp()
    WHERE name = v_dead_letter;

    UPDATE pgboss.queue
    SET retry_limit = 4,
        retry_delay = 0,
        retry_backoff = false,
        retry_delay_max = NULL,
        expire_seconds = 900,
        retention_seconds = 86400,
        deletion_seconds = 604800,
        heartbeat_seconds = 60,
        dead_letter = v_dead_letter,
        updated_on = clock_timestamp()
    WHERE name = workload;
  END LOOP;
END
$queues$;
--> statement-breakpoint
CREATE FUNCTION app.operator_redrive_worker_dlq_job(
  p_audit_event_id uuid,
  p_operator_principal_id uuid,
  p_dlq_job_id uuid,
  p_source_queue varchar,
  p_handler_version varchar,
  p_outbox_event_id uuid,
  p_expected_event_type varchar,
  p_expected_schema_version varchar,
  p_expected_dlq_state varchar,
  p_approval_reference varchar,
  p_reason_code varchar,
  p_request_id varchar,
  p_source_ip_hash bytea
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  source_job pgboss.job%ROWTYPE;
  v_organization_id uuid;
  v_execution_organization_id uuid;
  v_execution_state varchar;
  v_previous_attempt_count integer;
  v_execution_found boolean;
  redriven_job_id uuid := gen_random_uuid();
BEGIN
  IF session_user <> 'lead_agent_async_operator'
    OR p_source_queue NOT IN (
      'inbound', 'ai', 'outbound_message', 'staff_notification',
      'analytics', 'maintenance'
    )
    OR p_handler_version !~ '^v[1-9][0-9]{0,5}$'
    OR p_expected_event_type !~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
    OR p_expected_schema_version !~ '^[1-9][0-9]{0,5}$'
    OR p_expected_dlq_state <> 'created'
  THEN
    RAISE EXCEPTION 'invalid worker DLQ redrive request'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO source_job
  FROM pgboss.job job
  WHERE job.name = p_source_queue || '_dlq'
    AND job.id = p_dlq_job_id
    AND job.state::text = p_expected_dlq_state
    AND job.source_name = p_source_queue
    AND job.data->>'outbox_event_id' = p_outbox_event_id::text
    AND job.data->>'event_type' = p_expected_event_type
    AND job.data->>'event_schema_version' = p_expected_schema_version
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker DLQ job is not redrivable'
      USING ERRCODE = 'P0001';
  END IF;

  v_organization_id := (source_job.data->>'organization_id')::uuid;
  SELECT execution.organization_id, execution.state, execution.attempt_count
  INTO v_execution_organization_id, v_execution_state, v_previous_attempt_count
  FROM app.worker_handler_executions execution
  WHERE execution.handler_version = p_handler_version
    AND execution.outbox_event_id = p_outbox_event_id
  FOR UPDATE;
  v_execution_found := FOUND;

  IF (v_execution_found AND (
      v_execution_organization_id <> v_organization_id
      OR v_execution_state NOT IN ('permanent_failure', 'reconciliation_required')
    )) OR NOT EXISTS (
    SELECT 1 FROM public.outbox_events event
    WHERE event.organization_id = v_organization_id
      AND event.id = p_outbox_event_id
      AND event.status = 'published'
      AND event.event_type = p_expected_event_type
      AND event.schema_version = p_expected_schema_version
  ) THEN
    RAISE EXCEPTION 'worker DLQ job redrive denied'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE app.worker_handler_executions execution
  SET state = 'reconciliation_required',
      attempt_count = 0,
      lease_token = NULL,
      lease_expires_at = NULL,
      safe_failure_category = 'AMBIGUOUS_EXTERNAL_EFFECT',
      completed_at = NULL
  WHERE execution.handler_version = p_handler_version
    AND execution.outbox_event_id = p_outbox_event_id
    AND execution.organization_id = v_organization_id
    AND execution.state IN ('permanent_failure', 'reconciliation_required');

  INSERT INTO pgboss.job (
    id, name, data, priority, retry_limit, retry_backoff, retry_delay,
    retry_delay_max, expire_seconds, keep_until, deletion_seconds, policy,
    singleton_key, group_id, group_tier, heartbeat_seconds, dead_letter,
    created_on
  )
  SELECT redriven_job_id, p_source_queue, source_job.data, source_job.priority,
         queue.retry_limit, queue.retry_backoff, queue.retry_delay,
         queue.retry_delay_max, queue.expire_seconds,
         source_job.source_created_on + interval '24 hours',
         queue.deletion_seconds, queue.policy, source_job.singleton_key,
         source_job.group_id, source_job.group_tier, queue.heartbeat_seconds,
         queue.dead_letter, source_job.source_created_on
  FROM pgboss.queue queue
  WHERE queue.name = p_source_queue;

  UPDATE pgboss.job job
  SET state = 'completed', completed_on = clock_timestamp()
  WHERE job.name = p_source_queue || '_dlq'
    AND job.id = p_dlq_job_id
    AND job.state = 'created';

  INSERT INTO public.platform_audit_events (
    id, operator_principal_id, action, target_organization_id, target_type,
    target_id, approval_reference, reason_code, result, request_id,
    source_ip_hash, occurred_at, metadata_jsonb
  ) VALUES (
    p_audit_event_id, p_operator_principal_id, 'job.redriven', v_organization_id,
    'worker_job', p_outbox_event_id, p_approval_reference, p_reason_code,
    'succeeded', p_request_id, p_source_ip_hash, clock_timestamp(),
    jsonb_build_object(
      'dlq_job_id', p_dlq_job_id,
      'redriven_job_id', redriven_job_id,
      'source_queue', p_source_queue,
      'handler_version', p_handler_version,
      'event_type', p_expected_event_type,
      'schema_version', p_expected_schema_version,
      'previous_state', p_expected_dlq_state,
      'previous_execution_state', v_execution_state,
      'previous_attempt_count', v_previous_attempt_count
    )
  );

  RETURN redriven_job_id;
END
$function$;

CREATE FUNCTION app.operator_requeue_dead_outbox_event(
  p_audit_event_id uuid,
  p_operator_principal_id uuid,
  p_organization_id uuid,
  p_outbox_event_id uuid,
  p_expected_event_type varchar,
  p_expected_schema_version varchar,
  p_expected_state varchar,
  p_expected_error_category varchar,
  p_approval_reference varchar,
  p_reason_code varchar,
  p_request_id varchar,
  p_source_ip_hash bytea
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF session_user <> 'lead_agent_async_operator'
    OR p_expected_event_type !~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
    OR p_expected_schema_version !~ '^[1-9][0-9]{0,5}$'
    OR p_expected_state <> 'dead_lettered'
    OR p_expected_error_category !~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'
  THEN
    RAISE EXCEPTION 'invalid dead outbox requeue request'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.outbox_events event
  SET status = 'pending',
      available_at = GREATEST(clock_timestamp(), event.occurred_at),
      locked_by = NULL,
      locked_until = NULL,
      lease_token = NULL,
      published_at = NULL,
      published_claim_token = NULL,
      last_error_category = NULL
  WHERE event.organization_id = p_organization_id
    AND event.id = p_outbox_event_id
    AND event.status = p_expected_state
    AND event.event_type = p_expected_event_type
    AND event.schema_version = p_expected_schema_version
    AND event.last_error_category = p_expected_error_category;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dead outbox event is not requeueable'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.platform_audit_events (
    id, operator_principal_id, action, target_organization_id, target_type,
    target_id, approval_reference, reason_code, result, request_id,
    source_ip_hash, occurred_at, metadata_jsonb
  ) VALUES (
    p_audit_event_id, p_operator_principal_id, 'outbox.requeued',
    p_organization_id, 'outbox_event', p_outbox_event_id,
    p_approval_reference, p_reason_code, 'succeeded', p_request_id,
    p_source_ip_hash, clock_timestamp(),
    jsonb_build_object(
      'event_type', p_expected_event_type,
      'schema_version', p_expected_schema_version,
      'previous_state', p_expected_state,
      'previous_error_category', p_expected_error_category
    )
  );

  RETURN true;
END
$function$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app, public, pgboss
  TO lead_agent_worker_reliability_definer,
     lead_agent_async_maintenance_definer;

GRANT SELECT (id, organization_id, status)
  ON TABLE public.outbox_events
  TO lead_agent_worker_reliability_definer;
GRANT SELECT, INSERT, UPDATE ON TABLE app.worker_handler_executions
  TO lead_agent_worker_reliability_definer;
GRANT SELECT, UPDATE ON TABLE pgboss.job
  TO lead_agent_worker_reliability_definer;

GRANT UPDATE (
  monitor_claim_on, monitor_on, maintain_on, deferred_count, queued_count,
  ready_count, active_count, failed_count, total_count, ready_history,
  singletons_active
) ON TABLE pgboss.queue TO lead_agent_queue_runtime;
GRANT UPDATE (flow_on) ON TABLE pgboss.version TO lead_agent_queue_runtime;

GRANT SELECT (
  id, organization_id, event_type, schema_version, status, occurred_at,
  last_error_category
)
  ON TABLE public.outbox_events
  TO lead_agent_async_maintenance_definer;
GRANT UPDATE (
  status, available_at, locked_by, locked_until, lease_token, published_at,
  published_claim_token, last_error_category
) ON TABLE public.outbox_events
  TO lead_agent_async_maintenance_definer;
GRANT INSERT ON TABLE public.platform_audit_events
  TO lead_agent_async_maintenance_definer;
GRANT SELECT, UPDATE ON TABLE app.worker_handler_executions
  TO lead_agent_async_maintenance_definer;
GRANT SELECT ON TABLE pgboss.queue
  TO lead_agent_async_maintenance_definer;
GRANT SELECT, INSERT, UPDATE ON TABLE pgboss.job, pgboss.job_common
  TO lead_agent_async_maintenance_definer;

CREATE POLICY outbox_events_worker_reliability_select
  ON public.outbox_events
  FOR SELECT
  TO lead_agent_worker_reliability_definer
  USING (true);

CREATE POLICY outbox_events_async_maintenance_select
  ON public.outbox_events
  FOR SELECT
  TO lead_agent_async_maintenance_definer
  USING (true);

CREATE POLICY outbox_events_async_maintenance_update
  ON public.outbox_events
  FOR UPDATE
  TO lead_agent_async_maintenance_definer
  USING (true)
  WITH CHECK (true);

ALTER FUNCTION app.acquire_worker_handler_execution(uuid, uuid, varchar, bytea, integer, integer)
  OWNER TO lead_agent_worker_reliability_definer;
ALTER FUNCTION app.resume_worker_handler_execution(uuid, uuid, varchar, bytea, integer, integer)
  OWNER TO lead_agent_worker_reliability_definer;
ALTER FUNCTION app.finish_worker_handler_execution(uuid, uuid, varchar, uuid, varchar, varchar)
  OWNER TO lead_agent_worker_reliability_definer;
ALTER FUNCTION app.resolve_worker_handler_reconciliation(uuid, uuid, varchar, bytea, varchar, varchar)
  OWNER TO lead_agent_worker_reliability_definer;
ALTER FUNCTION app.prepare_worker_job_retry(varchar, uuid, integer, integer)
  OWNER TO lead_agent_worker_reliability_definer;
ALTER FUNCTION app.operator_redrive_worker_dlq_job(
  uuid, uuid, uuid, varchar, varchar, uuid, varchar, varchar, varchar, varchar, varchar, varchar, bytea
) OWNER TO lead_agent_async_maintenance_definer;
ALTER FUNCTION app.operator_requeue_dead_outbox_event(
  uuid, uuid, uuid, uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, bytea
) OWNER TO lead_agent_async_maintenance_definer;

REVOKE ALL PRIVILEGES ON TABLE app.worker_handler_executions
  FROM PUBLIC, lead_agent_queue_runtime, lead_agent_async_operator,
       lead_agent_runtime, lead_agent_ingress, lead_agent_auth;

REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA app
  FROM PUBLIC, lead_agent_async_operator;

GRANT EXECUTE ON FUNCTION
  app.acquire_worker_handler_execution(uuid, uuid, varchar, bytea, integer, integer),
  app.resume_worker_handler_execution(uuid, uuid, varchar, bytea, integer, integer),
  app.finish_worker_handler_execution(uuid, uuid, varchar, uuid, varchar, varchar),
  app.resolve_worker_handler_reconciliation(uuid, uuid, varchar, bytea, varchar, varchar),
  app.prepare_worker_job_retry(varchar, uuid, integer, integer)
  TO lead_agent_queue_runtime;

GRANT USAGE ON SCHEMA app TO lead_agent_async_operator;
GRANT EXECUTE ON FUNCTION
  app.operator_redrive_worker_dlq_job(
    uuid, uuid, uuid, varchar, varchar, uuid, varchar, varchar, varchar, varchar, varchar, varchar, bytea
  ),
  app.operator_requeue_dead_outbox_event(
    uuid, uuid, uuid, uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, bytea
  )
  TO lead_agent_async_operator;
