import {
  CorrelationIdSchema,
  LocationIdSchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  RequestIdSchema,
  ResourceIdSchema,
  UserIdSchema,
  isSchemaValue,
  type MembershipId,
  type LocationId,
  type OrganizationId,
  type ResourceId,
  type UserId,
} from "../../packages/contracts/src/index.js";
import {
  InvitationTokenInvalidError,
  MembershipLifecyclePermissionDeniedError,
  canonicalizeInvitationEmailTarget,
  createInvitationCredentialFactoryWithRandomness,
  createInvitationEmailTargetProtector,
  createMembershipLifecycle,
  createOidcIdentityVerifier,
  hashInvitationToken,
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
  type CurrentMembershipAuthorizationResolver,
  type InvitationIssuePersistence,
  type MembershipLifecycleStore,
  type MembershipRole,
} from "../../packages/security/src/index.js";
import { describe, expect, it } from "vitest";

const values = {
  correlation: "0193f1a8-7f65-7c28-a434-a10796c46501",
  membership: "0193f1a8-7f65-7c28-a434-a10796c46502",
  organization: "0193f1a8-7f65-7c28-a434-a10796c46503",
  request: "request.s65.0001",
  resource: "0193f1a8-7f65-7c28-a434-a10796c46504",
  user: "0193f1a8-7f65-7c28-a434-a10796c46505",
} as const;

if (
  !isSchemaValue(CorrelationIdSchema, values.correlation) ||
  !isSchemaValue(MembershipIdSchema, values.membership) ||
  !isSchemaValue(OrganizationIdSchema, values.organization) ||
  !isSchemaValue(RequestIdSchema, values.request) ||
  !isSchemaValue(ResourceIdSchema, values.resource) ||
  !isSchemaValue(UserIdSchema, values.user)
) {
  throw new TypeError("Invalid S6.5 test identifiers");
}

const ORGANIZATION_ID: OrganizationId = values.organization;
const MEMBERSHIP_ID: MembershipId = values.membership;
const USER_ID: UserId = values.user;
const RESOURCE_ID: ResourceId = values.resource;
const NOW = new Date("2026-09-11T10:00:00.000Z");
const AUDIT = Object.freeze({ correlationId: values.correlation, requestId: values.request });

const session = (
  authenticationLevel = "mfa",
  authenticationTime = NOW,
): AuthenticatedApplicationSession =>
  Object.freeze({
    absoluteExpiresAt: new Date(NOW.getTime() + 12 * 60 * 60 * 1_000),
    authenticationLevel,
    authenticationTime,
    createdAt: NOW,
    idleExpiresAt: new Date(NOW.getTime() + 60 * 60 * 1_000),
    lastSeenAt: NOW,
    rotatedAt: NOW,
    rotationDue: false,
    sessionId: values.resource,
    userId: USER_ID,
  });

const authorization = async (role: MembershipRole) => {
  const resolver: CurrentMembershipAuthorizationResolver = {
    resolveCurrentMembership: () =>
      Promise.resolve({
        allowedLocationIds: [],
        locationScope: role === "staff" || role === "analyst" ? "restricted" : "all",
        membershipId: MEMBERSHIP_ID,
        organizationId: ORGANIZATION_ID,
        role,
        status: "active",
        userId: USER_ID,
      }),
  };
  return resolveAuthorizationContext(session(), ORGANIZATION_ID, resolver);
};

const protector = () =>
  createInvitationEmailTargetProtector({
    encryptionKey: new Uint8Array(32).fill(0x11),
    lookupKey: new Uint8Array(32).fill(0x22),
  });

const store = (overrides: Partial<MembershipLifecycleStore> = {}): MembershipLifecycleStore => ({
  acceptInvitation: () =>
    Promise.resolve({
      externalIdentityCreated: true,
      membershipActivated: true,
      membershipId: MEMBERSHIP_ID,
      outcome: "activated",
      userCreated: true,
      userId: USER_ID,
    }),
  changeMembershipLocationScope: () => Promise.resolve({ revokedSessionCount: 0, version: 2 }),
  changeMembershipRole: () => Promise.resolve({ revokedSessionCount: 0, version: 2 }),
  issueInvitation: () => Promise.resolve(),
  reactivateMembership: () => Promise.resolve({ revokedSessionCount: 0, version: 2 }),
  resendInvitation: () => Promise.resolve(protector().protect("person@example.com").ciphertext),
  revokeInvitation: () => Promise.resolve(),
  revokeMembership: () => Promise.resolve({ revokedSessionCount: 0, version: 2 }),
  suspendMembership: () => Promise.resolve({ revokedSessionCount: 0, version: 2 }),
  ...overrides,
});

