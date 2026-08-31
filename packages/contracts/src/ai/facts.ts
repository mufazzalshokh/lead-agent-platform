import Type from "typebox";

import {
  LocationIdSchema,
  ResourceIdSchema,
  ServiceIdSchema,
  type LocationId,
  type ResourceId,
  type ServiceId,
} from "../shared/identifiers.js";
import { AggregateVersionSchema, type AggregateVersion } from "../shared/version.js";
import { embedSchema, embedSchemaAs } from "./internal.js";
import { AgentFactualClaimKindSchema, AgentFactualClaimSourceTypeSchema } from "./vocabulary.js";

const localTimeSchema = () =>
  Type.String({
    pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
  });

export const AgentAppointmentPreferenceSchema = Type.Object(
  {
    local_date: Type.Union([Type.String({ format: "date" }), Type.Null()]),
    local_time_end: Type.Union([localTimeSchema(), Type.Null()]),
    local_time_start: Type.Union([localTimeSchema(), Type.Null()]),
    raw_text: Type.String({ maxLength: 500 }),
    timezone: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
  },
  {
    $id: "AgentAppointmentPreference.v1",
    additionalProperties: false,
    description:
      "Untrusted extracted customer preference. It is not an availability result or confirmed time.",
  },
);
export type AgentAppointmentPreference = Type.Static<typeof AgentAppointmentPreferenceSchema>;

export const AgentExtractedFactsSchema = Type.Object(
  {
    appointment_preference: Type.Union([
      embedSchema(AgentAppointmentPreferenceSchema),
      Type.Null(),
    ]),
    display_name: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    email_raw: Type.Union([Type.String({ maxLength: 320 }), Type.Null()]),
    location_id: Type.Union([embedSchemaAs<LocationId>(LocationIdSchema), Type.Null()]),
    phone_raw: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
    service_id: Type.Union([embedSchemaAs<ServiceId>(ServiceIdSchema), Type.Null()]),
  },
  {
    $id: "AgentExtractedFacts.v1",
    additionalProperties: false,
    description:
      "Candidate facts extracted from customer text. Every value remains untrusted and requires application validation.",
  },
);
export type AgentExtractedFacts = Type.Static<typeof AgentExtractedFactsSchema>;

export const AgentFactualClaimSchema = Type.Object(
  {
    claim_kind: embedSchema(AgentFactualClaimKindSchema),
    source_id: embedSchemaAs<ResourceId>(ResourceIdSchema),
    source_type: embedSchema(AgentFactualClaimSourceTypeSchema),
    source_version: embedSchemaAs<AggregateVersion>(AggregateVersionSchema),
  },
  {
    $id: "AgentFactualClaim.v1",
    additionalProperties: false,
    description:
      "A proposed factual claim citation. Schema validity does not prove that the source exists, is current, or is authorized.",
  },
);
export type AgentFactualClaim = Type.Static<typeof AgentFactualClaimSchema>;
