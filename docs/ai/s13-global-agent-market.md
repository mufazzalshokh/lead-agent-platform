# S13.A — Global production agents

Retrieved 2026-09-17; display date 17-09-2026. These are first-party engineering,
product and customer materials, not independent audits. Labels have the meaning
defined in [the local report](s13-uzbekistan-market.md). All numerical commercial
results are **VENDOR-REPORTED METRIC** unless explicitly identified otherwise.

## Systems inspected

| System                | Disclosed architecture and production evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Capability boundary / uncertainty                                                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fin / Intercom        | **VERIFIED TECHNICAL FACT:** documented query refinement, workflow checks, RAG, output validation and human fallback ([engine](https://www.intercom.com/help/en/articles/9929230-the-fin-ai-engine)). Retrieval, reranking, summary and escalation models are disclosed ([layers](https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained)). **VENDOR-REPORTED METRIC:** Anthropic case: >560k monthly resolutions, 79% involved-conversation resolution, 63% total automation ([case](https://fin.ai/customers/anthropic-transformation)). | Service, sales qualification/meeting booking and ecommerce roles; multi-channel. **UNKNOWN / NOT DISCLOSED:** exact underlying weights/routing contracts, independent hallucination rate. Marketing “always accurate” is not a guarantee.                                 |
| Decagon               | **VERIFIED TECHNICAL FACT:** engineers disclose frontier models plus Decagon Labs specialized CX models for performance/latency, including customer-VPC inference ([engineering](https://decagon.ai/blog/what-an-air-gapped-ai-deployment-actually-requires)). **VENDOR-REPORTED METRIC:** Chime case: ~70% chat/voice resolution, >1M voice calls/month, 60% support-cost decrease; AOP iterations with technical core control ([case](https://decagon.ai/case-studies/chime)).                                                                             | Service/actions, shared chat/voice context and insights. **UNKNOWN / NOT DISCLOSED:** exact trained models, full red-team protocol, lead/booking behavior in these sources. The case references Chime's filing; it was not independently re-audited here.                 |
| Sierra                | **VERIFIED TECHNICAL FACT:** disclosed task-specific network of 15+ frontier/open/proprietary models, fine-tuning where task constraints fail, provider-health failover ([architecture](https://sierra.ai/uk/blog/constellation-of-models)). **VENDOR-REPORTED METRIC:** named AOL deployment with troubleshooting/account work and live escalation ([case](https://sierra.ai/customers/aol)).                                                                                                                                                               | CX, policies/actions/tone; production evidence is named, not our measurement. **UNKNOWN / NOT DISCLOSED:** exact models, reproducible per-language results, detailed booking/lead rules and independent scale.                                                            |
| Parloa                | **VERIFIED TECHNICAL FACT:** disclosed deterministic restrictions evaluated before LLM routing, task-local instructions and shared skills ([subtasks](https://www.parloa.com/blog/subtask-agents-for-enterprise-ai-orchestration/)); attack taxonomy, binary invariant checks plus judges/manual testing ([red team](https://www.parloa.com/labs/insights/how-parloa-stress-tests-production-deployments/)). **VENDOR-REPORTED METRIC:** named airport/medical/retail deployments; OBI 1,500 calls/day ([customers](https://www.parloa.com/customers/)).     | Voice-first service, booking/payment example; foundation-model orchestration. Claims 24% average faster resolution in one unnamed live test. **UNKNOWN / NOT DISCLOSED:** exact model/config in those customers; no evidence here of mandatory custom training.           |
| Salesforce Agentforce | **VERIFIED TECHNICAL FACT:** engineering describes graph/event-driven workflows, state, planning and enterprise metadata grounding ([Atlas](https://engineering.salesforce.com/inside-the-brain-of-agentforce-revealing-the-atlas-reasoning-engine/)). **VENDOR-REPORTED METRIC:** named Wiley deployment reports 213% ROI ([case](https://www.salesforce.com/customer-stories/wiley/)).                                                                                                                                                                     | Service/sales/CRM actions, flow logic and escalation; trust/context boundaries matter. **UNKNOWN / NOT DISCLOSED:** universal default model, externally audited action accuracy, generic clinic booking semantics. New Koa research is not proof of a production rollout. |
| Zendesk AI Agents     | **VERIFIED TECHNICAL FACT:** product documents knowledge/context grounding, multi-step connected workflows, QA/outcome feedback ([product](https://www.zendesk.com/service/ai/ai-agents/)); preview tests and conversation/action logs ([testing](https://support.zendesk.com/hc/en-us/articles/8357751802138-Best-practices-for-testing-AI-agents)). **VENDOR-REPORTED METRIC:** Hello Sugar: 66% automation/$14k monthly savings; TeamSystem: 80% automation.                                                                                              | Messaging/email/voice; service workflows and escalation. **UNKNOWN / NOT DISCLOSED:** exact current models, specialization training recipe, independent proof that generated answers cannot hallucinate. Broad product claims are not controlled evaluations.             |
| HubSpot Breeze        | **VERIFIED TECHNICAL FACT:** documented approved-content citations, handoff, channel coverage and resolution/sentiment insights ([product](https://www.hubspot.com/products/artificial-intelligence/ai-customer-service-agent)). **VENDOR-REPORTED METRIC:** RevPartners describes a launched GPT-4-powered website agent and gap/routing iteration ([case](https://www.hubspot.com/startups/ai/launching-breeze-customer-agent)).                                                                                                                           | Marketing/sales/service platform. Historical GPT-4 case is not the current universal provider/config. **UNKNOWN / NOT DISCLOSED:** current exact model, fine-tuning, independent latency/booking evidence.                                                                |
| Ada                   | **VERIFIED TECHNICAL FACT:** researchers describe replacing sequential specialist calls with fast/slow reasoning, per-behavior rollout gates, at least three repeats, end-to-end and component tests, online legitimacy classifier ([evaluation](https://www.ada.cx/labs/research/unified-reasoning-engine-evaluation-science/)).                                                                                                                                                                                                                            | Production architecture migration documented; support/action/knowledge tests. **UNKNOWN / NOT DISCLOSED:** exact model names, native Uzbek performance, independent case-scale metrics in this source. Fewer calls, not “more agents,” can improve an architecture.       |

## Per-system operational disclosure limits

This completes the requested fields without inferring hidden architecture.
Every `?` is **UNKNOWN / NOT DISCLOSED** in the linked sources above; an omitted
internal implementation is not evidence that a capability is absent. Channels
and features remain first-party documented claims, not our exercised integrations.

| System     | Lead / booking / workflow                                                                       | Evals / speed-cost / observability / failure                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fin        | Sales qualification/meeting role disclosed; exact booking-confirmation rules ?; workflow checks | Refinement/reranking/output checks; Apex Flash and task models target latency; conversation outcomes; human fallback. Exact repeatable native-Uzbek eval and provider incident policy ?                 |
| Decagon    | AOP service workflows disclosed; lead/booking rules ?                                           | Customer iterations and analytics, CX-specialized/VPC models; resolution/cost metrics vendor-reported; exact red-team taxonomy/automatic provider failover ?                                            |
| Sierra     | CX/action policies; exact lead/booking flow ?                                                   | Task-model constraints/validation and provider-health failover disclosed; precise retrieval/reranking and public native language eval ?; cost benefit not quantified here                               |
| Parloa     | Voice workflow/booking/payment examples; exact lead rules ?                                     | Red-team taxonomy, manual/judge/binary tests; task-scoped prompts reduce latency/context complexity; execution restrictions and test traces; exact model failover/cost ?                                |
| Agentforce | CRM/sales/service workflows; exact clinic confirmation ?                                        | Atlas graph/state and workflow grounding; Koa synthetic workflow research; enterprise actions/traces; reproducible native-language red-team/call latency/cost ?                                         |
| Zendesk    | Service multi-step connected actions; lead/booking ?                                            | Preview/action logs, QA and outcome learning; messaging/email/voice documented; exact model routing, custom training, latency and failure orchestration ?                                               |
| Breeze     | Sales/service platform; exact lead/booking semantics ?                                          | Citations, approved-content gaps and human routing, resolution/sentiment analytics; chat/email/WhatsApp/Facebook/voice product surfaces; exact current model/reranker/custom training/latency ?         |
| Ada        | Knowledge/playbook/action behaviors; lead/booking specifics ?                                   | End-to-end plus component/repeated-category gates; fast/slow reasoners and online legitimacy classifier; fewer serial calls improve latency potential; exact quotas/provider-health fallback and cost ? |

No universal “production scale” number is substituted for a customer's reported
workload. Fin/Decagon named workloads and Parloa's voice example are vendor
evidence; Sierra/Ada operational designs do not prove a public customer-count
threshold. Customer outcomes and workflow accuracy are different denominators.

## Specialization evidence

**VERIFIED TECHNICAL FACT:** Fin now discloses Apex 1.0, post-trained on support
data, and Apex Flash for latency-sensitive work. Its page reports 2.8% higher
resolution, 0.6s faster first token and 65% lower hallucinations than Sonnet 4.6:
these are **VENDOR-REPORTED METRIC**, not independent benchmarks. Motivation is
grounding, reliable policy adherence, escalation and latency—not unrestricted
agency ([model suite](https://fin.ai/cx-models)).

**PUBLIC BENCHMARK RESULT:** Salesforce Koa's 14-09-2026 preprint describes
Nemotron-based reinforcement post-training from public/synthetic workflow tasks,
with no customer data, improving multi-turn tool/CRM performance over its base.
This is research, not a verified deployed Agentforce default
([paper](https://arxiv.org/abs/2609.15066)).

**INFERENCE:** Fin/Decagon/Sierra demonstrate specialization after accumulating
task-specific failure/latency evidence and operational scale. There is no
published universal customer-count threshold. Parloa addresses growing prompt
complexity with deterministic orchestration; Salesforce uses CRM/workflow
structure. These solve quality, domain precision and workflow reliability;
cost/latency benefits must be measured, not inferred from model size alone.

## Answers and V1 implications

**INFERENCE:** A mature agent need not be one monolithic LLM, nor must every
startup copy a model network. Query rewriting, retrieval/reranking, specialist
classification, grounded checks, workflows and routing are publicly disclosed
across the inspected systems. Ada is a useful counterexample to assuming that
more sequential LLM calls always help.

**INFERENCE — implement within already accepted scope:** preserve provider-neutral
boundaries, deterministic action authority, current tenant context, source
versions, explicit fallback, finite deadlines, and per-behavior evals. Score raw
model violations separately from what local policy blocks; suppressed unsafe
output is a protected product outcome but still a model-quality failure.

**RECOMMENDATION — NOT APPROVED YET:** Consider learned classifiers, rerankers,
task routing, provider failover and vertical post-training only when measured
failures justify their maintenance/privacy/latency costs. Do not add vector
infrastructure, generic tools, proprietary-model hosting or multi-provider
production routing in S13.A. Our structured records remain authoritative.

**INFERENCE — FINE_TUNING_NOT_NEEDED for this stage:** first test current
foundation models against our own scripts, safety and schema. Later,
`FINE_TUNING_WORTH_INVESTIGATING` requires consented/non-PII labeled data,
repeatable residual errors that prompting/context cannot solve, a held-out native
evaluation, operational ownership and positive economics. Compare monthly
inference savings with annotation + training + re-evaluation + hosting + incident
costs. No dataset uploads or training jobs were performed.
