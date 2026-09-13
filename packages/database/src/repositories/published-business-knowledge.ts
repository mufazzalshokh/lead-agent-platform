import {
  PublishedBusinessKnowledgeV2Schema,
  isSchemaValue,
  type PublishedBusinessKnowledgeV2,
} from "@lead-agent/contracts";
import type { ConfigurationResult, PublishedBusinessKnowledgeStore } from "@lead-agent/application";
import type { QueryResultRow } from "pg";

import type { TenantDatabaseRuntime } from "../runtime/tenant.js";
import { executeTenantQuery } from "../runtime/tenant.js";
import { mapRepositoryFailure } from "./shared.js";

type KnowledgeRow = QueryResultRow & {
  kind: unknown;
  payload: unknown;
};

type KnowledgeMeta = Readonly<{
  authorized: boolean;
  bounded: boolean;
  integrity_valid: boolean;
  localization_valid: boolean;
  organization_ready: boolean;
  requested_locations_valid: boolean;
}>;

const fail = <Value>(
  code: "business_rule_failed" | "permission_denied" | "resource_not_found",
): ConfigurationResult<Value> => Object.freeze({ error: Object.freeze({ code }), ok: false });

const success = <Value>(value: Value): ConfigurationResult<Value> =>
  Object.freeze({ ok: true, value });

const isKnowledgeMeta = (value: unknown): value is KnowledgeMeta =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "authorized") === "boolean" &&
  typeof Reflect.get(value, "bounded") === "boolean" &&
  typeof Reflect.get(value, "integrity_valid") === "boolean" &&
  typeof Reflect.get(value, "localization_valid") === "boolean" &&
  typeof Reflect.get(value, "organization_ready") === "boolean" &&
  typeof Reflect.get(value, "requested_locations_valid") === "boolean";

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
};

