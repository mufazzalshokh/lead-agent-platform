import Type from "typebox";

import { withoutSchemaId } from "../api/embedding.js";
import {
  LocationIdSchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  RequestIdSchema,
  UserIdSchema,
} from "../shared/identifiers.js";

const embed = <Schema extends Type.TSchema>(schema: Schema) => withoutSchemaId(schema);

export const StaffMeSchema = Type.Object(
  {
    active_organization: Type.Object(
      {
        allowed_location_ids: Type.Array(embed(LocationIdSchema), {
          maxItems: 500,
          uniqueItems: true,
        }),
        location_scope: Type.Union([Type.Literal("all"), Type.Literal("restricted")]),
        membership_id: embed(MembershipIdSchema),
        organization_id: embed(OrganizationIdSchema),
        role: Type.Union([
          Type.Literal("owner"),
          Type.Literal("admin"),
          Type.Literal("staff"),
          Type.Literal("analyst"),
        ]),
        sensitive_fields_visible: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    user_id: embed(UserIdSchema),
  },
  { $id: "StaffMe.v1", additionalProperties: false },
);
export type StaffMe = Type.Static<typeof StaffMeSchema>;

export const StaffMeResponseSchema = Type.Object(
  {
    data: embed(StaffMeSchema),
    meta: Type.Object({ request_id: embed(RequestIdSchema) }, { additionalProperties: false }),
  },
  { $id: "StaffMeResponse.v1", additionalProperties: false },
);
export type StaffMeResponse = Type.Static<typeof StaffMeResponseSchema>;
