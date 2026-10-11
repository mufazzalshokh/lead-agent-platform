"use client";

import { useEffect, useState } from "react";

import { buildWidgetInstallSnippet, type WidgetManagementConfiguration } from "../../lib/staff-ui";

export function CopyWidgetCodeButton({
  apiOrigin,
  configuration,
}: Readonly<{
  apiOrigin: string;
  configuration: WidgetManagementConfiguration;
}>) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");

  useEffect(() => {
    if (status !== "copied") return;
    const timeout = globalThis.setTimeout(() => setStatus("idle"), 3_000);
    return () => globalThis.clearTimeout(timeout);
  }, [status]);

  const copy = async () => {
    setStatus("copying");
    try {
      const platformOrigin = apiOrigin.length > 0 ? apiOrigin : globalThis.location.origin;
      await globalThis.navigator.clipboard.writeText(
        buildWidgetInstallSnippet(platformOrigin, configuration),
      );
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  };

  return (
    <>
      <button
        className="ghost-button"
        type="button"
        disabled={status === "copying"}
        aria-busy={status === "copying"}
        aria-live="polite"
        onClick={() => void copy()}
      >
        {status === "copied"
          ? "Copied!"
          : status === "copying"
            ? "Copying…"
            : "Copy installation code"}
      </button>
      {status === "failed" && (
        <span className="integration-detail" role="alert">
          Could not copy the installation code. Please try again.
        </span>
      )}
    </>
  );
}
