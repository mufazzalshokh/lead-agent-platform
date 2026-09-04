DO $role_provisioning$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'lead_agent_runtime') THEN
		CREATE ROLE lead_agent_runtime LOGIN;
	END IF;

	IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'lead_agent_ingress') THEN
		CREATE ROLE lead_agent_ingress LOGIN;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'lead_agent_inbound_route_definer'
	) THEN
		CREATE ROLE lead_agent_inbound_route_definer NOLOGIN;
	END IF;
END
$role_provisioning$;
--> statement-breakpoint
ALTER ROLE lead_agent_runtime
	LOGIN NOSUPERUSER INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
--> statement-breakpoint
ALTER ROLE lead_agent_ingress
	LOGIN NOSUPERUSER INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
--> statement-breakpoint
ALTER ROLE lead_agent_inbound_route_definer
	NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
--> statement-breakpoint
REVOKE lead_agent_inbound_route_definer FROM lead_agent_runtime, lead_agent_ingress;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON SCHEMA app FROM PUBLIC;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
	FROM lead_agent_runtime, lead_agent_ingress, lead_agent_inbound_route_definer;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
	FROM lead_agent_runtime, lead_agent_ingress, lead_agent_inbound_route_definer;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public
	FROM lead_agent_runtime, lead_agent_ingress, lead_agent_inbound_route_definer;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
	SELECT NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::uuid
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.current_organization_id() FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public, app TO lead_agent_runtime;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_organization_id() TO lead_agent_runtime;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO lead_agent_inbound_route_definer;
--> statement-breakpoint
GRANT SELECT ON TABLE public.inbound_routes TO lead_agent_inbound_route_definer;
--> statement-breakpoint
DO $database_connect$
BEGIN
	EXECUTE pg_catalog.format(
		'GRANT CONNECT ON DATABASE %I TO lead_agent_runtime, lead_agent_ingress',
		pg_catalog.current_database()
	);
END
$database_connect$;
--> statement-breakpoint
DO $tenant_rls$
DECLARE
	tenant_table text;
BEGIN
	FOREACH tenant_table IN ARRAY ARRAY[
		'ai_action_evaluations',
		'ai_runs',
		'analytics_events',
		'appointment_confirmation_evidence',
		'appointment_request_attendance',
		'appointment_request_preferences',
		'appointment_request_transitions',
		'appointment_requests',
		'appointment_revenue_attributions',
		'audit_events',
		'business_policies',
		'channel_connections',
		'consent_records',
		'contact_identities',
		'contacts',
		'conversations',
		'faqs',
		'handoff_transitions',
		'handoffs',
		'idempotency_keys',
		'lead_qualification_evaluations',
		'lead_qualification_evidence',
		'leads',
		'legal_holds',
		'location_business_hours',
		'location_closures',
		'location_versions',
		'locations',
		'memberships',
		'messages',
		'notification_attempts',
		'notifications',
		'outbox_events',
		'privacy_requests',
		'retention_policies',
		'retention_policy_rules',
		'service_locations',
		'service_prices',
		'service_versions',
		'services',
		'webhook_receipts',
		'widget_allowed_origins',
		'widget_sessions'
	]::text[]
	LOOP
		EXECUTE pg_catalog.format(
			'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
			tenant_table
		);
		EXECUTE pg_catalog.format(
			'ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',
			tenant_table
		);
		EXECUTE pg_catalog.format(
			'CREATE POLICY %I ON public.%I TO lead_agent_runtime USING (organization_id = app.current_organization_id()) WITH CHECK (organization_id = app.current_organization_id())',
			tenant_table || '_tenant_isolation',
			tenant_table
		);
	END LOOP;
END
$tenant_rls$;
--> statement-breakpoint
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organizations_tenant_isolation ON public.organizations
	TO lead_agent_runtime
	USING (id = app.current_organization_id())
	WITH CHECK (id = app.current_organization_id());
--> statement-breakpoint
ALTER TABLE public.inbound_routes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.inbound_routes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inbound_routes_tenant_isolation ON public.inbound_routes
	TO lead_agent_runtime
	USING (organization_id = app.current_organization_id())
	WITH CHECK (organization_id = app.current_organization_id());
--> statement-breakpoint
DO $tenant_grants$
DECLARE
	tenant_table text;
BEGIN
	FOREACH tenant_table IN ARRAY ARRAY[
		'ai_action_evaluations',
		'ai_runs',
		'analytics_events',
		'appointment_confirmation_evidence',
		'appointment_request_attendance',
		'appointment_request_preferences',
		'appointment_request_transitions',
		'appointment_requests',
		'appointment_revenue_attributions',
		'business_policies',
		'channel_connections',
		'consent_records',
		'contact_identities',
		'contacts',
		'conversations',
		'faqs',
		'handoff_transitions',
		'handoffs',
		'idempotency_keys',
		'lead_qualification_evaluations',
		'lead_qualification_evidence',
		'leads',
		'legal_holds',
		'location_business_hours',
		'location_closures',
		'location_versions',
		'locations',
		'memberships',
		'messages',
		'notification_attempts',
		'notifications',
		'outbox_events',
		'privacy_requests',
		'retention_policies',
		'retention_policy_rules',
		'service_locations',
		'service_prices',
		'service_versions',
		'services',
		'webhook_receipts',
		'widget_allowed_origins',
		'widget_sessions'
	]::text[]
	LOOP
		EXECUTE pg_catalog.format(
			'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO lead_agent_runtime',
			tenant_table
		);
	END LOOP;
END
$tenant_grants$;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.audit_events TO lead_agent_runtime;
--> statement-breakpoint
GRANT SELECT, UPDATE ON TABLE public.organizations TO lead_agent_runtime;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public.inbound_routes
	FROM lead_agent_runtime, lead_agent_ingress;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public.users, public.platform_audit_events
	FROM lead_agent_runtime, lead_agent_ingress, lead_agent_inbound_route_definer;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
