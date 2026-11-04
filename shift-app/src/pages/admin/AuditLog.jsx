import { useCallback, useEffect, useMemo, useState } from "react";
import { breaksText, fmtDate, yen } from "../../utils.js";
import { exportAudit } from "../../excel.js";

const KIND = {
  shift: "シフト", request: "シフト希望", staff: "スタッフ", department: "部門", setting: "設定", roster: "シフト表の追加スタッフ",
  pin: "個人PIN", facility: "施設", member: "施設管理者", config: "全体設定",
};
const ACTION = { insert: "追加", update: "変更", delete: "削除" };
const SETTING_LABEL = {
  orgName: "施設・組織名", adminPass: "管理者パスコード", dayStart: "営業開始", dayEnd: "営業終了", stepMin: "時刻の単位", categories: "スタッフ区分",
  collection: "シフト希望の回収", overtimePremium: "時間外割増", overtimeRate: "時間外割増率", nightPremium: "深夜割増", nightRate: "深夜割増率",
  autoBreak: "法定休憩の自動設定", closingDay: "給与締め日", taskLabels: "業務項目", patterns: "シフトパターン", requirePin: "個人PINの必須化", lastBackupAt: "バックアップ日時",
};
const PERIODS = [["7", "直近7日"], ["30", "直近30日"], ["90", "直近90日"], ["", "すべて"]];

/** 操作記録1件を「何をしたか」の短い文に変換する */
export function describeAudit(a, staffName, deptName) {
  const b = a.before || {}, n = a.after || {}, r = a.after || a.before || {};
  const time = (x) => (x.start ? `${x.start}〜${x.end}` : "");
  const diff = (pairs) => pairs.filter(([, x, y]) => JSON.stringify(x ?? null) !== JSON.stringify(y ?? null)).map(([label, x, y, f = (v) => v ?? "-"]) => `${label} ${f(x)} → ${f(y)}`);
  switch (a.kind) {
    case "shift":
    case "request": {
      const head = `${staffName(r.staffId)} ${r.date ? fmtDate(r.date) : ""} ${deptName(r.deptId)}`;
      if (a.action !== "update") return `${head} ${time(r)}`;
      const ch = diff([
        ["時間", time(b), time(n)],
        ["休憩", b.breaks?.length ? breaksText(b.breaks, true) : `${b.breakMin || 0}分`, n.breaks?.length ? breaksText(n.breaks, true) : `${n.breakMin || 0}分`],
        ["業務", (b.tasks || []).map((t) => `${t.label}${t.start}-${t.end}`).join("、") || "なし", (n.tasks || []).map((t) => `${t.label}${t.start}-${t.end}`).join("、") || "なし"],
        ["メモ", b.memo || "なし", n.memo || "なし"],
      ]);
      return `${head}：${ch.join("／") || "内容を更新"}`;
    }
    case "staff": {
      if (a.action !== "update") return `${r.name || ""}（時給 ${yen(r.wage)}）`;
      const ch = diff([
        ["氏名", b.name, n.name], ["区分", b.category, n.category], ["時給", b.wage, n.wage, yen], ["交通費", b.transport, n.transport, yen],
        ["所属", (b.deptIds || []).map(deptName).join("・"), (n.deptIds || []).map(deptName).join("・")], ["在籍", b.active === false ? "退職" : "在籍", n.active === false ? "退職" : "在籍"],
      ]);
      return `${n.name || b.name}：${ch.join("／") || "内容を更新"}`;
    }
    case "department":
      return a.action === "update" && b.name !== n.name ? `${b.name} → ${n.name}` : r.name || "";
    case "setting": {
      const keys = [...new Set([...Object.keys(b), ...Object.keys(n)])].filter((k) => !["id", "facilityId"].includes(k) && JSON.stringify(b[k]) !== JSON.stringify(n[k]));
      return keys.length ? `変更した項目：${keys.map((k) => SETTING_LABEL[k] || k).join("、")}` : "設定を保存";
    }
    case "roster":
      return `${deptName(r.deptId)} ${r.month || ""}`;
    case "pin":
      return `${staffName(a.record_id)} のPINを${a.action === "delete" ? "削除" : "発行・再発行"}`;
    case "member":
      return r.email || a.record_id || "";
    case "facility":
      return r.name || "";
    case "config":
      return n.require_mfa != null ? `二段階認証の必須化：${n.require_mfa ? "オン" : "オフ"}` : "";
    default:
      return a.record_id || "";
  }
}

export default function AuditLog({ store, facility, backend, depts }) {
  const { data } = store;
  const [period, setPeriod] = useState("30");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const staffMap = useMemo(() => Object.fromEntries(data.staff.map((s) => [s.id, s.name])), [data.staff]);
  const deptMap = useMemo(() => Object.fromEntries(depts.map((d) => [d.id, d.name])), [depts]);
  const staffName = (id) => staffMap[id] || "(削除済みのスタッフ)";
  const deptName = (id) => deptMap[id] || "";

  const load = useCallback(async () => {
    setErr("");
    try {
      const from = period ? new Date(Date.now() - Number(period) * 86400000).toISOString() : undefined;
      setRows(await backend.listAudit(facility.id, { from }));
    } catch (e) {
      setErr(e.message);
      setRows([]);
    }
  }, [backend, facility.id, period]);
  useEffect(() => { load(); }, [load]);

  const shown = (rows || [])
    .map((a) => ({ ...a, summary: describeAudit(a, staffName, deptName) }))
    .filter((a) => !kind || a.kind === kind)
    .filter((a) => !q || `${a.actor} ${a.summary}`.includes(q));

  return (
    <>
      <div className="row between wrap">
        <h1>操作履歴</h1>
        <div className="row wrap">
          <button className="btn small" onClick={load}>最新の状態に更新</button>
          <button className="btn small" disabled={!shown.length} onClick={() => exportAudit({ facility, rows: shown, kindLabel: KIND, actionLabel: ACTION })}>⬇ Excel出力</button>
        </div>
      </div>
      <div className="card row wrap">
        <div className="seg">{PERIODS.map(([v, l]) => <button key={l} className={period === v ? "on" : ""} onClick={() => setPeriod(v)}>{l}</button>)}</div>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">すべての種類</option>
          {Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input placeholder="操作者・内容で検索" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">{rows ? `${shown.length}件` : "読み込み中…"}</span>
      </div>
      {err && <div className="banner error">{err}</div>}
      <div className="card scroll-x">
        <table className="tbl compact">
          <thead><tr><th>日時</th><th>操作者</th><th>操作</th><th>種類</th><th>内容</th></tr></thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.id}>
                <td className="nowrap small">{new Date(a.at).toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                <td className="small">{a.actor}</td>
                <td><span className={`tag ${a.action === "delete" ? "red" : a.action === "insert" ? "green" : ""}`}>{ACTION[a.action] || a.action}</span></td>
                <td className="nowrap small">{KIND[a.kind] || a.kind}</td>
                <td className="small">{a.summary}</td>
              </tr>
            ))}
            {rows && !shown.length && <tr><td colSpan={5} className="muted center">該当する操作はありません</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="small muted">データの追加・変更・削除は自動で記録され、管理者を含め誰も書き換え・削除できません（Supabase運用時）。表示は新しい順に最大1,000件です。</p>
    </>
  );
}
