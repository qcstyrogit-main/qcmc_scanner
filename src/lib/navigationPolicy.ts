import type { ViewType } from "@/types";

export const shouldShowBottomNavigation = (_view: ViewType) => true;

export const isInventoryView = (view: ViewType) =>
  ["dashboard", "scan", "location_transfer", "job_card_time"].includes(view);
