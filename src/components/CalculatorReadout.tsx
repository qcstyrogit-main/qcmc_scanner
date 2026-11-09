import React from "react";
import "./CalculatorReadout.css";

/**
 * Windows Calculator-style readout. Keep the original expression in the
 * caller's state so its existing evaluation/validation logic is unchanged.
 * Only the latest operand is displayed large.
 */
export const getCalculatorReadout = (raw: string): { history: string; current: string } => {
  const value = String(raw || "").replace(/\*/g, "×").replace(/\//g, "÷");
  const lastOperator = Math.max(value.lastIndexOf("+"), value.lastIndexOf("-"), value.lastIndexOf("×"), value.lastIndexOf("÷"));
  if (lastOperator < 0) return { history: "", current: value || "0" };
  // Show the entered expression on the small line; keep the latest
  // operand large. This is display-only: calculation and saved values
  // continue using the caller's unchanged expression.
  const completed = value.slice(0, lastOperator + 1);
  const current = value.slice(lastOperator + 1) ||
    value.slice(0, lastOperator).split(/[+\-×÷]/).pop() || "0";
  return {
    history: completed.replace(/([+\-×÷])/g, " $1 ").replace(/\s+/g, " ").trim(),
    current,
  };
};

export const CalculatorReadout: React.FC<{ value: string; className?: string; unit?: string }> = ({ value, className = "", unit }) => {
  const display = getCalculatorReadout(value);
  return <div className={`qcmc-calculator-readout ${className}`} role="status" aria-label={`Calculator entry ${value || "0"}`}>
    <div className="qcmc-calculator-history" aria-hidden="true">{display.history || "\u00a0"}</div>
    <div className="qcmc-calculator-current">{display.current}{unit && <small> {unit}</small>}</div>
  </div>;
};
