import Type from "typebox";

import { RequestIdSchema, type RequestId } from "../shared/identifiers.js";
import { withoutSchemaId } from "./embedding.js";

declare const opaqueCursorBrand: unique symbol;

type BrandedOpaqueCursor = string & {
  readonly [opaqueCursorBrand]: "OpaqueCursor";
};

const BASE64URL_PATTERN = "^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$";

const EmbeddedRequestIdSchema = withoutSchemaId<RequestId>(RequestIdSchema);

const createOpaqueCursorSchema = ($id?: string) =>
  Type.Unsafe<BrandedOpaqueCursor>(
    Type.String({
      ...($id === undefined ? {} : { $id }),
      description:
        "Bounded unpadded base64url cursor; opaque data and never tenant authorization evidence.",
      maxLength: 2_048,
      minLength: 2,
      pattern: BASE64URL_PATTERN,
    }),
  );

export const OpaqueCursorSchema = createOpaqueCursorSchema("OpaqueCursor.v1");
export type OpaqueCursor = Type.Static<typeof OpaqueCursorSchema>;

const createPageSizeSchema = ($id?: string) =>
  Type.Integer({
    ...($id === undefined ? {} : { $id }),
    default: 50,
    description: "Keyset page size with the V1 default and maximum documented by the API.",
    maximum: 100,
    minimum: 1,
  });

export const PageSizeSchema = createPageSizeSchema("PageSize.v1");
export type PageSize = Type.Static<typeof PageSizeSchema>;

export const PaginationRequestSchema = Type.Object(
  {
    cursor: Type.Optional(createOpaqueCursorSchema()),
    limit: Type.Optional(createPageSizeSchema()),
  },
  {
    $id: "PaginationRequest.v1",
    additionalProperties: false,
    description: "Parsed V1 keyset-pagination request; offset pagination is not supported.",
  },
);
export type PaginationRequest = Type.Static<typeof PaginationRequestSchema>;

const ExhaustedPaginationMetaSchema = Type.Object(
  {
    has_more: Type.Literal(false),
    next_cursor: Type.Optional(Type.Null()),
    request_id: EmbeddedRequestIdSchema,
  },
  { additionalProperties: false },
);

const ContinuedPaginationMetaSchema = Type.Object(
  {
    has_more: Type.Literal(true),
    next_cursor: createOpaqueCursorSchema(),
    request_id: EmbeddedRequestIdSchema,
  },
  { additionalProperties: false },
);

export const PaginationMetaSchema = Type.Union(
  [ExhaustedPaginationMetaSchema, ContinuedPaginationMetaSchema],
  {
    $id: "PaginationMeta.v1",
    description: "Collection response metadata with a coherent optional continuation cursor.",
  },
);
export type PaginationMeta = Type.Static<typeof PaginationMetaSchema>;
