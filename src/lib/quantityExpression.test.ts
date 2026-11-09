import { describe, expect, it } from "vitest";
import { evaluateQuantityExpression } from "@/lib/quantityExpression";
import { calculateEditedPhysicalCount } from "@/lib/editPhysicalCountBreakdown";

describe("Physical Count quantity expression zero-component regression", () => {
  it("immediately calculates 52 Big Packs while Loose Pack is still zero", () => {
    const big = evaluateQuantityExpression("52", true);
    const loose = evaluateQuantityExpression("0", true);
    expect(calculateEditedPhysicalCount(1000, big, loose).total).toBe(52000);
  });

  it("adds loose pieces when entered, without requiring a tab switch", () => {
    const big = evaluateQuantityExpression("52", true);
    const loose = evaluateQuantityExpression("25", true);
    expect(calculateEditedPhysicalCount(1000, big, loose).total).toBe(52025);
  });

  it("allows zero Big Packs for a Loose-only count", () => {
    const big = evaluateQuantityExpression("0", true);
    const loose = evaluateQuantityExpression("25", true);
    expect(calculateEditedPhysicalCount(1000, big, loose).total).toBe(25);
  });

  it("accepts zero expressions for either component, including 0.00 and 1-1", () => {
    expect(evaluateQuantityExpression("0", true)).toBe(0);
    expect(evaluateQuantityExpression("0.00", true)).toBe(0);
    expect(evaluateQuantityExpression("1-1", true)).toBe(0);
  });

  it("keeps standard scanner Quantity strict and positive-only", () => {
    expect(evaluateQuantityExpression("52")).toBe(52);
    expect(() => evaluateQuantityExpression("0")).toThrow("greater than 0");
    expect(() => evaluateQuantityExpression("1-1")).toThrow("greater than 0");
    expect(() => evaluateQuantityExpression("-1", true)).toThrow();
  });

  it("retains normal arithmetic, precedence, decimals and divide-by-zero prevention", () => {
    expect(evaluateQuantityExpression("2+3×4")).toBe(14);
    expect(evaluateQuantityExpression("12÷3")).toBe(4);
    expect(evaluateQuantityExpression("2.5*10")).toBe(25);
    expect(evaluateQuantityExpression("1,000 + 25")).toBe(1025);
    expect(() => evaluateQuantityExpression("52+")).toThrow("Complete the calculation");
    expect(() => evaluateQuantityExpression("52/0", true)).toThrow("divide by zero");
  });
});
