import type { Metadata } from "next";
import Link from "next/link";

import { PUBLIC_NOTICE } from "../../../lib/public-notice";

export const metadata: Metadata = {
  title: "Data deletion | Lead Agent Staging",
  description: "How to request deletion of data held by the Lead Agent Staging project.",
  robots: { index: false, follow: true },
};

export default function DataDeletionPage() {
  return (
    <article>
      <p className="eyebrow">{PUBLIC_NOTICE.projectName}</p>
      <h1>Data-deletion instructions</h1>
      <p>
        To request deletion of information held by Lead Agent Staging, email{" "}
        <a href={`mailto:${PUBLIC_NOTICE.contactEmail}`}>{PUBLIC_NOTICE.contactEmail}</a> with the
        subject <strong>Lead Agent Staging data deletion</strong>. Requests are handled manually;
        this page does not start an automatic deletion.
      </p>

      <h2>What to include</h2>
      <ul>
        <li>The channel used: Instagram, Telegram or website messaging.</li>
        <li>
          The account username or the test conversation reference available to you, and the business
          account or test website you contacted.
        </li>
        <li>The approximate date of the interaction and the scope of your request.</li>
      </ul>
      <p>
        Do not email passwords, access tokens, payment information, medical details or copies of
        identity documents. A full transcript is not needed to start a request. If additional
        verification is necessary, we will explain the minimum information required through the
        contact address above.
      </p>

      <h2>How a request is assessed</h2>
      <p>
        We verify your connection to the relevant account or conversation, locate records within the
        appropriate organization, and assess what can be deleted or anonymized. Depending on what
        was collected, this may include contact identifiers, messages, lead details and
        appointment-request information. We respond with the outcome or any additional steps
        required. This page does not promise immediate deletion or a fixed completion time.
      </p>

      <h2>Records and backups</h2>
      <p>
        Some minimum security, audit or other records may need to be retained where applicable
        obligations require it. We explain relevant exceptions when responding. Backups are access
        restricted and are not selectively rewritten; copies age out according to the configured
        backup lifecycle. A request does not mean that every backup copy disappears immediately.
      </p>

      <h2>Disconnecting Instagram or other integrations</h2>
      <p>
        Removing an app&apos;s access in Instagram or another provider changes its authorization; it
        does not itself delete records already held by Lead Agent Staging. Send a deletion request
        separately. Deleting information from this project does not delete your Instagram or
        Telegram account, or messages held independently by those providers. Provider-side
        information is subject to each provider&apos;s own controls and policies.
      </p>

      <h2>More information</h2>
      <p>
        Read the <Link href="/privacy">privacy notice</Link> for the staging test scope, information
        processed and service providers.
      </p>
    </article>
  );
}
