import { useMemo, useState } from "react";
import { daysInMonth, fmtDate, fmtMonth, shiftFromRequest, shortTime, sortStaff, weekdayOf } from "../../utils.js";
import { MonthInput } from "../../components.jsx";

export default function RequestList({ store, settings, depts, ctx }) {
  const { data, save, remove } = store;
  const [deptFilter, setDeptFilter] = useState(ctx.deptId);
  const [dateFilter, setDateFilter] = useState("");
  const [view, setView] = useState("date");
  const [showEmpty, setShowEmpty] = useState(true);
  const [picked, setPicked] = useState(() => new Set()); // 個人別：選択中のスタッフ
  const staffMap = Object.fromEntries(data.staff.map((s) => [s.id, s]));
  const deptMap = Object.fromEntries(depts.map((d) => [d.id, d]));

  const rows = useMemo(
    () =>
      data.request
        .filter((r) => r.date.startsWith(ctx.month))
        .filter((r) => !deptFilter || r.deptId === deptFilter)
        .filter((r) => !dateFilter || r.date === dateFilter)
        .sort((a, b) => a.date.localeCompare(b.date) || (deptMap[a.deptId]?.order ?? 0) - (deptMap[b.deptId]?.order ?? 0) || a.start.localeCompare(b.start)),
    [data.request, ctx.month, deptFilter, dateFilter] // eslint-disable-line
  );
  const hasShift = (r) => data.shift.some((s) => s.staffId === r.staffId && s.deptId === r.deptId && s.date === r.date);
  const shiftsOf = (r) => data.shift.filter((s) => s.staffId === r.staffId && s.deptId === r.deptId && s.date === r.date);
  /** 登録済（シフト反映済み）を解除 → 該当シフトを削除 */
  const unadopt = (list) => {
    const ids = [...new Set(list.flatMap((r) => shiftsOf(r).map((s) => s.id)))];
    if (!ids.length) return;
    const one = list.length === 1 ? `${staffMap[list[0].staffId]?.name || ""} さんの ${fmtDate(list[0].date)} ` : "";
    if (!window.confirm(`${one}登録済のシフト ${ids.length}件 を解除しますか？\n（シフト作成ツール・タイムテーブル・給与計算からも削除されます。希望は残ります）`)) return;
    remove("shift", ids);
  };
  const adopt = (list, who = "") => {
    const target = list.filter((r) => !hasShift(r));
    if (!target.length) return alert("反映対象の希望はありません（すでにシフト登録済みです）");
    if (!window.confirm(`${who ? `${who}の` : ""}希望 ${target.length}件 をシフトに反映しますか？`)) return;
    save("shift", target.map((r) => shiftFromRequest(r, settings)));
  };

  // 個人別グループ
  const byStaff = rows.reduce((o, r) => ((o[r.staffId] ||= []).push(r), o), {});
  const staffIds = Object.keys(byStaff).sort((a, b) => sortStaff(staffMap[a] || { name: "" }, staffMap[b] || { name: "" }));
  const togglePick = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pickedRows = staffIds.filter((id) => picked.has(id)).flatMap((id) => byStaff[id]);

  // 日付別グループ
  const byDate = rows.reduce((o, r) => ((o[r.date] ||= []).push(r), o), {});
  // 表示する日付（希望者がいない日も含める）
  const dates = showEmpty ? (dateFilter ? [dateFilter] : daysInMonth(ctx.month)) : Object.keys(byDate);
  // 未提出者
  const targetDepts = deptFilter ? [deptFilter] : depts.map((d) => d.id);
  const notSubmitted = targetDepts.map((did) => ({
    dept: deptMap[did],
    staff: data.staff.filter((s) => s.active !== false && (s.deptIds || []).includes(did) && !data.request.some((r) => r.staffId === s.id && r.deptId === did && r.date.startsWith(ctx.month))),
  }));

  return (
    <>
      <h1>シフト希望一覧</h1>
      <div className="card row wrap">
        <MonthInput value={ctx.month} onChange={(m) => { ctx.set({ month: m }); setDateFilter(""); }} />
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
          <option value="">全部門</option>
          {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input type="date" value={dateFilter} min={`${ctx.month}-01`} max={`${ctx.month}-31`} onChange={(e) => setDateFilter(e.target.value)} />
        {dateFilter && <button className="btn tiny ghost" onClick={() => setDateFilter("")}>日付指定解除</button>}
        <div className="seg">
          <button className={view === "date" ? "on" : ""} onClick={() => setView("date")}>日付別</button>
          <button className={view === "staff" ? "on" : ""} onClick={() => setView("staff")}>個人別</button>
          <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>一覧</button>
          <button className={view === "missing" ? "on" : ""} onClick={() => setView("missing")}>未提出者</button>
        </div>
        {(view === "date" || view === "list") && <label className="inline"><input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />希望者がいない日も表示</label>}
        <span className="muted">{rows.length}件</span>
        <button className="btn small primary" onClick={() => adopt(rows)} disabled={!rows.length}>表示中の希望をすべてシフトに反映</button>
      </div>

      {view === "staff" ? (
        <>
          <div className="card row wrap">
            <label className="inline"><input type="checkbox" checked={staffIds.length > 0 && staffIds.every((id) => picked.has(id))}
              onChange={(e) => setPicked(e.target.checked ? new Set(staffIds) : new Set())} />全員を選択</label>
            <span className="muted small">{picked.size ? `${[...picked].filter((id) => byStaff[id]).length}名を選択中` : "スタッフを選んでまとめて反映できます"}</span>
            <button className="btn small primary" disabled={!pickedRows.length} onClick={() => adopt(pickedRows, `選択した${[...picked].filter((id) => byStaff[id]).length}名`)}>選択した人の希望を一括反映</button>
            <button className="btn small" disabled={!pickedRows.some(hasShift)} onClick={() => unadopt(pickedRows.filter(hasShift))}>選択した人の登録を解除</button>
          </div>
          {!staffIds.length ? <div className="card muted center">希望はありません</div> : (
            <div className="date-groups">
              {staffIds.map((id) => {
                const list = byStaff[id], st = staffMap[id] || {};
                const done = list.filter(hasShift).length;
                return (
                  <div key={id} className={`card date-card ${picked.has(id) ? "picked" : ""}`}>
                    <div className="row between wrap">
                      <label className="inline staff-head">
                        <input type="checkbox" checked={picked.has(id)} onChange={() => togglePick(id)} />
                        <b>{st.name || "(削除済)"}</b>
                        <span className="muted small">{st.category} ／ 希望 {list.length}件・登録済 {done}件</span>
                      </label>
                      <div className="row">
                        <button className="btn tiny primary" disabled={done === list.length} onClick={() => adopt(list, `${st.name} さん`)}>この人の希望を一括反映</button>
                        {done > 0 && <button className="btn tiny ghost" onClick={() => unadopt(list.filter(hasShift))}>登録を解除</button>}
                      </div>
                    </div>
                    <table className="tbl compact">
                      <tbody>
                        {list.map((r) => (
                          <tr key={r.id}>
                            <td className={`wd${weekdayOf(r.date)} nowrap`}>{fmtDate(r.date)}</td>
                            <td><span className="dept-dot" style={{ background: deptMap[r.deptId]?.color }} />{deptMap[r.deptId]?.name || "-"}</td>
                            <td className="nowrap">{r.allDay ? "終日可" : `${shortTime(r.start)}〜${shortTime(r.end)}`}</td>
                            <td className="small">{r.note}</td>
                            <td className="nowrap">{hasShift(r)
                              ? <><span className="tag green">登録済</span><button className="btn tiny ghost" onClick={() => unadopt([r])}>解除</button></>
                              : <button className="btn tiny" onClick={() => save("shift", shiftFromRequest(r, settings))}>反映</button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : view === "missing" ? (
        <div className="card">
          <h3>{fmtMonth(ctx.month)} 希望未提出者</h3>
          {notSubmitted.map(({ dept, staff }) => dept && (
            <div key={dept.id} className="field">
              <b>{dept.name}</b>（{staff.length}名）：{staff.length ? staff.map((s) => <span key={s.id} className="tag">{s.name}</span>) : <span className="muted">全員提出済み</span>}
            </div>
          ))}
        </div>
      ) : view === "date" ? (
        dates.length ? (
          <div className="date-groups">
            {dates.map((date) => [date, byDate[date] || []]).map(([date, list]) => !list.length ? (
              <div key={date} className="card date-card empty">
                <div className="row between">
                  <h3 className={`wd${weekdayOf(date)}`}>{fmtDate(date)} <span className="muted small">希望者 0名</span></h3>
                </div>
                <div className="muted small">希望者なし</div>
              </div>
            ) : (
              <div key={date} className="card date-card">
                <div className="row between">
                  <h3 className={`wd${weekdayOf(date)}`}>{fmtDate(date)} <span className="muted small">希望者 {new Set(list.map((r) => r.staffId)).size}名</span></h3>
                  <div className="row">
                    <button className="btn tiny" onClick={() => adopt(list)}>この日を反映</button>
                    {list.some(hasShift) && <button className="btn tiny ghost" onClick={() => unadopt(list)}>この日の登録を解除</button>}
                  </div>
                </div>
                <table className="tbl compact">
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td><span className="dept-dot" style={{ background: deptMap[r.deptId]?.color }} />{deptMap[r.deptId]?.name || "-"}</td>
                        <td><b>{staffMap[r.staffId]?.name || "(削除済)"}</b></td>
                        <td className="nowrap">{r.allDay ? "終日可" : `${shortTime(r.start)}〜${shortTime(r.end)}`}</td>
                        <td className="small">{r.note}</td>
                        <td className="nowrap">{hasShift(r) ? <><span className="tag green">登録済</span><button className="btn tiny ghost" onClick={() => unadopt([r])}>解除</button></> : <button className="btn tiny" onClick={() => save("shift", shiftFromRequest(r, settings))}>反映</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ) : <div className="card muted center">希望はありません</div>
      ) : (
        <div className="card scroll-x">
          <table className="tbl">
            <thead><tr><th>日付</th><th>部門</th><th>氏名</th><th>区分</th><th>希望時間</th><th>備考</th><th>提出日時</th><th>状態</th><th></th></tr></thead>
            <tbody>
              {dates.flatMap((date) => (byDate[date]?.length ? byDate[date] : [{ id: `empty-${date}`, date, empty: true }])).map((r) => r.empty ? (
                <tr key={r.id} className="empty-row">
                  <td className={`wd${weekdayOf(r.date)} nowrap`}>{fmtDate(r.date)}</td>
                  <td colSpan={8} className="muted small">希望者なし</td>
                </tr>
              ) : (
                <tr key={r.id}>
                  <td className={`wd${weekdayOf(r.date)} nowrap`}>{fmtDate(r.date)}</td>
                  <td>{deptMap[r.deptId]?.name || "-"}</td>
                  <td><b>{staffMap[r.staffId]?.name || "(削除済)"}</b></td>
                  <td>{staffMap[r.staffId]?.category}</td>
                  <td className="nowrap">{r.allDay ? "終日可" : `${shortTime(r.start)}〜${shortTime(r.end)}`}</td>
                  <td className="small">{r.note}</td>
                  <td className="small nowrap">{r.submittedAt ? new Date(r.submittedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</td>
                  <td>{hasShift(r) ? <span className="tag green">登録済</span> : <span className="tag">未</span>}</td>
                  <td className="nowrap">
                    {hasShift(r) ? <button className="btn tiny ghost" onClick={() => unadopt([r])}>登録解除</button> : <button className="btn tiny" onClick={() => save("shift", shiftFromRequest(r, settings))}>反映</button>}
                    <button className="btn tiny danger" onClick={() => window.confirm("この希望を削除しますか？") && remove("request", r.id)}>削除</button>
                  </td>
                </tr>
              ))}
              {!dates.length && <tr><td colSpan={9} className="muted center">希望はありません</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
