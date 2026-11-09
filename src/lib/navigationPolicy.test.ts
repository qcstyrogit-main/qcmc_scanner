import { describe, expect, it } from "vitest";
import { shouldShowBottomNavigation } from "@/lib/navigationPolicy";

describe("shouldShowBottomNavigation", () => {
  it("keeps navigation visible throughout inventory scanner modules", () => {
    expect(shouldShowBottomNavigation("scan")).toBe(true);
    expect(shouldShowBottomNavigation("location_transfer")).toBe(true);
    expect(shouldShowBottomNavigation("dashboard")).toBe(true);
    expect(shouldShowBottomNavigation("history")).toBe(true);
    expect(shouldShowBottomNavigation("settings")).toBe(true);
  });
});
