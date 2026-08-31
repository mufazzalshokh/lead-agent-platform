import Type from "typebox";

export const embedSchemaAs = <Value>(schema: Type.TSchema) => {
  const embeddedSchema: Record<PropertyKey, unknown> = { ...schema };
  delete embeddedSchema["$id"];

  return Type.Unsafe<Value>(embeddedSchema);
};

export const embedSchema = <Schema extends Type.TSchema>(schema: Schema) =>
  embedSchemaAs<Type.Static<Schema>>(schema);
