import type { Metadata } from "next";
import Link from "next/link";

import { PUBLIC_NOTICE } from "../../../lib/public-notice";

export const metadata: Metadata = {
  title: "Privacy notice | Lead Agent Staging",
  description: "Data handling and privacy contact for invited Lead Agent Staging tests.",
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return (
    <article>
      <p className="eyebrow">{PUBLIC_NOTICE.projectName}</p>
      <h1>Privacy notice</h1>
      <p>
        Lead Agent Staging is a development and testing project for business messaging, lead
        qualification and staff-reviewed appointment requests. This notice covers the staging
        service and its enabled messaging and website integrations.
      </p>
      <p>
        Testing is limited to invited participants using synthetic business scenarios. Do not send
        real customer records, medical information, identity documents, payment details or account
        credentials. Public customer onboarding is not available while launch and retention
        arrangements remain under review.
      </p>

      <h2>Information processed</h2>
      <ul>
        <li>
          Messaging account and sender identifiers, message identifiers and delivery timestamps
          needed to route messages and prevent duplicate processing.
        </li>
        <li>
          For conversations admitted to business processing: message text, replies, voluntarily
          supplied contact details, qualification information, appointment preferences and staff
          actions.
        </li>
        <li>
          Staff identity, organization membership and session information needed to authenticate
          staff and restrict access.
        </li>
        <li>
          Operational metadata used for reliability, security, abuse prevention and cost
          measurement. Hosting and integration providers may also process network and device
          information when you access their services.
        </li>
      </ul>
      <p>
        A newly encountered social messaging thread does not automatically enter business
        automation. Uncertain or excluded threads are acknowledged without creating a business
        conversation or sending their message text to the AI provider. A limited protected thread
        reference is used to remember eligibility.
      </p>

      <h2>Purpose and access</h2>
      <p>
        Information is used to test and operate messaging, answer business questions, qualify
        enquiries, prepare appointment requests, support human review and protect the service.
        Access is restricted to authorized staff for the relevant organization and authorized
        operators for maintenance. Appointment requests require staff review and customer
        confirmation.
      </p>
      <p>
        The application does not automatically copy customer conversations into model training or
        evaluation datasets. Its ordinary application logs and metrics exclude message text, raw AI
        prompts and responses, and credentials.
      </p>

      <h2>Service providers and AI</h2>
      <ul>
        <li>Google Cloud hosts the staging application, database and operational services.</li>
        <li>Auth0 provides staff authentication.</li>
        <li>
          Meta/Instagram handles Instagram messaging. Telegram handles Telegram messaging when that
          integration is enabled. Each provider also handles information in its own service.
        </li>
        <li>
          When AI processing is enabled for an eligible conversation, selected conversation context
          and approved business information are sent to Google&apos;s paid Gemini API to generate a
          proposed response or decision.
        </li>
      </ul>
      <p>
        Google&apos;s <a href="https://ai.google.dev/gemini-api/terms">Gemini API terms</a> state
        that paid-service prompts and responses are not used to improve its products. Google may
        retain them for abuse monitoring and required disclosures. Processing may occur outside your
        country. This service does not promise zero provider retention or that all processing occurs
        in one country.
      </p>

      <h2>Storage and retention</h2>
      <p>
        Stored conversation content and protected customer identifiers use encryption and
        organization-scoped access controls. Operational records and backups may remain after a
        conversation ends. Final retention periods for a customer launch have not been approved;
        this notice does not present engineering planning periods as active retention guarantees.
        Contact us for the status and scope of data held from a staging test.
      </p>

      <h2>Cookies and sessions</h2>
      <p>
        Staff sign-in uses session and request-protection cookies. Enabled website messaging uses
        temporary session grants and tokens to maintain a conversation. These public notice pages do
        not require staff sign-in and add no advertising or analytics trackers.
      </p>

      <h2>Contact, access and deletion requests</h2>
      <p>
        Send privacy, access, correction or deletion requests to{" "}
        <a href={`mailto:${PUBLIC_NOTICE.contactEmail}`}>{PUBLIC_NOTICE.contactEmail}</a>. We may
        need to verify your connection to the account or test conversation before disclosing or
        changing information. See our <Link href="/data-deletion">data-deletion instructions</Link>{" "}
        for what to include.
      </p>

      <h2>Updates</h2>
      <p>
        This notice will be updated when the service, public contact details or operating
        arrangements change. The last-updated date appears below.
      </p>
    </article>
  );
}