const KNOWLEDGE_QUERY = `with
actual_scope as materialized (
  select coalesce(array_agg(mls.location_id order by mls.location_id), '{}'::uuid[]) as location_ids
    from membership_location_scopes mls
   where mls.organization_id = $1 and mls.membership_id = $2
),
actor as materialized (
  select m.id
    from memberships m
    cross join actual_scope scope
   where m.organization_id = $1
     and m.id = $2
     and m.user_id = $3
     and m.status = 'active'
     and m.role = $4
     and m.location_scope = $5
     and m.role in ('owner', 'admin', 'staff', 'analyst')
     and (($5::text = 'all' and cardinality($6::uuid[]) = 0)
       or ($5::text = 'restricted' and scope.location_ids = $6::uuid[]))
),
organization_context as materialized (
  select o.default_locale
    from organizations o
   where o.id = $1 and o.status = 'active' and exists (select 1 from actor)
),
requested_location_ids as materialized (
  select requested.location_id
    from unnest(coalesce($7::uuid[], '{}'::uuid[])) requested(location_id)
),
requested_location_check as materialized (
  select $7::uuid[] is null or not exists (
    select 1
      from requested_location_ids requested
      left join locations owned
        on owned.organization_id = $1 and owned.id = requested.location_id
     where owned.id is null
       or ($5::text = 'restricted' and requested.location_id <> all($6::uuid[]))
  ) as valid
),
candidate_location_roots as materialized (
  select l.*
    from locations l
   where l.organization_id = $1
     and l.status = 'active'
     and exists (select 1 from actor)
     and ($7::uuid[] is null or l.id = any($7::uuid[]))
),
current_locations as materialized (
  select l.id, l.code, l.version as root_version, lv.id as version_id,
         lv.name_i18n, lv.address_i18n, lv.public_contact_jsonb, lv.time_zone,
         lv.version_no, lv.content_hash, lv.published_at, lv.published_by_user_id
    from candidate_location_roots l
    join location_versions lv
      on lv.organization_id = l.organization_id and lv.location_id = l.id
     and lv.id = l.current_version_id
),
service_roots_in_projection as materialized (
  select s.*
    from services s
   where s.organization_id = $1
     and s.status = 'active'
     and exists (select 1 from actor)
     and ($7::uuid[] is null or exists (
       select 1
         from service_locations sl
         join current_locations location on location.id = sl.location_id
        where sl.organization_id = s.organization_id and sl.service_id = s.id
          and sl.status = 'active' and sl.effective_from <= $8::timestamptz
          and (sl.effective_to is null or sl.effective_to > $8::timestamptz)
     ))
),
current_services as materialized (
  select s.id, s.code, s.version as root_version,
         sv.id as version_id, sv.version_no, sv.name_i18n, sv.description_i18n,
         sv.disclaimer_i18n, sv.duration_guidance_minutes, sv.content_hash,
         sv.published_at, sv.published_by_user_id
    from service_roots_in_projection s
    join service_versions sv
      on sv.organization_id = s.organization_id and sv.service_id = s.id
     and sv.id = s.current_version_id
),
service_offerings as materialized (
  select sl.service_id, sl.location_id, sl.effective_from, sl.effective_to
    from service_locations sl
    join current_services service on service.id = sl.service_id
    join current_locations location on location.id = sl.location_id
   where sl.organization_id = $1 and sl.status = 'active'
     and sl.effective_from <= $8::timestamptz
     and (sl.effective_to is null or sl.effective_to > $8::timestamptz)
),
eligible_prices as materialized (
  select offering.location_id as target_location_id, sp.*,
         count(*) over (
           partition by sp.service_id, offering.location_id, sp.currency,
                        coalesce(sp.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
         ) as scope_count,
         row_number() over (
           partition by sp.service_id, offering.location_id, sp.currency
           order by (sp.location_id is not null) desc
         ) as precedence
    from service_offerings offering
    join service_prices sp
      on sp.organization_id = $1 and sp.service_id = offering.service_id
     and (sp.location_id is null or sp.location_id = offering.location_id)
     and sp.status = 'published' and sp.effective_from <= $8::timestamptz
     and (sp.effective_to is null or sp.effective_to > $8::timestamptz)
),
resolved_prices as materialized (
  select * from eligible_prices where precedence = 1
),
applicable_faqs as materialized (
  select f.*
    from faqs f
   where f.organization_id = $1 and f.status = 'published'
     and f.effective_from <= $8::timestamptz
     and (f.effective_to is null or f.effective_to > $8::timestamptz)
     and exists (select 1 from actor)
     and (f.location_id is null or exists (
       select 1 from current_locations location where location.id = f.location_id
     ))
     and (f.service_id is null or exists (
       select 1 from current_services service where service.id = f.service_id
     ))
     and (f.location_id is null or f.service_id is null or exists (
       select 1 from service_offerings offering
        where offering.location_id = f.location_id and offering.service_id = f.service_id
     ))
),
applicable_policy_candidates as materialized (
  select bp.*
    from business_policies bp
   where bp.organization_id = $1 and bp.status = 'published'
     and bp.effective_from <= $8::timestamptz
     and (bp.effective_to is null or bp.effective_to > $8::timestamptz)
     and exists (select 1 from actor)
),
applicable_policies as materialized (
  select * from applicable_policy_candidates
   where policy_type = 'qualification' and schema_version = 1
),
integrity as materialized (
  select
    (select count(*) from candidate_location_roots) = (select count(*) from current_locations)
    and (select count(*) from service_roots_in_projection) = (select count(*) from current_services)
    and not exists (select 1 from eligible_prices where scope_count <> 1)
    and not exists (
      select 1 from applicable_policy_candidates
       where policy_type <> 'qualification' or schema_version <> 1
    ) as valid
),
localization as materialized (
  select not exists (
    select 1 from current_locations location cross join organization_context organization
     where not ((location.name_i18n ? $9::text or location.name_i18n ? organization.default_locale)
       and (location.address_i18n ? $9::text or location.address_i18n ? organization.default_locale))
  ) and not exists (
    select 1 from current_services service cross join organization_context organization
     where not ((service.name_i18n ? $9::text or service.name_i18n ? organization.default_locale)
       and (service.description_i18n ? $9::text or service.description_i18n ? organization.default_locale)
       and (service.disclaimer_i18n ? $9::text or service.disclaimer_i18n ? organization.default_locale))
  ) and not exists (
    select 1 from resolved_prices price cross join organization_context organization
     where not (price.display_text_i18n ? $9::text
       or price.display_text_i18n ? organization.default_locale)
  ) and not exists (
    select 1 from applicable_faqs faq cross join organization_context organization
     where not ((faq.question_i18n ? $9::text or faq.question_i18n ? organization.default_locale)
       and (faq.answer_i18n ? $9::text or faq.answer_i18n ? organization.default_locale))
  ) as valid
),
bounds as materialized (
  select (select count(*) from current_locations) <= 100
    and (select count(*) from current_services) <= 500
    and (select count(*) from applicable_faqs) <= 500
    and (select count(*) from applicable_policies) <= 50
    and not exists (
      select 1 from current_locations location
       where (select count(*) from location_closures closure
               where closure.organization_id = $1 and closure.location_id = location.id
                 and closure.status = 'active'
                 and closure.local_date >= ($8::timestamptz at time zone location.time_zone)::date) > 366
    )
    and not exists (
      select 1 from current_services service
       where (select count(*) from service_offerings offering
               where offering.service_id = service.id) > 100
    )
    and not exists (
      select 1 from resolved_prices price
       group by price.service_id, price.target_location_id
      having count(*) > 300
    ) as valid
),
knowledge_rows as (
  select 'meta'::text as kind,
         jsonb_build_object(
           'authorized', exists(select 1 from actor),
           'bounded', (select valid from bounds),
           'integrity_valid', (select valid from integrity),
           'localization_valid', (select valid from localization),
           'organization_ready', exists(select 1 from organization_context),
           'requested_locations_valid', (select valid from requested_location_check)
         ) as payload,
         ''::text as sort_key
  union all
  select 'location',
         jsonb_build_object(
           'address_i18n', location.address_i18n,
           'business_hours', coalesce((
             select jsonb_agg(jsonb_build_object(
               'closes_at_local', hour.closes_at_local::text,
               'day_of_week', hour.day_of_week,
               'opens_at_local', hour.opens_at_local::text,
               'sequence_no', hour.sequence_no
             ) order by hour.day_of_week, hour.sequence_no)
               from location_business_hours hour
              where hour.organization_id = $1 and hour.location_version_id = location.version_id
           ), '[]'::jsonb),
           'closures', coalesce((
             select jsonb_agg(case when closure.kind = 'closed' then
               jsonb_build_object(
                 'closure_id', closure.id::text,
                 'kind', closure.kind,
                 'local_date', closure.local_date::text,
                 'reason_i18n', closure.reason_i18n
               ) else jsonb_build_object(
                 'closes_at_local', closure.closes_at_local::text,
                 'closure_id', closure.id::text,
                 'kind', closure.kind,
                 'local_date', closure.local_date::text,
                 'opens_at_local', closure.opens_at_local::text,
                 'reason_i18n', closure.reason_i18n
               ) end order by closure.local_date, closure.id)
               from location_closures closure
              where closure.organization_id = $1 and closure.location_id = location.id
                and closure.status = 'active'
                and closure.local_date >= ($8::timestamptz at time zone location.time_zone)::date
           ), '[]'::jsonb),
           'code', location.code,
           'location_id', location.id::text,
           'name_i18n', location.name_i18n,
           'provenance', jsonb_build_object(
             'content_hash', encode(location.content_hash, 'hex'),
             'published_at', to_char(location.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'published_by_user_id', location.published_by_user_id::text,
             'record_id', location.version_id::text,
             'version_no', location.version_no
           ),
           'public_contact', location.public_contact_jsonb,
           'root_version', location.root_version,
           'time_zone', location.time_zone
         ), location.code
    from current_locations location
  union all
  select 'service',
         jsonb_build_object(
           'code', service.code,
           'description_i18n', service.description_i18n,
           'disclaimer_i18n', service.disclaimer_i18n,
           'duration_guidance_minutes', service.duration_guidance_minutes,
           'location_offerings', coalesce((
             select jsonb_agg(jsonb_build_object(
               'effective_from', to_char(offering.effective_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'effective_to', case when offering.effective_to is null then null else
                 to_char(offering.effective_to at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
               'location_id', offering.location_id::text
             ) order by offering.location_id)
               from service_offerings offering where offering.service_id = service.id
           ), '[]'::jsonb),
           'name_i18n', service.name_i18n,
           'price_resolutions', coalesce((
             select jsonb_agg(jsonb_build_object(
               'location_id', offering.location_id::text,
               'prices', coalesce((
                 select jsonb_agg(jsonb_build_object(
                   'display_text_i18n', price.display_text_i18n,
                   'effective_from', to_char(price.effective_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                   'effective_to', case when price.effective_to is null then null else
                     to_char(price.effective_to at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
                   'location_id', case when price.location_id is null then null else price.location_id::text end,
                   'price_id', price.id::text,
                   'pricing', case price.price_type
                     when 'fixed' then jsonb_build_object('amount', jsonb_build_object(
                       'amount_minor', price.min_amount_minor, 'currency', price.currency::text), 'price_type', 'fixed')
                     when 'from' then jsonb_build_object('minimum', jsonb_build_object(
                       'amount_minor', price.min_amount_minor, 'currency', price.currency::text), 'price_type', 'from')
                     when 'range' then jsonb_build_object(
                       'maximum', jsonb_build_object('amount_minor', price.max_amount_minor, 'currency', price.currency::text),
                       'minimum', jsonb_build_object('amount_minor', price.min_amount_minor, 'currency', price.currency::text),
                       'price_type', 'range')
                     else jsonb_build_object('currency', price.currency::text, 'price_type', 'quote_required')
                   end,
                   'published_by_user_id', price.published_by_user_id::text,
                   'version_no', price.version_no
                 ) order by price.currency)
                   from resolved_prices price
                  where price.service_id = service.id
                    and price.target_location_id = offering.location_id
               ), '[]'::jsonb)
             ) order by offering.location_id)
               from service_offerings offering where offering.service_id = service.id
           ), '[]'::jsonb),
           'provenance', jsonb_build_object(
             'content_hash', encode(service.content_hash, 'hex'),
             'published_at', to_char(service.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'published_by_user_id', service.published_by_user_id::text,
             'record_id', service.version_id::text,
             'version_no', service.version_no
           ),
           'root_version', service.root_version,
           'service_id', service.id::text
         ), service.code
    from current_services service
  union all
  select 'faq', jsonb_build_object(
           'answer_i18n', faq.answer_i18n,
           'content_hash', encode(faq.content_hash, 'hex'),
           'effective_from', to_char(faq.effective_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'effective_to', case when faq.effective_to is null then null else
             to_char(faq.effective_to at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
           'faq_id', faq.id::text,
           'faq_key', faq.faq_key,
           'location_id', case when faq.location_id is null then null else faq.location_id::text end,
           'published_by_user_id', faq.published_by_user_id::text,
           'question_i18n', faq.question_i18n,
           'service_id', case when faq.service_id is null then null else faq.service_id::text end,
           'version_no', faq.version_no
         ), faq.faq_key || ':' || faq.id::text
    from applicable_faqs faq
  union all
  select 'policy', jsonb_build_object(
           'content_hash', encode(policy.content_hash, 'hex'),
           'effective_from', to_char(policy.effective_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'effective_to', case when policy.effective_to is null then null else
             to_char(policy.effective_to at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
           'policy_id', policy.id::text,
           'policy_key', policy.policy_key,
           'policy_type', policy.policy_type,
           'published_by_user_id', policy.published_by_user_id::text,
           'rules', policy.rules_jsonb,
           'schema_version', policy.schema_version,
           'version_no', policy.version_no
         ), policy.policy_key || ':' || policy.id::text
    from applicable_policies policy
)
select kind, payload from knowledge_rows order by kind, sort_key`;

