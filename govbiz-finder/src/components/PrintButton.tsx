"use client";
export function PrintButton() {
  return <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()}>인쇄</button>;
}
