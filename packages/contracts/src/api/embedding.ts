import Type from "typebox";

export const withoutSchemaId = <Value>(schema: Type.TSchema) => {
  const embeddedSchema: Record<PropertyKey, unknown> = { ...schema };
  delete embeddedSchema["$id"];

  return Type.Unsafe<Value>(embeddedSchema);
};
