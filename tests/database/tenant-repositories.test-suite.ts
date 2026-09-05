import {
  AppointmentRequestIdSchema,
  ChannelConnectionIdSchema,
  ContactIdSchema,
  ConversationIdSchema,
  HandoffIdSchema,
  LeadIdSchema,
  LocationIdSchema,
  MembershipIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  ServiceIdSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type AppointmentRequestId,
  type ChannelConnectionId,
  type ContactId,
  type ConversationId,
  type HandoffId,
  type LeadId,
  type LocationId,
  type MembershipId,
  type MessageId,
  type OrganizationId,
  type ResourceId,
  type ServiceId,
  type UtcTimestamp,
} from "../../packages/contracts/src/index.js";
import * as databasePackage from "../../packages/database/src/index.js";
import {
  InvalidRepositoryQueryError,
  RepositoryNotFoundError,
  TenantSessionClosedError,
  createAppointmentRepository,
  createConfigurationRepository,
  createConversationRepository,
  createCustomerRepository,
  createHandoffNotificationRepository,
  createLeadRepository,
  withTenantTransaction,
  type TenantDatabaseRuntime,
} from "../../packages/database/src/index.js";
import { executeTenantRead } from "../../packages/database/src/repositories/shared.js";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

type RepositoryFixtureStrings = Readonly<{
  appointmentA: string;
  appointmentB: string;
  channelA: string;
  channelB: string;
  contactA: string;
  contactB: string;
  conversationA: string;
  conversationB: string;
  handoffA: string;
  handoffB: string;
  identityA: string;
  leadA: string;
  leadB: string;
  locationA: string;
  locationVersionA: string;
  membershipA: string;
  messageA: string;
  notificationA: string;
  notificationB: string;
  organizationA: string;
  organizationB: string;
  retentionPolicyA: string;
  serviceA: string;
  widgetSessionA: string;
  widgetSessionB: string;
}>;

type TenantRepositoryTestHarness = Readonly<{
  fixtures: RepositoryFixtureStrings;
  privilegedPool: () => Pool;
  runtime: () => TenantDatabaseRuntime;
  seed: () => Promise<void>;
}>;

const requireId = <Id>(schema: Parameters<typeof isSchemaValue>[0], value: string): Id => {
  if (!isSchemaValue(schema, value)) {
    throw new Error("Invalid synthetic repository fixture identifier");
  }
  return value as Id;
};

type RepositoryFixtures = Readonly<{
  appointmentA: AppointmentRequestId;
  appointmentB: AppointmentRequestId;
  channelA: ChannelConnectionId;
  channelB: ChannelConnectionId;
  contactA: ContactId;
  contactB: ContactId;
  conversationA: ConversationId;
  conversationB: ConversationId;
  handoffA: HandoffId;
  handoffB: HandoffId;
  identityA: ResourceId;
  leadA: LeadId;
  leadB: LeadId;
  locationA: LocationId;
  locationVersionA: ResourceId;
  membershipA: MembershipId;
  messageA: MessageId;
  notificationA: ResourceId;
  notificationB: ResourceId;
  organizationA: OrganizationId;
  organizationB: OrganizationId;
  retentionPolicyA: ResourceId;
  serviceA: ServiceId;
  widgetSessionA: ResourceId;
  widgetSessionB: ResourceId;
}>;

