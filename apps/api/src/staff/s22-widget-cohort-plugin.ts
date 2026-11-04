import { S22WidgetCohortError, type S22WidgetCohortUseCases } from "@lead-agent/application";
import {
  OrganizationIdSchema,
  S22WidgetCohortSelectInputSchema,
  S22WidgetCohortSelectionResponseSchema,
  S22WidgetCohortStatusResponseSchema,
  isSchemaValue,
  type S22WidgetCohortSelectInput,
} from "@lead-agent/contracts";
import {
  createSecurityIdentifierFactory,
  resolveAuthorizationContext,
  type AuthorizationContext,
} from "@lead-agent/security";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { StaffConfigurationSecurityBoundary } from "../configuration/plugin.js";

export type StaffS22WidgetCohortDependencies = Readonly<{
  useCases: S22WidgetCohortUseCases;
}>;

export const registerStaffS22WidgetCohort = (
  api: FastifyInstance,
  dependencies: StaffS22WidgetCohortDependencies,
  security: StaffConfigurationSecurityBoundary,
): void => {
  const contexts = new WeakMap<FastifyRequest, AuthorizationContext>();
  const identifiers = createSecurityIdentifierFactory();
  const traces = new WeakMap<
    FastifyRequest,
    Readonly<{ requestId: string; correlationId: string }>
  >();
  const trace = (request: FastifyRequest) => {
    let current = traces.get(request);
    if (current === undefined) {
      const now = new Date();
      current = {
        requestId: `request:${identifiers.issueResourceId(now)}`,
        correlationId: identifiers.issueResourceId(now),
      };
      traces.set(request, current);
    }
    return current;
  };
  const authorize = async (
    request: FastifyRequest,
    reply: Parameters<StaffConfigurationSecurityBoundary["resolveReadSession"]>[1],
    mutation: boolean,
  ): Promise<void> => {
    reply.header("cache-control", "no-store");
    const session = await (mutation
      ? security.resolveMutationSession(request, reply)
      : security.resolveReadSession(request, reply));
    const organization = request.headers["x-organization-context"];
    if (!isSchemaValue(OrganizationIdSchema, organization)) {
      throw new S22WidgetCohortError("permission_denied");
    }
    const actor = await resolveAuthorizationContext(
      session,
      organization,
      security.authorizationResolver,
    );
    if (actor.role !== "owner") throw new S22WidgetCohortError("permission_denied");
    contexts.set(request, actor);
  };
  const context = (request: FastifyRequest): AuthorizationContext => {
    const actor = contexts.get(request);
    if (actor === undefined) throw new S22WidgetCohortError("permission_denied");
    return actor;
  };
  api.get(
    "/v1/staff/s22/widget-cohort",
    {
      preValidation: async (request, reply) => await authorize(request, reply, false),
      schema: { response: { 200: S22WidgetCohortStatusResponseSchema } },
    },
    async (request) => ({
      data: await dependencies.useCases.get({ actor: context(request) }),
      meta: { request_id: trace(request).requestId },
    }),
  );
  api.post<{ Body: S22WidgetCohortSelectInput }>(
    "/v1/staff/s22/widget-cohort/selection",
    {
      preValidation: async (request, reply) => await authorize(request, reply, true),
      schema: {
        body: S22WidgetCohortSelectInputSchema,
        response: { 200: S22WidgetCohortSelectionResponseSchema },
      },
    },
    async (request) => {
      const auditTrace = trace(request);
      try {
        const data = await dependencies.useCases.select({
          actor: context(request),
          body: request.body,
          ...auditTrace,
        });
        request.log.info(
          {
            operation: "s22_widget_cohort_selection",
            outcome: "selected",
            httpRequestId: request.id,
            ...auditTrace,
            selectionVersion: data.selection_version,
          },
          "S22 Widget cohort selection committed",
        );
        return { data, meta: { request_id: auditTrace.requestId } };
      } catch (error) {
        request.log.warn(
          {
            operation: "s22_widget_cohort_selection",
            outcome: "failed",
            httpRequestId: request.id,
            ...auditTrace,
            code: error instanceof S22WidgetCohortError ? error.code : "unavailable",
          },
          "S22 Widget cohort selection rejected",
        );
        throw error;
      }
    },
  );
};
