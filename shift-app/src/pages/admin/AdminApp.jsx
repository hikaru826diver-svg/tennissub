import { useCallback, useEffect, useState } from "react";
import { thisMonth } from "../../utils.js";
import { getSettings, lastAdminFacility, useFacilityStore } from "../../store.js";
import StaffMaster from "./StaffMaster.jsx";
import DeptMaster from "./DeptMaster.jsx";
import RequestList from "./RequestList.jsx";
import ShiftBuilder from "./ShiftBuilder.jsx";
import Timetable from "./Timetable.jsx";
import Payroll from "./Payroll.jsx";
import Settings from "./Settings.jsx";
import FacilityManager from "./FacilityManager.jsx";
import AuditLog from "./AuditLog.jsx";
import { MfaVerify, MfaEnroll, SecurityModal } from "./Security.jsx";

const TABS = [
  ["requests", "希望一覧"],
  ["shifts", "シフト作成"],
  ["timetable", "タイムテーブル"],
  ["payroll", "給与計算"],
  ["staff", "スタッフマスタ"],
  ["depts", "部門マスタ"],
  ["settings", "回収・各種設定"],
  ["audit", "操作履歴"],
];

/** 管理者画面の入口：ログイン → 施設の選択 → 各機能 */
export default function AdminGate({ backend, sub, onTitle }) {
  const [session, setSession] = useState(undefined); // undefined = 確認中
  const [isHq, setIsHq] = useState(false);
  const [facilities, setFacilities] = useState(null);
  const [fid, setFid] = useState(lastAdminFacility.get());
  const [recovery, setRecovery] = useState(false);
  const [mfa, setMfa] = useState(null); // { needVerify, needEnroll, ... }
  const [secOpen, setSecOpen] = useState(false);
  const [err, setErr] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const s = await backend.getSession();
      setSession(s);
      if (!s) { setFacilities(null); setMfa(null); return; }
      if (backend.mfaSupported) {
        const st = await backend.mfaState();
        setMfa(st);
        if (st.needVerify || st.needEnroll) return; // 二段階認証が済むまでデータは読み込まない
      }
      setIsHq(await backend.isHq(s));
      setFacilities(await backend.listFacilities(s));
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  }, [backend]);

  useEffect(() => {
    refresh();
    return backend.onAuthChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      refresh();
    });
  }, [backend, refresh]);

  // 本部で施設が未登録のときは施設管理画面へ（作成後もそのまま続けて操作できるように）
  useEffect(() => {
    if (isHq && facilities && !facilities.length && sub !== "facilities") window.location.hash = "#admin-facilities";
  }, [isHq, facilities, sub]);

  const logout = async () => { await backend.signOut(); setSession(null); setFacilities(null); };

  if (session === undefined) return <div className="center muted" style={{ padding: 40 }}>読み込み中…</div>;
  if (recovery) return <PasswordReset backend={backend} onDone={() => setRecovery(false)} />;
  if (!session) return <AdminLogin backend={backend} onLogin={refresh} />;
  if (mfa?.needVerify) return <MfaVerify backend={backend} factors={mfa.factors} onDone={refresh} onCancel={logout} />;
  if (mfa?.needEnroll) return <MfaEnroll backend={backend} forced onDone={refresh} onCancel={logout} />;
  if (!facilities) return <div className="center muted" style={{ padding: 40 }}>{err ? <span className="banner error">{err}</span> : "読み込み中…"}</div>;

  const current = facilities.find((f) => f.id === fid) || facilities[0];
  const choose = (id) => { setFid(id); lastAdminFacility.set(id); };
  const showManager = isHq && (sub === "facilities" || !current);

  return (
    <div className="admin">
      <div className="facility-bar">
        <div className="row wrap">
          <span className="small muted">施設</span>
          {facilities.length ? (
            <select className="facility-select" value={current?.id || ""} onChange={(e) => choose(e.target.value)}>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          ) : <b>（施設がありません）</b>}
          {isHq && <span className="tag">本部</span>}
        </div>
        <div className="row wrap small">
          <span className="muted">{session.label}</span>
          {backend.mfaSupported && <button className="btn tiny ghost" onClick={() => setSecOpen(true)}>🔐 二段階認証{mfa?.factors?.length ? "（設定済み）" : ""}</button>}
          <button className="btn tiny ghost" onClick={logout}>ログアウト</button>
        </div>
      </div>
      {err && <div className="banner error">{err}</div>}
      {secOpen && <SecurityModal backend={backend} isHq={isHq} state={mfa} onChange={refresh} onClose={() => setSecOpen(false)} />}
      {!current && !isHq ? (
        <main className="page narrow"><div className="card">担当する施設が割り当てられていません。本部の管理者に、施設への割り当てを依頼してください。</div></main>
      ) : showManager ? (
        <>
          <SubNav sub="facilities" isHq={isHq} />
          <main className="page wide">
            <FacilityManager backend={backend} facilities={facilities} reload={refresh} onOpen={(id) => { choose(id); window.location.hash = "#admin-requests"; }} />
          </main>
        </>
      ) : (
        <FacilityWorkspace key={current.id} backend={backend} facility={current} sub={sub} isHq={isHq} onTitle={onTitle} />
      )}
    </div>
  );
}

const backupDue = (at) => !at || Date.now() - Date.parse(at) > 30 * 86400000;

