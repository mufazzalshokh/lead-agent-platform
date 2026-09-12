import type {
  BusinessPolicy,
  BusinessPolicyListFilter,
  CancelLocationClosureInput,
  ChangeServiceLocationInput,
  ConfigurationIdempotencyKey,
  CreateBusinessPolicyDraftInput,
  CreateFaqDraftInput,
  CreateLocationClosureInput,
  CreateLocationInput,
  CreateServiceInput,
  CreateServicePriceDraftInput,
  DeactivateLocationInput,
  DeactivateServiceInput,
  DomainEvent,
  Faq,
  FaqListFilter,
  LocationClosureRecord,
  LocationId,
  LocationListFilter,
  LocationRoot,
  OpaqueCursor,
  PaginationRequest,
  PublishBusinessPolicyInput,
  PublishedBusinessKnowledge,
  PublishedBusinessKnowledgeRequest,
  PublishFaqInput,
  PublishLocationInput,
  PublishServiceInput,
  PublishServicePriceInput,
  ResourceId,
  ResourceVersion,
  RetireBusinessPolicyInput,
  RetireFaqInput,
  RetireServicePriceInput,
  ServiceId,
  ServiceListFilter,
  ServiceLocationRecord,
  ServicePriceRecord,
  ServicePriceListFilter,
  ServiceRoot,
  SupersedeLocationClosureInput,
  UpdateBusinessPolicyDraftInput,
  UpdateFaqDraftInput,
  UpdateServicePriceDraftInput,
} from "@lead-agent/contracts";
import type { AuthorizationContext, TenantPermission } from "@lead-agent/security";

export type ConfigurationPermission = Extract<
  TenantPermission,
  "configuration.read" | "configuration.write" | "configuration.publish"
>;

export const CONFIGURATION_PERMISSIONS = [
  "configuration.read",
  "configuration.write",
  "configuration.publish",
] as const satisfies readonly ConfigurationPermission[];

export type ConfigurationFailureCode =
  | "business_rule_failed"
  | "idempotency_conflict"
  | "permission_denied"
  | "rate_limited"
  | "resource_not_found"
  | "validation_failed"
  | "version_conflict";

export type ConfigurationFailure = Readonly<{
  code: ConfigurationFailureCode;
}>;

export type ConfigurationResult<Value> =
  Readonly<{ ok: true; value: Value }> | Readonly<{ error: ConfigurationFailure; ok: false }>;

export type ConfigurationMutation<Value> = Readonly<{
  events: readonly DomainEvent[];
  resource: Value;
}>;

export type ConfigurationPage<Value> = Readonly<{
  items: readonly Value[];
  nextCursor: OpaqueCursor | null;
}>;

export type AuthorizedConfigurationQuery<Input> = Readonly<{
  authorization: AuthorizationContext;
  input: Input;
}>;

export type ConfigurationCommand<Input> = Readonly<{
  authorization: AuthorizationContext;
  idempotencyKey: ConfigurationIdempotencyKey;
  input: Input;
}>;

export type VersionedConfigurationCommand<Target, Input> = ConfigurationCommand<Input> &
  Readonly<{
    expectedVersion: ResourceVersion;
    target: Target;
  }>;

export type ConfigurationListQuery<Filter> = AuthorizedConfigurationQuery<
  Readonly<{
    filter: Filter;
    pagination: PaginationRequest;
  }>
>;

