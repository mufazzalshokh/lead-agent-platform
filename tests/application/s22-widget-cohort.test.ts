import { describe, expect, it, vi } from "vitest";

import {
  S22WidgetCohortError,
  createS22WidgetCohortUseCases,
  type S22WidgetCohortStore,
} from "../../packages/application/src/index.js";
import { IDS } from "../telegram/fixtures.js";
import {
  COHORT_STATUS,
  S22_ORGANIZATION,
  SELECTION_BODY,
  SELECTION_RECEIPT,
  s22Authorization,
} from "./s22-widget-cohort-fixtures.js";

const trace = {
  requestId: "request:s22-selection-test",
  correlationId: "01a11c48-dbc2-76de-a873-f41664da5ccc",
};
const fixture = () => {
  const store = {
    get: vi.fn(() => Promise.resolve(COHORT_STATUS)),
    select: vi.fn(() => Promise.resolve(SELECTION_RECEIPT)),
  } satisfies S22WidgetCohortStore;
  return {
    store,
    useCases: createS22WidgetCohortUseCases({ organizationId: S22_ORGANIZATION, store }),
  };
};

describe("S22 owner-only Widget cohort selection application boundary", () => {
  it("accepts only a verified approved owner and delegates the exact CAS selection and trace", async () => {
    const { store, useCases } = fixture();
    const actor = await s22Authorization();
    await expect(useCases.get({ actor })).resolves.toEqual(COHORT_STATUS);
    await expect(useCases.select({ actor, body: SELECTION_BODY, ...trace })).resolves.toEqual(
      SELECTION_RECEIPT,
    );
    expect(store.get).toHaveBeenCalledExactlyOnceWith({ actor });
    expect(store.select).toHaveBeenCalledExactlyOnceWith({ actor, body: SELECTION_BODY, ...trace });
  });

  it.each(["admin", "staff"] as const)("denies %s before any storage access", async (role) => {
    const { store, useCases } = fixture();
    const actor = await s22Authorization(role);
    await expect(useCases.get({ actor })).rejects.toEqual(
      new S22WidgetCohortError("permission_denied"),
    );
    await expect(useCases.select({ actor, body: SELECTION_BODY, ...trace })).rejects.toEqual(
      new S22WidgetCohortError("permission_denied"),
    );
    expect(store.get).not.toHaveBeenCalled();
    expect(store.select).not.toHaveBeenCalled();
  });

  it("denies another tenant's genuine owner and an unbranded clone", async () => {
    const { store, useCases } = fixture();
    const otherOwner = await s22Authorization("owner", IDS.otherOrganization);
    const owner = await s22Authorization();
    // JSON cloning removes the unforgeable authorization brand, not just visible role fields.
    const unbranded = Object.assign({}, owner);
    for (const key of Object.getOwnPropertySymbols(unbranded))
      Reflect.deleteProperty(unbranded, key);
    for (const actor of [otherOwner, unbranded]) {
      await expect(useCases.get({ actor })).rejects.toEqual(
        new S22WidgetCohortError("permission_denied"),
      );
      await expect(useCases.select({ actor, body: SELECTION_BODY, ...trace })).rejects.toEqual(
        new S22WidgetCohortError("permission_denied"),
      );
    }
    expect(store.get).not.toHaveBeenCalled();
    expect(store.select).not.toHaveBeenCalled();
  });

  it.each([
    { ...SELECTION_BODY, organization_id: S22_ORGANIZATION },
    { ...SELECTION_BODY, expected_session_version: 3 },
    { ...SELECTION_BODY, expected_selection_version: -1 },
    { ...SELECTION_BODY, expected_selection_version: 0.5 },
    { ...SELECTION_BODY, session_id: "not-a-resource" },
    { ...SELECTION_BODY, reserve_micros: "0" },
    { ...SELECTION_BODY, allow_paid_calls: true },
    null,
  ])("rejects malformed or authority-smuggling body %#", async (body) => {
    const { store, useCases } = fixture();
    await expect(
      useCases.select({ actor: await s22Authorization(), body, ...trace }),
    ).rejects.toEqual(new S22WidgetCohortError("validation_failed"));
    expect(store.select).not.toHaveBeenCalled();
  });

  it.each([
    { requestId: "bad", correlationId: trace.correlationId },
    { requestId: trace.requestId, correlationId: "bad" },
  ])("requires bounded audit trace %#", async (invalidTrace) => {
    const { store, useCases } = fixture();
    await expect(
      useCases.select({ actor: await s22Authorization(), body: SELECTION_BODY, ...invalidTrace }),
    ).rejects.toEqual(new S22WidgetCohortError("validation_failed"));
    expect(store.select).not.toHaveBeenCalled();
  });

  it.each(["selection_conflict", "cohort_blocked", "unavailable"] as const)(
    "preserves the store's fail-closed %s disposition",
    async (code) => {
      const { store, useCases } = fixture();
      vi.mocked(store.select).mockRejectedValueOnce(new S22WidgetCohortError(code));
      await expect(
        useCases.select({ actor: await s22Authorization(), body: SELECTION_BODY, ...trace }),
      ).rejects.toEqual(new S22WidgetCohortError(code));
    },
  );

  it("rejects secret-bearing or malformed store projections", async () => {
    const { store, useCases } = fixture();
    const actor = await s22Authorization();
    vi.mocked(store.get).mockResolvedValueOnce(
      Object.assign({}, COHORT_STATUS, { token: "private" }),
    );
    await expect(useCases.get({ actor })).rejects.toEqual(new S22WidgetCohortError("unavailable"));
    vi.mocked(store.select).mockResolvedValueOnce(
      Object.assign({}, SELECTION_RECEIPT, { selection_version: -1 }),
    );
    await expect(useCases.select({ actor, body: SELECTION_BODY, ...trace })).rejects.toEqual(
      new S22WidgetCohortError("unavailable"),
    );
  });

  it("rejects invalid trusted configuration at construction", () => {
    expect(() =>
      createS22WidgetCohortUseCases({ organizationId: "bad", store: fixture().store }),
    ).toThrow("Invalid trusted S22 organization");
  });

  it("captures trusted tenant scope so later configuration mutation cannot redirect it", async () => {
    const store = fixture().store;
    const dependencies = { organizationId: String(S22_ORGANIZATION), store };
    const useCases = createS22WidgetCohortUseCases(dependencies);
    dependencies.organizationId = IDS.otherOrganization;
    await expect(useCases.get({ actor: await s22Authorization() })).resolves.toEqual(COHORT_STATUS);
    await expect(
      useCases.get({ actor: await s22Authorization("owner", IDS.otherOrganization) }),
    ).rejects.toEqual(new S22WidgetCohortError("permission_denied"));
    expect(store.get).toHaveBeenCalledOnce();
  });

  it.each([
    { ...SELECTION_RECEIPT, selection_version: 0 },
    { ...SELECTION_RECEIPT, selection_version: 2 },
    { ...SELECTION_RECEIPT, selected_session_id: IDS.control },
  ])("rejects a store receipt that does not match the exact requested CAS %#", async (receipt) => {
    const { store, useCases } = fixture();
    vi.mocked(store.select).mockResolvedValueOnce(receipt);
    await expect(
      useCases.select({ actor: await s22Authorization(), body: SELECTION_BODY, ...trace }),
    ).rejects.toEqual(new S22WidgetCohortError("unavailable"));
  });
});
