import type {
  BusinessPolicyConfigurationUseCases,
  ConfigurationFailureCode,
  ConfigurationResult,
  FaqConfigurationUseCases,
  LocationConfigurationUseCases,
  PriceConfigurationUseCases,
  ServiceConfigurationUseCases,
} from "@lead-agent/application";
import {
  BusinessPolicyListFilterSchema,
  BusinessPolicySchema,
  CancelLocationClosureInputSchema,
  ChangeServiceLocationInputSchema,
  ConfigurationIdempotencyKeySchema,
  CreateBusinessPolicyDraftInputSchema,
  CreateFaqDraftInputSchema,
  CreateLocationClosureInputSchema,
  CreateLocationInputSchema,
  CreateServiceInputSchema,
  CreateServicePriceDraftInputSchema,
  DeactivateLocationInputSchema,
  DeactivateServiceInputSchema,
  FaqListFilterSchema,
  FaqSchema,
  LocationClosureRecordSchema,
  LocationIdSchema,
  LocationListFilterSchema,
  LocationRootSchema,
  OrganizationIdSchema,
  PaginationRequestSchema,
  PublishBusinessPolicyInputSchema,
  PublishFaqInputSchema,
  PublishLocationInputSchema,
  PublishServiceInputSchema,
  PublishServicePriceInputSchema,
  RequestIdSchema,
  ResourceIdSchema,
  ResourceVersionSchema,
  RetireBusinessPolicyInputSchema,
  RetireFaqInputSchema,
  RetireServicePriceInputSchema,
  ServiceIdSchema,
  ServiceListFilterSchema,
  ServiceLocationRecordSchema,
  ServicePriceListFilterSchema,
  ServicePriceRecordSchema,
  ServiceRootSchema,
  SupersedeLocationClosureInputSchema,
  UpdateBusinessPolicyDraftInputSchema,
  UpdateFaqDraftInputSchema,
  UpdateServicePriceDraftInputSchema,
  createCollectionEnvelopeSchema,
  createSuccessEnvelopeSchema,
  isSchemaValue,
  type BusinessPolicyListFilter,
  type CancelLocationClosureInput,
  type ChangeServiceLocationInput,
  type ConfigurationIdempotencyKey,
  type CreateBusinessPolicyDraftInput,
  type CreateFaqDraftInput,
  type CreateLocationClosureInput,
  type CreateLocationInput,
  type CreateServiceInput,
  type CreateServicePriceDraftInput,
  type DeactivateLocationInput,
  type DeactivateServiceInput,
  type FaqListFilter,
  type LocationId,
  type LocationListFilter,
  type OpaqueCursor,
  type OrganizationId,
  type PageSize,
  type PaginationRequest,
  type PublishBusinessPolicyInput,
  type PublishFaqInput,
  type PublishLocationInput,
  type PublishServiceInput,
  type PublishServicePriceInput,
  type RequestId,
  type ResourceId,
  type ResourceVersion,
  type RetireBusinessPolicyInput,
  type RetireFaqInput,
  type RetireServicePriceInput,
  type ServiceId,
  type ServiceListFilter,
  type ServicePriceListFilter,
  type SupersedeLocationClosureInput,
  type UpdateBusinessPolicyDraftInput,
  type UpdateFaqDraftInput,
  type UpdateServicePriceDraftInput,
} from "@lead-agent/contracts";
import {
  AuthorizationDeniedError,
  hasPermission,
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
  type AuthorizationContext,
  type CurrentMembershipAuthorizationResolver,
} from "@lead-agent/security";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { configurationRoute, toFastifyPath, type StaffConfigurationOperation } from "./manifest.js";

const ORGANIZATION_HEADER = "x-organization-context";
const IDEMPOTENCY_HEADER = "idempotency-key";
const IF_MATCH_HEADER = "if-match";

export type StaffConfigurationDependencies = Readonly<{
  faqs: FaqConfigurationUseCases;
  locations: LocationConfigurationUseCases;
  policies: BusinessPolicyConfigurationUseCases;
  prices: PriceConfigurationUseCases;
  services: ServiceConfigurationUseCases;
}>;

