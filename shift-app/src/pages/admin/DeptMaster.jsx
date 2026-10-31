import { useState } from "react";
import { uid } from "../../utils.js";

const COLORS = ["#2f80ed", "#27ae60", "#eb5757", "#f2994a", "#9b51e0", "#00a5a8", "#d35400", "#6d4c41"];

export default function DeptMaster({ store, depts }) {
  const { data, save, remove } = store;
  const [name, setName] = useState("");

  const add = () => {
    if (!name.trim()) return;
    save("department", { id: uid(), name: name.trim(), color: COLORS[depts.length % COLORS.length], order: depts.length });
    setName("");
  };
  const move = (i, dir) => {
    const list = [...depts];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    save("department", list.map((d, k) => ({ ...d, order: k })));
  };
  const del = (d) => {
    const used = data.shift.some((s) => s.deptId === d.id) || data.request.some((r) => r.deptId === d.id);
    if (!window.confirm(`部門「${d.name}」を削除しますか？${used ? "\n※この部門のシフト・希望データは残りますが表示されなくなります。" : ""}`)) return;
    remove("department", d.id);
  };

  return (
    <>
      <h1>部門マスタ</h1>
      <div className="card">
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="部門名（例：フロント、プール監視、ジム、スクール）" />
          <button className="btn primary" onClick={add}>追加</button>
        </div>
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>順</th><th>色</th><th>部門名</th><th>所属スタッフ数</th><th></th></tr></thead>
          <tbody>
            {depts.map((d, i) => (
              <tr key={d.id}>
                <td className="nowrap">
                  <button className="btn tiny ghost" onClick={() => move(i, -1)}>▲</button>
                  <button className="btn tiny ghost" onClick={() => move(i, 1)}>▼</button>
                </td>
                <td><input type="color" value={d.color || "#2f80ed"} onChange={(e) => save("department", { ...d, color: e.target.value })} /></td>
                <td><input defaultValue={d.name} onBlur={(e) => e.target.value.trim() && e.target.value !== d.name && save("department", { ...d, name: e.target.value.trim() })} /></td>
                <td>{data.staff.filter((s) => (s.deptIds || []).includes(d.id)).length}名</td>
                <td><button className="btn tiny danger" onClick={() => del(d)}>削除</button></td>
              </tr>
            ))}
            {!depts.length && <tr><td colSpan={5} className="muted center">部門が登録されていません</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