const mapFixtures = (values: RepositoryFixtureStrings): RepositoryFixtures => ({
  appointmentA: requireId(AppointmentRequestIdSchema, values.appointmentA),
  appointmentB: requireId(AppointmentRequestIdSchema, values.appointmentB),
  channelA: requireId(ChannelConnectionIdSchema, values.channelA),
  channelB: requireId(ChannelConnectionIdSchema, values.channelB),
  contactA: requireId(ContactIdSchema, values.contactA),
  contactB: requireId(ContactIdSchema, values.contactB),
  conversationA: requireId(ConversationIdSchema, values.conversationA),
  conversationB: requireId(ConversationIdSchema, values.conversationB),
  handoffA: requireId(HandoffIdSchema, values.handoffA),
  handoffB: requireId(HandoffIdSchema, values.handoffB),
  identityA: requireId(ResourceIdSchema, values.identityA),
  leadA: requireId(LeadIdSchema, values.leadA),
  leadB: requireId(LeadIdSchema, values.leadB),
  locationA: requireId(LocationIdSchema, values.locationA),
  locationVersionA: requireId(ResourceIdSchema, values.locationVersionA),
  membershipA: requireId(MembershipIdSchema, values.membershipA),
  messageA: requireId(MessageIdSchema, values.messageA),
  notificationA: requireId(ResourceIdSchema, values.notificationA),
  notificationB: requireId(ResourceIdSchema, values.notificationB),
  organizationA: requireId(OrganizationIdSchema, values.organizationA),
  organizationB: requireId(OrganizationIdSchema, values.organizationB),
  retentionPolicyA: requireId(ResourceIdSchema, values.retentionPolicyA),
  serviceA: requireId(ServiceIdSchema, values.serviceA),
  widgetSessionA: requireId(ResourceIdSchema, values.widgetSessionA),
  widgetSessionB: requireId(ResourceIdSchema, values.widgetSessionB),
});

const expectTenantLocalNotFound = async (operation: Promise<unknown>): Promise<void> => {
  await expect(operation).rejects.toBeInstanceOf(RepositoryNotFoundError);
  await expect(operation).rejects.toMatchObject({
    code: "repository_not_found",
    message: "Resource was not found in the current tenant",
  });
};

const assertNoInfrastructureHandles = (repository: object): void => {
  for (const unsafeKey of ["client", "database", "db", "pool", "transaction"]) {
    expect(unsafeKey in repository).toBe(false);
  }
  expect(Object.isFrozen(repository)).toBe(true);
};

