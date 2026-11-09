export type ManufacturingRole = "pullout" | "checker" | "picker";
export type ManufacturingEntryStage = "menu" | "receive" | "batch" | "checker-handover-scan" | "picker-scan";

export const resolveManufacturingEntryStage = (
  role: ManufacturingRole | undefined,
  hasLocalHandover: boolean,
): ManufacturingEntryStage => {
  if (role === "pullout") return "receive";
  if (role === "checker") return hasLocalHandover ? "batch" : "checker-handover-scan";
  if (role === "picker") return "picker-scan";
  return "menu";
};
