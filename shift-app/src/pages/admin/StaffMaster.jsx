import { useState } from "react";
import { sortStaff, uid, yen } from "../../utils.js";
import { Modal } from "../../components.jsx";

const EMPTY = { name: "", kana: "", category: "", wage: 1100, transport: 0, deptIds: [], active: true, note: "" };

export default function StaffMaster({ store, settings, depts }) {
  const { data, save, remove } = store;
  const [edit, setEdit] = useState(null);
  const [filter, setFilter] = useState({ dept: "", q: "", showInactive: false });
  const deptName = (id) => depts.find((d) => d.id === id)?.name;

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
      <div className="card scroll-x">
        <table className="tbl">
          <thead><tr><th>氏名</th><th>区分</th><th className="r">時給</th><th className="r">交通費(1日)</th><th>所属部門</th><th>備考</th><th></th></tr></thead>
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
                  <button className="btn tiny" onClick={() => setEdit({ ...EMPTY, ...s })}>編集</button>
                  <button className="btn tiny danger" onClick={() => del(s)}>削除</button>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7} className="muted center">スタッフが登録されていません</td></tr>}
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
    </>
  );
}
