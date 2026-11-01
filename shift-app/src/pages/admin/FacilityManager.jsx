import { useEffect, useState } from "react";
import { aggregate, calcPayroll, fmtMonth, fmtPeriod, hours, payPeriod, thisMonth, yen } from "../../utils.js";
import { getSettings } from "../../store.js";
import { MonthInput } from "../../components.jsx";

const CODE_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
export const staffUrl = (code) => `${window.location.origin}${window.location.pathname}?f=${encodeURIComponent(code)}#staff`;

/** 本部用：施設の作成・編集・削除、管理者の割り当て、全施設の人件費集計 */
export default function FacilityManager({ backend, facilities, reload, onOpen }) {
  const [form, setForm] = useState({ name: "", code: "" });
  const [msg, setMsg] = useState(null);
  const [members, setMembers] = useState(null); // facility
  const [hqPass, setHqPass] = useState("");

  const create = async (e) => {
    e.preventDefault();
    setMsg(null);
    const name = form.name.trim(), code = form.code.trim().toLowerCase();
    if (!name) return setMsg({ type: "error", text: "施設名を入力してください" });
    if (!CODE_RE.test(code)) return setMsg({ type: "error", text: "施設コードは半角英小文字・数字・ハイフンで2〜32文字にしてください（例：chuo-gym）" });
    try {
      await backend.saveFacility({ name, code });
      setForm({ name: "", code: "" });
      setMsg({ type: "ok", text: `「${name}」を作成しました` });
      reload();
    } catch (e2) {
      setMsg({ type: "error", text: e2.message });
    }
  };
  const rename = async (f, name) => {
    if (!name.trim() || name === f.name) return;
    try { await backend.saveFacility({ ...f, name: name.trim() }); reload(); } catch (e) { setMsg({ type: "error", text: e.message }); }
  };
  const del = async (f) => {
    if (!window.confirm(`施設「${f.name}」と、その施設のスタッフ・シフト・希望などのデータをすべて削除します。元に戻せません。よろしいですか？`)) return;
    try { await backend.deleteFacility(f.id); reload(); } catch (e) { setMsg({ type: "error", text: e.message }); }
  };
  const copy = (text) => navigator.clipboard?.writeText(text).catch(() => {});

  return (
    <>
      <h1>施設管理（本部）</h1>
      {msg && <div className={`banner ${msg.type === "ok" ? "ok" : "error"}`}>{msg.text}</div>}

      <div className="card">
        <h3>施設の一覧</h3>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>施設名</th><th>施設コード</th><th>スタッフ用URL（シフト希望入力）</th><th></th></tr></thead>
            <tbody>
              {facilities.map((f) => (
                <tr key={f.id}>
                  <td><input id={`fac-name-${f.id}`} defaultValue={f.name} onBlur={(e) => rename(f, e.target.value)} /></td>
                  <td><code>{f.code}</code></td>
                  <td className="small">
                    <div className="row"><input readOnly value={staffUrl(f.code)} style={{ flex: 1, minWidth: 0 }} onFocus={(e) => e.target.select()} /><button className="btn tiny" onClick={() => copy(staffUrl(f.code))}>コピー</button></div>
                  </td>
                  <td className="nowrap">
                    <button className="btn tiny primary" onClick={() => onOpen(f.id)}>開く</button>
                    {backend.membersSupported && <button className="btn tiny" onClick={() => setMembers(f)}>管理者</button>}
                    <button className="btn tiny danger" onClick={() => del(f)}>削除</button>
                  </td>
                </tr>
              ))}
              {!facilities.length && <tr><td colSpan={4} className="muted center">施設がありません。下のフォームから作成してください。</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <form className="card" onSubmit={create}>
        <h3>施設を追加</h3>
        <div className="grid2">
          <label>施設名<input id="new-fac-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例：中央体育館" /></label>
          <label>施設コード（URLに使用・後から変更不可）<input id="new-fac-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="例：chuo-gym" /></label>
        </div>
        <button className="btn primary" style={{ marginTop: 10 }}>施設を作成</button>
      </form>

      {members && <MembersCard backend={backend} facility={members} onClose={() => setMembers(null)} />}

      <SummaryCard backend={backend} facilities={facilities} />

      {backend.name === "local" ? (
        <div className="card">
          <h3>パスコード（ブラウザ内保存モード）</h3>
          <p className="small muted">各施設の管理者パスコードは、その施設の「回収・各種設定」で変更します。</p>
          <div className="row wrap">
            <input id="hq-pass" type="password" value={hqPass} onChange={(e) => setHqPass(e.target.value)} placeholder="新しい本部パスコード" />
            <button className="btn small" disabled={!hqPass} onClick={async () => { await backend.setHqPass(hqPass); setHqPass(""); setMsg({ type: "ok", text: "本部パスコードを変更しました" }); }}>変更</button>
          </div>
        </div>
      ) : (
        <div className="card small">
          <h3>管理者アカウントの追加方法</h3>
          <ol>
            <li>Supabase の「Authentication → Users → Add user」で、メールアドレスとパスワードを登録します。</li>
            <li>この画面の施設の「管理者」から、そのメールアドレスを追加します。</li>
            <li>本部権限を付けたいユーザーは、README の手順（SQL）で登録します。</li>
          </ol>
        </div>
      )}
    </>
  );
}

function MembersCard({ backend, facility, onClose }) {
  const [list, setList] = useState(null);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const load = () => backend.listMembers(facility.id).then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [facility.id]); // eslint-disable-line
  const add = async (e) => {
    e.preventDefault();
    setErr("");
    try { await backend.addMember(facility.id, email.trim()); setEmail(""); load(); } catch (e2) { setErr(e2.message); }
  };
  return (
    <div className="card">
      <div className="row between"><h3>{facility.name} の管理者</h3><button className="btn tiny ghost" onClick={onClose}>閉じる</button></div>
      {err && <div className="banner error">{err}</div>}
      {!list ? <p className="muted">読み込み中…</p> : (
        <table className="tbl compact">
          <tbody>
            {list.map((m) => (
              <tr key={m.user_id}>
                <td>{m.email}</td>
                <td><button className="btn tiny danger" onClick={async () => { if (window.confirm(`${m.email} をこの施設の管理者から外しますか？`)) { await backend.removeMember(facility.id, m.user_id).catch((e) => setErr(e.message)); load(); } }}>外す</button></td>
              </tr>
            ))}
            {!list.length && <tr><td className="muted">管理者が割り当てられていません</td></tr>}
          </tbody>
        </table>
      )}
      <form className="row wrap" onSubmit={add} style={{ marginTop: 8 }}>
        <input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="管理者のメールアドレス" />
        <button className="btn small primary" disabled={!email.trim()}>追加</button>
      </form>
    </div>
  );
}

