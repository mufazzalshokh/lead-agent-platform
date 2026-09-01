import type Type from "typebox";
import Value from "typebox/value";

const NOT_EQUAL_PROPERTIES_KEYWORD = "x-not-equal-properties";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const schemaMembers = (schema: Type.TSchema, keyword: string): readonly Type.TSchema[] => {
  const value: unknown = Reflect.get(schema, keyword);
  return Array.isArray(value) ? (value as readonly Type.TSchema[]) : [];
};

const satisfiesNotEqualProperties = (schema: Type.TSchema, value: unknown): boolean => {
  const constraints: unknown = Reflect.get(schema, NOT_EQUAL_PROPERTIES_KEYWORD);
  if (constraints === undefined) {
    return true;
  }

  if (!Array.isArray(constraints) || !isRecord(value)) {
    return false;
  }

  return constraints.every(
    (constraint) =>
      Array.isArray(constraint) &&
      constraint.length === 2 &&
      typeof constraint[0] === "string" &&
      typeof constraint[1] === "string" &&
      value[constraint[0]] !== value[constraint[1]],
  );
};

const satisfiesSchemaExtensions = (schema: Type.TSchema, value: unknown): boolean => {
  if (!satisfiesNotEqualProperties(schema, value)) {
    return false;
  }

  const anyOf = schemaMembers(schema, "anyOf");
  if (
    anyOf.length > 0 &&
    !anyOf.some((member) => Value.Check(member, value) && satisfiesSchemaExtensions(member, value))
  ) {
    return false;
  }

  const oneOf = schemaMembers(schema, "oneOf");
  if (
    oneOf.length > 0 &&
    oneOf.filter((member) => Value.Check(member, value) && satisfiesSchemaExtensions(member, value))
      .length !== 1
  ) {
    return false;
  }

  const allOf = schemaMembers(schema, "allOf");
  if (allOf.some((member) => !satisfiesSchemaExtensions(member, value))) {
    return false;
  }

  const properties: unknown = Reflect.get(schema, "properties");
  if (isRecord(properties) && isRecord(value)) {
    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      if (
        Object.hasOwn(value, propertyName) &&
        isRecord(propertySchema) &&
        !satisfiesSchemaExtensions(propertySchema, value[propertyName])
      ) {
        return false;
      }
    }
  }

  return true;
};

export const isSchemaValue = <Schema extends Type.TSchema>(
  schema: Schema,
  value: unknown,
): value is Type.Static<Schema> =>
  Value.Check(schema, value) && satisfiesSchemaExtensions(schema, value);
