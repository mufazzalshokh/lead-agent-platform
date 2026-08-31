import Type from "typebox";

declare const currencyCodeBrand: unique symbol;

type CurrencyCodeValue = string & {
  readonly [currencyCodeBrand]: "CurrencyCode";
};

const createCurrencyCodeSchema = ($id?: string) =>
  Type.Unsafe<CurrencyCodeValue>(
    Type.String({
      ...($id === undefined ? {} : { $id }),
      description: "Uppercase three-letter ISO 4217 currency code.",
      maxLength: 3,
      minLength: 3,
      pattern: "^[A-Z]{3}$",
    }),
  );

export const CurrencyCodeSchema = createCurrencyCodeSchema("CurrencyCode.v1");
export type CurrencyCode = Type.Static<typeof CurrencyCodeSchema>;

export const MoneySchema = Type.Object(
  {
    amount_minor: Type.Integer({
      description: "Authoritative amount in integer currency minor units.",
      maximum: Number.MAX_SAFE_INTEGER,
      minimum: Number.MIN_SAFE_INTEGER,
    }),
    currency: createCurrencyCodeSchema(),
  },
  {
    $id: "Money.v1",
    additionalProperties: false,
    description: "Exact wire money representation; domain commands impose sign-specific rules.",
  },
);
export type Money = Type.Static<typeof MoneySchema>;
