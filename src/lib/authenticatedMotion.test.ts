import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles/authenticated-ui.css", import.meta.url), "utf8");

describe("authenticated page motion", () => {
  it("uses short page and dialog entrance animations", () => {
    expect(css).toContain("@keyframes qcmc-page-enter");
    expect(css).toContain("@keyframes qcmc-dialog-enter");
    expect(css).toMatch(/animation:\s*qcmc-page-enter\s+180ms/);
    expect(css).toMatch(/animation:\s*qcmc-dialog-enter\s+140ms/);
  });

  it("stagger-animates the inventory cards", () => {
    expect(css).toContain(".inventory-task:nth-child(2)");
    expect(css).toContain("animation-delay: 25ms");
  });

  it("turns decorative motion off when reduced motion is requested", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });
});

describe("authenticated transaction and dialog layout", () => {
  it("makes successful transaction history independently scrollable", () => {
    expect(css).toMatch(/\.transaction-success-list\s*\{[\s\S]*?flex:\s*1[\s\S]*?overflow-y:\s*auto/);
  });

  it("uses the shared blue primary treatment in scanner dialogs", () => {
    expect(css).toContain(".mfg-qty-actions button:last-child");
    expect(css).toContain(".scan-confirm-button-primary");
    expect(css).toContain("background: var(--qcmc-blue)");
  });
});
