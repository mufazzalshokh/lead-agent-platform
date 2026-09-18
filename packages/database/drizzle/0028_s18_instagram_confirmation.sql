ALTER TABLE "analytics_events" DROP CONSTRAINT "analytics_events_schema_version_check";--> statement-breakpoint
ALTER TABLE "analytics_events" DROP CONSTRAINT "analytics_events_confirmation_source_check";--> statement-breakpoint
ALTER TABLE "appointment_confirmation_evidence" DROP CONSTRAINT "appointment_confirmation_evidence_source_check";--> statement-breakpoint
ALTER TABLE "appointment_confirmation_evidence" DROP CONSTRAINT "appointment_confirmation_evidence_source_shape_check";--> statement-breakpoint
ALTER TABLE "appointment_requests" DROP CONSTRAINT "appointment_requests_confirmation_source_check";--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_schema_version_check";--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_instagram_confirmation_version_check" CHECK ("analytics_events"."confirmation_source" is distinct from 'instagram'
      or ("analytics_events"."event_type" = 'appointment_request.confirmed' and "analytics_events"."schema_version" = '2'));--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_schema_version_check" CHECK (("analytics_events"."event_type" in ('lead.reopened', 'contact.identity_added', 'appointment_request.confirmed') and "analytics_events"."schema_version" in ('1', '2'))
        or ("analytics_events"."event_type" not in ('lead.reopened', 'contact.identity_added', 'appointment_request.confirmed') and "analytics_events"."schema_version" = '1'));--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_confirmation_source_check" CHECK ("analytics_events"."confirmation_source" is null
        or "analytics_events"."confirmation_source" in ('customer_session', 'telegram', 'staff_attested_external', 'instagram'));--> statement-breakpoint
ALTER TABLE "appointment_confirmation_evidence" ADD CONSTRAINT "appointment_confirmation_evidence_source_check" CHECK ("appointment_confirmation_evidence"."source" in ('customer_session', 'telegram', 'staff_attested_external', 'instagram'));--> statement-breakpoint
ALTER TABLE "appointment_confirmation_evidence" ADD CONSTRAINT "appointment_confirmation_evidence_source_shape_check" CHECK (("appointment_confirmation_evidence"."source" = 'customer_session'
          and "appointment_confirmation_evidence"."recorded_by_membership_id" is null
          and "appointment_confirmation_evidence"."source_message_id" is null
          and "appointment_confirmation_evidence"."attestation_method" is null
          and "appointment_confirmation_evidence"."attestation_reason_code" is null)
        or ("appointment_confirmation_evidence"."source" in ('telegram', 'instagram')
          and "appointment_confirmation_evidence"."recorded_by_membership_id" is null
          and "appointment_confirmation_evidence"."source_message_id" is not null
          and "appointment_confirmation_evidence"."attestation_method" is null
          and "appointment_confirmation_evidence"."attestation_reason_code" is null)
        or ("appointment_confirmation_evidence"."source" = 'staff_attested_external'
          and "appointment_confirmation_evidence"."outcome" = 'confirmed'
          and "appointment_confirmation_evidence"."recorded_by_membership_id" is not null
          and "appointment_confirmation_evidence"."source_message_id" is null
          and "appointment_confirmation_evidence"."attestation_method" in ('phone', 'in_person')
          and "appointment_confirmation_evidence"."attestation_reason_code" is not null));--> statement-breakpoint
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_confirmation_source_check" CHECK ("appointment_requests"."confirmation_source" is null
        or "appointment_requests"."confirmation_source" in ('customer_session', 'telegram', 'staff_attested_external', 'instagram'));--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_instagram_confirmation_version_check" CHECK ("outbox_events"."event_type" <> 'appointment_request.confirmed'
      or coalesce("outbox_events"."payload_jsonb" #>> '{payload,confirmation_source}', '') <> 'instagram'
      or "outbox_events"."schema_version" = '2');--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_schema_version_check" CHECK (("outbox_events"."event_type" in ('lead.reopened', 'contact.identity_added', 'appointment_request.confirmed') and "outbox_events"."schema_version" in ('1', '2'))
        or ("outbox_events"."event_type" not in ('lead.reopened', 'contact.identity_added', 'appointment_request.confirmed') and "outbox_events"."schema_version" = '1'));