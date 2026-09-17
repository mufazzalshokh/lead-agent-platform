# S13.A — Uzbekistan agent market

Research snapshot: 17-09-2026 (Asia/Tashkent). Research only; no accounts purchased,
customer messages scraped, provider calls made, or roadmap changes approved.

## Evidence convention

`VERIFIED TECHNICAL FACT` means documented technical behavior, not independently
tested vendor software. `VENDOR-REPORTED METRIC` includes attributed marketing
capability/price claims as well as numerical results. `PUBLIC BENCHMARK RESULT`
means a published evaluation, not our result. `INFERENCE` is our interpretation.
`UNKNOWN / NOT DISCLOSED` means the inspected evidence does not establish it,
not that the feature is absent. All sources below were retrieved on 2026-09-17;
the machine-readable register is [research-sources.json](../../tests/ai-evals/research-sources.json).

## Competitor matrix

Every advertised capability, subscription price, language and integration in
these matrices is **VENDOR-REPORTED METRIC**, not independent production proof.
Confidence measures evidence visibility, not product quality. “?” means
**UNKNOWN / NOT DISCLOSED**. No product was penetration-tested or exercised.

| Product; local connection; apparent status                              | Widget | Telegram bot / Business DMs                       | Instagram Direct / comments                                   | WhatsApp                                         | Public pricing / included use                                                               | Source; confidence                                                                           |
| ----------------------------------------------------------------------- | ------ | ------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| EzguSavdo; Uzbekistan seller platform; named vendor cases and sign-up   | Yes    | Both explicitly                                   | Direct / ?                                                    | Project assessment; Pro card conflicts with this | Free 50 dialogs; Starter $21/500, Pro $99/3,000, Business $249/5,000 monthly                | [Product](https://ezgusavdo.uz/en); high                                                     |
| nilu; local retail/services/education; sign-up and named testimonials   | Yes    | Bot token / ?                                     | Direct / Pro comments                                         | ?                                                | 690,000/1,000; 1,290,000/1,800; 2,290,000/4,000; 4,900,000/10,000 UZS monthly conversations | [Product](https://nilu.uz/en/); high                                                         |
| SimpleChat; Uzbekistan-facing SaaS; sign-up, demo UI                    | Yes    | BotFather / ?                                     | Direct / keyword comment-to-DM                                | ?                                                | Free 100 messages; $29/2,000; $79/10,000 monthly                                            | [Product](https://simplechat.uz/en); high                                                    |
| Gramir; Uzbekistan-facing sales inbox; sign-up, demo UI                 | ?      | Telegram advertised; mode ?                       | Instagram and comment management advertised; exact API flow ? | Coming soon                                      | Free 250 contacts; Start 120,000 UZS; AI Pro 360,000 UZS monthly; AI-message allowance ?    | [Product](https://gramir.uz/); medium: search-index body; page retrieval rendered only shell |
| Reveo; Uzbekistan-facing, clinic/salon/commerce examples; trial         | ?      | Both explicitly                                   | Both                                                          | Business API claimed live                        | No price retrievable; tariff link returns homepage                                          | [Product](https://reveo.uz/); medium                                                         |
| AI Kotib; Uzbekistan-facing Instagram/Telegram Business branding        | ?      | Branding says Telegram Business; implementation ? | Instagram branding; comments ?                                | ?                                                | ?                                                                                           | [Product](https://aikotib.uz/); low: indexed description only, fetched page empty            |
| Innosoft; Tashkent custom development, not comparable subscription SaaS | Yes    | Telegram / mode ?                                 | Instagram / comments ?                                        | Yes                                              | Starter 5–8 million UZS setup; Business/Enterprise 10–25 million; usage allowance ?         | [Service](https://innosoft.uz/en/services/ai-agent); high                                    |

| Product    | Knowledge / lead / qualification / booking                                                                      | CRM / staff / analytics                                                                            | Languages and script claims                                                    | Model, architecture, security                                                                      | Usage evidence                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| EzguSavdo  | Catalog/stock/prices; sales/order capture; bounded discounts; clinic qualification and booking protocol ?       | Billz/Bitrix24 ready; 1C/MoySklad custom; handoff                                                  | Uzbek Latin incl. typos, Russian; mixed-script/slang claim; English evidence ? | **Google Gemini**, exact model ?; separate price/discount checks; implementation/security audit ?  | Tostco claims +30% conversion and zero missed messages; vendor/store report, not independently checked |
| nilu       | Catalog search/branch stock; lead capture; tasks/funnel; clinical qualification/booking ?                       | Mini-CRM/CSV; amoCRM/Kommo/Sheets/Smartup/PBX; staff groups; analytics                             | Uzbek/Russian; Latin/Cyrillic/transliteration search; English ?                | **Gemini/GPT/Claude** families; routing/models ?; isolation/encrypted secrets claims               | 61.3% after-hours share, May–July 2026 platform sample; not conversion or confirmed bookings           |
| SimpleChat | Files/URLs indexed with citations; leads and status table; fallback on missing answers; qualification/booking ? | Inbox, CSV, operator takeover, analytics; named external CRM ?                                     | Uzbek/Russian/English; separate Cyrillic/slang evidence ?                      | Provider ?; chunk/index grounding; RLS, encrypted tokens, domain allowlist, 30-day deletion claims | Screenshot figures are demos, not verified customers                                                   |
| Gramir     | Uploaded products/prices/FAQ; name/phone leads to Telegram; formal qualification/booking ?                      | Unified inbox, operator escalation, analytics; external CRM ?                                      | Uzbek UI; supported response languages/scripts ?                               | Model/architecture/security ?                                                                      | Demo response timing is not measured production latency                                                |
| Reveo      | Prices/services/hours/FAQ; lead and appointment/queue claims; confirmation lifecycle ?                          | One panel, manual participation, analytics; 1C/Odoo/SAP/Smartup/Billz logos, connector readiness ? | Uzbek/Russian/English; Cyrillic/slang ?                                        | Provider/architecture ?; encrypted conversations claim                                             | 200+ businesses, <3s replies, 99.9% uptime: vendor claims; animated zero counters ignored              |
| AI Kotib   | AI sales positioning; detailed qualification/booking/knowledge behavior ?                                       | Inbox/CRM/handoff/analytics ?                                                                      | Uzbek branding; actual language/script support ?                               | Provider/architecture/privacy ?                                                                    | No independently retrievable customer metric                                                           |
| Innosoft   | RAG with query rewrite/source checks; qualification; appointment workflows offered, deployed booking proof ?    | CRM/ERP/1C/Bitrix24/payments; fallback and KPI tracking                                            | Uzbek/Russian/English and mixed-dialogue claim; script/dialect detail ?        | **GPT-4o and Claude**, other versions ?; vector RAG, guards; encryption/compliance claims          | 30+ delivered agents, 98% satisfaction: vendor claims                                                  |

## Interpretation and limits

Requested-field hygiene: unless explicitly shown above, a feature remains
**UNKNOWN / NOT DISCLOSED**, including clinical qualification logic, exact
booking state/evidence, customer counts, model versions and independent security
verification. All visible usage metrics are vendor-reported; **none independently
verified here**. Uzbekistan-facing language/pricing does not prove incorporation.
Innosoft identifies Tashkent; legal headquarters of the other products were not
established in this research.

| Product    | Target / inbox and analytics disclosure                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| EzguSavdo  | Seller/catalog commerce; formal clinic ICP ?; centralized inbox/analytics implementation ?           |
| nilu       | Retail/services/education; mini-CRM/funnel and task analytics; exact cross-channel inbox mechanics ? |
| SimpleChat | Business support/sales; unified inbox/operator takeover and lead analytics advertised                |
| Gramir     | Sales/support; unified Instagram/Telegram/Facebook inbox and lead/response analytics advertised      |
| Reveo      | Clinic/salon/commerce examples; one staff panel and analytics advertised                             |
| AI Kotib   | Sales positioning; industries/unified inbox/analytics ?                                              |
| Innosoft   | Custom commerce/health/service development; CRM/KPI projects offered, exact packaged inbox ?         |

The Telegram distinction is important: BotFather/token instructions do not prove
existing-account Business DMs. Conversely, a Telegram Business label does not
prove traffic or a working implementation. Lead capture recurs; formal immutable
qualification evidence and customer-confirmed appointment accounting are not
established by these marketing pages.

**INFERENCE:** Telegram Business is a meaningful offered product surface, not
merely bots: EzguSavdo and Reveo explicitly distinguish both. We cannot infer
traffic share or local prevalence from vendor pages. Instagram Direct and web
widgets recur across offers; lead capture and human takeover are common promises.
Formal, evidence-backed clinic qualification is less visible than sales funnels.
Booking is advertised by Reveo/Innosoft, but neither inspected material proves
our staff-acceptance-then-customer-confirmation invariant.

**INFERENCE:** CRM integration is a recurring sales proposition. Logos alone do
not prove supported connectors or customer demand volume. nilu's Cyrillic search
claim and EzguSavdo's mixed-input claims justify explicit script/typo tests; they
do not demonstrate native conversational quality. Disclosed provider families
range from Gemini alone to multiple families; multi-model routing is not proven.

**INFERENCE:** Price comparisons need denominators. nilu counts a 24-hour dialog
with at most 15 AI replies before another billing unit; overage is 800–2,000 UZS
per conversation. SimpleChat counts messages, Gramir contacts, and Innosoft setup
work. Do not present these as equal cost per lead. SimpleChat's channel entitlement
cards disagree with its all-channel comparison; verify commercially before relying
on that plan. None of the inspected marketing security claims certify isolation.

**RECOMMENDATION — NOT APPROVED YET:** Revisit WhatsApp post-V1 through actual
ICP interviews/traffic evidence. Reveo claims it live, Gramir says coming soon,
EzguSavdo qualifies availability, and other inspected offers are unclear. This
does not establish that WhatsApp is common enough to reorder V1.

**INFERENCE:** Differentiate on measurable clinic outcomes, explicit optional-phone
contactability, grounded prices, auditable qualification, safe medical handoff,
tenant isolation and confirmed-booking evidence—not a broad “24/7 sales” claim.
Our frozen Telegram Business/Instagram/widget direction remains unchanged.
