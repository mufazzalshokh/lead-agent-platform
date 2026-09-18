import {
  StaffWorkItemSchema,
  isSchemaValue,
  type StaffWorkItem,
} from "../../packages/contracts/src/index.js";
const id = "0199f1a8-7f65-7c28-a434-a10796c49001";
const value: unknown = {
  id,
  kind: "appointment_request",
  status: "requested",
  version: 1,
  actionable: true,
  activity_at: "2026-09-18T08:00:00.000Z",
  conversation_id: null,
  contact_id: null,
  lead_id: null,
  channel_connection_id: null,
  location_id: null,
  service_id: null,
  assigned_membership_id: null,
  conversation_version: null,
  handoff_id: null,
  handoff_status: null,
  appointment_request_id: id,
  appointment_status: "requested",
  preferences: [],
  start_at: null,
  end_at: null,
  recipient_read_at: null,
  acknowledgment_supported: false,
};
if (!isSchemaValue(StaffWorkItemSchema, value)) throw new TypeError("Invalid S17 work fixture");
export const staffWorkFixture: StaffWorkItem = value;
