import {
  CreateFaqDraftInputSchema,
  FaqSchema,
  LocationRootSchema,
  ServiceRootSchema,
  UpdateFaqDraftInputSchema,
  createCollectionEnvelopeSchema,
  createSuccessEnvelopeSchema,
  isSchemaValue,
  type Faq,
  type LocalizedText,
} from "@lead-agent/contracts";
import type { StaffRequest } from "./staff-request";
import { makeIdempotencyKey } from "./staff-ui";

const FAQ_PATH = "/v1/staff/faqs";
const FaqCollection = createCollectionEnvelopeSchema(
  FaqSchema,
  "StaffConfigurationFaqCollectionResponse.v1",
);
const FaqResponse = createSuccessEnvelopeSchema(FaqSchema, "StaffConfigurationFaqResponse.v1");
const Locations = createCollectionEnvelopeSchema(
  LocationRootSchema,
  "StaffConfigurationLocationCollectionResponse.v1",
);
const Services = createCollectionEnvelopeSchema(
  ServiceRootSchema,
  "StaffConfigurationServiceCollectionResponse.v1",
);

export const faqLanguages = [
  ["en", "English"],
  ["ru", "Russian"],
  ["uz", "Uzbek"],
] as const;

const text = (form: FormData, field: string) => {
  const value = form.get(field);
  return typeof value === "string" ? value.trim() : "";
};

export const readFaqDraft = (form: FormData, current: Faq | null) => {
  const question: LocalizedText = {};
  const answer: LocalizedText = {};
  for (const [locale] of faqLanguages) {
    const prompt = text(form, `question_${locale}`);
    const response = text(form, `answer_${locale}`);
    if ((prompt === "") !== (response === "")) return null;
    if (prompt !== "") {
      question[locale] = prompt;
      answer[locale] = response;
    }
  }
  const content = {
    question_i18n: question,
    answer_i18n: answer,
    service_id: text(form, "service_id") || null,
    location_id: text(form, "location_id") || null,
  };
  if (current !== null) {
    return current.status === "draft" && isSchemaValue(UpdateFaqDraftInputSchema, content)
      ? ({
          method: "PATCH",
          path: `${FAQ_PATH}/${current.faq_id}`,
          body: content,
          current,
          status: "draft",
        } as const)
      : null;
  }
  const body = { ...content, faq_key: text(form, "faq_key") };
  return isSchemaValue(CreateFaqDraftInputSchema, body)
    ? ({ method: "POST", path: FAQ_PATH, body, current: null, status: "draft" } as const)
    : null;
};

export const faqPublication = (current: Faq, action: "publish" | "retire") => {
  if (current.status !== (action === "publish" ? "draft" : "published")) return null;
  return {
    method: "POST",
    path: `${FAQ_PATH}/${current.faq_id}/${action}`,
    body: {},
    current,
    status: action === "publish" ? "published" : "retired",
  } as const;
};

type FaqCommand = NonNullable<ReturnType<typeof readFaqDraft> | ReturnType<typeof faqPublication>>;

export const prepareFaqCommand = (command: FaqCommand, randomId: string) => ({
  ...command,
  body: JSON.stringify(command.body),
  idempotencyKey: makeIdempotencyKey("faq", randomId),
});

export type PreparedFaqCommand = ReturnType<typeof prepareFaqCommand>;

const readPage = async <Schema extends Parameters<typeof createCollectionEnvelopeSchema>[0]>(
  request: StaffRequest,
  base: string,
  schema: ReturnType<typeof createCollectionEnvelopeSchema<Schema>>,
  cursor: string | null,
) => {
  const response = await request(
    cursor === null ? base : `${base}?cursor=${encodeURIComponent(cursor)}`,
  );
  if (!response.ok) throw new Error("Configuration could not be loaded");
  const value: unknown = await response.json();
  if (!isSchemaValue(schema, value)) throw new Error("Invalid configuration response");
  return value;
};

const readAll = async <Schema extends Parameters<typeof createCollectionEnvelopeSchema>[0]>(
  request: StaffRequest,
  path: string,
  schema: ReturnType<typeof createCollectionEnvelopeSchema<Schema>>,
) => {
  const first = await readPage(request, path, schema, null);
  const rows = [...first.data];
  const seen = new Set<string>();
  let cursor = first.meta.next_cursor ?? null;
  while (cursor !== null) {
    if (seen.has(cursor)) throw new Error("Invalid configuration cursor");
    seen.add(cursor);
    const page = await readPage(request, path, schema, cursor);
    rows.push(...page.data);
    cursor = page.meta.next_cursor ?? null;
  }
  return rows;
};

export const listClinicFaqs = (request: StaffRequest, cursor: string | null = null) =>
  readPage(request, FAQ_PATH, FaqCollection, cursor);

export const loadFaqScope = async (request: StaffRequest) => {
  const [locations, services] = await Promise.all([
    readAll(request, "/v1/staff/locations", Locations),
    readAll(request, "/v1/staff/services", Services),
  ]);
  return { locations, services };
};

export const writeClinicFaq = async (
  request: StaffRequest,
  command: PreparedFaqCommand,
  csrf: string | null,
) => {
  if (csrf === null)
    return { kind: "rejected", message: "Refresh your session before saving." } as const;
  const { current, method, path, body, idempotencyKey } = command;
  const conditions =
    current === null ? {} : { "if-match": `"${current.faq_id}:${current.version_no}"` };
  const uncertain = {
    kind: "uncertain",
    message: "The result is unknown. Retry the same command.",
  } as const;
  try {
    const response = await request(path, {
      method,
      body,
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrf,
        "idempotency-key": idempotencyKey,
        ...conditions,
      },
    });
    if (response.status >= 500) return uncertain;
    if (response.status === 429) {
      return { kind: "uncertain", message: "Too many requests. Wait a moment and retry." } as const;
    }
    if (!response.ok) {
      if (response.status === 409) {
        return {
          kind: "stale",
          message:
            "The FAQ changed or conflicts with another version. Refresh FAQs and review the current state.",
        } as const;
      }
      const message =
        response.status === 401 || response.status === 403
          ? "Your current session lacks access to this FAQ action."
          : "The clinic could not save this FAQ. Check the content, scope, and translations, including the clinic’s default language.";
      return { kind: "rejected", message } as const;
    }
    const value: unknown = await response.json();
    if (
      !isSchemaValue(FaqResponse, value) ||
      value.data.status !== command.status ||
      (current !== null && value.data.faq_id !== current.faq_id)
    )
      return uncertain;
    return { kind: "saved", faq: value.data } as const;
  } catch {
    return uncertain;
  }
};
