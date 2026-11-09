import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("../components/ScanPage.tsx", import.meta.url), "utf8");
const start = src.indexOf("const confirmQuantity = ");
const end = src.indexOf("const enterQuantityKey = ", start);
const confirm = src.slice(start, end);

describe("Physical Count recount quantity package breakdown", () => {
  it("retains each tab's quantity after Big Pack → Loose Pack → Big Pack → Loose Pack", () => {
    const switchStart = src.indexOf("const selectQuantityPackageStatus = ");
    const switchEnd = src.indexOf("const activeStep =", switchStart);
    const switchLogic = src.slice(switchStart, switchEnd);
    expect(src).toContain('const [retainedLoosePackExpression, setRetainedLoosePackExpression] = React.useState("")');
    expect(switchLogic).toContain('if (status === packageStatus) return');
    expect(switchLogic).toContain('setRetainedBigPackExpression(scanValue)');
    expect(switchLogic).toContain('setScanValue(retainedLoosePackExpression || "0")');
    expect(switchLogic).toContain('setRetainedLoosePackExpression(scanValue)');
    expect(switchLogic).toContain('setScanValue(retainedBigPackExpression || "0")');
    expect(src).toContain('setRetainedLoosePackExpression(recounting && oldLooseUnits > 0 ? String(oldLooseUnits) : "")');
    expect(src).toContain('setRetainedLoosePackExpression(restored.status === "OPENED" ? restored.count : "")');
    expect(src).toContain('setRetainedLoosePackExpression("")');
  });

  it("saves the combined count even when OK is pressed on Big Pack after Loose Pack entry", () => {
    expect(confirm).toContain('packageStatus === "OPENED" || retainedLoosePackExpression.trim()');
    expect(confirm).toContain('evaluateQuantityExpression(retainedLoosePackExpression || "0", true)');
    expect(confirm).toContain('(bigPackCount * pendingItem.qrQuantity) + loosePackQuantity');
    expect(src).toContain('packageBreakdown && packageBreakdown.loosePackQuantity > 0 ? "OPENED" : packageStatus');
    expect(src).toContain('quantityPreview + retainedLoosePackUnits');
    expect(confirm).toContain('if (packageStatus === "COMPLETE" && loosePackQuantity === 0)');
  });


  it("allows OK for 0 Big Packs by permitting zero in both preview and submit validation", () => {
    expect(confirm).toContain("const calculatedValue = evaluateQuantityExpression(value, true);");
    expect(src).toContain("const calculatedInput = evaluateQuantityExpression(scanValue, true);");
    expect(src).toContain('packageStatus === "COMPLETE" && calculatedInput === 0');
    expect(src).toContain('disabled={Boolean(packageQuantityError)}');
    expect(confirm).toContain('setPackageStatus("OPENED")');
    expect(confirm).toContain('evaluateQuantityExpression(retainedBigPackExpression, true)');
    expect(confirm).toContain('totalPhysicalQuantity <= 0');
  });


  it("accepts zero Big Pack as a loose-only intermediate value but rejects a zero combined count", () => {
    expect(confirm).toContain('packageStatus === "COMPLETE" && calculatedValue === 0');
    expect(confirm).toContain('setRetainedBigPackExpression("0")');
    expect(confirm).toContain('setPackageStatus("OPENED")');
    expect(confirm).toContain('totalPhysicalQuantity <= 0');
    expect(confirm).toContain('Big Pack must be zero or greater.');
    expect(src).toContain('packageStatus === "COMPLETE" && calculatedInput === 0');
  });

  it("multiplies Big Pack by the current QR per-pack quantity and adds Loose Pack", () => {
    expect(confirm).toContain("(bigPackCount * pendingItem.qrQuantity) + loosePackQuantity");
    expect(confirm).toContain("processScan(String(totalPhysicalQuantity), { bigPackCount, loosePackQuantity })");
  });
  it("keeps Big Pack multiplier when no Loose Pack is entered", () => {
    expect(confirm).toContain("processScan(String(calculatedValue), { bigPackCount: calculatedValue, loosePackQuantity: 0 })");
    expect(src).toContain("calculatePhysicalPackage({");
    expect(src).toContain("qrQuantity: pendingItem.qrQuantity");
  });
  it("uses the existing saved pack size when a generic recount scan reads one unit", () => {
    expect(src).toContain('recountingItem && existingBaseline');
    expect(src).toContain('effectiveQrQuantity = existingBaseline.qrQuantity');
  });
  it("prefills recount from the saved effective inventory tag quantity instead of defaulting to one", () => {
    expect(src).toContain("previousRecountQuantity = existingCount ? getPcountInventoryTagEffectiveCount(existingCount, tag) : null");
    expect(src).toContain("Math.floor((previousRecountQuantity + 1e-8) / packSize)");
    expect(src).toContain('setPackageStatus(recounting && oldLooseUnits > 0 ? "OPENED" : "COMPLETE")');
    expect(src).toContain("setRetainedBigPackExpression(recounting && oldLooseUnits > 0 ? String(oldBigPacks) : \"\")");
    expect(src).toContain("oldLooseUnits > 0 ? oldLooseUnits : oldBigPacks");
  });
  it("preserves recount replacement rather than additive original count", () => {
    expect(src).toContain('activeGroupId?.startsWith("recount-")');
    expect(src).toContain("const correctionDelta =");
  });
});