export type StaffConfigurationSecurityBoundary = Readonly<{
  authorizationResolver: CurrentMembershipAuthorizationResolver;
  resolveMutationSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedApplicationSession>;
  resolveReadSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedApplicationSession>;
}>;

export class StaffConfigurationHttpError extends Error {
  public constructor(public readonly code: ConfigurationFailureCode) {
    super(code);
    this.name = "StaffConfigurationHttpError";
  }
}

type PaginationQuery = Readonly<{ cursor?: OpaqueCursor; limit?: PageSize }>;
type LocationListQuery = LocationListFilter & PaginationQuery;
type ServiceListQuery = ServiceListFilter & PaginationQuery;
type PriceListQuery = ServicePriceListFilter & PaginationQuery;
type FaqListQuery = FaqListFilter & PaginationQuery;
type PolicyListQuery = BusinessPolicyListFilter & PaginationQuery;

type LocationParams = Readonly<{ id: LocationId }>;
type ServiceParams = Readonly<{ id: ServiceId }>;
type ResourceParams = Readonly<{ id: ResourceId }>;
type PriceParams = Readonly<{ price_id: ResourceId }>;
type ClosureParams = Readonly<{ closure_id: ResourceId; id: LocationId }>;

const schemaObject = (
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[] = [],
) => ({ additionalProperties: false, properties, required, type: "object" }) as const;

const listSchema = (properties: Readonly<Record<string, unknown>>) =>
  schemaObject({ ...properties, ...PaginationRequestSchema.properties });

const LocationParamsSchema = schemaObject({ id: LocationIdSchema }, ["id"]);
const ServiceParamsSchema = schemaObject({ id: ServiceIdSchema }, ["id"]);
const ResourceParamsSchema = schemaObject({ id: ResourceIdSchema }, ["id"]);
const PriceParamsSchema = schemaObject({ price_id: ResourceIdSchema }, ["price_id"]);
const ClosureParamsSchema = schemaObject({ closure_id: ResourceIdSchema, id: LocationIdSchema }, [
  "id",
  "closure_id",
]);

const LocationListQuerySchema = listSchema(LocationListFilterSchema.properties);
const ServiceListQuerySchema = listSchema(ServiceListFilterSchema.properties);
const PriceListQuerySchema = listSchema(ServicePriceListFilterSchema.properties);
const FaqListQuerySchema = listSchema(FaqListFilterSchema.properties);
const PolicyListQuerySchema = listSchema(BusinessPolicyListFilterSchema.properties);

const LocationResponseSchema = createSuccessEnvelopeSchema(
  LocationRootSchema,
  "StaffConfigurationLocationResponse.v1",
);
const LocationCollectionResponseSchema = createCollectionEnvelopeSchema(
  LocationRootSchema,
  "StaffConfigurationLocationCollectionResponse.v1",
);
const ClosureResponseSchema = createSuccessEnvelopeSchema(
  LocationClosureRecordSchema,
  "StaffConfigurationClosureResponse.v1",
);
const ServiceResponseSchema = createSuccessEnvelopeSchema(
  ServiceRootSchema,
  "StaffConfigurationServiceResponse.v1",
);
const ServiceCollectionResponseSchema = createCollectionEnvelopeSchema(
  ServiceRootSchema,
  "StaffConfigurationServiceCollectionResponse.v1",
);
const ServiceLocationResponseSchema = createSuccessEnvelopeSchema(
  ServiceLocationRecordSchema,
  "StaffConfigurationServiceLocationResponse.v1",
);
const PriceResponseSchema = createSuccessEnvelopeSchema(
  ServicePriceRecordSchema,
  "StaffConfigurationPriceResponse.v1",
);
const PriceCollectionResponseSchema = createCollectionEnvelopeSchema(
  ServicePriceRecordSchema,
  "StaffConfigurationPriceCollectionResponse.v1",
);
const FaqResponseSchema = createSuccessEnvelopeSchema(
  FaqSchema,
  "StaffConfigurationFaqResponse.v1",
);
const FaqCollectionResponseSchema = createCollectionEnvelopeSchema(
  FaqSchema,
  "StaffConfigurationFaqCollectionResponse.v1",
);
const PolicyResponseSchema = createSuccessEnvelopeSchema(
  BusinessPolicySchema,
  "StaffConfigurationPolicyResponse.v1",
);
const PolicyCollectionResponseSchema = createCollectionEnvelopeSchema(
  BusinessPolicySchema,
  "StaffConfigurationPolicyCollectionResponse.v1",
);

