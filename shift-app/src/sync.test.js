import { describe, expect, it, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { __setSupabaseForTest, applyChanges, getBackend, windowStart } from "./store.js";

// Supabase への通信を記録し、用意した応答を返す偽の fetch
const calls = [];
let responder = () => [];
const fakeFetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  calls.push({ url: u, method: init.method || "GET" });
  const body = responder(u);
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};

let backend;
beforeAll(async () => {
  __setSupabaseForTest(createClient("https://example.supabase.co", "test-key", { global: { fetch: fakeFetch }, auth: { persistSession: false } }));
  ({ backend } = await getBackend());
});

describe("通信量を抑える読み込み", () => {
  it("Supabase 接続時は差分取得に対応したバックエンドになる", () => {
    expect(backend.name).toBe("supabase");
    expect(typeof backend.loadChanges).toBe("function");
  });

  it("初回読み込み：日付のあるデータは期間を絞る", async () => {
    calls.length = 0;
    responder = (u) => (u.includes("kind=not.in")
      ? [{ id: "s1", kind: "staff", data: { name: "佐藤" }, updated_at: "2026-11-07T01:00:00+00:00" }]
      : [{ id: "sh1", kind: "shift", data: { date: "2026-10-01" }, updated_at: "2026-11-07T02:00:00+00:00" }]);
    const d = await backend.loadFacility("fa", { from: "2026-08-01" });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/rest/v1/shift_records?");
    expect(calls[0].url).toContain("facility_id=eq.fa");
    expect(calls[0].url).toContain("kind=not.in.(request,shift)");
    expect(calls[1].url).toContain("kind=in.(request,shift)");
    expect(calls[1].url).toContain("data->>date=gte.2026-08-01");
    expect(d.staff[0]).toMatchObject({ id: "s1", name: "佐藤", facilityId: "fa" });
    expect(d.shift[0].id).toBe("sh1");
    expect(d.cursor).toBe("2026-11-07T02:00:00+00:00");
  });

  it("差分取得：変更分と削除分だけを問い合わせる", async () => {
    calls.length = 0;
    responder = (u) => (u.includes("audit_logs")
      ? [{ record_id: "sh9", kind: "shift", at: "2026-11-07T03:00:00+00:00" }, { record_id: "s1", kind: "pin", at: "2026-11-07T03:30:00+00:00" }]
      : [{ id: "sh2", kind: "shift", data: { date: "2026-11-10" }, updated_at: "2026-11-07T02:30:00+00:00" }]);
    const ch = await backend.loadChanges("fa", "2026-11-07T02:00:00.000Z");
    const rec = calls.find((c) => c.url.includes("shift_records")), aud = calls.find((c) => c.url.includes("audit_logs"));
    expect(rec.url).toContain("updated_at=gt.2026-11-07T02:00:00.000Z");
    expect(aud.url).toContain("action=eq.delete");
    expect(aud.url).toContain("at=gt.2026-11-07T02:00:00.000Z");
    expect(ch.upserts).toEqual([{ kind: "shift", rec: { date: "2026-11-10", id: "sh2", facilityId: "fa" } }]);
    expect(ch.deletes).toEqual([{ id: "sh9", kind: "shift" }]); // PIN など画面データ以外は無視
    expect(ch.cursor).toBe("2026-11-07T03:00:00+00:00");
  });

  it("過去のシフト実績はサーバーに問い合わせて確認する", async () => {
    calls.length = 0;
    responder = () => [{ id: "sh700" }];
    expect(await backend.hasStaffShifts("fa", "s1")).toBe(true);
    expect(calls[0].url).toContain("data->>staffId=eq.s1");
    expect(calls[0].url).toContain("kind=eq.shift");
  });
});

describe("差分の反映", () => {
  const base = { department: [], staff: [{ id: "s1", name: "A" }], request: [], shift: [{ id: "x", date: "2026-11-01" }, { id: "y", date: "2026-11-02" }], setting: [], roster: [] };
  it("追加・更新・削除を反映し、変更のない種類はそのまま", () => {
    const n = applyChanges(base, [{ kind: "shift", rec: { id: "y", date: "2026-11-03" } }, { kind: "shift", rec: { id: "z", date: "2026-11-04" } }], [{ id: "x", kind: "shift" }]);
    expect(n.shift.map((r) => `${r.id}:${r.date}`).sort()).toEqual(["y:2026-11-03", "z:2026-11-04"]);
    expect(n.staff).toBe(base.staff);
  });
  it("変更がなければ同じオブジェクトを返す（再描画しない）", () => {
    expect(applyChanges(base, [], [])).toBe(base);
  });
  it("最初に読み込む期間の開始日", () => {
    expect(windowStart(new Date(2026, 10, 7))).toBe("2026-08-01");
    expect(windowStart(new Date(2026, 1, 15))).toBe("2025-11-01");
  });
});
