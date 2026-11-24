import { ClinicSignupForm } from "./ClinicSignupForm";

export default async function SignupPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ result?: string | string[] }> }>) {
  const { result } = await searchParams;
  const message =
    result === "verify-email"
      ? "Verify your email in Auth0, then continue here with the verified account."
      : result === "account-unavailable"
        ? "This account cannot create a workspace. If you already have access, open your workspace and sign in."
        : result === "retry"
          ? "We could not finish registration. You can safely try again."
          : null;
  return (
    <main className="staff-auth-shell">
      <section className="staff-auth-card">
        <h1>Create your clinic workspace</h1>
        <p>
          After you verify your account, you can add clinic details and connect your messaging
          accounts in Integrations.
        </p>
        {message === null ? null : <p role="status">{message}</p>}
        <ClinicSignupForm apiOrigin={process.env["NEXT_PUBLIC_API_ORIGIN"] ?? ""} />
        <p>
          <a href="/staff">Back to staff sign-in</a>
        </p>
      </section>
    </main>
  );
}
