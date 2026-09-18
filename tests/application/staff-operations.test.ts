import { describe, expect, it, vi } from "vitest";
import {
  createStaffOperations,
  createStaffQueryCursorCodec,
  type StaffOperationsStore,
  type StaffPreparedOperation,
} from "../../packages/application/src/index.js";
import {
  StaffWorkItemSchema,
  OrganizationIdSchema,
  MembershipIdSchema,
  UserIdSchema,
  ResourceIdSchema,
  isSchemaValue,
} from "../../packages/contracts/src/index.js";
import { staffWorkFixture } from "./staff-operations-fixtures.js";
import {
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
  type MembershipRole,
} from "../../packages/security/src/index.js";

const id = "0199f1a8-7f65-7c28-a434-a10796c49001",
  org = "0199f1a8-7f65-7c28-a434-a10796c49002",
  member = "0199f1a8-7f65-7c28-a434-a10796c49003",
  user = "0199f1a8-7f65-7c28-a434-a10796c49004";
if (
  !isSchemaValue(ResourceIdSchema, id) ||
  !isSchemaValue(OrganizationIdSchema, org) ||
  !isSchemaValue(MembershipIdSchema, member) ||
  !isSchemaValue(UserIdSchema, user)
)
  throw new TypeError("Invalid S17 fixture");
const now = new Date("2026-09-18T08:00:00.000Z");
const authorize = async (role: MembershipRole = "staff") => {
  const session: AuthenticatedApplicationSession = {
    userId: user,
    sessionId: id,
    authenticationLevel: "mfa",
    authenticationTime: now,
    createdAt: now,
    lastSeenAt: now,
    rotatedAt: now,
    rotationDue: false,
    idleExpiresAt: new Date(now.getTime() + 3600000),
    absoluteExpiresAt: new Date(now.getTime() + 86400000),
  };
  return resolveAuthorizationContext(session, org, {
    resolveCurrentMembership: () =>
      Promise.resolve({
        userId: user,
        organizationId: org,
        membershipId: member,
        role,
        status: "active",
        locationScope: "all",
        allowedLocationIds: [],
      }),
  });
};
const fixture = () => {
  const calls: StaffPreparedOperation[] = [];
  const list = vi.fn<StaffOperationsStore["list"]>(() =>
    Promise.resolve({ items: [staffWorkFixture], next: { at: now.toISOString(), id } }),
  );
  const mutate = vi.fn<StaffOperationsStore["mutate"]>((input) => {
    calls.push(input);
    return Promise.resolve({ resource: staffWorkFixture, outcome_id: null });
  });
  const store: StaffOperationsStore = {
    list,
    get: vi.fn(() => Promise.resolve(staffWorkFixture)),
    outcomes: vi.fn(() => Promise.resolve({ items: [], next: null })),
    mutate,
  };
  return {
    store,
    mocks: { list, mutate },
    calls,
    ops: createStaffOperations(
      store,
      createStaffQueryCursorCodec(new Uint8Array(32).fill(17)),
      () => now,
    ),
  };
};
describe("S17 private staff application boundary", () => {
  it.each(["conversation", "handoff", "appointment_request", "notification"] as const)(
    "authorizes the finite %s reader",
    async (kind) => {
      const f = fixture();
      expect((await f.ops.list(await authorize(), kind, {})).items).toEqual([staffWorkFixture]);
      expect(f.mocks.list).toHaveBeenCalledWith(
        expect.objectContaining({ kind, limit: 25, after: null }),
      );
    },
  );
  it.each(["conversation", "handoff", "appointment_request", "notification"] as const)(
    "denies analyst %s access before persistence",
    async (kind) => {
      const f = fixture();
      await expect(f.ops.list(await authorize("analyst"), kind, {})).rejects.toMatchObject({
        code: "permission_denied",
      });
      expect(f.mocks.list).not.toHaveBeenCalled();
    },
  );
  it("binds cursor to actor, tenant, location scope, resource and view", async () => {
    const f = fixture(),
      auth = await authorize(),
      page = await f.ops.list(auth, "appointment_request", {});
    if (page.nextCursor === null) throw new Error("Expected fixture cursor");
    await f.ops.list(auth, "appointment_request", { cursor: page.nextCursor });
    for (const kind of ["conversation", "handoff", "notification"] as const)
      await expect(f.ops.list(auth, kind, { cursor: page.nextCursor })).rejects.toMatchObject({
        code: "validation_failed",
      });
    await expect(
      f.ops.list(auth, "appointment_request", { cursor: page.nextCursor, view: "history" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      f.ops.list(await authorize("admin"), "appointment_request", { cursor: page.nextCursor }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
  it("prepares bounded existing idempotency records without raw keys or a phone requirement", async () => {
    const f = fixture(),
      auth = await authorize();
    await f.ops.mutate(
      auth,
      "appointment_request",
      id,
      1,
      "browser-key",
      { action: "reject", input: { reason_code: "unavailable" } },
      "request:s17",
      "unused",
    );
    const command = f.calls[0];
    expect(command).toMatchObject({
      authorization: auth,
      expectedVersion: 1,
      operation: { action: "reject" },
      occurredAt: now.toISOString(),
    });
    expect(command?.idempotency.keyHash.byteLength).toBe(32);
    expect(JSON.stringify(command)).not.toContain("browser-key");
    expect(isSchemaValue(ResourceIdSchema, command?.idempotency.id)).toBe(true);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid CAS version %s",
    async (version) => {
      const f = fixture();
      await expect(
        f.ops.mutate(
          await authorize(),
          "appointment_request",
          id,
          version,
          "browser-key",
          { action: "reject", input: { reason_code: "unavailable" } },
          "request:s17",
          "unused",
        ),
      ).rejects.toMatchObject({ code: "validation_failed" });
      expect(f.mocks.mutate).not.toHaveBeenCalled();
    },
  );
  it("rejects mismatched protected resource kind", async () => {
    const f = fixture();
    await expect(
      f.ops.mutate(
        await authorize(),
        "conversation",
        id,
        1,
        "browser-key",
        { action: "reject", input: { reason_code: "unavailable" } },
        "request:s17",
        "unused",
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
  it("does not expose sensitive/private fields in the work contract", () => {
    for (const field of [
      "staff_notes",
      "reasoning",
      "provider_payload",
      "body_ciphertext",
      "organization_id",
      "confirmation_token",
      "phone",
    ])
      expect(isSchemaValue(StaffWorkItemSchema, { ...staffWorkFixture, [field]: "private" })).toBe(
        false,
      );
  });
  it("rejects unbounded and unknown filters", async () => {
    const f = fixture(),
      auth = await authorize();
    for (const limit of [0, 101, 100000])
      await expect(f.ops.list(auth, "conversation", { limit })).rejects.toMatchObject({
        code: "validation_failed",
      });
  });
});
