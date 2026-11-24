"use client";

import { useEffect, useId, useState } from "react";

import { buildWidgetInstallSnippet, type WidgetManagementConfiguration } from "../../lib/staff-ui";

export function CopyWidgetCodeButton({
  apiOrigin,
  configuration,
}: Readonly<{
  apiOrigin: string;
  configuration: WidgetManagementConfiguration;
}>) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const tooltipId = useId();
  const label = status === "copied" ? "Copied" : status === "copying" ? "Copying…" : "Copy code";

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
    <span className="copy-code-control" data-copy-state={status}>
      <button
        className="ghost-button copy-code-button"
        type="button"
        disabled={status === "copying"}
        aria-busy={status === "copying"}
        aria-label={status === "copied" ? "Installation code copied" : "Copy installation code"}
        aria-describedby={tooltipId}
        onClick={() => void copy()}
      >
        <span className="copy-code-label">Copy installation code</span>
        <svg
          className="copy-code-icon"
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {status === "copied" ? (
            <path d="m5 12 4 4L19 6" />
          ) : (
            <>
              <rect x="8" y="8" width="12" height="12" rx="2" />
              <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
            </>
          )}
        </svg>
      </button>
      <span className="copy-code-tooltip" id={tooltipId} role="tooltip" aria-live="polite">
        {label}
      </span>
      {status === "failed" && (
        <span className="integration-detail" role="alert">
          Could not copy the installation code. Please try again.
        </span>
      )}
    </span>
  );
}
