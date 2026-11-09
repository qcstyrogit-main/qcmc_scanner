import { describe, expect, it } from "vitest";
import { parseEmployeeScan, parseJobCardPackingQr } from "@/lib/jobCardTimeService";

describe("Job Card scanner QR parsing", () => {
  it("uses the fifth packing QR value as the Job Card ID", () => {
    expect(parseJobCardPackingQr("EIEHB1BL50;20;PC;MFG-WO-2026-00028;PO-JOB00022")).toEqual({
      itemCode: "EIEHB1BL50",
      quantity: 20,
      uom: "PC",
      workOrderId: "MFG-WO-2026-00028",
      jobCardId: "PO-JOB00022",
    });
  });

  it("rejects an item barcode without a Job Card value", () => {
    expect(parseJobCardPackingQr("EIEHB1BL50;20;PC;545654")).toBeNull();
  });

  it("accepts a bare Job Card ID from older ERP labels", () => {
    expect(parseJobCardPackingQr("PO-JOB00022\r\n")?.jobCardId).toBe("PO-JOB00022");
  });

  it("accepts JSON and ERP desk Job Card URLs", () => {
    expect(parseJobCardPackingQr('{"doctype":"Job Card","name":"PO-JOB00022"}')?.jobCardId).toBe("PO-JOB00022");
    expect(parseJobCardPackingQr("https://erp.example/app/job-card/PO-JOB00022")?.jobCardId).toBe("PO-JOB00022");
  });

  it("accepts employee IDs from plain text and JSON", () => {
    expect(parseEmployeeScan("HR-EMP-00312")).toBe("HR-EMP-00312");
    expect(parseEmployeeScan('{"type":"employee","employee_id":"HR-EMP-00312"}')).toBe("HR-EMP-00312");
  });
});
