import { describe, expect, it } from "vitest";
import { aggregate, calcPayroll, legalBreak, shiftFromRequest } from "./utils.js";

const staff = { a: { id: "a", wage: 1000, transport: 300 } };
const S = (o) => ({ id: Math.random().toString(), staffId: "a", deptId: "d1", date: "2026-12-01", breakMin: 0, ...o });

describe("legalBreak", () => {
  it("6h以下は0、6h超45分、8h超60分", () => {
    expect(legalBreak(360)).toBe(0);
    expect(legalBreak(361)).toBe(45);
    expect(legalBreak(480)).toBe(45);
    expect(legalBreak(481)).toBe(60);
  });
});

describe("calcPayroll", () => {
  it("基本給と交通費", () => {
    const [r] = calcPayroll([S({ start: "09:00", end: "13:00" })], staff);
    expect(r.workMin).toBe(240);
    expect(r.basePay).toBe(4000);
    expect(r.transport).toBe(300);
    expect(r.total).toBe(4300);
  });
  it("休憩控除と8時間超の時間外割増", () => {
    const [r] = calcPayroll([S({ start: "09:00", end: "19:00", breakMin: 60 })], staff);
    expect(r.workMin).toBe(540);
    expect(r.otMin).toBe(60);
    expect(r.otPay).toBe(250);
    expect(r.wagePay).toBe(9250);
  });
  it("同日の複数シフト（部門横断）で時間外を判定し交通費は1回", () => {
    const rows = calcPayroll([S({ start: "09:00", end: "15:00" }), S({ deptId: "d2", start: "15:00", end: "19:00" })], staff);
    const d2 = rows.find((r) => r.deptId === "d2");
    expect(d2.otMin).toBe(120);
    expect(rows.reduce((s, r) => s + r.transport, 0)).toBe(300);
  });
  it("深夜割増（22時以降）", () => {
    const [r] = calcPayroll([S({ start: "18:00", end: "23:00" })], staff);
    expect(r.nightMin).toBe(60);
    expect(r.nightPay).toBe(250);
  });
  it("割増OFF設定", () => {
    const [r] = calcPayroll([S({ start: "14:00", end: "24:00" })], staff, { overtimePremium: false, nightPremium: false });
    expect(r.wagePay).toBe(10000);
  });
  it("集計", () => {
    const rows = calcPayroll([S({ start: "09:00", end: "13:00" }), S({ date: "2026-12-02", start: "09:00", end: "13:00" })], staff);
    const t = aggregate(rows, () => "t").t;
    expect(t.days.size).toBe(2);
    expect(t.total).toBe(8600);
  });
});

describe("休憩時間帯", () => {
  it("時間帯で登録した休憩を控除し breakMin と同期", async () => {
    const { withBreaks } = await import("./utils.js");
    const sh = withBreaks(S({ start: "09:00", end: "18:00" }), [{ start: "12:00", end: "12:30" }, { start: "12:15", end: "13:00" }, { start: "08:00", end: "08:30" }]);
    expect(sh.breaks).toEqual([{ start: "12:00", end: "13:00" }]);
    expect(sh.breakMin).toBe(60);
    const [r] = calcPayroll([sh], staff);
    expect(r.workMin).toBe(480);
  });
  it("深夜帯の休憩は深夜時間から控除", async () => {
    const { withBreaks } = await import("./utils.js");
    const sh = withBreaks(S({ start: "17:00", end: "24:00" }), [{ start: "22:00", end: "22:30" }]);
    const [r] = calcPayroll([sh], staff);
    expect(r.workMin).toBe(390);
    expect(r.nightMin).toBe(90);
  });
  it("自動配置は中央付近", async () => {
    const { autoPlaceBreak } = await import("./utils.js");
    expect(autoPlaceBreak({ start: "09:00", end: "18:00" }, 60)).toEqual([{ start: "13:00", end: "14:00" }]);
  });
});

describe("shiftFromRequest", () => {
  it("法定休憩を自動設定", () => {
    const s = shiftFromRequest({ id: "r", staffId: "a", deptId: "d", date: "2026-12-01", start: "09:00", end: "18:00" }, { autoBreak: true });
    expect(s.breakMin).toBe(60);
    expect(s.fromRequestId).toBe("r");
  });
});
