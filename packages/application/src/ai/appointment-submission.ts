import type { MessageId, PublishedBusinessKnowledgeV2 } from "@lead-agent/contracts";
import { aiFallback } from "./policy.js";
import { normalizeGroundingQuery } from "./grounding-query.js";
import { createAIOrchestrator } from "./orchestrate.js";
import {
  evaluateSalesDecision,
  planSalesFlow,
  salesLocale,
  salesPreflight,
  type SalesPlan,
} from "./sales-flow.js";
import type { AIContextSnapshot, AIFallbackReason, AIOutcome, SalesResult } from "./ports.js";
import {
  appointmentTimeMentioned,
  parseAppointmentDate,
  resolveAppointmentTime,
  type ParsedAppointmentTime,
} from "./appointment-time.js";

export const APPOINTMENT_SUBMISSION_PROFILE = "s16_appointment_submission.v1";
export const APPOINTMENT_SUBMISSION_PROMPT = "s16-appointment-submission.v1";
export const appointmentSubmissionPreflight = (
  snapshot: AIContextSnapshot,
): AIFallbackReason | null => {
  const base = salesPreflight(snapshot);
  if (base !== null && base !== "staff_requested") return base;
  const query = normalizeGroundingQuery(snapshot.message);
  if (
    snapshot.booking?.staffActive ||
    (snapshot.sales !== undefined &&
      !["engaged", "qualified", "booking_requested"].includes(snapshot.sales.leadStatus))
  )
    return "stale_context";
  if (
    /\b(admin confirmed|staff said yes|mark me booked|confirm me|tasdiqlangan|already confirmed|appointment id is|ignore rules|otmeni|cancel|bekor|dont book|do not book|dont want|do not want|not coming|not going|ne [hx]ochu|yozilmay\w*|xohlamay\w*|bormayman|kelmayman)\b/u.test(
      query,
    )
  )
    return "policy_denied";
  return base;
};
export type AppointmentSubmission = Readonly<{
  service: PublishedBusinessKnowledgeV2["services"][number];
  location: PublishedBusinessKnowledgeV2["locations"][number];
  preference: ParsedAppointmentTime;
  dateMessageId: MessageId;
  timeMessageId: MessageId;
}>;
export type AppointmentSubmissionPlan = SalesPlan &
  Readonly<{
    qualification: SalesPlan;
    submission: AppointmentSubmission | null;
  }>;