/** 全施設の人件費（給与月単位・各施設の締め日で集計） */
function SummaryCard({ backend, facilities }) {
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const out = [];
      for (const f of facilities) {
        const d = await backend.loadFacility(f.id);
        const st = getSettings(d, f);
        const p = payPeriod(month, st.closingDay);
        const staffMap = Object.fromEntries(d.staff.map((s) => [s.id, s]));
        const pay = calcPayroll(d.shift.filter((s) => s.date >= p.from && s.date <= p.to), staffMap, st);
        out.push({ f, p, t: aggregate(pay, () => "t").t });
      }
      setRows(out);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { setRows(null); }, [month, facilities]);
  const sum = (k) => (rows || []).reduce((a, r) => a + (r.t?.[k] || 0), 0);
  const days = (rows || []).reduce((a, r) => a + (r.t?.days.size || 0), 0);
  return (
    <div className="card">
      <h3>全施設の人件費集計</h3>
      <div className="row wrap">
        <MonthInput value={month} onChange={setMonth} />
        <button className="btn small primary" onClick={run} disabled={busy || !facilities.length}>{busy ? "集計中…" : "集計する"}</button>
      </div>
      {rows && (
        <div className="scroll-x" style={{ marginTop: 10 }}>
          <table className="tbl">
            <thead><tr><th>施設</th><th>対象期間</th><th className="r">延べ人日</th><th className="r">実働</th><th className="r">賃金</th><th className="r">交通費</th><th className="r">支給総額</th></tr></thead>
            <tbody>
              {rows.map(({ f, p, t }) => (
                <tr key={f.id}>
                  <td>{f.name}</td><td className="small">{fmtPeriod(p.from, p.to)}</td>
                  <td className="r">{t?.days.size || 0}</td><td className="r">{hours(t?.workMin)}</td><td className="r">{yen(t?.wagePay)}</td><td className="r">{yen(t?.transport)}</td><td className="r"><b>{yen(t?.total)}</b></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th colSpan={2}>合計（{fmtMonth(month)}分）</th><td className="r">{days}</td><td className="r">{hours(sum("workMin"))}</td><td className="r">{yen(sum("wagePay"))}</td><td className="r">{yen(sum("transport"))}</td><td className="r"><b>{yen(sum("total"))}</b></td></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
