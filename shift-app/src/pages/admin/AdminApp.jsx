import { useState } from "react";
import { thisMonth } from "../../utils.js";
import StaffMaster from "./StaffMaster.jsx";
import DeptMaster from "./DeptMaster.jsx";
import RequestList from "./RequestList.jsx";
import ShiftBuilder from "./ShiftBuilder.jsx";
import Timetable from "./Timetable.jsx";
import Payroll from "./Payroll.jsx";
import Settings from "./Settings.jsx";

const TABS = [
  ["requests", "希望一覧"],
  ["shifts", "シフト作成"],
  ["timetable", "タイムテーブル"],
  ["payroll", "給与計算"],
  ["staff", "スタッフマスタ"],
  ["depts", "部門マスタ"],
  ["settings", "回収・各種設定"],
];
const AUTH_KEY = "shift-app-admin";

export default function AdminApp({ store, settings, sub }) {
  const [authed, setAuthed] = useState(() => {
    if (import.meta.env.VITE_DEMO) return true;
    try { return sessionStorage.getItem(AUTH_KEY) === "1"; } catch { return false; }
  });
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const depts = [...store.data.department].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // 画面間で共有する選択状態
  const [ctx, setCtx] = useState({ month: settings.collection.month || thisMonth(), deptId: "", date: "" });
  const deptId = ctx.deptId || depts[0]?.id || "";
  const shared = { ...ctx, deptId, set: (p) => setCtx((c) => ({ ...c, ...p })) };

  if (!authed) {
    const login = (e) => {
      e.preventDefault();
      if (pass === settings.adminPass) {
        try { sessionStorage.setItem(AUTH_KEY, "1"); } catch { /* ignore */ }
        setAuthed(true);
      } else setErr("パスコードが違います");
    };
    return (
      <main className="page narrow">
        <form className="card login" onSubmit={login}>
          <h2>管理者ログイン</h2>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="管理者パスコード" autoFocus />
          {err && <div className="banner error">{err}</div>}
          <button className="btn primary block">ログイン</button>
          {settings.adminPass === "admin" && <p className="muted small">初期パスコードは「admin」です。ログイン後「回収・各種設定」で変更してください。</p>}
        </form>
      </main>
    );
  }

  const props = { store, settings, depts, ctx: shared };
  const page = {
    requests: <RequestList {...props} />,
    shifts: <ShiftBuilder {...props} />,
    timetable: <Timetable {...props} />,
    payroll: <Payroll {...props} />,
    staff: <StaffMaster {...props} />,
    depts: <DeptMaster {...props} />,
    settings: <Settings {...props} />,
  }[sub] || <RequestList {...props} />;

  return (
    <div className="admin">
      <nav className="subnav">
        {TABS.map(([k, label]) => (
          <a key={k} href={`#admin-${k}`} className={sub === k ? "active" : ""}>{label}</a>
        ))}
        <button className="btn tiny ghost logout" onClick={() => { try { sessionStorage.removeItem(AUTH_KEY); } catch { /* ignore */ } setAuthed(false); }}>ログアウト</button>
      </nav>
      {!depts.length && sub !== "depts" && sub !== "settings" && (
        <div className="banner warn">まず「<a href="#admin-depts">部門マスタ</a>」で部門を登録し、「<a href="#admin-staff">スタッフマスタ</a>」でスタッフを登録してください。</div>
      )}
      <main className="page wide">{page}</main>
    </div>
  );
}
