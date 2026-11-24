import { type createCollectionEnvelopeSchema, isSchemaValue } from "@lead-agent/contracts";
import type { StaffRequest } from "./staff-request";

export const clinicLanguages = [
  ["en", "English"],
  ["ru", "Russian"],
  ["uz", "Uzbek"],
] as const;

export const readFormText = (form: FormData, field: string) => {
  const value = form.get(field);
  return typeof value === "string" ? value.trim() : "";
};

export const readConfigurationPage = async <
  Schema extends Parameters<typeof createCollectionEnvelopeSchema>[0],
>(
  request: StaffRequest,
  path: string,
  schema: ReturnType<typeof createCollectionEnvelopeSchema<Schema>>,
  cursor: string | null,
) => {
  const response = await request(
    cursor === null
      ? path
      : `${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`,
  );
  if (!response.ok) throw new Error("Configuration could not be loaded");
  const value: unknown = await response.json();
  if (!isSchemaValue(schema, value)) throw new Error("Invalid configuration response");
  return value;
};

export const readConfigurationCatalog = async <Item>(
  read: (cursor: string | null) => Promise<{ data: Item[]; meta: { next_cursor?: string | null } }>,
) => {
  const rows: Item[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await read(cursor);
    rows.push(...page.data);
    cursor = page.meta.next_cursor ?? null;
    if (cursor !== null) {
      if (seen.has(cursor)) throw new Error("Invalid configuration cursor");
      seen.add(cursor);
    }
  } while (cursor !== null);
  return rows;
};

export const writeClinicConfiguration = async <Resource>(
  request: StaffRequest,
  command: Readonly<{
    body: string;
    idempotencyKey: string;
    method: "PATCH" | "POST" | "PUT";
    path: string;
  }>,
  csrf: string | null,
  condition: Readonly<{ id: string; version: number }> | null,
  readResource: (value: unknown) => Resource | null,
  messages: Readonly<{ denied: string; invalid: string; stale: string }>,
) => {
  if (csrf === null)
    return { kind: "rejected", message: "Refresh your session before saving." } as const;
  const uncertain = {
    kind: "uncertain",
    message: "The result is unknown. Retry the same command.",
  } as const;
  try {
    const response = await request(command.path, {
      method: command.method,
      body: command.body,
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrf,
        "idempotency-key": command.idempotencyKey,
        ...(condition === null ? {} : { "if-match": `"${condition.id}:${condition.version}"` }),
      },
    });
    if (response.status >= 500 || response.status === 408) return uncertain;
    if (response.status === 429) {
      return { kind: "uncertain", message: "Too many requests. Wait a moment and retry." } as const;
    }
    if (response.status === 409) return { kind: "stale", message: messages.stale } as const;
    if (!response.ok) {
      const message =
        response.status === 401 || response.status === 403 ? messages.denied : messages.invalid;
      return { kind: "rejected", message } as const;
    }
    const resource = readResource(await response.json());
    return resource === null ? uncertain : ({ kind: "saved", resource } as const);
  } catch {
    return uncertain;
  }
};
