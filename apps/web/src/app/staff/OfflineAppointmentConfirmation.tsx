"use client";

import { useState } from "react";
import {
  StaffAttestCustomerConfirmationInputSchema,
  StaffStepUpNavigationSchema,
  isSchemaValue,
  type StaffAppointmentConfirmation,
  type StaffAttestCustomerConfirmationInput,
} from "@lead-agent/contracts";

import type { StaffRequest } from "../../lib/staff-request";
import { readCsrfCookie } from "../../lib/staff-ui";

export function OfflineAppointmentConfirmation({
  offer,
  organizationId,
  disabled,
  request,
  recordConfirmation,
}: Readonly<{
  offer: NonNullable<StaffAppointmentConfirmation["offline_offer"]>;
  organizationId: string;
  disabled: boolean;
  request: StaffRequest;
  recordConfirmation: (input: StaffAttestCustomerConfirmationInput) => void;
}>) {
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const localFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const verify = async () => {
    setVerifying(true);
    setError(null);
    try {
      const csrf = readCsrfCookie(document.cookie);
      if (csrf === null) throw new Error("missing_csrf");
      const response = await request("/v1/staff/auth/step-up", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({
          return_to: `/staff?organization=${encodeURIComponent(organizationId)}`,
        }),
      });
      if (!response.ok) throw new Error("step_up_unavailable");
      const data: unknown = await response.json();
      if (!isSchemaValue(StaffStepUpNavigationSchema, data))
        throw new Error("invalid_step_up_navigation");
      const destination = new URL(data.authorization_url);
      if (destination.protocol !== "https:" || destination.username || destination.password)
        throw new Error("invalid_step_up_navigation");
      window.location.assign(destination.href);
    } catch {
      setError("MFA verification could not start. Refresh and try again.");
      setVerifying(false);
    }
  };
  return (
    <details className="action-box">
      <summary>Record offline customer confirmation</summary>
      <p className="help-text">
        Offer for {localFormat.format(new Date(offer.start_at))}. Record the customer’s explicit
        acceptance by phone or in person before {localFormat.format(new Date(offer.expires_at))}.
      </p>
      <button
        className="secondary-button"
        type="button"
        disabled={disabled || verifying}
        onClick={() => void verify()}
      >
        {verifying ? "Opening MFA verification…" : "Verify MFA"}
      </button>
      <p className="help-text">
        After verifying MFA, reopen this appointment to record confirmation.
      </p>
      {error !== null && <p role="alert">{error}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled || verifying) return;
          const form = new FormData(event.currentTarget);
          const actedAt = form.get("customer_acted_at");
          const date = new Date(typeof actedAt === "string" ? actedAt : "");
          const input = {
            offer_version: offer.offer_version,
            attestation_method: form.get("attestation_method"),
            customer_acted_at: Number.isFinite(date.getTime()) ? date.toISOString() : "",
            explicit_confirmation: form.get("explicit_confirmation") === "on",
          };
          if (isSchemaValue(StaffAttestCustomerConfirmationInputSchema, input)) {
            setError(null);
            recordConfirmation(input);
          } else setError("Enter the actual confirmation time and confirm what the customer said.");
        }}
      >
        <label>
          Confirmation method
          <select name="attestation_method" required defaultValue="">
            <option value="" disabled>
              Select a method
            </option>
            <option value="phone">Phone</option>
            <option value="in_person">In person</option>
          </select>
        </label>
        <label>
          Customer confirmation time ({localFormat.resolvedOptions().timeZone})
          <input name="customer_acted_at" type="datetime-local" step="1" required />
        </label>
        <label>
          <input name="explicit_confirmation" type="checkbox" required />
          The customer explicitly accepted this offered time.
        </label>
        <button className="primary-button" type="submit" disabled={disabled || verifying}>
          Record confirmation
        </button>
      </form>
    </details>
  );
}