const publicRequestId = (request: FastifyRequest): RequestId => {
  const supplied = request.headers["x-request-id"];
  if (typeof supplied === "string" && isSchemaValue(RequestIdSchema, supplied)) return supplied;
  const generated = "request:" + request.id;
  if (!isSchemaValue(RequestIdSchema, generated)) {
    throw new TypeError("Fastify request identifier is invalid");
  }
  return generated;
};

const requireOrganization = (request: FastifyRequest): OrganizationId => {
  const value = request.headers[ORGANIZATION_HEADER];
  if (!isSchemaValue(OrganizationIdSchema, value)) {
    throw new StaffConfigurationHttpError("permission_denied");
  }
  return value;
};

const requireIdempotencyKey = (request: FastifyRequest): ConfigurationIdempotencyKey => {
  const value = request.headers[IDEMPOTENCY_HEADER];
  if (!isSchemaValue(ConfigurationIdempotencyKeySchema, value)) {
    throw new StaffConfigurationHttpError("validation_failed");
  }
  return value;
};

const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export const formatConfigurationEtag = (
  resourceId: LocationId | ResourceId | ServiceId,
  version: ResourceVersion,
): string => `"${resourceId}:${version}"`;

export const parseConfigurationIfMatch = (
  value: unknown,
  resourceId: LocationId | ResourceId | ServiceId,
): ResourceVersion => {
  if (typeof value !== "string") throw new StaffConfigurationHttpError("validation_failed");
  const match = new RegExp(`^"${escapeRegularExpression(resourceId)}:([1-9][0-9]*)"$`, "u").exec(
    value,
  );
  const version = match === null ? Number.NaN : Number(match[1]);
  if (!isSchemaValue(ResourceVersionSchema, version)) {
    throw new StaffConfigurationHttpError("validation_failed");
  }
  return version;
};

const requireIfMatch = (
  request: FastifyRequest,
  resourceId: LocationId | ResourceId | ServiceId,
): ResourceVersion => parseConfigurationIfMatch(request.headers[IF_MATCH_HEADER], resourceId);

const requireResult = <Value>(result: ConfigurationResult<Value>): Value => {
  if (!result.ok) throw new StaffConfigurationHttpError(result.error.code);
  return result.value;
};

const sendResource = (
  request: FastifyRequest,
  reply: FastifyReply,
  resource: unknown,
  status: 200 | 201,
  etag?: string,
) => {
  const requestId = publicRequestId(request);
  reply.header("x-request-id", requestId);
  if (etag !== undefined) reply.header("etag", etag);
  return reply.code(status).send({ data: resource, meta: { request_id: requestId } });
};

const sendCollection = (
  request: FastifyRequest,
  reply: FastifyReply,
  page: Readonly<{ items: readonly unknown[]; nextCursor: OpaqueCursor | null }>,
) => {
  const requestId = publicRequestId(request);
  reply.header("x-request-id", requestId);
  return reply.send({
    data: page.items,
    meta:
      page.nextCursor === null
        ? { has_more: false, next_cursor: null, request_id: requestId }
        : { has_more: true, next_cursor: page.nextCursor, request_id: requestId },
  });
};

const pagination = (query: PaginationQuery): PaginationRequest => ({
  ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
  ...(query.limit === undefined ? {} : { limit: query.limit }),
});

const bodyIsCanonical = (valid: boolean): void => {
  if (!valid) throw new StaffConfigurationHttpError("validation_failed");
};

