import Type from "typebox";

import { embedSchemaAs } from "../configuration/internal.js";
import { IanaTimeZoneSchema, type IanaTimeZone } from "../configuration/primitives.js";
import { LocaleSchema, type Locale } from "../shared/localization.js";

export const StaffSignupInputSchema = Type.Object(
  {
    display_name: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: "^(?=.*\\S)[^\\u0000-\\u001f\\u007f]+$",
    }),
    default_locale: embedSchemaAs<Locale>(LocaleSchema),
    default_time_zone: embedSchemaAs<IanaTimeZone>(IanaTimeZoneSchema),
  },
  { $id: "StaffSignupInput.v1", additionalProperties: false },
);

export type StaffSignupInput = Type.Static<typeof StaffSignupInputSchema>;
