import Type from "typebox";

import { RequestIdSchema, SchemaIdSchema, type RequestId } from "../shared/identifiers.js";
import { isSchemaValue } from "../shared/validation.js";
import { withoutSchemaId } from "./embedding.js";
import { PaginationMetaSchema, type PaginationMeta } from "./pagination.js";

const EmbeddedRequestIdSchema = withoutSchemaId<RequestId>(RequestIdSchema);
const EmbeddedPaginationMetaSchema = withoutSchemaId<PaginationMeta>(PaginationMetaSchema);

const requireSchemaId = (schemaId: string) => {
  if (!isSchemaValue(SchemaIdSchema, schemaId)) {
    throw new TypeError("Response envelope schema ID must be a canonical versioned schema ID");
  }

  return schemaId;
};

const createResponseMetaSchema = ($id?: string) =>
  Type.Object(
    {
      request_id: EmbeddedRequestIdSchema,
    },
    {
      ...($id === undefined ? {} : { $id }),
      additionalProperties: false,
      description: "Correlation metadata returned by a successful API request.",
    },
  );

export const ResponseMetaSchema = createResponseMetaSchema("ResponseMeta.v1");
export type ResponseMeta = Type.Static<typeof ResponseMetaSchema>;

export const createSuccessEnvelopeSchema = <DataSchema extends Type.TSchema>(
  dataSchema: DataSchema,
  schemaId: string,
) =>
  Type.Object(
    {
      data: dataSchema,
      meta: createResponseMetaSchema(),
    },
    {
      $id: requireSchemaId(schemaId),
      additionalProperties: false,
      description: "V1 successful single-resource response envelope.",
    },
  );

export const createCollectionEnvelopeSchema = <ItemSchema extends Type.TSchema>(
  itemSchema: ItemSchema,
  schemaId: string,
): Type.TObject<{
  data: Type.TArray<ItemSchema>;
  meta: Type.TUnsafe<PaginationMeta>;
}> =>
  Type.Object(
    {
      data: Type.Array(itemSchema, { maxItems: 100 }),
      meta: EmbeddedPaginationMetaSchema,
    },
    {
      $id: requireSchemaId(schemaId),
      additionalProperties: false,
      description: "V1 successful keyset-paginated collection response envelope.",
    },
  );