export interface LocationConfigurationUseCases {
  createLocation(
    command: ConfigurationCommand<CreateLocationInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<LocationRoot>>>;
  publishLocation(
    command: VersionedConfigurationCommand<LocationId, PublishLocationInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<LocationRoot>>>;
  deactivateLocation(
    command: VersionedConfigurationCommand<LocationId, DeactivateLocationInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<LocationRoot>>>;
  createClosure(
    command: VersionedConfigurationCommand<LocationId, CreateLocationClosureInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<LocationClosureRecord>>>;
  supersedeClosure(
    command: VersionedConfigurationCommand<
      Readonly<{ closureId: ResourceId; locationId: LocationId }>,
      SupersedeLocationClosureInput
    >,
  ): Promise<ConfigurationResult<ConfigurationMutation<LocationClosureRecord>>>;
  cancelClosure(
    command: VersionedConfigurationCommand<
      Readonly<{ closureId: ResourceId; locationId: LocationId }>,
      CancelLocationClosureInput
    >,
  ): Promise<ConfigurationResult<ConfigurationMutation<LocationClosureRecord>>>;
  getLocation(
    query: AuthorizedConfigurationQuery<Readonly<{ locationId: LocationId }>>,
  ): Promise<ConfigurationResult<LocationRoot>>;
  listLocations(
    query: ConfigurationListQuery<LocationListFilter>,
  ): Promise<ConfigurationResult<ConfigurationPage<LocationRoot>>>;
}

export interface ServiceConfigurationUseCases {
  createService(
    command: ConfigurationCommand<CreateServiceInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<ServiceRoot>>>;
  publishService(
    command: VersionedConfigurationCommand<ServiceId, PublishServiceInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<ServiceRoot>>>;
  deactivateService(
    command: VersionedConfigurationCommand<ServiceId, DeactivateServiceInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<ServiceRoot>>>;
  changeServiceLocation(
    command: VersionedConfigurationCommand<ServiceId, ChangeServiceLocationInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<ServiceLocationRecord>>>;
  getService(
    query: AuthorizedConfigurationQuery<Readonly<{ serviceId: ServiceId }>>,
  ): Promise<ConfigurationResult<ServiceRoot>>;
  listServices(
    query: ConfigurationListQuery<ServiceListFilter>,
  ): Promise<ConfigurationResult<ConfigurationPage<ServiceRoot>>>;
}

export interface PriceConfigurationUseCases {
  createPriceDraft(
    command: VersionedConfigurationCommand<ServiceId, CreateServicePriceDraftInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<ServicePriceRecord>>>;
  updatePriceDraft(
    command: VersionedConfigurationCommand<ResourceId, UpdateServicePriceDraftInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<ServicePriceRecord>>>;
  publishPrice(
    command: VersionedConfigurationCommand<ResourceId, PublishServicePriceInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<ServicePriceRecord>>>;
  retirePrice(
    command: VersionedConfigurationCommand<ResourceId, RetireServicePriceInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<ServicePriceRecord>>>;
  getPrice(
    query: AuthorizedConfigurationQuery<Readonly<{ priceId: ResourceId }>>,
  ): Promise<ConfigurationResult<ServicePriceRecord>>;
  listPrices(
    query: ConfigurationListQuery<ServicePriceListFilter>,
  ): Promise<ConfigurationResult<ConfigurationPage<ServicePriceRecord>>>;
}

export interface FaqConfigurationUseCases {
  createFaqDraft(
    command: ConfigurationCommand<CreateFaqDraftInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<Faq>>>;
  updateFaqDraft(
    command: VersionedConfigurationCommand<ResourceId, UpdateFaqDraftInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<Faq>>>;
  publishFaq(
    command: VersionedConfigurationCommand<ResourceId, PublishFaqInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<Faq>>>;
  retireFaq(
    command: VersionedConfigurationCommand<ResourceId, RetireFaqInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<Faq>>>;
  getFaq(
    query: AuthorizedConfigurationQuery<Readonly<{ faqId: ResourceId }>>,
  ): Promise<ConfigurationResult<Faq>>;
  listFaqs(
    query: ConfigurationListQuery<FaqListFilter>,
  ): Promise<ConfigurationResult<ConfigurationPage<Faq>>>;
}

export interface BusinessPolicyConfigurationUseCases {
  createPolicyDraft(
    command: ConfigurationCommand<CreateBusinessPolicyDraftInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<BusinessPolicy>>>;
  updatePolicyDraft(
    command: VersionedConfigurationCommand<ResourceId, UpdateBusinessPolicyDraftInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<BusinessPolicy>>>;
  publishPolicy(
    command: VersionedConfigurationCommand<ResourceId, PublishBusinessPolicyInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<BusinessPolicy>>>;
  retirePolicy(
    command: VersionedConfigurationCommand<ResourceId, RetireBusinessPolicyInput>,
  ): Promise<ConfigurationResult<ConfigurationMutation<BusinessPolicy>>>;
  getPolicy(
    query: AuthorizedConfigurationQuery<Readonly<{ policyId: ResourceId }>>,
  ): Promise<ConfigurationResult<BusinessPolicy>>;
  listPolicies(
    query: ConfigurationListQuery<BusinessPolicyListFilter>,
  ): Promise<ConfigurationResult<ConfigurationPage<BusinessPolicy>>>;
}

export interface PublishedBusinessKnowledgeReader {
  getPublishedBusinessKnowledge(
    query: AuthorizedConfigurationQuery<PublishedBusinessKnowledgeRequest>,
  ): Promise<ConfigurationResult<PublishedBusinessKnowledge>>;
}
