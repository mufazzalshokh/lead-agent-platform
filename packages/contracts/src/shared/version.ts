import Type from "typebox";

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

export const SchemaVersionSchema = Type.String({
  $id: "SchemaVersion.v1",
  description: "Canonical positive decimal contract schema version.",
  maxLength: 6,
  minLength: 1,
  pattern: "^[1-9][0-9]{0,5}$",
});
export type SchemaVersion = Type.Static<typeof SchemaVersionSchema>;

export const ResourceVersionSchema = Type.Integer({
  $id: "ResourceVersion.v1",
  description: "Positive safe integer used for optimistic concurrency.",
  maximum: MAX_SAFE_INTEGER,
  minimum: 1,
});
export type ResourceVersion = Type.Static<typeof ResourceVersionSchema>;

export const AggregateVersionSchema = Type.Integer({
  $id: "AggregateVersion.v1",
  description: "Monotonic positive safe integer aggregate version.",
  maximum: MAX_SAFE_INTEGER,
  minimum: 1,
});
export type AggregateVersion = Type.Static<typeof AggregateVersionSchema>;
