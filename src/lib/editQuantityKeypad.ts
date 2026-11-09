/** Calculator-key input shared by the compact Scan Items transaction editor.
 * Does not evaluate expressions; the existing quantity evaluator validates them at save time.
 */
export const nextEditQuantityKey = (current: string, key: string, replaceInitial = false): string => {
  if (key === "clear") return "";
  if (key === "backspace") return current.slice(0, -1);
  const digit = key === "×" ? "*" : key === "÷" ? "/" : key;
  if (!/^(?:\d|\.|[+\-*/])$/.test(digit)) return current;
  if (/[+\-*/]/.test(digit)) {
    if (!current) return "";
    if (/[+\-*/]$/.test(current)) return current.slice(0, -1) + digit;
    if (current.endsWith(".")) return current;
    return current + digit;
  }
  const base = replaceInitial ? "" : current;
  const term = base.split(/[+\-*/]/).pop() || "";
  if (digit === ".") {
    if (term.includes(".")) return base;
    return term ? base + "." : base + "0.";
  }
  if (!base || base === "0") return digit;
  return base + digit;
};
