import Type from "typebox";

declare const utcTimestampBrand: unique symbol;

export const UtcTimestampSchema = Type.Unsafe<
  string & { readonly [utcTimestampBrand]: "UtcTimestamp" }
>(
  Type.String({
    $id: "UtcTimestamp.v1",
    description: "Canonical RFC 3339 UTC instant using an uppercase Z suffix.",
    format: "date-time",
    maxLength: 30,
    minLength: 20,
    pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$",
  }),
);
export type UtcTimestamp = Type.Static<typeof UtcTimestampSchema>;
