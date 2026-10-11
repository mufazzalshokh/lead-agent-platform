import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CopyWidgetCodeButton } from "./CopyWidgetCodeButton";

const renderControl = () =>
  renderToStaticMarkup(
    createElement(CopyWidgetCodeButton, {
      apiOrigin: "https://platform.example",
      configuration: {
        publishableKey: "a".repeat(43),
        websiteOrigin: "https://clinic.example",
      },
    }),
  );

describe("installation-code copy control", () => {
  it("keeps the original visible action label before the small trailing icon", () => {
    const markup = renderControl();
    const contents = /<button\b[^>]*>([\s\S]*?)<\/button>/u.exec(markup)?.[1];
    if (contents === undefined) throw new Error("Copy action is missing");
    expect(contents).toContain('<span class="copy-code-label">Copy installation code</span>');
    expect(contents.indexOf("Copy installation code")).toBeLessThan(contents.indexOf("<svg"));
    expect(contents).toMatch(/<svg[^>]*width="16"[^>]*height="16"/u);
    expect(contents).toMatch(/<svg[^>]*aria-hidden="true"/u);
  });

  it("retains an accessible button and live feedback without submitting a form", () => {
    const markup = renderControl();
    expect(markup).toMatch(/<button[^>]*type="button"/u);
    expect(markup).toContain('aria-label="Copy installation code"');
    const descriptionId = /aria-describedby="([^"]+)"/u.exec(markup)?.[1];
    if (descriptionId === undefined) throw new Error("Copy feedback is not associated");
    expect(markup).toContain(`id="${descriptionId}" role="tooltip" aria-live="polite"`);
    expect(markup).toContain('data-copy-state="idle"');
    expect(markup).not.toContain("a".repeat(43));
  });

  it("allows the label to determine width instead of boxing the icon into a square", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const buttonRule = /\.copy-code-button\s*\{([^}]+)\}/u.exec(css)?.[1];
    if (buttonRule === undefined) throw new Error("Copy layout is missing");
    expect(buttonRule).toContain("min-height: 2.75rem");
    expect(buttonRule).toContain("gap: 0.5rem");
    expect(buttonRule).not.toMatch(/(?:^|[;\s])(?:width|height|flex):/u);
    expect(css).toMatch(/\.copy-code-icon\s*\{\s*flex: 0 0 1rem;/u);
    const tooltipRule = /\.copy-code-tooltip\s*\{([^}]+)\}/u.exec(css)?.[1];
    expect(tooltipRule).toContain("right: 0.8rem");
    expect(tooltipRule).not.toMatch(/(?:^|[;\s])left:/u);
  });
});
