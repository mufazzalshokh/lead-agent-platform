CREATE TABLE "thread_automation_controls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_connection_id" uuid NOT NULL,
	"external_thread_hash" "bytea" NOT NULL,
	"eligibility_state" varchar(24) NOT NULL,
	"decision_source" varchar(32) NOT NULL,
	"reason_code" varchar(100) NOT NULL,
	"decided_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "thread_automation_controls_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "thread_automation_controls_thread_unique" UNIQUE("organization_id","channel_connection_id","external_thread_hash"),
	CONSTRAINT "thread_automation_controls_id_uuid_v7_check" CHECK ("thread_automation_controls"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "thread_automation_controls_thread_hash_check" CHECK (octet_length("thread_automation_controls"."external_thread_hash") between 16 and 128),
	CONSTRAINT "thread_automation_controls_eligibility_state_check" CHECK ("thread_automation_controls"."eligibility_state" in ('business_eligible', 'excluded_personal', 'uncertain', 'staff_only')),
	CONSTRAINT "thread_automation_controls_decision_source_check" CHECK ("thread_automation_controls"."decision_source" in ('system_default', 'staff', 'owner_configuration', 'provider_rule', 'platform_policy')),
	CONSTRAINT "thread_automation_controls_reason_code_check" CHECK ("thread_automation_controls"."reason_code" = lower(btrim("thread_automation_controls"."reason_code"))
        and length("thread_automation_controls"."reason_code") between 1 and 100
        and "thread_automation_controls"."reason_code" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'),
	CONSTRAINT "thread_automation_controls_staff_provenance_check" CHECK (("thread_automation_controls"."decision_source" = 'staff') = ("thread_automation_controls"."decided_by_membership_id" is not null)),
	CONSTRAINT "thread_automation_controls_version_check" CHECK ("thread_automation_controls"."version" > 0),
	CONSTRAINT "thread_automation_controls_timestamps_check" CHECK ("thread_automation_controls"."updated_at" >= "thread_automation_controls"."created_at")
);
--> statement-breakpoint
ALTER TABLE "thread_automation_controls" ADD CONSTRAINT "thread_automation_controls_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "thread_automation_controls" ADD CONSTRAINT "thread_automation_controls_channel_connection_fk" FOREIGN KEY ("organization_id","channel_connection_id") REFERENCES "public"."channel_connections"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "thread_automation_controls" ADD CONSTRAINT "thread_automation_controls_decider_membership_fk" FOREIGN KEY ("organization_id","decided_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "thread_automation_controls_hot_lookup_idx" ON "thread_automation_controls" USING btree ("organization_id","channel_connection_id","external_thread_hash");--> statement-breakpoint
CREATE INDEX "thread_automation_controls_organization_state_updated_idx" ON "thread_automation_controls" USING btree ("organization_id","eligibility_state","updated_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE public.thread_automation_controls ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.thread_automation_controls FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY thread_automation_controls_tenant_isolation
ON public.thread_automation_controls
TO lead_agent_runtime
USING (organization_id = app.current_organization_id())
WITH CHECK (organization_id = app.current_organization_id());--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public.thread_automation_controls
FROM PUBLIC, lead_agent_runtime, lead_agent_ingress, lead_agent_inbound_route_definer;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.thread_automation_controls TO lead_agent_runtime;
