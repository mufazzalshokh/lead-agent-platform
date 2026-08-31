import type Type from "typebox";
import Value from "typebox/value";

export const isSchemaValue = <Schema extends Type.TSchema>(
  schema: Schema,
  value: unknown,
): value is Type.Static<Schema> => Value.Check(schema, value);