const questions = {
  location: {
    uz: "Qaysi filial sizga qulay?",
    ru: "Какой филиал вам удобнее?",
    en: "Which location works for you?",
  },
  date: {
    uz: "Qaysi kunga rejalashtiryapsiz?",
    ru: "На какой день планируете?",
    en: "Which date works for you?",
  },
  time: {
    uz: "Qaysi vaqt sizga qulay?",
    ru: "Какое время вам удобно?",
    en: "What time works for you?",
  },
  ambiguous_time: {
    uz: "Vaqtni 24 soat formatida yozasizmi, masalan 17:00?",
    ru: "Напишите время в 24-часовом формате, например 17:00?",
    en: "Could you give the time in 24-hour format, for example 17:00?",
  },
};
const customerSubmissionIntent = (text: string): boolean => {
  const query = normalizeGroundingQuery(text);
  if (/\b(not|dont|do not|ne [hx]ochu|yoq|emas|xohlamay\w*)\b/u.test(query)) return false;
  // Desire for information is not desire to submit an appointment request.
  const question =
    /\b(how|what|price|cost|narx\w*|qancha|nech\w*|pul|skolko|stoit|ochiq\w*|ishlay\w*|hours|open|rabota\w*|know|information)\b/u.test(
      query,
    );
  const explicit =
    /\b(yozil\w*|yozdir\w*|boraman|kelaman|zapis\w*|book\w*|want|would like|id like|[hx]ochu|xohlay\w*|istay\w*)\b/u.test(
      query,
    );
  // An explicit submission clause may accompany a price question, but a bare
  // date or an informational mention of "appointment" cannot authorize one.
  if (question)
    return (
      /\b(yozil\w*|yozdir\w*|boraman|kelaman|zapis\w*|book\w*)\b/u.test(query) &&
      !/\b(know|information)\b/u.test(query)
    );
  return (
    explicit ||
    /\b(appointment|ertaga|indin|bugun|zavtra|poslezavtra|segodnya|tomorrow|today)\b/u.test(query)
  );
};
export const planAppointmentSubmission = (
  snapshot: AIContextSnapshot,
  outcome: AIOutcome,
): AppointmentSubmissionPlan => {
  const locale = salesLocale(snapshot.message, snapshot.locale);
  const allEntries = [
    ...snapshot.history.filter(
      (entry) => entry.role === "customer" && entry.sequence < snapshot.sourceSequence,
    ),
    {
      role: "customer" as const,
      sequence: snapshot.sourceSequence,
      text: snapshot.message,
      messageId: snapshot.sourceMessageId,
      receivedAt: snapshot.sourceReceivedAt,
    },
  ]
    .filter(
      (entry) =>
        entry.messageId !== undefined && entry.sequence > (snapshot.booking?.afterSequence ?? 0),
    )
    .sort((left, right) => left.sequence - right.sequence);
  // Contradictory/unsafe customer input invalidates earlier submission intent and preferences.
  // It never executes cancellation or changes an existing appointment's lifecycle.
  const interrupted = allEntries.findLast((entry) => {
    const reason = appointmentSubmissionPreflight({ ...snapshot, message: entry.text });
    return reason !== null && reason !== "staff_requested" && reason !== "stale_context";
  });
  const entries = allEntries.filter((entry) => entry.sequence > (interrupted?.sequence ?? 0));
  const intent = entries.findLast(
    (entry) =>
      appointmentSubmissionPreflight({ ...snapshot, message: entry.text }) === null &&
      customerSubmissionIntent(entry.text),
  );
  // A customer preference supplies next-step evidence, never the model's booking action.
  let trusted =
    interrupted === undefined
      ? snapshot
      : {
          ...snapshot,
          history: snapshot.history.filter((entry) => entry.sequence > interrupted.sequence),
        };
  if (
    snapshot.sales !== undefined &&
    (intent?.messageId !== undefined || interrupted !== undefined)
  ) {
    trusted = {
      ...trusted,
      sales: {
        ...snapshot.sales,
        stored: {
          ...snapshot.sales.stored,
          positiveNextStep: intent?.messageId !== undefined,
          nextStepMessageId: intent?.messageId ?? null,
        },
      },
    };
  }
  const base = planSalesFlow(trusted, outcome);
  const wrap = (
    plan: SalesPlan,
    submission: AppointmentSubmission | null = null,
  ): AppointmentSubmissionPlan => ({
    ...plan,
    qualification: plan.text === null || plan.handoffReason !== null ? plan : base,
    submission: plan.text === null ? null : submission,
  });
  const blocked = appointmentSubmissionPreflight(snapshot);
  if (blocked !== null && blocked !== "staff_requested")
    return wrap({
      ...base,
      result: { kind: "grounding_insufficient", reason: blocked, missing: [] },
      text: null,
      handoffReason: null,
    });
  if (
    base.text === null ||
    base.handoffReason !== null ||
    base.result.missing.length > 0 ||
    intent === undefined ||
    snapshot.booking === undefined
  )
    return wrap(base);
  const answer = base.sources.length === 0 ? "" : base.text.slice(0, base.text.lastIndexOf("\n"));
  const reply = (
    text: string,
    kind: SalesResult["kind"],
    missing: readonly string[] = [],
    reason: string | null = null,
  ): SalesPlan => {
    const combined = [answer, text].filter(Boolean).join("\n");
    return new TextEncoder().encode(combined).length <= 1_000
      ? { ...base, text: combined, result: { kind, reason, missing } }
      : {
          ...base,
          text: null,
          sources: [],
          handoffReason: null,
          result: { kind: "grounding_insufficient", reason: "grounding_insufficient", missing: [] },
        };
  };
  if (snapshot.booking.activeRequestId !== null)
    return wrap(
      reply(
        {
          uz: "So'rovingiz allaqachon yuborilgan. Yangi so'rov qoldirmadik.",
          ru: "Ваш запрос уже отправлен. Новый запрос не создавали.",
          en: "Your request has already been submitted. We haven't added another one.",
        }[locale],
        "appointment_existing",
      ),
    );
  const knowledge = snapshot.booking.knowledge,
    service = knowledge?.services.find((entry) => entry.service_id === base.evidence.serviceId);
  const locationIds = service?.location_offerings.map((entry) => entry.location_id) ?? [];
  const locationId = base.evidence.locationId ?? (locationIds.length === 1 ? locationIds[0] : null);
  const location = knowledge?.locations.find((entry) => entry.location_id === locationId);
  if (location === undefined && locationIds.length > 1)
    return wrap(reply(questions.location[locale], "appointment_incomplete", ["location"]));
  if (service === undefined || location === undefined || service.duration_guidance_minutes === null)
    return wrap({
      ...reply(
        {
          uz: "Xodimdan kerakli ma'lumotlarni aniqlashtirish uchun so'rov yuborildi.",
          ru: "Запрос передан сотруднику для уточнения необходимых данных.",
          en: "A request has been sent to a staff member to clarify the details.",
        }[locale],
        "handoff_requested",
        [],
        "missing_authoritative_information",
      ),
      handoffReason: "missing_authoritative_information",
    });
  let date: string | null = null,
    dateMessageId: MessageId | null = null,
    timeText: string | null = null,
    timeMessageId: MessageId | null = null;
  for (const entry of entries) {
    if (
      appointmentSubmissionPreflight({ ...snapshot, message: entry.text }) !== null ||
      entry.messageId === undefined
    )
      continue;
    const parsed = parseAppointmentDate(
      entry.text,
      entry.receivedAt ?? snapshot.booking.now,
      location.time_zone,
    );
    if (parsed !== null) {
      date = parsed;
      dateMessageId = entry.messageId;
    } else if (
      /\b(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})\b/u.test(entry.text) ||
      /\b(ertaga|bugun|indin|zavtra|poslezavtra|tomorrow|today|segodnya)\b/u.test(
        normalizeGroundingQuery(entry.text),
      )
    ) {
      date = null;
      dateMessageId = null;
    }
    if (appointmentTimeMentioned(entry.text)) {
      timeText = entry.text;
      timeMessageId = entry.messageId;
    }
  }
  if (date === null || dateMessageId === null)
    return wrap(reply(questions.date[locale], "appointment_incomplete", ["date"]));
  if (timeText === null || timeMessageId === null)
    return wrap(reply(questions.time[locale], "appointment_incomplete", ["time"]));
  const parsed = resolveAppointmentTime(
    timeText,
    date,
    location,
    service.duration_guidance_minutes,
    snapshot.booking.now,
  );
  if (parsed.value === null) {
    const text =
      parsed.reason === "ambiguous_time"
        ? questions.ambiguous_time[locale]
        : {
            uz: "Bu sana yoki vaqt ish vaqtiga mos kelmaydi yoki o'tib ketgan. Boshqa qaysi kunga rejalashtiryapsiz?",
            ru: "Эта дата или время не подходят по рабочим часам либо уже прошли. Какой другой день вам удобен?",
            en: "That date or time is outside opening hours or has passed. Which other date works for you?",
          }[locale];
    return wrap(
      reply(
        text,
        "appointment_incomplete",
        [parsed.reason === "ambiguous_time" ? "time" : "date"],
        parsed.reason,
      ),
    );
  }
  const preference = parsed.value;
  if (
    !service.location_offerings.some(
      (offering) =>
        offering.location_id === location.location_id &&
        Date.parse(offering.effective_from) <= Date.parse(preference.startAt) &&
        (offering.effective_to === null ||
          Date.parse(offering.effective_to) >= Date.parse(preference.endAt)),
    )
  )
    return wrap(
      reply(questions.date[locale], "appointment_incomplete", ["date"], "offering_unavailable"),
    );
  const displayDate = preference.localDate.split("-").reverse().join("-"),
    time = preference.localStart.slice(11, 16);
  return wrap(
    reply(
      {
        uz: `${displayDate} soat ${time} uchun so'rov qoldirildi. Xodim ko'rib chiqqach shu yerda xabar beramiz.`,
        ru: `Запрос на ${displayDate} в ${time} отправлен. После рассмотрения сотрудником сообщим здесь.`,
        en: `Your request for ${displayDate} at ${time} has been submitted. We'll update you here after staff review.`,
      }[locale],
      "appointment_requested",
    ),
    { service, location, preference, dateMessageId, timeMessageId },
  );
};
export const createAppointmentSubmissionOrchestrator = (
  options: Parameters<typeof createAIOrchestrator>[0],
) => {
  const orchestrator = createAIOrchestrator({
    ...options,
    preflight: appointmentSubmissionPreflight,
    evaluateDecision: (decision, snapshot) => {
      const blocked = appointmentSubmissionPreflight(snapshot);
      return blocked === null ? evaluateSalesDecision(decision, snapshot) : aiFallback(blocked);
    },
  });
  return Object.freeze({
    run: async (...args: Parameters<typeof orchestrator.run>): Promise<SalesResult> => {
      const outcome = await orchestrator.run(...args);
      return (
        outcome.salesResult ?? {
          kind: "grounding_insufficient",
          reason: outcome.kind === "fallback_required" ? outcome.reason : "policy_denied",
          missing: [],
        }
      );
    },
  });
};
