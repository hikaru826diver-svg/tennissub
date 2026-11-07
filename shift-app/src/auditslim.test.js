import { describe, expect, it } from "vitest";
import { auditSlim } from "./utils.js";
import { describeAudit } from "./pages/admin/AuditLog.jsx";

const staffName = (id) => ({ s1: "佐藤" }[id] || "?");
const deptName = (id) => ({ d1: "フロント" }[id] || "");
const shift = { id: "sh1", facilityId: "fa", staffId: "s1", deptId: "d1", date: "2026-12-05", start: "09:00", end: "17:00", breakMin: 60,
  breaks: [{ start: "12:00", end: "13:00" }], tasks: [{ start: "09:00", end: "10:00", label: "受付" }], memo: "鍵当番", fromRequestId: "rq1" };

describe("操作履歴を軽くする", () => {
  it("追加：内容がわかる項目だけ", () => {
    const s = auditSlim(null, shift);
    expect(s.before).toBeNull();
    expect(s.after).toEqual({ staffId: "s1", deptId: "d1", date: "2026-12-05", start: "09:00", end: "17:00" });
    expect(describeAudit({ kind: "shift", action: "insert", ...s }, staffName, deptName)).toBe("佐藤 12/5(土) フロント 09:00〜17:00");
  });
  it("変更：内容がわかる項目＋変わった項目だけ", () => {
    const s = auditSlim(shift, { ...shift, end: "18:00", memo: "" });
    expect(s.before).toEqual({ staffId: "s1", deptId: "d1", date: "2026-12-05", start: "09:00", end: "17:00", memo: "鍵当番" });
    expect(s.after).toEqual({ staffId: "s1", deptId: "d1", date: "2026-12-05", start: "09:00", end: "18:00", memo: "" });
    const t = describeAudit({ kind: "shift", action: "update", ...s }, staffName, deptName);
    expect(t).toBe("佐藤 12/5(土) フロント：時間 09:00〜17:00 → 09:00〜18:00／メモ 鍵当番 → なし");
  });
  it("削除：削除前の内容をすべて（ID などは除く）", () => {
    const s = auditSlim(shift, null);
    expect(s.after).toBeNull();
    expect(s.before.tasks).toHaveLength(1);
    expect(s.before.id).toBeUndefined();
    expect(s.before.facilityId).toBeUndefined();
  });
  it("スタッフの時給変更", () => {
    const st = { id: "s1", name: "佐藤", wage: 1100, transport: 300, deptIds: ["d1"], note: "長い備考".repeat(20) };
    const s = auditSlim(st, { ...st, wage: 1150 });
    expect(s.after).toEqual({ name: "佐藤", wage: 1150 });
    expect(describeAudit({ kind: "staff", action: "update", ...s }, staffName, deptName)).toBe("佐藤：時給 ¥1,100 → ¥1,150");
  });
});