export const registerTenantRepositoryTests = (harness: TenantRepositoryTestHarness): void => {
  const fixtures = mapFixtures(harness.fixtures);
  const effectiveAt = requireId<UtcTimestamp>(UtcTimestampSchema, "2026-03-01T00:00:00.000Z");

  describe("S5.4 tenant repositories", () => {
    it("publishes only session-bound factories and keeps raw infrastructure package-internal", async () => {
      await harness.seed();
      expect("executeTenantQuery" in databasePackage).toBe(false);
      expect("executeTenantRead" in databasePackage).toBe(false);
      expect("readRepositoryDatabaseCause" in databasePackage).toBe(false);

      await withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) => {
        const repositories = [
          createConfigurationRepository(session),
          createCustomerRepository(session),
          createLeadRepository(session),
          createConversationRepository(session),
          createAppointmentRepository(session),
          createHandoffNotificationRepository(session),
        ];
        for (const repository of repositories) {
          assertNoInfrastructureHandles(repository);
          expect(Object.values(repository).every((value) => typeof value === "function")).toBe(
            true,
          );
        }
      });
    });

    it("reads tenant-root and configuration data without exposing Tenant B existence", async () => {
      await harness.seed();
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, async (session) => {
        const repository = createConfigurationRepository(session);
        expect((await repository.getOrganization()).organizationId).toBe(fixtures.organizationA);
        expect((await repository.getChannelConnection(fixtures.channelA)).channelConnectionId).toBe(
          fixtures.channelA,
        );
        await expectTenantLocalNotFound(repository.getChannelConnection(fixtures.channelB));
        expect((await repository.getWidgetSession(fixtures.widgetSessionA)).widgetSessionId).toBe(
          fixtures.widgetSessionA,
        );
        await expectTenantLocalNotFound(repository.getWidgetSession(fixtures.widgetSessionB));
        expect((await repository.listWidgetAllowedOrigins(fixtures.channelA)).items).toHaveLength(
          1,
        );
        const locations = await repository.listLocations();
        expect(locations.items.map((item) => item.locationId)).toHaveLength(1);
        expect((await repository.listServices()).items).toHaveLength(1);
        expect((await repository.listLocationHours(fixtures.locationVersionA)).items).toEqual([]);
        expect(
          (await repository.listLocationClosures(fixtures.locationA, "2026-01-01", "2026-02-01"))
            .items,
        ).toEqual([]);
        expect(
          (await repository.listServiceLocations(fixtures.serviceA, effectiveAt)).items,
        ).toEqual([]);
        expect((await repository.listServicePrices(fixtures.serviceA, effectiveAt)).items).toEqual(
          [],
        );
        expect((await repository.listPublishedFaqs(effectiveAt)).items).toEqual([]);
        expect((await repository.listPublishedBusinessPolicies(effectiveAt)).items).toEqual([]);
        expect((await repository.getCurrentRetentionPolicy()).retentionPolicyId).toBe(
          fixtures.retentionPolicyA,
        );
        expect(
          (await repository.listRetentionPolicyRules(fixtures.retentionPolicyA)).items,
        ).toHaveLength(1);
      });
    });

    it("performs exact tenant/channel/hash identity resolution and symmetric A/B isolation", async () => {
      await harness.seed();
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, async (session) => {
        const repository = createCustomerRepository(session);
        expect((await repository.getContact(fixtures.contactA)).contactId).toBe(fixtures.contactA);
        await expectTenantLocalNotFound(repository.getContact(fixtures.contactB));
        const identity = await repository.findActiveIdentity({
          channelConnectionId: fixtures.channelA,
          identityType: "widget_participant",
          lookupHash: Buffer.from("s54-tenant-a-participant-hash"),
        });
        expect(identity?.contactIdentityId).toBe(fixtures.identityA);
        expect(
          await repository.findActiveIdentity({
            channelConnectionId: fixtures.channelB,
            identityType: "widget_participant",
            lookupHash: Buffer.from("s54-tenant-b-participant-hash"),
          }),
        ).toBeNull();
      });

      await withTenantTransaction(harness.runtime(), fixtures.organizationB, async (session) => {
        const repository = createCustomerRepository(session);
        expect((await repository.getContact(fixtures.contactB)).contactId).toBe(fixtures.contactB);
        await expectTenantLocalNotFound(repository.getContact(fixtures.contactA));
      });
    });

    it("respects active Lead identity and provides gap-free keyset pagination", async () => {
      await harness.seed();
      const contactIds = [0x95401, 0x95402, 0x95403].map(
        (suffix) => `0193f1a8-7f65-7c28-a434-${suffix.toString(16).padStart(12, "0")}`,
      );
      const leadIds = [0x95411, 0x95412, 0x95413].map(
        (suffix) => `0193f1a8-7f65-7c28-a434-${suffix.toString(16).padStart(12, "0")}`,
      );
      for (let index = 0; index < contactIds.length; index += 1) {
        await harness.privilegedPool().query(
          `insert into contacts
            (id, organization_id, preferred_locale, status, first_seen_at, last_seen_at)
           values ($1, $2, 'en', 'active', $3, $3)`,
          [contactIds[index], fixtures.organizationA, "2026-03-01T00:00:00Z"],
        );
        await harness.privilegedPool().query(
          `insert into leads
            (id, organization_id, contact_id, status, source_channel_connection_id,
             closed_at, closed_reason, created_at, updated_at)
           values ($1, $2, $3, 'closed', $4, $5, 'completed', $5, $5)`,
          [
            leadIds[index],
            fixtures.organizationA,
            contactIds[index],
            fixtures.channelA,
            "2026-03-01T00:00:00Z",
          ],
        );
      }

      await withTenantTransaction(harness.runtime(), fixtures.organizationA, async (session) => {
        const repository = createLeadRepository(session);
        expect((await repository.findActiveLeadByContact(fixtures.contactA))?.leadId).toBe(
          fixtures.leadA,
        );
        expect(await repository.findActiveLeadByContact(fixtures.contactB)).toBeNull();
        await expectTenantLocalNotFound(repository.getLead(fixtures.leadB));

        const first = await repository.listLeads({ limit: 2, status: "closed" });
        expect(first.items).toHaveLength(2);
        expect(first.next).not.toBeNull();
        if (first.next === null) {
          throw new Error("Expected a second Lead page");
        }
        const second = await repository.listLeads({
          after: first.next,
          limit: 2,
          status: "closed",
        });
        const all = [...first.items, ...second.items].map((lead) => lead.leadId);
        expect(new Set(all).size).toBe(3);
        expect(all).toEqual(expect.arrayContaining(leadIds));
      });
    });

    it("uses active thread grouping and stable message sequence retrieval", async () => {
      await harness.seed();
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, async (session) => {
        const repository = createConversationRepository(session);
        const active = await repository.findActiveConversation(
          fixtures.channelA,
          Buffer.from(`synthetic-thread-hash-${fixtures.conversationA}`),
        );
        expect(active?.conversationId).toBe(fixtures.conversationA);
        await expectTenantLocalNotFound(repository.getConversation(fixtures.conversationB));
        const inbox = await repository.listInbox();
        expect(inbox.items.map((item) => item.conversationId)).toEqual([fixtures.conversationA]);
        const messages = await repository.listMessages(fixtures.conversationA);
        expect(messages.items.map((item) => item.messageId)).toEqual([fixtures.messageA]);
        expect(messages.items[0]?.sequenceNo).toBe(1);
      });
    });

    it("keeps appointment reads and immutable history APIs tenant-scoped", async () => {
      await harness.seed();
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, async (session) => {
        const repository = createAppointmentRepository(session);
        expect(
          (await repository.getAppointmentRequest(fixtures.appointmentA)).appointmentRequestId,
        ).toBe(fixtures.appointmentA);
        await expectTenantLocalNotFound(repository.getAppointmentRequest(fixtures.appointmentB));
        const queue = await repository.listReviewQueue({ status: "requested" });
        expect(queue.items.map((item) => item.appointmentRequestId)).toEqual([
          fixtures.appointmentA,
        ]);
        expect((await repository.listPreferences(fixtures.appointmentA)).items).toEqual([]);
        expect((await repository.listTransitions(fixtures.appointmentA)).items).toEqual([]);
      });
    });

    it("reads Handoff work lists and Notification delivery history without worker APIs", async () => {
      await harness.seed();
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, async (session) => {
        const repository = createHandoffNotificationRepository(session);
        expect((await repository.getHandoff(fixtures.handoffA)).handoffId).toBe(fixtures.handoffA);
        await expectTenantLocalNotFound(repository.getHandoff(fixtures.handoffB));
        expect(
          (await repository.findActiveHandoffByConversation(fixtures.conversationA))?.handoffId,
        ).toBe(fixtures.handoffA);
        expect((await repository.listActiveHandoffs()).items.map((item) => item.handoffId)).toEqual(
          [fixtures.handoffA],
        );
        expect((await repository.getNotification(fixtures.notificationA)).notificationId).toBe(
          fixtures.notificationA,
        );
        await expectTenantLocalNotFound(repository.getNotification(fixtures.notificationB));
        expect(
          (await repository.listRecipientNotifications(fixtures.membershipA)).items.map(
            (item) => item.notificationId,
          ),
        ).toEqual([fixtures.notificationA]);
        expect(
          (await repository.listNotificationAttempts(fixtures.notificationA)).items,
        ).toHaveLength(1);
      });
    });

    it("enforces explicit tenant-qualified read SQL and session lifetime without hidden transactions", async () => {
      await harness.seed();
      let escapedRepository: ReturnType<typeof createCustomerRepository> | undefined;
      const marker = new Error("synthetic repository callback rollback");
      await expect(
        withTenantTransaction(harness.runtime(), fixtures.organizationA, async (session) => {
          escapedRepository = createCustomerRepository(session);
          expect((await escapedRepository.getContact(fixtures.contactA)).contactId).toBe(
            fixtures.contactA,
          );
          await expect(
            executeTenantRead(session, "select id from contacts"),
          ).rejects.toBeInstanceOf(InvalidRepositoryQueryError);
          throw marker;
        }),
      ).rejects.toBe(marker);
      if (escapedRepository === undefined) {
        throw new Error("Repository callback did not run");
      }
      await expect(escapedRepository.getContact(fixtures.contactA)).rejects.toBeInstanceOf(
        TenantSessionClosedError,
      );
    });
  });
};
