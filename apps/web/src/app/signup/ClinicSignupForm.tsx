"use client";

import {
  StaffSignupInputSchema,
  StaffStepUpNavigationSchema,
  isSchemaValue,
} from "@lead-agent/contracts";
import { useState, type SubmitEvent } from "react";

import { readFormText } from "../../lib/staff-clinic-configuration";

export function ClinicSignupForm({ apiOrigin }: Readonly<{ apiOrigin: string }>) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const details = {
      display_name: readFormText(form, "display_name"),
      default_locale: form.get("default_locale"),
      default_time_zone: readFormText(form, "default_time_zone"),
    };
    if (!isSchemaValue(StaffSignupInputSchema, details)) {
      setMessage("Enter a clinic name and an IANA time zone such as Asia/Tashkent or UTC.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`${apiOrigin}/v1/staff/auth/signup`, {
        body: JSON.stringify(details),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data: unknown = response.ok ? await response.json() : null;
      if (!isSchemaValue(StaffStepUpNavigationSchema, data)) {
        throw new Error("Missing registration navigation");
      }
      const destination = new URL(data.authorization_url);
      if (destination.protocol !== "https:" || destination.username || destination.password) {
        throw new Error("Invalid registration navigation");
      }
      window.location.assign(destination.href);
    } catch {
      setMessage("We could not start registration. Please try again.");
      setPending(false);
    }
  };

  return (
    <form className="clinic-signup-form" method="post" onSubmit={(event) => void submit(event)}>
      <label>
        Clinic name
        <input name="display_name" maxLength={200} required />
      </label>
      <label>
        Default customer language
        <select name="default_locale" required defaultValue="en">
          <option value="en">English</option>
          <option value="ru">Русский</option>
          <option value="uz">Oʻzbekcha</option>
        </select>
      </label>
      <label>
        Clinic time zone
        <input name="default_time_zone" placeholder="Asia/Tashkent" maxLength={255} required />
      </label>
      {message === null ? null : <p role="alert">{message}</p>}
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? "Opening secure registration…" : "Continue to account verification"}
      </button>
    </form>
  );
}