const targetResolver = (target: string | null = "person@example.com") => ({
  resolveVerifiedEmailTarget: () => Promise.resolve(target),
});

const identity = async () =>
  createOidcIdentityVerifier({
    verifyEvidence: () =>
      Promise.resolve({ issuer: "https://identity.example/", subject: "auth0|s65" }),
  }).verify({ expectedNonce: "unused-by-fake", idToken: "unused-by-fake" });

describe("S6.5 invitation and membership lifecycle policy", () => {
  it("uses conservative canonical email targets and purpose-separated authenticated encryption", () => {
    expect(canonicalizeInvitationEmailTarget("Person@EXAMPLE.COM")).toBe("Person@example.com");
    expect(canonicalizeInvitationEmailTarget("person@example.com")).not.toBe(
      canonicalizeInvitationEmailTarget("Person@example.com"),
    );
    expect(() => canonicalizeInvitationEmailTarget(" person@example.com")).toThrow(TypeError);
    expect(() => canonicalizeInvitationEmailTarget("person@gmail.com.")).toThrow(TypeError);

    const targetProtector = protector();
    const protectedTarget = targetProtector.protect("Person@EXAMPLE.COM");
    expect(Buffer.from(protectedTarget.ciphertext).toString("utf8")).not.toContain("Person");
    expect(protectedTarget.lookupHash).toHaveLength(32);
    expect(targetProtector.reveal(protectedTarget.ciphertext)).toBe("Person@example.com");
    const tampered = new Uint8Array(protectedTarget.ciphertext);
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 1;
    expect(() => targetProtector.reveal(tampered)).toThrow(TypeError);
  });

  it("issues strict 256-bit opaque invitation tokens and hashes only decoded bytes", () => {
    let value = 0;
    const factory = createInvitationCredentialFactoryWithRandomness((size) => {
      value += 1;
      return new Uint8Array(size).fill(value);
    });
    const first = factory.issue(NOW);
    const second = factory.issue(NOW);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toEqual(hashInvitationToken(first.token));
    expect(hashInvitationToken(Buffer.from(first.tokenHash).toString("base64url"))).not.toEqual(
      first.tokenHash,
    );
    expect(hashInvitationToken("malformed")).toBeUndefined();
  });

  it.each(["owner", "admin", "staff", "analyst"] as const)(
    "allows an owner to issue a seven-day %s invitation without persisting the raw token",
    async (role) => {
      let persisted: InvitationIssuePersistence | undefined;
      const lifecycleStore = store({
        issueInvitation: (input) => {
          persisted = input;
          return Promise.resolve();
        },
      });
      const lifecycle = createMembershipLifecycle(lifecycleStore, protector(), targetResolver(), {
        clock: () => NOW,
      });
      const context = await authorization("owner");
      const issued = await lifecycle.issueInvitation(
        { authorization: context, session: session() },
        {
          audit: AUDIT,
          locationScope: role === "owner" || role === "admin" ? "all" : "restricted",
          role,
          target: "Person@EXAMPLE.COM",
        },
      );
      expect(issued.deliveryTarget).toBe("Person@example.com");
      expect(issued.expiresAt.toISOString()).toBe("2026-09-18T10:00:00.000Z");
      expect(persisted?.tokenHash).toHaveLength(32);
      expect(JSON.stringify(persisted)).not.toContain(issued.token);
    },
  );

  it("enforces admin target-role policy and denies staff/analyst or stale/non-MFA actors", async () => {
    const lifecycle = createMembershipLifecycle(store(), protector(), targetResolver(), {
      clock: () => NOW,
    });
    const admin = await authorization("admin");
    await expect(
      lifecycle.issueInvitation(
        { authorization: admin, session: session() },
        { audit: AUDIT, locationScope: "all", role: "owner", target: "person@example.com" },
      ),
    ).rejects.toBeInstanceOf(MembershipLifecyclePermissionDeniedError);
    for (const role of ["staff", "analyst"] as const) {
      const context = await authorization(role);
      await expect(
        lifecycle.issueInvitation(
          { authorization: context, session: session() },
          {
            audit: AUDIT,
            locationScope: "restricted",
            role: "staff",
            target: "person@example.com",
          },
        ),
      ).rejects.toBeInstanceOf(MembershipLifecyclePermissionDeniedError);
    }
    await expect(
      lifecycle.issueInvitation(
        {
          authorization: admin,
          session: session("mfa", new Date(NOW.getTime() - 15 * 60 * 1_000)),
        },
        { audit: AUDIT, locationScope: "all", role: "admin", target: "person@example.com" },
      ),
    ).rejects.toBeInstanceOf(MembershipLifecyclePermissionDeniedError);
  });

  it("resend creates a distinct credential and never attempts to recover the old token", async () => {
    const targetProtector = protector();
    const encrypted = targetProtector.protect("person@example.com").ciphertext;
    const lifecycle = createMembershipLifecycle(
      store({ resendInvitation: () => Promise.resolve(encrypted) }),
      targetProtector,
      targetResolver(),
      { clock: () => NOW },
    );
    const context = await authorization("owner");
    const first = await lifecycle.resendInvitation(
      { authorization: context, session: session() },
      { audit: AUDIT, invitationId: RESOURCE_ID },
    );
    const second = await lifecycle.resendInvitation(
      { authorization: context, session: session() },
      { audit: AUDIT, invitationId: RESOURCE_ID },
    );
    expect(first.token).not.toBe(second.token);
    expect(first.deliveryTarget).toBe("person@example.com");
  });

  it("accepts only a well-formed token plus verified target evidence", async () => {
    const credential = createInvitationCredentialFactoryWithRandomness((size) =>
      new Uint8Array(size).fill(7),
    ).issue(NOW);
    let called = false;
    const lifecycle = createMembershipLifecycle(
      store({
        acceptInvitation: (input) => {
          called = true;
          expect(input.tokenHash).toEqual(credential.tokenHash);
          return store().acceptInvitation(input);
        },
      }),
      protector(),
      targetResolver(),
      { clock: () => NOW },
    );
    await expect(
      lifecycle.acceptInvitation({
        audit: AUDIT,
        identity: await identity(),
        organizationId: ORGANIZATION_ID,
        token: credential.token,
      }),
    ).resolves.toMatchObject({ outcome: "activated" });
    expect(called).toBe(true);

    const unverified = createMembershipLifecycle(store(), protector(), targetResolver(null), {
      clock: () => NOW,
    });
    await expect(
      unverified.acceptInvitation({
        audit: AUDIT,
        identity: await identity(),
        organizationId: ORGANIZATION_ID,
        token: credential.token,
      }),
    ).rejects.toBeInstanceOf(InvitationTokenInvalidError);
    await expect(
      lifecycle.acceptInvitation({
        audit: AUDIT,
        identity: await identity(),
        organizationId: ORGANIZATION_ID,
        token: "malformed",
      }),
    ).rejects.toBeInstanceOf(InvitationTokenInvalidError);
  });

  it("rejects duplicate and foreign-shaped location scope inputs before persistence", async () => {
    const locationValue = "0193f1a8-7f65-7c28-a434-a10796c46506";
    if (!isSchemaValue(LocationIdSchema, locationValue))
      throw new TypeError("Invalid location fixture");
    const location: LocationId = locationValue;
    const context = await authorization("owner");
    const lifecycle = createMembershipLifecycle(store(), protector(), targetResolver(), {
      clock: () => NOW,
    });
    expect(() =>
      lifecycle.changeMembershipLocationScope(
        { authorization: context, session: session() },
        {
          audit: AUDIT,
          expectedVersion: 1,
          locationIds: [location, location],
          locationScope: "restricted",
          targetMembershipId: MEMBERSHIP_ID,
        },
      ),
    ).toThrow(TypeError);
    expect(() =>
      lifecycle.reactivateMembership(
        { authorization: context, session: session() },
        {
          audit: AUDIT,
          expectedVersion: 1,
          locationIds: [],
          locationScope: "restricted",
          role: "owner",
          targetMembershipId: MEMBERSHIP_ID,
        },
      ),
    ).toThrow(MembershipLifecyclePermissionDeniedError);
  });
});