export const createPublishedBusinessKnowledgeStore = (
  runtime: TenantDatabaseRuntime,
): PublishedBusinessKnowledgeStore => ({
  readPublishedBusinessKnowledge: async (query) => {
    try {
      return await runtime.withTenantTransaction(
        query.authorization.organizationId,
        async (session) => {
          const allowedLocationIds =
            query.authorization.locationScope === "restricted"
              ? [...query.authorization.allowedLocationIds].sort()
              : [];
          const rows = await executeTenantQuery<KnowledgeRow>(session, (organizationId) => ({
            text: KNOWLEDGE_QUERY,
            values: [
              organizationId,
              query.authorization.membershipId,
              query.authorization.userId,
              query.authorization.role,
              query.authorization.locationScope,
              allowedLocationIds,
              query.locationIds,
              query.effectiveAt,
              query.locale,
            ],
          }));
          const meta = rows.rows.find((row) => row.kind === "meta")?.payload;
          if (!isKnowledgeMeta(meta)) return fail("business_rule_failed");
          if (!meta.authorized) return fail("permission_denied");
          if (!meta.organization_ready) return fail("resource_not_found");
          if (!meta.requested_locations_valid) return fail("resource_not_found");
          if (!meta.bounded || !meta.integrity_valid || !meta.localization_valid) {
            return fail("business_rule_failed");
          }

          const value = {
            effective_at: query.effectiveAt,
            faqs: rows.rows.filter((row) => row.kind === "faq").map((row) => row.payload),
            locale: query.locale,
            locations: rows.rows.filter((row) => row.kind === "location").map((row) => row.payload),
            policies: rows.rows.filter((row) => row.kind === "policy").map((row) => row.payload),
            services: rows.rows.filter((row) => row.kind === "service").map((row) => row.payload),
          };
          if (!isSchemaValue(PublishedBusinessKnowledgeV2Schema, value)) {
            return fail("business_rule_failed");
          }
          return success(deepFreeze<PublishedBusinessKnowledgeV2>(value));
        },
      );
    } catch (error) {
      throw mapRepositoryFailure(error);
    }
  },
});
