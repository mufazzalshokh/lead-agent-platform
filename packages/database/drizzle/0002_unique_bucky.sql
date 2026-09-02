CREATE EXTENSION IF NOT EXISTS "btree_gist";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "is_bounded_locale_map"("value" jsonb, "max_chars" integer)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
	DECLARE
		entry_count integer;
	BEGIN
		IF jsonb_typeof("value") <> 'object' OR "max_chars" <= 0 THEN
			RETURN false;
		END IF;

		SELECT count(*) INTO entry_count FROM jsonb_each("value");
		IF entry_count NOT BETWEEN 1 AND 3 THEN
			RETURN false;
		END IF;

		RETURN NOT EXISTS (
			SELECT 1
			FROM jsonb_each("value") AS entry("key", "localized_value")
			WHERE entry."key" NOT IN ('uz', 'ru', 'en')
				OR jsonb_typeof(entry."localized_value") <> 'string'
				OR length(btrim(entry."localized_value" #>> '{}')) NOT BETWEEN 1 AND "max_chars"
		);
	END;
$$;
--> statement-breakpoint
CREATE TABLE "business_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_key" varchar(128) NOT NULL,
	"version_no" integer NOT NULL,
	"policy_type" varchar(32) NOT NULL,
	"schema_version" integer NOT NULL,
	"rules_jsonb" jsonb NOT NULL,
	"status" varchar(16) NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"content_hash" "bytea" NOT NULL,
	"published_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_policies_organization_key_version_unique" UNIQUE("organization_id","policy_key","version_no"),
	CONSTRAINT "business_policies_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "business_policies_id_uuid_v7_check" CHECK ("business_policies"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "business_policies_key_normalized_check" CHECK ("business_policies"."policy_key" = lower(btrim("business_policies"."policy_key"))
        and "business_policies"."policy_key" ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
	CONSTRAINT "business_policies_version_no_check" CHECK ("business_policies"."version_no" > 0),
	CONSTRAINT "business_policies_type_check" CHECK ("business_policies"."policy_type" in ('qualification', 'booking', 'handoff', 'safety', 'consent')),
	CONSTRAINT "business_policies_schema_version_check" CHECK ("business_policies"."schema_version" > 0),
	CONSTRAINT "business_policies_rules_check" CHECK (jsonb_typeof("business_policies"."rules_jsonb") = 'object'
        and "business_policies"."rules_jsonb" <> '{}'::jsonb
        and pg_column_size("business_policies"."rules_jsonb") <= 65536),
	CONSTRAINT "business_policies_status_check" CHECK ("business_policies"."status" in ('draft', 'published', 'retired')),
	CONSTRAINT "business_policies_effective_interval_check" CHECK ("business_policies"."effective_to" is null
        or ("business_policies"."effective_from" is not null and "business_policies"."effective_to" > "business_policies"."effective_from")),
	CONSTRAINT "business_policies_content_hash_check" CHECK (octet_length("business_policies"."content_hash") between 1 and 128),
	CONSTRAINT "business_policies_publication_check" CHECK ("business_policies"."status" = 'draft'
        or ("business_policies"."effective_from" is not null and "business_policies"."published_by_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "faqs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"faq_key" varchar(128) NOT NULL,
	"version_no" integer NOT NULL,
	"service_id" uuid,
	"location_id" uuid,
	"question_i18n" jsonb NOT NULL,
	"answer_i18n" jsonb NOT NULL,
	"search_vector_uz" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("question_i18n" ->> 'uz', '') || ' ' || coalesce("answer_i18n" ->> 'uz', ''))) STORED NOT NULL,
	"search_vector_ru" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("question_i18n" ->> 'ru', '') || ' ' || coalesce("answer_i18n" ->> 'ru', ''))) STORED NOT NULL,
	"search_vector_en" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("question_i18n" ->> 'en', '') || ' ' || coalesce("answer_i18n" ->> 'en', ''))) STORED NOT NULL,
	"status" varchar(16) NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"content_hash" "bytea" NOT NULL,
	"published_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "faqs_organization_key_version_unique" UNIQUE("organization_id","faq_key","version_no"),
	CONSTRAINT "faqs_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "faqs_id_uuid_v7_check" CHECK ("faqs"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "faqs_key_normalized_check" CHECK ("faqs"."faq_key" = lower(btrim("faqs"."faq_key"))
        and "faqs"."faq_key" ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
	CONSTRAINT "faqs_version_no_check" CHECK ("faqs"."version_no" > 0),
	CONSTRAINT "faqs_question_i18n_check" CHECK (is_bounded_locale_map("faqs"."question_i18n", 4000)),
	CONSTRAINT "faqs_answer_i18n_check" CHECK (is_bounded_locale_map("faqs"."answer_i18n", 4000)),
	CONSTRAINT "faqs_status_check" CHECK ("faqs"."status" in ('draft', 'published', 'retired')),
	CONSTRAINT "faqs_effective_interval_check" CHECK ("faqs"."effective_to" is null
        or ("faqs"."effective_from" is not null and "faqs"."effective_to" > "faqs"."effective_from")),
	CONSTRAINT "faqs_content_hash_check" CHECK (octet_length("faqs"."content_hash") between 1 and 128),
	CONSTRAINT "faqs_publication_check" CHECK ("faqs"."status" = 'draft'
        or ("faqs"."effective_from" is not null and "faqs"."published_by_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "location_business_hours" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_version_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"opens_at_local" time(0) NOT NULL,
	"closes_at_local" time(0) NOT NULL,
	"sequence_no" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_business_hours_schedule_unique" UNIQUE("organization_id","location_version_id","day_of_week","sequence_no"),
	CONSTRAINT "location_business_hours_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "location_business_hours_id_uuid_v7_check" CHECK ("location_business_hours"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "location_business_hours_day_of_week_check" CHECK ("location_business_hours"."day_of_week" between 1 and 7),
	CONSTRAINT "location_business_hours_sequence_no_check" CHECK ("location_business_hours"."sequence_no" > 0),
	CONSTRAINT "location_business_hours_interval_check" CHECK ("location_business_hours"."opens_at_local" < "location_business_hours"."closes_at_local")
);
--> statement-breakpoint
CREATE TABLE "location_closures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"kind" varchar(16) NOT NULL,
	"opens_at_local" time(0),
	"closes_at_local" time(0),
	"reason_i18n" jsonb NOT NULL,
	"status" varchar(16) NOT NULL,
	"supersedes_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_closures_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "location_closures_organization_location_id_unique" UNIQUE("organization_id","location_id","id"),
	CONSTRAINT "location_closures_id_uuid_v7_check" CHECK ("location_closures"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "location_closures_kind_check" CHECK ("location_closures"."kind" in ('closed', 'override')),
	CONSTRAINT "location_closures_interval_shape_check" CHECK (("location_closures"."kind" = 'closed'
          and "location_closures"."opens_at_local" is null
          and "location_closures"."closes_at_local" is null)
        or ("location_closures"."kind" = 'override'
          and "location_closures"."opens_at_local" is not null
          and "location_closures"."closes_at_local" is not null
          and "location_closures"."opens_at_local" < "location_closures"."closes_at_local")),
	CONSTRAINT "location_closures_reason_i18n_check" CHECK (is_bounded_locale_map("location_closures"."reason_i18n", 4000)),
	CONSTRAINT "location_closures_status_check" CHECK ("location_closures"."status" in ('active', 'superseded', 'cancelled')),
	CONSTRAINT "location_closures_supersedes_check" CHECK ("location_closures"."supersedes_id" is null or "location_closures"."supersedes_id" <> "location_closures"."id")
);
--> statement-breakpoint
CREATE TABLE "location_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"name_i18n" jsonb NOT NULL,
	"address_i18n" jsonb NOT NULL,
	"public_contact_jsonb" jsonb NOT NULL,
	"time_zone" varchar(255) NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"published_by_user_id" uuid NOT NULL,
	"content_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_versions_organization_location_version_unique" UNIQUE("organization_id","location_id","version_no"),
	CONSTRAINT "location_versions_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "location_versions_organization_location_id_unique" UNIQUE("organization_id","location_id","id"),
	CONSTRAINT "location_versions_id_uuid_v7_check" CHECK ("location_versions"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "location_versions_version_no_check" CHECK ("location_versions"."version_no" > 0),
	CONSTRAINT "location_versions_name_i18n_check" CHECK (is_bounded_locale_map("location_versions"."name_i18n", 4000)),
	CONSTRAINT "location_versions_address_i18n_check" CHECK (is_bounded_locale_map("location_versions"."address_i18n", 4000)),
	CONSTRAINT "location_versions_public_contact_check" CHECK (jsonb_typeof("location_versions"."public_contact_jsonb") = 'object'
        and pg_column_size("location_versions"."public_contact_jsonb") <= 16384),
	CONSTRAINT "location_versions_time_zone_check" CHECK ("location_versions"."time_zone" = btrim("location_versions"."time_zone")
        and length("location_versions"."time_zone") between 1 and 255
        and ("location_versions"."time_zone" = 'UTC' or "location_versions"."time_zone" ~ '^[A-Za-z_+-]+(?:/[A-Za-z0-9_+-]+)+$')
        and timezone("location_versions"."time_zone", timestamptz '2000-01-01 00:00:00+00') is not null),
	CONSTRAINT "location_versions_content_hash_check" CHECK (octet_length("location_versions"."content_hash") between 1 and 128),
	CONSTRAINT "location_versions_publication_timestamps_check" CHECK ("location_versions"."published_at" >= "location_versions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "service_locations" (
	"organization_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"status" varchar(16) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_locations_pk" PRIMARY KEY("organization_id","service_id","location_id","effective_from"),
	CONSTRAINT "service_locations_status_check" CHECK ("service_locations"."status" in ('active', 'inactive')),
	CONSTRAINT "service_locations_effective_interval_check" CHECK ("service_locations"."effective_to" is null or "service_locations"."effective_to" > "service_locations"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "service_prices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"location_id" uuid,
	"price_type" varchar(16) NOT NULL,
	"currency" char(3) NOT NULL,
	"min_amount_minor" bigint,
	"max_amount_minor" bigint,
	"display_text_i18n" jsonb NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"status" varchar(16) NOT NULL,
	"version_no" integer NOT NULL,
	"published_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_prices_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "service_prices_id_uuid_v7_check" CHECK ("service_prices"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "service_prices_price_type_check" CHECK ("service_prices"."price_type" in ('fixed', 'from', 'range', 'quote_required')),
	CONSTRAINT "service_prices_currency_check" CHECK ("service_prices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "service_prices_amount_shape_check" CHECK (("service_prices"."price_type" = 'fixed'
          and "service_prices"."min_amount_minor" is not null
          and "service_prices"."max_amount_minor" = "service_prices"."min_amount_minor"
          and "service_prices"."min_amount_minor" >= 0)
        or ("service_prices"."price_type" = 'from'
          and "service_prices"."min_amount_minor" is not null
          and "service_prices"."min_amount_minor" >= 0
          and "service_prices"."max_amount_minor" is null)
        or ("service_prices"."price_type" = 'range'
          and "service_prices"."min_amount_minor" is not null
          and "service_prices"."max_amount_minor" is not null
          and "service_prices"."min_amount_minor" >= 0
          and "service_prices"."max_amount_minor" >= "service_prices"."min_amount_minor")
        or ("service_prices"."price_type" = 'quote_required'
          and "service_prices"."min_amount_minor" is null
          and "service_prices"."max_amount_minor" is null)),
	CONSTRAINT "service_prices_display_text_i18n_check" CHECK (is_bounded_locale_map("service_prices"."display_text_i18n", 4000)),
	CONSTRAINT "service_prices_status_check" CHECK ("service_prices"."status" in ('draft', 'published', 'retired')),
	CONSTRAINT "service_prices_version_no_check" CHECK ("service_prices"."version_no" > 0),
	CONSTRAINT "service_prices_effective_interval_check" CHECK ("service_prices"."effective_to" is null
        or ("service_prices"."effective_from" is not null and "service_prices"."effective_to" > "service_prices"."effective_from")),
	CONSTRAINT "service_prices_publication_check" CHECK ("service_prices"."status" = 'draft'
        or ("service_prices"."effective_from" is not null and "service_prices"."published_by_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "service_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"name_i18n" jsonb NOT NULL,
	"description_i18n" jsonb NOT NULL,
	"duration_guidance_minutes" integer,
	"disclaimer_i18n" jsonb NOT NULL,
	"search_vector_uz" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("name_i18n" ->> 'uz', '') || ' ' || coalesce("description_i18n" ->> 'uz', ''))) STORED NOT NULL,
	"search_vector_ru" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("name_i18n" ->> 'ru', '') || ' ' || coalesce("description_i18n" ->> 'ru', ''))) STORED NOT NULL,
	"search_vector_en" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("name_i18n" ->> 'en', '') || ' ' || coalesce("description_i18n" ->> 'en', ''))) STORED NOT NULL,
	"content_hash" "bytea" NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"published_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_versions_organization_service_version_unique" UNIQUE("organization_id","service_id","version_no"),
	CONSTRAINT "service_versions_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "service_versions_organization_service_id_unique" UNIQUE("organization_id","service_id","id"),
	CONSTRAINT "service_versions_id_uuid_v7_check" CHECK ("service_versions"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "service_versions_version_no_check" CHECK ("service_versions"."version_no" > 0),
	CONSTRAINT "service_versions_name_i18n_check" CHECK (is_bounded_locale_map("service_versions"."name_i18n", 4000)),
	CONSTRAINT "service_versions_description_i18n_check" CHECK (is_bounded_locale_map("service_versions"."description_i18n", 4000)),
	CONSTRAINT "service_versions_disclaimer_i18n_check" CHECK (is_bounded_locale_map("service_versions"."disclaimer_i18n", 4000)),
	CONSTRAINT "service_versions_duration_guidance_check" CHECK ("service_versions"."duration_guidance_minutes" is null or "service_versions"."duration_guidance_minutes" > 0),
	CONSTRAINT "service_versions_content_hash_check" CHECK (octet_length("service_versions"."content_hash") between 1 and 128),
	CONSTRAINT "service_versions_publication_timestamps_check" CHECK ("service_versions"."published_at" >= "service_versions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "services_organization_id_code_unique" UNIQUE("organization_id","code"),
	CONSTRAINT "services_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "services_id_uuid_v7_check" CHECK ("services"."id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "services_code_normalized_check" CHECK ("services"."code" = lower(btrim("services"."code")) and "services"."code" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "services_status_check" CHECK ("services"."status" in ('active', 'inactive')),
	CONSTRAINT "services_version_check" CHECK ("services"."version" > 0),
	CONSTRAINT "services_timestamps_check" CHECK ("services"."updated_at" >= "services"."created_at")
);
--> statement-breakpoint
ALTER TABLE "business_policies" ADD CONSTRAINT "business_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "business_policies" ADD CONSTRAINT "business_policies_publisher_membership_fk" FOREIGN KEY ("organization_id","published_by_user_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_location_fk" FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_publisher_membership_fk" FOREIGN KEY ("organization_id","published_by_user_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "location_business_hours" ADD CONSTRAINT "location_business_hours_location_version_fk" FOREIGN KEY ("organization_id","location_version_id") REFERENCES "public"."location_versions"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "location_closures" ADD CONSTRAINT "location_closures_location_fk" FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "location_closures" ADD CONSTRAINT "location_closures_superseded_record_fk" FOREIGN KEY ("organization_id","location_id","supersedes_id") REFERENCES "public"."location_closures"("organization_id","location_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "location_closures" ADD CONSTRAINT "location_closures_creator_membership_fk" FOREIGN KEY ("organization_id","created_by_user_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "location_versions" ADD CONSTRAINT "location_versions_location_fk" FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "location_versions" ADD CONSTRAINT "location_versions_publisher_membership_fk" FOREIGN KEY ("organization_id","published_by_user_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_location_fk" FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_location_fk" FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_publisher_membership_fk" FOREIGN KEY ("organization_id","published_by_user_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "service_versions" ADD CONSTRAINT "service_versions_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "service_versions" ADD CONSTRAINT "service_versions_publisher_membership_fk" FOREIGN KEY ("organization_id","published_by_user_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_current_version_fk" FOREIGN KEY ("organization_id","id","current_version_id") REFERENCES "public"."service_versions"("organization_id","service_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "business_policies_one_published_per_key_type_unique" ON "business_policies" USING btree ("organization_id","policy_key","policy_type") WHERE "business_policies"."status" = 'published';--> statement-breakpoint
CREATE INDEX "business_policies_organization_type_status_effective_idx" ON "business_policies" USING btree ("organization_id","policy_type","status","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "faqs_one_published_per_key_scope_unique" ON "faqs" USING btree ("organization_id","faq_key",coalesce("service_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("location_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "faqs"."status" = 'published';--> statement-breakpoint
CREATE INDEX "faqs_organization_status_scope_effective_idx" ON "faqs" USING btree ("organization_id","status","service_id","location_id","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "faqs_search_vector_uz_idx" ON "faqs" USING gin ("search_vector_uz");--> statement-breakpoint
CREATE INDEX "faqs_search_vector_ru_idx" ON "faqs" USING gin ("search_vector_ru");--> statement-breakpoint
CREATE INDEX "faqs_search_vector_en_idx" ON "faqs" USING gin ("search_vector_en");--> statement-breakpoint
CREATE INDEX "location_business_hours_organization_version_day_idx" ON "location_business_hours" USING btree ("organization_id","location_version_id","day_of_week");--> statement-breakpoint
CREATE UNIQUE INDEX "location_closures_one_active_per_local_date_unique" ON "location_closures" USING btree ("organization_id","location_id","local_date") WHERE "location_closures"."status" = 'active';--> statement-breakpoint
CREATE INDEX "location_closures_organization_location_date_idx" ON "location_closures" USING btree ("organization_id","location_id","local_date");--> statement-breakpoint
CREATE INDEX "location_versions_organization_location_version_idx" ON "location_versions" USING btree ("organization_id","location_id","version_no" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "service_locations_organization_location_status_idx" ON "service_locations" USING btree ("organization_id","location_id","status");--> statement-breakpoint
CREATE INDEX "service_locations_organization_service_status_idx" ON "service_locations" USING btree ("organization_id","service_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "service_prices_scope_currency_version_unique" ON "service_prices" USING btree ("organization_id","service_id",coalesce("location_id", '00000000-0000-0000-0000-000000000000'::uuid),"currency","version_no");--> statement-breakpoint
CREATE INDEX "service_prices_org_service_location_status_effective_idx" ON "service_prices" USING btree ("organization_id","service_id","location_id","status","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "service_versions_organization_service_version_idx" ON "service_versions" USING btree ("organization_id","service_id","version_no" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "service_versions_search_vector_uz_idx" ON "service_versions" USING gin ("search_vector_uz");--> statement-breakpoint
CREATE INDEX "service_versions_search_vector_ru_idx" ON "service_versions" USING gin ("search_vector_ru");--> statement-breakpoint
CREATE INDEX "service_versions_search_vector_en_idx" ON "service_versions" USING gin ("search_vector_en");--> statement-breakpoint
CREATE INDEX "services_organization_status_code_idx" ON "services" USING btree ("organization_id","status","code");--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_current_version_fk" FOREIGN KEY ("organization_id","id","current_version_id") REFERENCES "public"."location_versions"("organization_id","location_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "location_business_hours" ADD CONSTRAINT "location_business_hours_no_overlap_excl"
EXCLUDE USING gist (
	"organization_id" WITH =,
	"location_version_id" WITH =,
	"day_of_week" WITH =,
	int8range(
		(extract(epoch FROM "opens_at_local") * 1000000)::bigint,
		(extract(epoch FROM "closes_at_local") * 1000000)::bigint,
		'[)'
	) WITH &&
);--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_no_active_overlap_excl"
EXCLUDE USING gist (
	"organization_id" WITH =,
	"service_id" WITH =,
	"location_id" WITH =,
	tstzrange("effective_from", "effective_to", '[)') WITH &&
)
WHERE ("status" = 'active');--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_no_published_overlap_excl"
EXCLUDE USING gist (
	"organization_id" WITH =,
	"service_id" WITH =,
	coalesce("location_id", '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
	"currency" WITH =,
	tstzrange("effective_from", "effective_to", '[)') WITH &&
)
WHERE ("status" = 'published');
