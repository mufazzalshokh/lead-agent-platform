import Type from "typebox";

export const LocaleSchema = Type.Union(
  [Type.Literal("uz"), Type.Literal("ru"), Type.Literal("en")],
  {
    $id: "Locale.v1",
    description: "Supported V1 customer presentation locale.",
  },
);
export type Locale = Type.Static<typeof LocaleSchema>;
