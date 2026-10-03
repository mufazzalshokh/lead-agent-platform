import { StaffWorkspace } from "./StaffWorkspace";
import { readInstagramCallbackResult, readStaffAuthRecovery } from "../../lib/staff-ui";

export const dynamic = "force-dynamic";

export default async function StaffPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>> }>) {
  const query = await searchParams;
  const organization = query["organization"];
  return (
    <StaffWorkspace
      apiOrigin={process.env["NEXT_PUBLIC_API_ORIGIN"] ?? ""}
      initialAuthRecovery={readStaffAuthRecovery(query["auth"])}
      initialInstagramResult={readInstagramCallbackResult(query["integration"], query["result"])}
      initialOrganization={typeof organization === "string" ? organization : null}
    />
  );
}
