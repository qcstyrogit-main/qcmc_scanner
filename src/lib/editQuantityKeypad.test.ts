import { describe, expect, it } from "vitest";
import { nextEditQuantityKey } from "@/lib/editQuantityKeypad";

describe("Edit Quantity keypad", () => {
  it("replaces the initially displayed quantity on first numeric tap", () => {
    expect(nextEditQuantityKey("12", "7", true)).toBe("7");
    expect(nextEditQuantityKey("12", ".", true)).toBe("0.");
    expect(nextEditQuantityKey("12", "+", true)).toBe("12+");
  });
  it("supports digits, decimal and basic arithmetic matching the Quantity calculator", () => {
    expect(nextEditQuantityKey("12", "3")).toBe("123");
    expect(nextEditQuantityKey("12", ".")).toBe("12.");
    expect(nextEditQuantityKey("12.", ".")).toBe("12.");
    expect(nextEditQuantityKey("12+", ".")).toBe("12+0.");
    expect(nextEditQuantityKey("12+", "÷")).toBe("12/");
    expect(nextEditQuantityKey("12", "×")).toBe("12*");
    expect(nextEditQuantityKey("12", "÷")).toBe("12/");
    expect(nextEditQuantityKey("12", "+")).toBe("12+");
    expect(nextEditQuantityKey("12+", "4")).toBe("12+4");
  });
  it("handles Clear, Backspace, incomplete operations and invalid key codes", () => {
    expect(nextEditQuantityKey("23.5", "clear")).toBe("");
    expect(nextEditQuantityKey("23.5", "backspace")).toBe("23.");
    expect(nextEditQuantityKey("", "backspace")).toBe("");
    expect(nextEditQuantityKey("", "+")).toBe("");
    expect(nextEditQuantityKey("12.", "-")).toBe("12.");
    expect(nextEditQuantityKey("12", "ENTER")).toBe("12");
  });
});
