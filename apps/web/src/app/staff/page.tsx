import { StaffWorkspace } from "./StaffWorkspace";

export const dynamic = "force-dynamic";

export default async function StaffPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>> }>) {
  const query = await searchParams;
  const organization = query["organization"];
  return (
    <StaffWorkspace
      apiOrigin={process.env["NEXT_PUBLIC_API_ORIGIN"] ?? ""}
      initialOrganization={typeof organization === "string" ? organization : null}
    />
  );
}
