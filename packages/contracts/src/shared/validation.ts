import type Type from "typebox";
import Value from "typebox/value";

const NOT_EQUAL_PROPERTIES_KEYWORD = "x-not-equal-properties";
const IANA_TIME_ZONE_KEYWORD = "x-iana-time-zone";
const LOCAL_DATE_KEYWORD = "x-local-date";
const LESS_THAN_PROPERTIES_KEYWORD = "x-less-than-properties";
const MONEY_RANGE_KEYWORD = "x-money-range";
const NON_NEGATIVE_MONEY_KEYWORD = "x-non-negative-money";

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

const isIanaTimeZone = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(value)) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
};

const isLocalDate = (value: unknown): value is string => {
  if (typeof value !== "string") {
    return false;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysByMonth[month - 1] ?? 0);
};

const satisfiesLessThanProperties = (schema: Type.TSchema, value: unknown): boolean => {
  const constraints: unknown = Reflect.get(schema, LESS_THAN_PROPERTIES_KEYWORD);
  if (constraints === undefined) {
    return true;
  }
  if (!Array.isArray(constraints) || !isRecord(value)) {
    return false;
  }

  return constraints.every((constraint) => {
    if (
      !Array.isArray(constraint) ||
      constraint.length !== 2 ||
      typeof constraint[0] !== "string" ||
      typeof constraint[1] !== "string"
    ) {
      return false;
    }
    const lower = value[constraint[0]];
    const upper = value[constraint[1]];
    if (upper === null) {
      return true;
    }
    if (lower === null) {
      return false;
    }
    return (
      ((typeof lower === "number" && typeof upper === "number") ||
        (typeof lower === "string" && typeof upper === "string")) &&
      lower < upper
    );
  });
};

const satisfiesNonNegativeMoney = (schema: Type.TSchema, value: unknown): boolean => {
  if (Reflect.get(schema, NON_NEGATIVE_MONEY_KEYWORD) !== true) {
    return true;
  }

  return isRecord(value) && typeof value["amount_minor"] === "number" && value["amount_minor"] >= 0;
};

const satisfiesMoneyRange = (schema: Type.TSchema, value: unknown): boolean => {
  if (Reflect.get(schema, MONEY_RANGE_KEYWORD) !== true) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  const minimum = value["minimum"];
  const maximum = value["maximum"];
  if (!isRecord(minimum) || !isRecord(maximum)) {
    return false;
  }

  return (
    minimum["currency"] === maximum["currency"] &&
    typeof minimum["amount_minor"] === "number" &&
    typeof maximum["amount_minor"] === "number" &&
    minimum["amount_minor"] >= 0 &&
    minimum["amount_minor"] <= maximum["amount_minor"]
  );
};

const satisfiesSchemaExtensions = (schema: Type.TSchema, value: unknown): boolean => {
  if (
    !satisfiesNotEqualProperties(schema, value) ||
    !satisfiesLessThanProperties(schema, value) ||
    !satisfiesMoneyRange(schema, value) ||
    !satisfiesNonNegativeMoney(schema, value) ||
    (Reflect.get(schema, IANA_TIME_ZONE_KEYWORD) === true && !isIanaTimeZone(value)) ||
    (Reflect.get(schema, LOCAL_DATE_KEYWORD) === true && !isLocalDate(value))
  ) {
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
