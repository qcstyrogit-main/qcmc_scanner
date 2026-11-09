/**
 * Safe arithmetic for QCMC scanner quantity inputs.
 *
 * Default is the original scanner behavior: a positive result is required.
 * The Edit Quantity & Inv Tag dialog may pass allowZero=true for a single
 * Big Pack or Loose Pack component so an untouched component can be zero.
 */
export const evaluateQuantityExpression = (raw: string, allowZero = false): number => {
  const expression = raw.replace(/,/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/\s+/g, "");
  if (!expression) throw new Error("Enter a quantity.");
  if (!/^\d*\.?\d+(?:[+\-*/]\d*\.?\d+)*$/.test(expression)) {
    throw new Error("Complete the calculation before saving.");
  }

  const numbers = expression.split(/[+\-*/]/).map(Number);
  const operators = expression.match(/[+\-*/]/g) || [];
  if (numbers.some((value) => !Number.isFinite(value))) throw new Error("Invalid calculation.");

  const reducedNumbers = [numbers[0]];
  const reducedOperators: string[] = [];
  for (let i = 0; i < operators.length; i += 1) {
    const operator = operators[i];
    const next = numbers[i + 1];
    if (operator === "*" || operator === "/") {
      const current = reducedNumbers.pop()!;
      if (operator === "/" && next === 0) throw new Error("Cannot divide by zero.");
      reducedNumbers.push(operator === "*" ? current * next : current / next);
    } else {
      reducedOperators.push(operator);
      reducedNumbers.push(next);
    }
  }

  let result = reducedNumbers[0];
  for (let i = 0; i < reducedOperators.length; i += 1) {
    result = reducedOperators[i] === "+"
      ? result + reducedNumbers[i + 1]
      : result - reducedNumbers[i + 1];
  }

  if (!Number.isFinite(result) || result < 0 || (!allowZero && result === 0)) {
    throw new Error(allowZero ? "Result cannot be negative." : "Result must be greater than 0.");
  }
  return result;
};
