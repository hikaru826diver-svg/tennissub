import { describe, expect, it } from "vitest";
import { isWeakPin, pinProblem } from "./pages/admin/StaffMaster.jsx";

describe("PINのチェック", () => {
  it("推測されやすいPINを判定", () => {
    for (const p of ["0000", "1111", "1234", "9876", "123456", "87654321"]) expect(isWeakPin(p)).toBe(true);
    for (const p of ["4821", "1357", "2024", "120345", "1123"]) expect(isWeakPin(p)).toBe(false);
  });
  it("形式チェック", () => {
    expect(pinProblem("12")).toMatch("4〜8桁");
    expect(pinProblem("12a4")).toMatch("4〜8桁");
    expect(pinProblem("123456789")).toMatch("4〜8桁");
    expect(pinProblem("0000")).toMatch("推測されやすい");
    expect(pinProblem("4821")).toBe("");
  });
});
