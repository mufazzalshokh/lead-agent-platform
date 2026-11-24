import Type from "typebox";

import { withoutSchemaId } from "../api/embedding.js";
import { createSuccessEnvelopeSchema } from "../api/envelopes.js";
import { ResourceIdSchema } from "../shared/identifiers.js";
import { UtcTimestampSchema } from "../shared/time.js";

const embed = <S extends Type.TSchema>(schema: S) => withoutSchemaId<Type.Static<S>>(schema);
const selectionVersion = () => Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const costMicros = () => Type.String({ pattern: "^(?:0|[1-9][0-9]{0,19})$", maxLength: 20 });

/** Internal S22 staging selection only; never a general tenant billing interface. */
export const S22WidgetCohortSelectInputSchema = Type.Object(
  {
    session_id: embed(ResourceIdSchema),
    expected_session_version: Type.Literal(2),
    expected_selection_version: selectionVersion(),
  },
  { $id: "S22WidgetCohortSelectInput.v1", additionalProperties: false },
);
export type S22WidgetCohortSelectInput = Type.Static<typeof S22WidgetCohortSelectInputSchema>;

export const S22WidgetCohortCandidateSchema = Type.Object(
  {
    session_id: embed(ResourceIdSchema),
    session_version: Type.Literal(2),
    issued_at: embed(UtcTimestampSchema),
    idle_deadline: embed(UtcTimestampSchema),
    expires_at: embed(UtcTimestampSchema),
  },
  { $id: "S22WidgetCohortCandidate.v1", additionalProperties: false },
);
export type S22WidgetCohortCandidate = Type.Static<typeof S22WidgetCohortCandidateSchema>;

export const S22WidgetCohortStatusSchema = Type.Object(
  {
    selection_version: selectionVersion(),
    selected_session_id: Type.Union([embed(ResourceIdSchema), Type.Null()]),
    candidates: Type.Array(embed(S22WidgetCohortCandidateSchema), { maxItems: 5 }),
    blocked: Type.Boolean(),
    can_select: Type.Boolean(),
    reason: Type.Union([
      Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$" }),
      Type.Null(),
    ]),
    known_cost_micros: costMicros(),
    combined_exposure_micros: costMicros(),
    unresolved_reserve_micros: costMicros(),
  },
  { $id: "S22WidgetCohortStatus.v1", additionalProperties: false },
);
export type S22WidgetCohortStatus = Type.Static<typeof S22WidgetCohortStatusSchema>;

export const S22WidgetCohortSelectionReceiptSchema = Type.Object(
  {
    selection_version: selectionVersion(),
    selected_session_id: embed(ResourceIdSchema),
  },
  { $id: "S22WidgetCohortSelectionReceipt.v1", additionalProperties: false },
);
export type S22WidgetCohortSelectionReceipt = Type.Static<
  typeof S22WidgetCohortSelectionReceiptSchema
>;

export const S22WidgetCohortStatusResponseSchema = createSuccessEnvelopeSchema(
  S22WidgetCohortStatusSchema,
  "S22WidgetCohortStatusResponse.v1",
);
export const S22WidgetCohortSelectionResponseSchema = createSuccessEnvelopeSchema(
  S22WidgetCohortSelectionReceiptSchema,
  "S22WidgetCohortSelectionResponse.v1",
);
