import {
  CorrelationIdSchema,
  OrganizationIdSchema,
  RequestIdSchema,
  S22WidgetCohortSelectInputSchema,
  S22WidgetCohortSelectionReceiptSchema,
  S22WidgetCohortStatusSchema,
  isSchemaValue,
  type S22WidgetCohortSelectInput,
  type S22WidgetCohortSelectionReceipt,
  type S22WidgetCohortStatus,
} from "@lead-agent/contracts";
import { isAuthorizationContext, type AuthorizationContext } from "@lead-agent/security";

export class S22WidgetCohortError extends Error {
  constructor(
    public readonly code:
      | "permission_denied"
      | "validation_failed"
      | "selection_conflict"
      | "cohort_blocked"
      | "unavailable",
  ) {
    super(code);
    this.name = "S22WidgetCohortError";
  }
}

export interface S22WidgetCohortStore {
  get(input: Readonly<{ actor: AuthorizationContext }>): Promise<S22WidgetCohortStatus>;
  select(
    input: Readonly<{
      actor: AuthorizationContext;
      body: S22WidgetCohortSelectInput;
      requestId: string;
      correlationId: string;
    }>,
  ): Promise<S22WidgetCohortSelectionReceipt>;
}

export type S22WidgetCohortUseCases = Readonly<{
  get(input: Readonly<{ actor: AuthorizationContext }>): Promise<S22WidgetCohortStatus>;
  select(
    input: Readonly<{
      actor: AuthorizationContext;
      body: unknown;
      requestId: string;
      correlationId: string;
    }>,
  ): Promise<S22WidgetCohortSelectionReceipt>;
}>;

export const createS22WidgetCohortUseCases = (
  dependencies: Readonly<{
    /** Trusted staging composition only, never derived from an HTTP body. */
    organizationId: string;
    store: S22WidgetCohortStore;
  }>,
): S22WidgetCohortUseCases => {
  const organizationId = dependencies.organizationId;
  if (!isSchemaValue(OrganizationIdSchema, organizationId)) {
    throw new TypeError("Invalid trusted S22 organization");
  }
  const authorize = (actor: AuthorizationContext): void => {
    if (
      !isAuthorizationContext(actor) ||
      actor.role !== "owner" ||
      actor.organizationId !== organizationId
    ) {
      throw new S22WidgetCohortError("permission_denied");
    }
  };
  return Object.freeze({
    get: async ({ actor }) => {
      authorize(actor);
      const status = await dependencies.store.get({ actor });
      if (!isSchemaValue(S22WidgetCohortStatusSchema, status)) {
        throw new S22WidgetCohortError("unavailable");
      }
      return status;
    },
    select: async ({ actor, body, requestId, correlationId }) => {
      authorize(actor);
      if (
        !isSchemaValue(S22WidgetCohortSelectInputSchema, body) ||
        !isSchemaValue(RequestIdSchema, requestId) ||
        !isSchemaValue(CorrelationIdSchema, correlationId)
      ) {
        throw new S22WidgetCohortError("validation_failed");
      }
      const receipt = await dependencies.store.select({ actor, body, requestId, correlationId });
      if (
        !isSchemaValue(S22WidgetCohortSelectionReceiptSchema, receipt) ||
        receipt.selected_session_id !== body.session_id ||
        receipt.selection_version !== body.expected_selection_version + 1
      ) {
        throw new S22WidgetCohortError("unavailable");
      }
      return receipt;
    },
  });
};
