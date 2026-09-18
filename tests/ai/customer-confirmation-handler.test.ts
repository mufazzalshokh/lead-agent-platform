import { describe, expect, it, vi } from "vitest";
import {
  createCustomerConfirmationMessageHandler,
  createCustomerConfirmationPreparationHandler,
  createCustomerConfirmationExpiryHandler,
} from "../../apps/worker/src/customer-confirmation.js";
import { createProductionHandlerRegistry } from "../../apps/worker/src/telegram-outbound.js";
import type {
  WorkerHandlerContext,
  WorkerEventHandler,
} from "../../apps/worker/src/handler-registry.js";
import { queueForEvent, isKnownEventVersion } from "../../apps/worker/src/event-routing.js";
import type { CustomerConfirmationStore } from "../../packages/application/src/index.js";
import { DomainEventSchemasByVersion, isSchemaValue } from "../../packages/contracts/src/index.js";
import { AI_REFERENCE, fixtureId } from "./fixtures.js";

const context = (
  kind:
    | "message.received"
    | "appointment_request.staff_accepted"
    | "appointment_request.customer_confirmation_requested",
): WorkerHandlerContext => {
  const payload =
    kind === "message.received"
      ? { message_direction: "inbound", message_id: AI_REFERENCE.messageId }
      : kind === "appointment_request.staff_accepted"
        ? {
            appointment_status: "staff_accepted",
            location_id: fixtureId(28001),
            offer_version: 1,
            scheduled_start_at: "2026-09-19T12:00:00.000Z",
          }
        : {
            appointment_status: "awaiting_customer_confirmation",
            offer_version: 1,
            confirmation_expires_at: "2026-09-19T09:00:00.000Z",
          };
  const schema = DomainEventSchemasByVersion[kind]["1"];
  const value: unknown = {
    actor:
      kind === "appointment_request.staff_accepted"
        ? { actor_type: "member", actor_id: fixtureId(28002) }
        : { actor_type: "system", actor_id: null },
    aggregate_id: kind === "message.received" ? AI_REFERENCE.conversationId : fixtureId(28003),
    aggregate_type: kind === "message.received" ? "conversation" : "appointment_request",
    aggregate_version:
      kind === "message.received" ? 2 : kind === "appointment_request.staff_accepted" ? 2 : 3,
    event_id: AI_REFERENCE.causationId,
    event_type: kind,
    schema_id:
      kind === "message.received"
        ? "MessageReceivedDomainEvent.v1"
        : kind === "appointment_request.staff_accepted"
          ? "AppointmentRequestStaffAcceptedDomainEvent.v1"
          : "AppointmentRequestCustomerConfirmationRequestedDomainEvent.v1",
    schema_version: "1",
    organization_id: AI_REFERENCE.organizationId,
    occurred_at: "2026-09-18T09:00:00.000Z",
    correlation_id: AI_REFERENCE.correlationId,
    causation_id: null,
    request_id: null,
    payload,
  };
  if (!isSchemaValue(schema, value)) throw new TypeError("Invalid S18 worker fixture");
  return {
    attempt: { attemptNumber: 1, jobId: fixtureId(28004), retryLimit: 5 },
    canonicalEvent: value,
    causationId: null,
    correlationId: AI_REFERENCE.correlationId,
    identity: {
      handlerVersion: "v1",
      idempotencyKey: "s18:worker",
      outboxEventId: AI_REFERENCE.causationId,
      providerIdempotencyKey: AI_REFERENCE.causationId,
    },
    organizationId: AI_REFERENCE.organizationId,
    outboxEventId: AI_REFERENCE.causationId,
    signal: new AbortController().signal,
    tenant: { organizationId: AI_REFERENCE.organizationId },
  };
};
const store = () => ({
  prepare: vi.fn<CustomerConfirmationStore["prepare"]>(() => Promise.resolve("prepared")),
  expire: vi.fn<CustomerConfirmationStore["expire"]>(() => Promise.resolve("expired")),
  respond: vi.fn<CustomerConfirmationStore["respond"]>(() =>
    Promise.resolve({ kind: "not_applicable", reason: null }),
  ),
});
describe("S18 finite confirmation worker boundaries", () => {
  it("consumes the existing staff intent under unchanged analytics ownership", async () => {
    const persistence = store(),
      ctx = context("appointment_request.staff_accepted");
    await createCustomerConfirmationPreparationHandler(persistence)(ctx);
    expect(persistence.prepare).toHaveBeenCalledWith(ctx.canonicalEvent);
    const registry = createProductionHandlerRegistry({
      telegramOutbound: vi.fn<WorkerEventHandler>(),
      confirmationPreparation: createCustomerConfirmationPreparationHandler(persistence),
      confirmationExpiry: createCustomerConfirmationExpiryHandler(persistence),
    });
    expect(registry.resolve("appointment_request.staff_accepted", "1")?.queue).toBe("analytics");
    expect(
      registry.resolve("appointment_request.customer_confirmation_requested", "1")?.queue,
    ).toBe("analytics");
    expect(queueForEvent("appointment_request.confirmed")).toBe("analytics");
    expect(isKnownEventVersion("appointment_request.confirmed", "1")).toBe(true);
    expect(isKnownEventVersion("appointment_request.confirmed", "2")).toBe(true);
    expect(isKnownEventVersion("appointment_request.confirmed", "3")).toBe(false);
  });
  it("passes only trusted durable references, never model target IDs", async () => {
    const persistence = store(),
      fallback = vi.fn<WorkerEventHandler>();
    persistence.respond.mockResolvedValue({ kind: "confirmed", reason: null });
    await createCustomerConfirmationMessageHandler(
      persistence,
      fallback,
    )(context("message.received"));
    expect(persistence.respond).toHaveBeenCalledWith(AI_REFERENCE);
    expect(fallback).not.toHaveBeenCalled();
  });
  it.each(["clarification", "grounding_insufficient", "ignored", "declined"] as const)(
    "does not let model fallback override a handled %s",
    async (kind) => {
      const persistence = store(),
        fallback = vi.fn<WorkerEventHandler>();
      persistence.respond.mockResolvedValue({ kind, reason: "s18:bounded" });
      await createCustomerConfirmationMessageHandler(
        persistence,
        fallback,
      )(context("message.received"));
      expect(fallback).not.toHaveBeenCalled();
    },
  );
  it("preserves the pre-existing AI path when no confirmation context applies", async () => {
    const persistence = store(),
      fallback = vi.fn<WorkerEventHandler>(),
      ctx = context("message.received");
    await createCustomerConfirmationMessageHandler(persistence, fallback)(ctx);
    expect(fallback).toHaveBeenCalledWith(ctx);
  });
  it("rejects tenant substitution before persistence", async () => {
    const persistence = store();
    await expect(
      createCustomerConfirmationPreparationHandler(persistence)({
        ...context("appointment_request.staff_accepted"),
        organizationId: fixtureId(28005),
      }),
    ).rejects.toMatchObject({ code: "worker_job_invariant_failed" });
    expect(persistence.prepare).not.toHaveBeenCalled();
  });
  it("surfaces unavailable delivery binding without claiming confirmation", async () => {
    const persistence = store();
    persistence.prepare.mockResolvedValue("unavailable");
    await expect(
      createCustomerConfirmationPreparationHandler(persistence)(
        context("appointment_request.staff_accepted"),
      ),
    ).rejects.toMatchObject({ category: "PERMANENT_BUSINESS" });
  });
  it("does not acknowledge an expiry job before its trusted deadline", async () => {
    const persistence = store();
    persistence.expire.mockResolvedValue("not_due");
    await expect(
      createCustomerConfirmationExpiryHandler(persistence)(
        context("appointment_request.customer_confirmation_requested"),
      ),
    ).rejects.toMatchObject({ category: "RETRYABLE_INFRASTRUCTURE" });
  });
});
