import type { ViewType } from "@/types";

export const AUTH_NAV_ITEMS = [
  { id: "inventory", label: "Inventory" },
  { id: "delivery", label: "Delivery" },
  { id: "transactions", label: "Transactions" },
  { id: "profile", label: "Profile" },
] as const;

export const authenticatedViewIsInventory = (view: ViewType) =>
  ["dashboard", "location_transfer", "job_card_time"].includes(view);

export const INVENTORY_OPERATIONS = [
  { id: "pullout", label: "Pullout", description: "Create draft stock entries", accent: "blue" },
  { id: "checker", label: "Checker", description: "Verify picked items", accent: "blue" },
  { id: "picker", label: "Picker", description: "Allocate storage locations", accent: "blue" },
  { id: "physical-count", label: "Physical count", description: "Audit actual stock", accent: "purple" },
  { id: "issue-stock", label: "Issue stock", description: "Remove stock from storage", accent: "orange" },
  { id: "transfer-location", label: "Transfer location", description: "Move stock between locations", accent: "orange" },
] as const;