function SubNav({ sub, isHq }) {
  return (
    <nav className="subnav">
      {TABS.map(([k, label]) => <a key={k} href={`#admin-${k}`} className={sub === k ? "active" : ""}>{label}</a>)}
      {isHq && <a href="#admin-facilities" className={`hq-tab ${sub === "facilities" ? "active" : ""}`}>施設管理（本部）</a>}
    </nav>
  );
}

function FacilityWorkspace({ backend, facility, sub, isHq, onTitle }) {
  const store = useFacilityStore(backend, facility.id);
  const settings = getSettings(store.data, facility);
  useEffect(() => { onTitle?.(settings.orgName); }, [settings.orgName]); // eslint-disable-line
  const depts = [...store.data.department].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // 画面間で共有する選択状態
  const [ctx, setCtx] = useState({ month: "", deptId: "", date: "" });
  const month = ctx.month || settings.collection.month || thisMonth();
  const deptId = ctx.deptId || depts[0]?.id || "";
  const shared = { ...ctx, month, deptId, set: (p) => setCtx((c) => ({ ...c, ...p })) };

  const props = { store, settings, depts, ctx: shared, facility, backend };
  const page = {
    requests: <RequestList {...props} />,
    shifts: <ShiftBuilder {...props} />,
    timetable: <Timetable {...props} />,
    payroll: <Payroll {...props} />,
    staff: <StaffMaster {...props} />,
    depts: <DeptMaster {...props} />,
    settings: <Settings {...props} />,
    audit: <AuditLog {...props} />,
  }[sub] || <RequestList {...props} />;

  return (
    <>
      <SubNav sub={sub} isHq={isHq} />
      {store.error && <div className="banner error">{store.error}</div>}
      {!store.loading && depts.length > 0 && sub !== "settings" && backupDue(settings.lastBackupAt) && (
        <div className="banner warn small">💾 {settings.lastBackupAt ? `前回のバックアップから${Math.floor((Date.now() - Date.parse(settings.lastBackupAt)) / 86400000)}日が経過しています。` : "この施設のデータはまだバックアップされていません。"}「<a href="#admin-settings">回収・各種設定</a>」の「データ管理」からバックアップを保存してください。</div>
      )}
      {!store.loading && !depts.length && sub !== "depts" && sub !== "settings" && (
        <div className="banner warn">まず「<a href="#admin-depts">部門マスタ</a>」で部門を登録し、「<a href="#admin-staff">スタッフマスタ</a>」でスタッフを登録してください（「<a href="#admin-settings">回収・各種設定</a>」からサンプルデータも投入できます）。</div>
      )}
      <main className="page wide">{store.loading ? <div className="center muted">読み込み中…</div> : page}</main>
    </>
  );
}

function AdminLogin({ backend, onLogin }) {
  const isLocal = backend.name === "local";
  const [f, setF] = useState({ email: "", password: "", facilityId: "", pass: "", hq: false });
  const [list, setList] = useState([]);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isLocal) backend.listFacilities({ role: "hq" }).then((l) => { setList(l); setF((x) => ({ ...x, facilityId: l[0]?.id || "", hq: !l.length })); });
  }, [backend, isLocal]);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await backend.signIn(isLocal ? { facilityId: f.facilityId, pass: f.pass, hq: f.hq } : { email: f.email.trim(), password: f.password });
      onLogin();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };
  const forgot = async () => {
    if (!f.email.trim()) return setErr("メールアドレスを入力してから押してください");
    try { await backend.resetPassword(f.email.trim()); setInfo("パスワード再設定用のメールを送信しました。"); } catch (e) { setErr(e.message); }
  };

  return (
    <main className="page narrow">
      <form className="card login" onSubmit={submit}>
        <h2>管理者ログイン</h2>
        {isLocal ? (
          <>
            <label className="inline"><input id="login-hq" type="checkbox" checked={f.hq} onChange={(e) => setF({ ...f, hq: e.target.checked })} />本部としてログイン（全施設を管理）</label>
            {!f.hq && (
              <label>施設
                <select id="login-facility" value={f.facilityId} onChange={(e) => setF({ ...f, facilityId: e.target.value })}>
                  {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            )}
            <label>{f.hq ? "本部パスコード" : "施設の管理者パスコード"}<input id="login-pass" type="password" value={f.pass} onChange={(e) => setF({ ...f, pass: e.target.value })} autoFocus /></label>
            <p className="muted small">ブラウザ内保存モードです。初期パスコードは「admin」です（本部・各施設とも）。ログイン後に変更してください。</p>
          </>
        ) : (
          <>
            <label>メールアドレス<input id="login-email" type="email" autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoFocus /></label>
            <label>パスワード<input id="login-password" type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
          </>
        )}
        {err && <div className="banner error">{err}</div>}
        {info && <div className="banner ok">{info}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? "確認中…" : "ログイン"}</button>
        {!isLocal && <button type="button" className="btn tiny ghost" onClick={forgot}>パスワードを忘れた場合</button>}
      </form>
    </main>
  );
}

function PasswordReset({ backend, onDone }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 8) return setErr("8文字以上で入力してください");
    try { await backend.updatePassword(pw); onDone(); } catch (e2) { setErr(e2.message); }
  };
  return (
    <main className="page narrow">
      <form className="card login" onSubmit={submit}>
        <h2>新しいパスワードの設定</h2>
        <input id="new-password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="8文字以上" autoFocus />
        {err && <div className="banner error">{err}</div>}
        <button className="btn primary block">設定する</button>
      </form>
    </main>
  );
}
