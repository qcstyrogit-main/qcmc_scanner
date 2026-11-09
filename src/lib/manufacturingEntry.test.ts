import { describe, expect, it } from "vitest";
import { resolveManufacturingEntryStage } from "@/lib/manufacturingEntry";

describe("resolveManufacturingEntryStage", () => {
  it("opens each Receive Finished Goods role directly", () => {
    expect(resolveManufacturingEntryStage("pullout", false)).toBe("receive");
    expect(resolveManufacturingEntryStage("checker", true)).toBe("batch");
    expect(resolveManufacturingEntryStage("checker", false)).toBe("checker-handover-scan");
    expect(resolveManufacturingEntryStage("picker", false)).toBe("picker-scan");
  });

  it("keeps the role menu when no direct role is requested", () => {
    expect(resolveManufacturingEntryStage(undefined, true)).toBe("menu");
  });
});
