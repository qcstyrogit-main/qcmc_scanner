import { describe, expect, it } from "vitest";
import { getCalculatorReadout } from "../components/CalculatorReadout";

describe("Windows-style calculator readout", () => {
  it("shows the current number without history", () => {
    expect(getCalculatorReadout("193")).toEqual({ history: "", current: "193" });
    expect(getCalculatorReadout("")).toEqual({ history: "", current: "0" });
  });
  it("moves the earlier operand and operator to the small history line", () => {
    expect(getCalculatorReadout("193+")).toEqual({ history: "193 +", current: "193" });
    expect(getCalculatorReadout("193+65")).toEqual({ history: "193 +", current: "65" });
    expect(getCalculatorReadout("20*3")).toEqual({ history: "20 ×", current: "3" });
    expect(getCalculatorReadout("100/4")).toEqual({ history: "100 ÷", current: "4" });
  });
  it("shows the entire typed expression with + signs in the top history line", () => {
    expect(getCalculatorReadout("25+25+25+25")).toEqual({ history: "25 + 25 + 25 +", current: "25" });
    expect(getCalculatorReadout("25+25+25+")).toEqual({ history: "25 + 25 + 25 +", current: "25" });
    expect(getCalculatorReadout("25+25+25+25+")).toEqual({ history: "25 + 25 + 25 + 25 +", current: "25" });
    expect(getCalculatorReadout("193+65*2")).toEqual({ history: "193 + 65 ×", current: "2" });
  });
  it("does not change the original expression used for calculation", () => {
    const original = "193+65";
    getCalculatorReadout(original);
    expect(original).toBe("193+65");
  });
});
