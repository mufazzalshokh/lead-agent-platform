import {
  CreateFaqDraftInputSchema,
  FaqSchema,
  ServiceRootSchema,
  UpdateFaqDraftInputSchema,
  createCollectionEnvelopeSchema,
  createSuccessEnvelopeSchema,
  isSchemaValue,
  type Faq,
  type LocalizedText,
} from "@lead-agent/contracts";
import {
  clinicLanguages,
  readConfigurationPage,
  readFormText,
  writeClinicConfiguration,
} from "./staff-clinic-configuration";
import { listClinicLocations } from "./staff-clinic-locations";
import type { StaffRequest } from "./staff-request";
import { makeIdempotencyKey } from "./staff-ui";

const FAQ_PATH = "/v1/staff/faqs";
const FaqCollection = createCollectionEnvelopeSchema(
  FaqSchema,
  "StaffConfigurationFaqCollectionResponse.v1",
);
const FaqResponse = createSuccessEnvelopeSchema(FaqSchema, "StaffConfigurationFaqResponse.v1");
const Services = createCollectionEnvelopeSchema(
  ServiceRootSchema,
  "StaffConfigurationServiceCollectionResponse.v1",
);

export const readFaqDraft = (form: FormData, current: Faq | null) => {
  const question: LocalizedText = {};
  const answer: LocalizedText = {};
  for (const [locale] of clinicLanguages) {
    const prompt = readFormText(form, `question_${locale}`);
    const response = readFormText(form, `answer_${locale}`);
    if ((prompt === "") !== (response === "")) return null;
    if (prompt !== "") {
      question[locale] = prompt;
      answer[locale] = response;
    }
  }
  const content = {
    question_i18n: question,
    answer_i18n: answer,
    service_id: readFormText(form, "service_id") || null,
    location_id: readFormText(form, "location_id") || null,
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
  const body = { ...content, faq_key: readFormText(form, "faq_key") };
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

const readAll = async <Item>(
  read: (cursor: string | null) => Promise<{ data: Item[]; meta: { next_cursor?: string | null } }>,
) => {
  const first = await read(null);
  const rows = [...first.data];
  const seen = new Set<string>();
  let cursor = first.meta.next_cursor ?? null;
  while (cursor !== null) {
    if (seen.has(cursor)) throw new Error("Invalid configuration cursor");
    seen.add(cursor);
    const page = await read(cursor);
    rows.push(...page.data);
    cursor = page.meta.next_cursor ?? null;
  }
  return rows;
};

export const listClinicFaqs = (request: StaffRequest, cursor: string | null = null) =>
  readConfigurationPage(request, FAQ_PATH, FaqCollection, cursor);

export const loadFaqScope = async (request: StaffRequest) => {
  const [locations, services] = await Promise.all([
    readAll((cursor) => listClinicLocations(request, cursor)),
    readAll((cursor) => readConfigurationPage(request, "/v1/staff/services", Services, cursor)),
  ]);
  return { locations, services };
};

export const writeClinicFaq = async (
  request: StaffRequest,
  command: PreparedFaqCommand,
  csrf: string | null,
) => {
  const { current } = command;
  const result = await writeClinicConfiguration(
    request,
    command,
    csrf,
    current === null ? null : { id: current.faq_id, version: current.version_no },
    (value) =>
      isSchemaValue(FaqResponse, value) &&
      value.data.status === command.status &&
      (current === null || value.data.faq_id === current.faq_id)
        ? value.data
        : null,
    {
      denied: "Your current session lacks access to this FAQ action.",
      invalid:
        "The clinic could not save this FAQ. Check the content, scope, and translations, including the clinic’s default language.",
      stale:
        "The FAQ changed or conflicts with another version. Refresh FAQs and review the current state.",
    },
  );
  return result.kind === "saved" ? ({ kind: "saved", faq: result.resource } as const) : result;
};
