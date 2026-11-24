-- Optional customer-owned reauthentication; original issue/expiry remain immutable.
-- No backfill, recovery proof issuance, booking/budget changes, or RLS/role changes.
ALTER TABLE "widget_sessions" ADD COLUMN "recovery_token_hash" bytea;
--> statement-breakpoint
ALTER TABLE "widget_sessions" ADD COLUMN "recovery_issued_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "widget_sessions" ADD COLUMN "recovery_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "widget_sessions" ADD COLUMN "recovery_request_origin" varchar(2048);
--> statement-breakpoint
ALTER TABLE "widget_sessions" ADD COLUMN "recovery_embedding_origin" varchar(2048);
--> statement-breakpoint
ALTER TABLE "widget_sessions" ADD COLUMN "access_issued_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "widget_sessions" ADD COLUMN "access_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "widget_sessions" DROP CONSTRAINT "widget_sessions_lifetime_check";
--> statement-breakpoint
ALTER TABLE "widget_sessions" ADD CONSTRAINT "widget_sessions_lifetime_check" CHECK (
  expires_at > issued_at AND last_seen_at >= issued_at
  AND last_seen_at < coalesce(access_expires_at, expires_at)
);
--> statement-breakpoint
ALTER TABLE "widget_sessions" DROP CONSTRAINT "widget_sessions_revocation_check";
--> statement-breakpoint
ALTER TABLE "widget_sessions" ADD CONSTRAINT "widget_sessions_revocation_check" CHECK (
  (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_at >= issued_at
    AND revoked_at < coalesce(recovery_expires_at, access_expires_at, expires_at))
  OR (status <> 'revoked' AND revoked_at IS NULL)
);
--> statement-breakpoint
ALTER TABLE "widget_sessions" ADD CONSTRAINT "widget_sessions_recovery_shape_check" CHECK (
  (recovery_token_hash IS NULL AND recovery_issued_at IS NULL AND recovery_expires_at IS NULL
    AND recovery_request_origin IS NULL AND recovery_embedding_origin IS NULL)
  OR (recovery_token_hash IS NOT NULL AND octet_length(recovery_token_hash) = 32
    AND recovery_issued_at IS NOT NULL AND recovery_expires_at IS NOT NULL
    AND recovery_issued_at >= issued_at AND recovery_expires_at > recovery_issued_at
    AND recovery_expires_at <= recovery_issued_at + interval '24 hours'
    AND recovery_request_origin IS NOT NULL AND length(recovery_request_origin) > 0
    AND recovery_embedding_origin IS NOT NULL AND length(recovery_embedding_origin) > 0
    AND contact_id IS NOT NULL AND conversation_id IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "widget_sessions" ADD CONSTRAINT "widget_sessions_access_shape_check" CHECK (
  (access_issued_at IS NULL AND access_expires_at IS NULL)
  OR (access_issued_at IS NOT NULL AND access_expires_at IS NOT NULL
    AND recovery_issued_at IS NOT NULL AND recovery_expires_at IS NOT NULL
    AND access_issued_at >= recovery_issued_at AND last_seen_at >= access_issued_at
    AND access_expires_at > access_issued_at
    AND access_expires_at <= access_issued_at + interval '2 hours'
    AND access_expires_at <= recovery_expires_at)
);
