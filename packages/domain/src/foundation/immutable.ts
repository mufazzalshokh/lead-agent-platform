type Primitive = bigint | boolean | null | number | string | symbol | undefined;

export type DeepReadonly<T> = T extends Primitive
  ? T
  : T extends readonly unknown[]
    ? { readonly [Index in keyof T]: DeepReadonly<T[Index]> }
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

const cloneValue = (value: unknown, clones: WeakMap<object, object>): unknown => {
  if (value === null || typeof value !== "object") {
    return value;
  }

  const existingClone = clones.get(value);
  if (existingClone !== undefined) {
    return existingClone;
  }

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    clones.set(value, clone);

    for (const item of value) {
      clone.push(cloneValue(item, clones));
    }

    return Object.freeze(clone);
  }

  const clone: Record<string, unknown> = {};
  clones.set(value, clone);

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      value: cloneValue(item, clones),
      writable: true,
    });
  }

  return Object.freeze(clone);
};

export const cloneAndFreeze = <T>(value: T): DeepReadonly<T> =>
  cloneValue(value, new WeakMap<object, object>()) as DeepReadonly<T>;
