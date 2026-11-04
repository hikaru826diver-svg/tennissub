import { describe, expect, it } from "vitest";
import { describeAudit } from "./pages/admin/AuditLog.jsx";

const staffName = (id) => ({ s1: "佐藤" }[id] || "(削除済みのスタッフ)");
const deptName = (id) => ({ d1: "フロント", d2: "ジム" }[id] || "");

describe("describeAudit", () => {
  it("シフト時間・休憩の変更", () => {
    const t = describeAudit({ kind: "shift", action: "update",
      before: { staffId: "s1", deptId: "d1", date: "2026-12-05", start: "09:00", end: "13:00", breakMin: 0 },
      after: { staffId: "s1", deptId: "d1", date: "2026-12-05", start: "09:00", end: "17:00", breakMin: 60, breaks: [{ start: "12:00", end: "13:00" }] } }, staffName, deptName);
    expect(t).toContain("佐藤 12/5(土) フロント");
    expect(t).toContain("時間 09:00〜13:00 → 09:00〜17:00");
    expect(t).toContain("休憩 0分 → 12:00〜13:00");
  });
  it("時給・所属の変更", () => {
    const t = describeAudit({ kind: "staff", action: "update", before: { name: "佐藤", wage: 1100, deptIds: ["d1"] }, after: { name: "佐藤", wage: 1150, deptIds: ["d1", "d2"] } }, staffName, deptName);
    expect(t).toBe("佐藤：時給 ¥1,100 → ¥1,150／所属 フロント → フロント・ジム");
  });
  it("設定・PIN", () => {
    expect(describeAudit({ kind: "setting", action: "update", before: { requirePin: true }, after: { requirePin: false } }, staffName, deptName)).toBe("変更した項目：個人PINの必須化");
    expect(describeAudit({ kind: "pin", action: "delete", record_id: "s1" }, staffName, deptName)).toBe("佐藤 のPINを削除");
  });
});
