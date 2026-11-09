import { describe, expect, it } from "vitest";
import { AUTH_NAV_ITEMS, authenticatedViewIsInventory, INVENTORY_OPERATIONS } from "@/lib/authenticatedUi";

describe("authenticated UI contract", () => {
  it("defines the requested navigation destinations in order", () => {
    expect(AUTH_NAV_ITEMS.map((item) => item.label)).toEqual(["Inventory", "Delivery", "Transactions", "Profile"]);
  });

  it("treats inventory workflow views as Inventory", () => {
    expect(authenticatedViewIsInventory("dashboard")).toBe(true);
    expect(authenticatedViewIsInventory("location_transfer")).toBe(true);
    expect(authenticatedViewIsInventory("history")).toBe(false);
  });

  it("keeps every inventory operation unique and readable", () => {
    expect(INVENTORY_OPERATIONS.map((item) => item.label)).toEqual([
      "Pullout", "Checker", "Picker", "Physical count", "Issue stock", "Transfer location",
    ]);
    expect(new Set(INVENTORY_OPERATIONS.map((item) => item.label)).size).toBe(INVENTORY_OPERATIONS.length);
    expect(INVENTORY_OPERATIONS.every((item) => item.description.trim().length > 0)).toBe(true);
  });
});
