import {
  OrganizationIdSchema,
  S22WidgetCohortSelectInputSchema,
  S22WidgetCohortSelectionReceiptSchema,
  S22WidgetCohortStatusSchema,
  isSchemaValue,
  type OrganizationId,
} from "../../packages/contracts/src/index.js";
import {
  resolveAuthorizationContext,
  type MembershipRole,
} from "../../packages/security/src/index.js";
import { IDS, staffSession } from "../telegram/fixtures.js";

const organization = "01a0ee39-91a9-7293-82c0-5b7046c10115";
if (!isSchemaValue(OrganizationIdSchema, organization)) throw new Error("Invalid S22 test org");
export const S22_ORGANIZATION = organization;
export const SELECTION_BODY = (() => {
  const body = {
    session_id: "01a11c48-dbc2-76de-a873-f41664da5ccb",
    expected_session_version: 2,
    expected_selection_version: 0,
  };
  if (!isSchemaValue(S22WidgetCohortSelectInputSchema, body)) throw new Error("Invalid test body");
  return body;
})();
export const SELECTION_RECEIPT = (() => {
  const receipt = { selection_version: 1, selected_session_id: SELECTION_BODY.session_id };
  if (!isSchemaValue(S22WidgetCohortSelectionReceiptSchema, receipt)) {
    throw new Error("Invalid test receipt");
  }
  return receipt;
})();
export const COHORT_STATUS = (() => {
  const status = {
    selection_version: 0,
    selected_session_id: null,
    candidates: [
      {
        session_id: SELECTION_BODY.session_id,
        session_version: 2,
        issued_at: "2026-10-08T17:30:00.000Z",
        idle_deadline: "2026-10-08T18:00:00.000Z",
        expires_at: "2026-10-08T19:30:00.000Z",
      },
    ],
    blocked: true,
    can_select: true,
    reason: "widget_selection_required",
    known_cost_micros: "8714",
    combined_exposure_micros: "1042110",
    unresolved_reserve_micros: "0",
  };
  if (!isSchemaValue(S22WidgetCohortStatusSchema, status)) throw new Error("Invalid test status");
  return status;
})();
export const s22Authorization = (
  role: MembershipRole = "owner",
  organizationId: OrganizationId = S22_ORGANIZATION,
) =>
  resolveAuthorizationContext(staffSession, organizationId, {
    resolveCurrentMembership: () =>
      Promise.resolve({
        allowedLocationIds: [],
        locationScope: "all",
        membershipId: IDS.membership,
        organizationId,
        role,
        status: "active",
        userId: IDS.user,
      }),
  });