export const registerStaffConfiguration = (
  api: FastifyInstance,
  dependencies: StaffConfigurationDependencies,
  security: StaffConfigurationSecurityBoundary,
): void => {
  const contexts = new WeakMap<FastifyRequest, AuthorizationContext>();

  const secured = (
    operation: StaffConfigurationOperation,
    validateBody?: (body: unknown) => boolean,
  ) => {
    const route = configurationRoute(operation);
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const session = route.mutation
        ? await security.resolveMutationSession(request, reply)
        : await security.resolveReadSession(request, reply);
      const authorization = await resolveAuthorizationContext(
        session,
        requireOrganization(request),
        security.authorizationResolver,
      );
      if (!hasPermission(authorization.role, route.permission)) {
        throw new AuthorizationDeniedError();
      }
      if (validateBody !== undefined) bodyIsCanonical(validateBody(request.body));
      contexts.set(request, authorization);
    };
  };

  const contextFor = (request: FastifyRequest): AuthorizationContext => {
    const context = contexts.get(request);
    if (context === undefined) throw new TypeError("Staff configuration authorization is missing");
    return context;
  };

  const pathFor = (operation: StaffConfigurationOperation): string =>
    toFastifyPath(configurationRoute(operation).path);

  api.get<{ Querystring: LocationListQuery }>(
    pathFor("listLocations"),
    {
      preValidation: secured("listLocations"),
      schema: {
        querystring: LocationListQuerySchema,
        response: { 200: LocationCollectionResponseSchema },
      },
    },
    async (request, reply) => {
      const page = requireResult(
        await dependencies.locations.listLocations({
          authorization: contextFor(request),
          input: {
            filter: {
              ...(request.query.status === undefined ? {} : { status: request.query.status }),
            },
            pagination: pagination(request.query),
          },
        }),
      );
      return sendCollection(request, reply, page);
    },
  );

  api.post<{ Body: CreateLocationInput }>(
    pathFor("createLocation"),
    {
      preValidation: secured("createLocation", (body) =>
        isSchemaValue(CreateLocationInputSchema, body),
      ),
      schema: { body: CreateLocationInputSchema, response: { 201: LocationResponseSchema } },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.locations.createLocation({
          authorization: contextFor(request),
          idempotencyKey: requireIdempotencyKey(request),
          input: request.body,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        201,
        formatConfigurationEtag(resource.location_id, resource.version),
      );
    },
  );

  api.get<{ Params: LocationParams }>(
    pathFor("getLocation"),
    {
      preValidation: secured("getLocation"),
      schema: { params: LocationParamsSchema, response: { 200: LocationResponseSchema } },
    },
    async (request, reply) => {
      const resource = requireResult(
        await dependencies.locations.getLocation({
          authorization: contextFor(request),
          input: { locationId: request.params.id },
        }),
      );
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.location_id, resource.version),
      );
    },
  );

  api.post<{ Body: PublishLocationInput; Params: LocationParams }>(
    pathFor("publishLocation"),
    {
      preValidation: secured("publishLocation", (body) =>
        isSchemaValue(PublishLocationInputSchema, body),
      ),
      schema: {
        body: PublishLocationInputSchema,
        params: LocationParamsSchema,
        response: { 200: LocationResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.locations.publishLocation({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.id),
          idempotencyKey: requireIdempotencyKey(request),
          input: request.body,
          target: request.params.id,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.location_id, resource.version),
      );
    },
  );

  api.post<{ Body: DeactivateLocationInput; Params: LocationParams }>(
    pathFor("deactivateLocation"),
    {
      preValidation: secured("deactivateLocation", (body) =>
        isSchemaValue(DeactivateLocationInputSchema, body),
      ),
      schema: {
        body: DeactivateLocationInputSchema,
        params: LocationParamsSchema,
        response: { 200: LocationResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.locations.deactivateLocation({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.id),
          idempotencyKey: requireIdempotencyKey(request),
          input: {},
          target: request.params.id,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.location_id, resource.version),
      );
    },
  );

  api.post<{ Body: CreateLocationClosureInput; Params: LocationParams }>(
    pathFor("createClosure"),
    {
      preValidation: secured("createClosure", (body) =>
        isSchemaValue(CreateLocationClosureInputSchema, body),
      ),
      schema: {
        body: CreateLocationClosureInputSchema,
        params: LocationParamsSchema,
        response: { 201: ClosureResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.locations.createClosure({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.id),
          idempotencyKey: requireIdempotencyKey(request),
          input: request.body,
          target: request.params.id,
        }),
      );
      return sendResource(request, reply, mutation.resource, 201);
    },
  );

  api.post<{
    Body: SupersedeLocationClosureInput;
    Params: ClosureParams;
  }>(
    pathFor("supersedeClosure"),
    {
      preValidation: secured("supersedeClosure", (body) =>
        isSchemaValue(SupersedeLocationClosureInputSchema, body),
      ),
      schema: {
        body: SupersedeLocationClosureInputSchema,
        params: ClosureParamsSchema,
        response: { 201: ClosureResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.locations.supersedeClosure({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.id),
          idempotencyKey: requireIdempotencyKey(request),
          input: request.body,
          target: { closureId: request.params.closure_id, locationId: request.params.id },
        }),
      );
      return sendResource(request, reply, mutation.resource, 201);
    },
  );

  api.post<{ Body: CancelLocationClosureInput; Params: ClosureParams }>(
    pathFor("cancelClosure"),
    {
      preValidation: secured("cancelClosure", (body) =>
        isSchemaValue(CancelLocationClosureInputSchema, body),
      ),
      schema: {
        body: CancelLocationClosureInputSchema,
        params: ClosureParamsSchema,
        response: { 200: ClosureResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.locations.cancelClosure({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.id),
          idempotencyKey: requireIdempotencyKey(request),
          input: {},
          target: { closureId: request.params.closure_id, locationId: request.params.id },
        }),
      );
      return sendResource(request, reply, mutation.resource, 200);
    },
  );

  api.get<{ Querystring: ServiceListQuery }>(
    pathFor("listServices"),
    {
      preValidation: secured("listServices"),
      schema: {
        querystring: ServiceListQuerySchema,
        response: { 200: ServiceCollectionResponseSchema },
      },
    },
    async (request, reply) => {
      const page = requireResult(
        await dependencies.services.listServices({
          authorization: contextFor(request),
          input: {
            filter: {
              ...(request.query.location_id === undefined
                ? {}
                : { location_id: request.query.location_id }),
              ...(request.query.status === undefined ? {} : { status: request.query.status }),
            },
            pagination: pagination(request.query),
          },
        }),
      );
      return sendCollection(request, reply, page);
    },
  );

  api.post<{ Body: CreateServiceInput }>(
    pathFor("createService"),
    {
      preValidation: secured("createService", (body) =>
        isSchemaValue(CreateServiceInputSchema, body),
      ),
      schema: { body: CreateServiceInputSchema, response: { 201: ServiceResponseSchema } },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.services.createService({
          authorization: contextFor(request),
          idempotencyKey: requireIdempotencyKey(request),
          input: request.body,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        201,
        formatConfigurationEtag(resource.service_id, resource.version),
      );
    },
  );

  api.get<{ Params: ServiceParams }>(
    pathFor("getService"),
    {
      preValidation: secured("getService"),
      schema: { params: ServiceParamsSchema, response: { 200: ServiceResponseSchema } },
    },
    async (request, reply) => {
      const resource = requireResult(
        await dependencies.services.getService({
          authorization: contextFor(request),
          input: { serviceId: request.params.id },
        }),
      );
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.service_id, resource.version),
      );
    },
  );

  api.post<{ Body: PublishServiceInput; Params: ServiceParams }>(
    pathFor("publishService"),
    {
      preValidation: secured("publishService", (body) =>
        isSchemaValue(PublishServiceInputSchema, body),
      ),
      schema: {
        body: PublishServiceInputSchema,
        params: ServiceParamsSchema,
        response: { 200: ServiceResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.services.publishService({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.id),
          idempotencyKey: requireIdempotencyKey(request),
          input: request.body,
          target: request.params.id,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.service_id, resource.version),
      );
    },
  );

  api.post<{ Body: DeactivateServiceInput; Params: ServiceParams }>(
    pathFor("deactivateService"),
    {
      preValidation: secured("deactivateService", (body) =>
        isSchemaValue(DeactivateServiceInputSchema, body),
      ),
      schema: {
        body: DeactivateServiceInputSchema,
        params: ServiceParamsSchema,
        response: { 200: ServiceResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.services.deactivateService({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.id),
          idempotencyKey: requireIdempotencyKey(request),
          input: {},
          target: request.params.id,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.service_id, resource.version),
      );
    },
  );

  api.put<{ Body: ChangeServiceLocationInput; Params: ServiceParams }>(
    pathFor("changeServiceLocation"),
    {
      preValidation: secured("changeServiceLocation", (body) =>
        isSchemaValue(ChangeServiceLocationInputSchema, body),
      ),
      schema: {
        body: ChangeServiceLocationInputSchema,
        params: ServiceParamsSchema,
        response: { 200: ServiceLocationResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.services.changeServiceLocation({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.id),
          idempotencyKey: requireIdempotencyKey(request),
          input: request.body,
          target: request.params.id,
        }),
      );
      return sendResource(request, reply, mutation.resource, 200);
    },
  );

  api.get<{ Querystring: PriceListQuery }>(
    pathFor("listPrices"),
    {
      preValidation: secured("listPrices"),
      schema: {
        querystring: PriceListQuerySchema,
        response: { 200: PriceCollectionResponseSchema },
      },
    },
    async (request, reply) => {
      const page = requireResult(
        await dependencies.prices.listPrices({
          authorization: contextFor(request),
          input: {
            filter: {
              ...(request.query.location_id === undefined
                ? {}
                : { location_id: request.query.location_id }),
              ...(request.query.price_type === undefined
                ? {}
                : { price_type: request.query.price_type }),
              ...(request.query.status === undefined ? {} : { status: request.query.status }),
            },
            pagination: pagination(request.query),
          },
        }),
      );
      return sendCollection(request, reply, page);
    },
  );

  api.post<{ Body: CreateServicePriceDraftInput; Params: ServiceParams }>(
    pathFor("createPriceDraft"),
    {
      preValidation: secured("createPriceDraft", (body) =>
        isSchemaValue(CreateServicePriceDraftInputSchema, body),
      ),
      schema: {
        body: CreateServicePriceDraftInputSchema,
        params: ServiceParamsSchema,
        response: { 201: PriceResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.prices.createPriceDraft({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.id),
          idempotencyKey: requireIdempotencyKey(request),
          input: request.body,
          target: request.params.id,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        201,
        formatConfigurationEtag(resource.price_id, resource.version_no),
      );
    },
  );

  api.get<{ Params: PriceParams }>(
    pathFor("getPrice"),
    {
      preValidation: secured("getPrice"),
      schema: { params: PriceParamsSchema, response: { 200: PriceResponseSchema } },
    },
    async (request, reply) => {
      const resource = requireResult(
        await dependencies.prices.getPrice({
          authorization: contextFor(request),
          input: { priceId: request.params.price_id },
        }),
      );
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.price_id, resource.version_no),
      );
    },
  );

  api.patch<{ Body: UpdateServicePriceDraftInput; Params: PriceParams }>(
    pathFor("updatePriceDraft"),
    {
      preValidation: secured("updatePriceDraft", (body) =>
        isSchemaValue(UpdateServicePriceDraftInputSchema, body),
      ),
      schema: {
        body: UpdateServicePriceDraftInputSchema,
        params: PriceParamsSchema,
        response: { 200: PriceResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.prices.updatePriceDraft({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.price_id),
          idempotencyKey: requireIdempotencyKey(request),
          input: request.body,
          target: request.params.price_id,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.price_id, resource.version_no),
      );
    },
  );

  api.post<{ Body: PublishServicePriceInput; Params: PriceParams }>(
    pathFor("publishPrice"),
    {
      preValidation: secured("publishPrice", (body) =>
        isSchemaValue(PublishServicePriceInputSchema, body),
      ),
      schema: {
        body: PublishServicePriceInputSchema,
        params: PriceParamsSchema,
        response: { 200: PriceResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.prices.publishPrice({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.price_id),
          idempotencyKey: requireIdempotencyKey(request),
          input: {},
          target: request.params.price_id,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.price_id, resource.version_no),
      );
    },
  );

  api.post<{ Body: RetireServicePriceInput; Params: PriceParams }>(
    pathFor("retirePrice"),
    {
      preValidation: secured("retirePrice", (body) =>
        isSchemaValue(RetireServicePriceInputSchema, body),
      ),
      schema: {
        body: RetireServicePriceInputSchema,
        params: PriceParamsSchema,
        response: { 200: PriceResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.prices.retirePrice({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.price_id),
          idempotencyKey: requireIdempotencyKey(request),
          input: {},
          target: request.params.price_id,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.price_id, resource.version_no),
      );
    },
  );

  api.get<{ Querystring: FaqListQuery }>(
    pathFor("listFaqs"),
    {
      preValidation: secured("listFaqs"),
      schema: { querystring: FaqListQuerySchema, response: { 200: FaqCollectionResponseSchema } },
    },
    async (request, reply) => {
      const page = requireResult(
        await dependencies.faqs.listFaqs({
          authorization: contextFor(request),
          input: {
            filter: {
              ...(request.query.location_id === undefined
                ? {}
                : { location_id: request.query.location_id }),
              ...(request.query.service_id === undefined
                ? {}
                : { service_id: request.query.service_id }),
              ...(request.query.status === undefined ? {} : { status: request.query.status }),
            },
            pagination: pagination(request.query),
          },
        }),
      );
      return sendCollection(request, reply, page);
    },
  );

  api.post<{ Body: CreateFaqDraftInput }>(
    pathFor("createFaqDraft"),
    {
      preValidation: secured("createFaqDraft", (body) =>
        isSchemaValue(CreateFaqDraftInputSchema, body),
      ),
      schema: { body: CreateFaqDraftInputSchema, response: { 201: FaqResponseSchema } },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.faqs.createFaqDraft({
          authorization: contextFor(request),
          idempotencyKey: requireIdempotencyKey(request),
          input: request.body,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        201,
        formatConfigurationEtag(resource.faq_id, resource.version_no),
      );
    },
  );

  api.get<{ Params: ResourceParams }>(
    pathFor("getFaq"),
    {
      preValidation: secured("getFaq"),
      schema: { params: ResourceParamsSchema, response: { 200: FaqResponseSchema } },
    },
    async (request, reply) => {
      const resource = requireResult(
        await dependencies.faqs.getFaq({
          authorization: contextFor(request),
          input: { faqId: request.params.id },
        }),
      );
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.faq_id, resource.version_no),
      );
    },
  );

  api.patch<{ Body: UpdateFaqDraftInput; Params: ResourceParams }>(
    pathFor("updateFaqDraft"),
    {
      preValidation: secured("updateFaqDraft", (body) =>
        isSchemaValue(UpdateFaqDraftInputSchema, body),
      ),
      schema: {
        body: UpdateFaqDraftInputSchema,
        params: ResourceParamsSchema,
        response: { 200: FaqResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.faqs.updateFaqDraft({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.id),
          idempotencyKey: requireIdempotencyKey(request),
          input: request.body,
          target: request.params.id,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.faq_id, resource.version_no),
      );
    },
  );

  api.post<{ Body: PublishFaqInput; Params: ResourceParams }>(
    pathFor("publishFaq"),
    {
      preValidation: secured("publishFaq", (body) => isSchemaValue(PublishFaqInputSchema, body)),
      schema: {
        body: PublishFaqInputSchema,
        params: ResourceParamsSchema,
        response: { 200: FaqResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.faqs.publishFaq({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.id),
          idempotencyKey: requireIdempotencyKey(request),
          input: {},
          target: request.params.id,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.faq_id, resource.version_no),
      );
    },
  );

  api.post<{ Body: RetireFaqInput; Params: ResourceParams }>(
    pathFor("retireFaq"),
    {
      preValidation: secured("retireFaq", (body) => isSchemaValue(RetireFaqInputSchema, body)),
      schema: {
        body: RetireFaqInputSchema,
        params: ResourceParamsSchema,
        response: { 200: FaqResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.faqs.retireFaq({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.id),
          idempotencyKey: requireIdempotencyKey(request),
          input: {},
          target: request.params.id,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.faq_id, resource.version_no),
      );
    },
  );

  api.get<{ Querystring: PolicyListQuery }>(
    pathFor("listPolicies"),
    {
      preValidation: secured("listPolicies"),
      schema: {
        querystring: PolicyListQuerySchema,
        response: { 200: PolicyCollectionResponseSchema },
      },
    },
    async (request, reply) => {
      const page = requireResult(
        await dependencies.policies.listPolicies({
          authorization: contextFor(request),
          input: {
            filter: {
              ...(request.query.policy_type === undefined
                ? {}
                : { policy_type: request.query.policy_type }),
              ...(request.query.status === undefined ? {} : { status: request.query.status }),
            },
            pagination: pagination(request.query),
          },
        }),
      );
      return sendCollection(request, reply, page);
    },
  );

  api.post<{ Body: CreateBusinessPolicyDraftInput }>(
    pathFor("createPolicyDraft"),
    {
      preValidation: secured("createPolicyDraft", (body) =>
        isSchemaValue(CreateBusinessPolicyDraftInputSchema, body),
      ),
      schema: {
        body: CreateBusinessPolicyDraftInputSchema,
        response: { 201: PolicyResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.policies.createPolicyDraft({
          authorization: contextFor(request),
          idempotencyKey: requireIdempotencyKey(request),
          input: request.body,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        201,
        formatConfigurationEtag(resource.policy_id, resource.version_no),
      );
    },
  );

  api.get<{ Params: ResourceParams }>(
    pathFor("getPolicy"),
    {
      preValidation: secured("getPolicy"),
      schema: { params: ResourceParamsSchema, response: { 200: PolicyResponseSchema } },
    },
    async (request, reply) => {
      const resource = requireResult(
        await dependencies.policies.getPolicy({
          authorization: contextFor(request),
          input: { policyId: request.params.id },
        }),
      );
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.policy_id, resource.version_no),
      );
    },
  );

  api.patch<{ Body: UpdateBusinessPolicyDraftInput; Params: ResourceParams }>(
    pathFor("updatePolicyDraft"),
    {
      preValidation: secured("updatePolicyDraft", (body) =>
        isSchemaValue(UpdateBusinessPolicyDraftInputSchema, body),
      ),
      schema: {
        body: UpdateBusinessPolicyDraftInputSchema,
        params: ResourceParamsSchema,
        response: { 200: PolicyResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.policies.updatePolicyDraft({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.id),
          idempotencyKey: requireIdempotencyKey(request),
          input: request.body,
          target: request.params.id,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.policy_id, resource.version_no),
      );
    },
  );

  api.post<{ Body: PublishBusinessPolicyInput; Params: ResourceParams }>(
    pathFor("publishPolicy"),
    {
      preValidation: secured("publishPolicy", (body) =>
        isSchemaValue(PublishBusinessPolicyInputSchema, body),
      ),
      schema: {
        body: PublishBusinessPolicyInputSchema,
        params: ResourceParamsSchema,
        response: { 200: PolicyResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.policies.publishPolicy({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.id),
          idempotencyKey: requireIdempotencyKey(request),
          input: {},
          target: request.params.id,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.policy_id, resource.version_no),
      );
    },
  );

  api.post<{ Body: RetireBusinessPolicyInput; Params: ResourceParams }>(
    pathFor("retirePolicy"),
    {
      preValidation: secured("retirePolicy", (body) =>
        isSchemaValue(RetireBusinessPolicyInputSchema, body),
      ),
      schema: {
        body: RetireBusinessPolicyInputSchema,
        params: ResourceParamsSchema,
        response: { 200: PolicyResponseSchema },
      },
    },
    async (request, reply) => {
      const mutation = requireResult(
        await dependencies.policies.retirePolicy({
          authorization: contextFor(request),
          expectedVersion: requireIfMatch(request, request.params.id),
          idempotencyKey: requireIdempotencyKey(request),
          input: {},
          target: request.params.id,
        }),
      );
      const resource = mutation.resource;
      return sendResource(
        request,
        reply,
        resource,
        200,
        formatConfigurationEtag(resource.policy_id, resource.version_no),
      );
    },
  );
};
