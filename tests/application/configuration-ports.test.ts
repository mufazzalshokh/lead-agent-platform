import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CONFIGURATION_PERMISSIONS,
  type BusinessPolicyConfigurationUseCases,
  type FaqConfigurationUseCases,
  type LocationConfigurationUseCases,
  type PriceConfigurationUseCases,
  type PublishedBusinessKnowledgeReader,
  type ServiceConfigurationUseCases,
} from "../../packages/application/src/index.js";
import type { ResourceVersion } from "../../packages/contracts/src/index.js";
import type { AuthorizationContext } from "../../packages/security/src/index.js";

type FirstParameter<Method> = Method extends (argument: infer Parameter) => unknown
  ? Parameter
  : never;

describe("S7.1 configuration application ports", () => {
  it("reuses the frozen S6 permission vocabulary exactly", () => {
    expect(CONFIGURATION_PERMISSIONS).toEqual([
      "configuration.read",
      "configuration.write",
      "configuration.publish",
    ]);
  });

  it("requires trusted AuthorizationContext on every representative boundary", () => {
    expectTypeOf<FirstParameter<LocationConfigurationUseCases["createLocation"]>>().toMatchTypeOf<{
      authorization: AuthorizationContext;
    }>();
    expectTypeOf<FirstParameter<ServiceConfigurationUseCases["publishService"]>>().toMatchTypeOf<{
      authorization: AuthorizationContext;
      expectedVersion: ResourceVersion;
    }>();
    expectTypeOf<FirstParameter<PriceConfigurationUseCases["publishPrice"]>>().toMatchTypeOf<{
      authorization: AuthorizationContext;
      expectedVersion: ResourceVersion;
    }>();
    expectTypeOf<FirstParameter<FaqConfigurationUseCases["publishFaq"]>>().toMatchTypeOf<{
      authorization: AuthorizationContext;
      expectedVersion: ResourceVersion;
    }>();
    expectTypeOf<
      FirstParameter<BusinessPolicyConfigurationUseCases["publishPolicy"]>
    >().toMatchTypeOf<{ authorization: AuthorizationContext; expectedVersion: ResourceVersion }>();
    expectTypeOf<
      FirstParameter<PublishedBusinessKnowledgeReader["getPublishedBusinessKnowledge"]>
    >().toMatchTypeOf<{ authorization: AuthorizationContext }>();
  });

  it("keeps framework, SQL, and transport dependencies out of the port source", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL("../../packages/application/src/configuration/ports.ts", import.meta.url),
      ),
      "utf8",
    );

    for (const forbidden of ["fastify", "drizzle", 'from "pg"', "If-Match", "Idempotency-Key"]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).not.toContain("organizationId:");
    expect(source).not.toContain("role:");
    expect(source).not.toContain("permissions:");
  });
});
