import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const screen = readFileSync(new URL("../components/LocationTransferScanner.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../components/LocationTransferScanner.css", import.meta.url), "utf8");

describe("QCMC Transfer Location blue-and-white mobile UI", () => {
  it("uses the approved blue-and-white layout with the real single-item workflow", () => {
    expect(screen).toContain('className="lt-page lt-v2"');
    expect(screen).toContain('className="lt-v2-head"');
    expect(screen).toContain("Single item");
    expect(screen).toContain("Same warehouse · Online ERPNext verification");
    expect(screen).toContain('["From", "Item", "To", "Quantity", "Confirm"]');
    expect(styles).toContain("QCMC Transfer Location approved blue-and-white UI");
    expect(screen).not.toContain("Batch Transfer");
    expect(screen).not.toContain("Enter Location Manually");
  });

  it("preserves source -> item -> destination -> quantity -> review stages", () => {
    expect(screen).toContain('React.useState<Stage>("source")');
    expect(screen).toContain('stage === "source"');
    expect(screen).toContain('stage === "item"');
    expect(screen).toContain('stage === "target"');
    expect(screen).toContain('stage === "quantity"');
    expect(screen).toContain('stage === "review"');
    expect(screen).toContain('stage === "success"');
    expect(screen).toContain('Scan From Location QR');
    expect(screen).toContain('Scan Item QR');
    expect(screen).toContain('Scan To Location QR');
    expect(screen).toContain('Review Transfer Details');
  });

  it("uses validated inventory locations and real item quantities", () => {
    expect(screen).toContain("validateTransferLocation(raw)");
    expect(screen).toContain("loadSourceLocationStock(source, parseTransferItemQr(raw))");
    expect(screen).toContain("await validateTransferDestination(source, location)");
    expect(screen).toContain("source?.inventoryLocationId");
    expect(screen).toContain("target?.inventoryLocationId");
    expect(screen).toContain("item.availableQuantity.toLocaleString()");
    expect(screen).toContain("result.stockEntry");
    expect(screen).not.toContain("RM-01-01");
    expect(screen).not.toContain("RM-001");
  });

  it("keeps custom keypad and blocks invalid or excessive quantities", () => {
    expect(screen).toContain("const QuantityKeypadModal: React.FC");
    expect(screen).toContain('inputMode="none"');
    expect(screen).toContain("const error = validateTransferQuantity(quantity, item.availableQuantity, item.precision)");
    expect(screen).toContain("setQuantityModalOpen(true)");
    expect(screen).toContain("newLocationTransferRequestId()");
    expect(screen).toContain('Review Transfer');
  });

  it("keeps all transfer and ERPNext/online-only safeguards", () => {
    expect(screen).toContain("await verifyLocationTransferConnection()");
    expect(screen).toContain("LOCATION_TRANSFER_ONLINE_MESSAGE");
    expect(screen).toContain("No transfer is queued offline.");
    expect(screen).toContain("await createLocationTransfer({ item, source, target, quantity, deviceId");
    expect(screen).toContain("requestId: requestIdRef.current");
    expect(screen).toContain("if (!completed.stockEntry) throw new LocationTransferError");
    expect(screen).toContain('["STOCK_CHANGED", "INSUFFICIENT_SOURCE_QUANTITY"]');
    expect(screen).toContain("saveSuccessfulTransaction(createLocationTransferTransaction(completed))");
    expect(screen).toContain("ERPNext confirmed the Stock Entry below.");
    expect(screen).not.toContain("Saved on device for later transfer");
  });

  it("retains scan focus, Android back and convenient navigation", () => {
    expect(screen).toContain('const goBackStep = React.useCallback');
    expect(screen).toContain('CapacitorApp.addListener("backButton", goBackStep)');
    expect(screen).toContain('onClick={(event) => { event.stopPropagation(); goBackStep(); }}');
    expect(screen).toContain("const scannerActive = connected && !busy");
    expect(screen).toContain('onKeyDown={handleKey} onBlur={focusScanner}');
    expect(screen).toContain('className="lt-capture" readOnly inputMode="none"');
    expect(screen).toContain("onClick={reset}");
    expect(screen).toContain("onClick={onBack}");
  });

  it("keeps a compact responsive interface and a visible safe confirmation", () => {
    expect(styles).toContain(".lt-page.lt-v2");
    expect(styles).toContain(".lt-v2 .lt-v2-progress");
    expect(styles).toContain(".lt-v2 .lt-v2-route");
    expect(styles).toContain(".lt-v2 .lt-prompt.lt-v2-scan-prompt");
    expect(styles).toContain(".lt-v2 .lt-card.lt-v2-review");
    expect(styles).toContain("@media (max-width: 360px)");
    expect(styles).toContain("@media (max-height: 710px)");
    expect(screen).toContain("Submitting transfers stock online;");
    expect(screen).toContain('disabled={busy} onClick={() => void confirmTransfer()}');
  });
});
