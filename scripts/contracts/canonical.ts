export type JsonValue =
  boolean | null | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const canonicalize = (value: unknown, path = "$"): JsonValue => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite number at ${path}`);
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key], `${path}.${key}`)]),
    );
  }

  throw new TypeError(`Non-JSON value at ${path}`);
};

export const canonicalStringify = (value: unknown) =>
  `${JSON.stringify(canonicalize(value), null, 2)}\n`;
