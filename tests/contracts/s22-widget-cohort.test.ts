import { describe, expect, it } from "vitest";

import {
  S22WidgetCohortSelectInputSchema,
  S22WidgetCohortSelectionResponseSchema,
  S22WidgetCohortStatusSchema,
  S22WidgetCohortStatusResponseSchema,
  isSchemaValue,
} from "../../packages/contracts/src/index.js";
import {
  COHORT_STATUS,
  SELECTION_BODY,
  SELECTION_RECEIPT,
} from "../application/s22-widget-cohort-fixtures.js";

describe("S22 internal Widget cohort contracts", () => {
  it("validates the strict selection, safe metadata projection and standard envelopes", () => {
    expect(isSchemaValue(S22WidgetCohortSelectInputSchema, SELECTION_BODY)).toBe(true);
    expect(isSchemaValue(S22WidgetCohortStatusSchema, COHORT_STATUS)).toBe(true);
    expect(
      isSchemaValue(S22WidgetCohortStatusResponseSchema, {
        data: COHORT_STATUS,
        meta: { request_id: "request:s22-cohort" },
      }),
    ).toBe(true);
    expect(
      isSchemaValue(S22WidgetCohortSelectionResponseSchema, {
        data: SELECTION_RECEIPT,
        meta: { request_id: "request:s22-cohort" },
      }),
    ).toBe(true);
  });

  it.each([
    { ...COHORT_STATUS, known_cost_micros: null },
    { ...COHORT_STATUS, known_cost_micros: "1.5" },
    { ...COHORT_STATUS, combined_exposure_micros: "-1" },
    { ...COHORT_STATUS, token: "private" },
    { ...COHORT_STATUS, reason: "Raw database error with customer text" },
    { ...COHORT_STATUS, candidates: Array(6).fill(COHORT_STATUS.candidates[0]) },
    { ...COHORT_STATUS, can_select: undefined },
    {
      ...COHORT_STATUS,
      candidates: [{ ...COHORT_STATUS.candidates[0], session_version: 1 }],
    },
    {
      ...COHORT_STATUS,
      candidates: [{ ...COHORT_STATUS.candidates[0], bearer_token: "private" }],
    },
  ])("rejects unbounded, credential-bearing or malformed metadata %#", (value) => {
    expect(isSchemaValue(S22WidgetCohortStatusSchema, value)).toBe(false);
  });
});
