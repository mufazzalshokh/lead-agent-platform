import Type from "typebox";

export type JsonWire<Value> = Value extends string
  ? string
  : Value extends number
    ? number
    : Value extends boolean
      ? boolean
      : Value extends null
        ? null
        : Value extends readonly (infer Item)[]
          ? JsonWire<Item>[]
          : Value extends object
            ? { readonly [Key in keyof Value]: JsonWire<Value[Key]> }
            : never;

export const embedSchemaAs = <Value>(schema: Type.TSchema) => {
  const embeddedSchema: Record<PropertyKey, unknown> = { ...schema };
  delete embeddedSchema["$id"];

  return Type.Unsafe<Value>(embeddedSchema);
};

export const embedSchema = <Schema extends Type.TSchema>(schema: Schema) =>
  embedSchemaAs<Type.Static<Schema>>(schema);
