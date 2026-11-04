import { useCallback, useEffect, useState } from "react";
import { sortStaff, uid, yen } from "../../utils.js";
import { Modal } from "../../components.jsx";

const EMPTY = { name: "", kana: "", category: "", wage: 1100, transport: 0, deptIds: [], active: true, note: "" };

/** 推測されにくい4桁のPIN（0000・1234 のような並びは除く） */
function genPin() {
  const weak = /^(\d)\1{3}$|^(0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|3210)$/;
  for (;;) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    const p = String(a[0] % 10000).padStart(4, "0");
    if (!weak.test(p)) return p;
  }
}

export default function StaffMaster({ store, settings, depts, facility, backend }) {
  const { data, save, remove } = store;
  const [edit, setEdit] = useState(null);
  const [filter, setFilter] = useState({ dept: "", q: "", showInactive: false });
  const deptName = (id) => depts.find((d) => d.id === id)?.name;

  // ---- 個人PIN ----
  const [pins, setPins] = useState(null);
  const [pinErr, setPinErr] = useState("");
  const [issued, setIssued] = useState(null); // [{name, pin}]
  const [busy, setBusy] = useState(false);
  const loadPins = useCallback(() => {
    backend.pinStatus(facility.id).then((l) => setPins(Object.fromEntries(l.map((x) => [x.staff_id, x])))).catch((e) => setPinErr(e.message));
  }, [backend, facility.id]);
  useEffect(() => {
    loadPins();
    // ロック状態などを最新に保つ（15秒ごと・画面に戻ったとき）
    const t = setInterval(() => document.visibilityState === "visible" && loadPins(), 15000);
    const onVis = () => document.visibilityState === "visible" && loadPins();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [loadPins]);
  const issue = async (targets) => {
    if (!targets.length) return;
    if (targets.some((t) => pins?.[t.id]) && !window.confirm(`${targets.length}名のPINを発行します。発行済みの人は新しいPINに変わり、古いPINは使えなくなります。よろしいですか？`)) return;
    setBusy(true); setPinErr("");
    const out = [];
    try {
      for (const t of targets) {
        const pin = genPin();
        await backend.setPin(facility.id, t.id, pin);
        out.push({ name: t.name, pin });
      }
    } catch (e) {
      setPinErr(e.message);
    } finally {
      setBusy(false);
      if (out.length) setIssued(out);
      loadPins();
    }
  };
  const clearPin = async (t) => {
    if (!window.confirm(`${t.name} さんのPINを削除しますか？（PINが必須の場合、再発行するまで希望を提出できません）`)) return;
    try { await backend.clearPin(facility.id, t.id); loadPins(); } catch (e) { setPinErr(e.message); }
  };

  const list = data.staff
    .filter((s) => filter.showInactive || s.active !== false)
    .filter((s) => !filter.dept || (s.deptIds || []).includes(filter.dept))
    .filter((s) => !filter.q || `${s.name}${s.kana || ""}`.includes(filter.q))
    .sort(sortStaff);

  const submit = async () => {
    if (!edit.name.trim()) return alert("氏名を入力してください");
    if (!edit.deptIds.length) return alert("所属部門を1つ以上選択してください");
    await save("staff", { ...edit, name: edit.name.trim(), wage: Number(edit.wage) || 0, transport: Number(edit.transport) || 0, id: edit.id || uid() });
    setEdit(null);
  };
  const del = (s) => {
    const used = data.shift.some((x) => x.staffId === s.id);
    if (used) {
      if (window.confirm(`${s.name} さんにはシフト実績があるため削除せず「退職（無効）」にします。よろしいですか？`)) save("staff", { ...s, active: false });
      return;
    }
    if (window.confirm(`${s.name} さんを削除しますか？`)) remove("staff", s.id);
  };
  const set = (p) => setEdit((e) => ({ ...e, ...p }));

  return (
    <>
      <div className="row between">
        <h1>アルバイトスタッフ マスタ</h1>
        <button className="btn primary" onClick={() => setEdit({ ...EMPTY, category: settings.categories[0] || "" , deptIds: filter.dept ? [filter.dept] : [] })}>＋ スタッフ登録</button>
      </div>
      <div className="card row wrap">
        <select value={filter.dept} onChange={(e) => setFilter({ ...filter, dept: e.target.value })}>
          <option value="">全部門</option>
          {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input placeholder="氏名で検索" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <label className="inline"><input type="checkbox" checked={filter.showInactive} onChange={(e) => setFilter({ ...filter, showInactive: e.target.checked })} />退職者も表示</label>
        <span className="muted">{list.length}名</span>
      </div>
      <div className="card row wrap pin-bar">
        <span>🔒 <b>個人PIN</b>（スタッフがシフト希望を提出するときの本人確認）</span>
        {settings.requirePin === false
          ? <span className="tag red">現在は「回収・各種設定」でPINが無効になっています</span>
          : <span className="muted small">未発行 {pins ? list.filter((x) => x.active !== false && !pins[x.id]).length : "-"}名</span>}
        <button className="btn small primary" disabled={busy || !pins} onClick={() => issue(list.filter((x) => x.active !== false && !pins[x.id]))}>未発行の全員に発行</button>
        {pinErr && <span className="banner error">{pinErr}</span>}
      </div>
      <div className="card scroll-x">
        <table className="tbl">
          <thead><tr><th>氏名</th><th>区分</th><th className="r">時給</th><th className="r">交通費(1日)</th><th>所属部門</th><th>備考</th><th>PIN</th><th></th></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} className={s.active === false ? "inactive" : ""}>
                <td><b>{s.name}</b>{s.kana && <div className="muted small">{s.kana}</div>}{s.active === false && <span className="tag">退職</span>}</td>
                <td>{s.category}</td>
                <td className="r">{yen(s.wage)}</td>
                <td className="r">{yen(s.transport)}</td>
                <td>{(s.deptIds || []).map((id) => deptName(id) && <span key={id} className="tag">{deptName(id)}</span>)}</td>
                <td className="small">{s.note}</td>
                <td className="nowrap">
                  {!pins ? "…" : pins[s.id]
                    ? <>{pins[s.id].locked ? <span className="tag red">ロック中</span> : <span className="tag green">発行済</span>}
                        <button className="btn tiny ghost" disabled={busy} onClick={() => issue([s])}>再発行</button>
                        <button className="btn tiny ghost" onClick={() => clearPin(s)}>削除</button></>
                    : <><span className="tag">未発行</span><button className="btn tiny" disabled={busy || s.active === false} onClick={() => issue([s])}>発行</button></>}
                </td>
                <td className="nowrap">
                  <button className="btn tiny" onClick={() => setEdit({ ...EMPTY, ...s })}>編集</button>
                  <button className="btn tiny danger" onClick={() => del(s)}>削除</button>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={8} className="muted center">スタッフが登録されていません</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title={edit.id ? "スタッフ編集" : "スタッフ登録"} onClose={() => setEdit(null)}
          footer={<><button className="btn" onClick={() => setEdit(null)}>キャンセル</button><button className="btn primary" onClick={submit}>保存</button></>}>
          <div className="grid2">
            <label>氏名 *<input value={edit.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></label>
            <label>フリガナ<input value={edit.kana} onChange={(e) => set({ kana: e.target.value })} /></label>
            <label>区分
              <select value={edit.category} onChange={(e) => set({ category: e.target.value })}>
                <option value="">-</option>
                {settings.categories.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>時給（円）<input type="number" min="0" step="10" value={edit.wage} onChange={(e) => set({ wage: e.target.value })} /></label>
            <label>交通費（円／出勤1日）<input type="number" min="0" step="10" value={edit.transport} onChange={(e) => set({ transport: e.target.value })} /></label>
            <label>在籍状況
              <select value={edit.active === false ? "0" : "1"} onChange={(e) => set({ active: e.target.value === "1" })}>
                <option value="1">在籍</option><option value="0">退職（無効）</option>
              </select>
            </label>
          </div>
          <div className="field">
            <div>所属部門 *（複数可）</div>
            <div className="row wrap">
              {depts.map((d) => (
                <label key={d.id} className="inline chip">
                  <input type="checkbox" checked={edit.deptIds.includes(d.id)}
                    onChange={(e) => set({ deptIds: e.target.checked ? [...edit.deptIds, d.id] : edit.deptIds.filter((x) => x !== d.id) })} />
                  {d.name}
                </label>
              ))}
            </div>
          </div>
          <label>備考<textarea rows={2} value={edit.note} onChange={(e) => set({ note: e.target.value })} /></label>
        </Modal>
      )}
      {issued && (
        <Modal title="発行したPIN" onClose={() => setIssued(null)}
          footer={<>
            <button className="btn" onClick={() => navigator.clipboard?.writeText(issued.map((x) => `${x.name}\t${x.pin}`).join("\n")).catch(() => {})}>一覧をコピー</button>
            <button className="btn primary" onClick={() => setIssued(null)}>閉じる</button>
          </>}>
          <div className="banner warn">PINはこの画面でしか表示されません（保存されるのは暗号化した値だけです）。閉じる前に、本人へ個別に伝えてください。忘れた場合は「再発行」します。</div>
          <table className="tbl compact">
            <thead><tr><th>氏名</th><th>PIN</th></tr></thead>
            <tbody>{issued.map((x) => <tr key={x.name}><td>{x.name}</td><td className="pin-show">{x.pin}</td></tr>)}</tbody>
          </table>
          <p className="small muted">スタッフ用URL（施設ごと）と一緒に伝えてください。PINは5回続けて間違えると15分間ロックされます。</p>
        </Modal>
      )}
    </>
  );
}
