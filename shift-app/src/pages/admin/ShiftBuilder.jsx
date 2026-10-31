import { useMemo, useState } from "react";
import { aggregate, calcPayroll, rosterStaff, daysInMonth, fmtDate, hours, legalBreak, shiftFromRequest, shortTime, sortStaff, timeOptions, toMin, uid, weekdayOf, WEEK, yen } from "../../utils.js";
import { DeptSelect, Modal, MonthInput } from "../../components.jsx";
import { TimeSelect } from "../StaffEntry.jsx";
import { exportShiftTable } from "../../excel.js";

const short = (t) => shortTime(t).replace(":00", "");

export default function ShiftBuilder({ store, settings, depts, ctx }) {
  const { data, save, remove } = store;
  const { month, deptId } = ctx;
  const days = daysInMonth(month);
  const times = timeOptions(settings.dayStart, Math.max(settings.dayEnd, 24), settings.stepMin);
  const patterns = settings.patterns?.length ? settings.patterns : [{ start: "09:00", end: "17:00" }, { start: "09:00", end: "13:00" }, { start: "13:00", end: "17:00" }, { start: "17:00", end: "22:00" }];
  const [mode, setMode] = useState("edit"); // edit | paint
  const [pattern, setPattern] = useState(0); // index or "erase"
  const [modal, setModal] = useState(null); // {staffId, date}
  const [showReq, setShowReq] = useState(true);

  const staffMap = useMemo(() => Object.fromEntries(data.staff.map((s) => [s.id, s])), [data.staff]);
  const monthShifts = useMemo(() => data.shift.filter((s) => s.date.startsWith(month)), [data.shift, month]);
  const deptShifts = monthShifts.filter((s) => s.deptId === deptId);
  const deptReqs = data.request.filter((r) => r.deptId === deptId && r.date.startsWith(month));

  const staffRows = rosterStaff(data, deptId, month);
  const rosterId = `${deptId}|${month}`;
  const roster = data.roster?.find((r) => r.id === rosterId) || { id: rosterId, deptId, month, staffIds: [] };
  const [addOpen, setAddOpen] = useState(false);

  const addToRoster = (ids) => save("roster", { ...roster, staffIds: [...new Set([...roster.staffIds, ...ids])] });
  const removeFromRoster = (st) => {
    const has = deptShifts.filter((s) => s.staffId === st.id);
    if (has.length && !window.confirm(`${st.name} さんにはこの月のシフトが ${has.length}件 あります。シフトも削除して行を外しますか？`)) return;
    if (has.length) remove("shift", has.map((s) => s.id));
    save("roster", { ...roster, staffIds: roster.staffIds.filter((id) => id !== st.id) });
  };

  const cellShifts = (sid, d) => deptShifts.filter((s) => s.staffId === sid && s.date === d).sort((a, b) => a.start.localeCompare(b.start));
  const cellReqs = (sid, d) => deptReqs.filter((r) => r.staffId === sid && r.date === d);

  // 給与（全部門のシフトで計算 → 時間外判定を部門横断で行う）
  const pay = useMemo(() => calcPayroll(monthShifts, staffMap, settings).filter((r) => r.deptId === deptId), [monthShifts, staffMap, settings, deptId]);
  const byStaff = aggregate(pay, (r) => r.staffId);
  const byDate = aggregate(pay, (r) => r.date);
  const total = aggregate(pay, () => "all").all;

  const onCell = (sid, d) => {
    if (mode === "edit") return setModal({ staffId: sid, date: d });
    const existing = cellShifts(sid, d);
    if (pattern === "erase") return existing.length && remove("shift", existing.map((s) => s.id));
    const p = patterns[pattern];
    const span = toMin(p.end) - toMin(p.start);
    const rec = { id: existing[0]?.id || uid(), staffId: sid, deptId, date: d, start: p.start, end: p.end, breakMin: settings.autoBreak ? legalBreak(span) : 0 };
    save("shift", rec);
  };

  const adoptAll = () => {
    const target = deptReqs.filter((r) => !cellShifts(r.staffId, r.date).length);
    if (!target.length) return alert("未反映の希望はありません");
    if (window.confirm(`${month} の希望 ${target.length}件 をシフトに一括反映しますか？\n（すでにシフトがある日はスキップします）`)) save("shift", target.map((r) => shiftFromRequest(r, settings)));
  };
  const clearMonth = () => {
    if (!deptShifts.length) return;
    if (window.confirm(`${depts.find((d) => d.id === deptId)?.name} の ${month} のシフト ${deptShifts.length}件 をすべて削除しますか？`)) remove("shift", deptShifts.map((s) => s.id));
  };

  if (!deptId) return <h1>シフト作成</h1>;

  return (
    <>
      <div className="row between wrap">
        <h1>シフト作成ツール</h1>
        <div className="row wrap">
          <button className="btn small" onClick={() => exportShiftTable({ data, settings, depts: depts.filter((d) => d.id === deptId), month })}>⬇ Excel（この部門）</button>
          <button className="btn small" onClick={() => exportShiftTable({ data, settings, depts, month })}>⬇ Excel（全部門）</button>
        </div>
      </div>
      <div className="card row wrap">
        <MonthInput value={month} onChange={(m) => ctx.set({ month: m })} />
        <DeptSelect depts={depts} value={deptId} onChange={(v) => ctx.set({ deptId: v })} />
        <div className="seg">
          <button className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>詳細編集</button>
          <button className={mode === "paint" ? "on" : ""} onClick={() => setMode("paint")}>パターン入力</button>
        </div>
        {mode === "paint" && (
          <div className="row wrap">
            {patterns.map((p, i) => (
              <button key={i} className={`btn tiny ${pattern === i ? "primary" : ""}`} onClick={() => setPattern(i)}>{short(p.start)}-{short(p.end)}</button>
            ))}
            <button className={`btn tiny ${pattern === "erase" ? "danger" : ""}`} onClick={() => setPattern("erase")}>消去</button>
          </div>
        )}
        <label className="inline"><input type="checkbox" checked={showReq} onChange={(e) => setShowReq(e.target.checked)} />希望を表示</label>
        <button className="btn small primary" onClick={adoptAll}>希望を一括反映</button>
        <button className="btn small danger" onClick={clearMonth}>月クリア</button>
      </div>
      <div className="legend-row small muted">
        <span><i className="sw shift" />シフト確定</span>
        <span><i className="sw req" />希望あり（未反映）</span>
        <span><i className="sw diff" />希望と異なる時間</span>
        <span>セルをクリックで{mode === "edit" ? "編集" : "パターン貼付"}</span>
      </div>

      <div className="card scroll-x pad0">
        <table className="grid-tbl">
          <thead>
            <tr>
              <th className="sticky name-col">スタッフ</th>
              {days.map((d) => (
                <th key={d} className={`wd${weekdayOf(d)}`}>{Number(d.slice(8))}<br /><span className="small">{WEEK[weekdayOf(d)]}</span></th>
              ))}
              <th>日数</th><th>時間</th><th>給与概算</th>
            </tr>
          </thead>
          <tbody>
            {staffRows.map((st) => (
              <tr key={st.id}>
                <td className="sticky name-col">
                  <div className="row between">
                    <b>{st.name}</b>
                    {st.manual && <button className="btn tiny ghost" title="この月のシフト表から外す" onClick={() => removeFromRoster(st)}>✕</button>}
                  </div>
                  <div className="small muted">{st.category} {yen(st.wage)} {st.extra && <span className="tag">応援</span>}</div>
                </td>
                {days.map((d) => {
                  const sh = cellShifts(st.id, d);
                  const rq = showReq ? cellReqs(st.id, d) : [];
                  const diff = sh.length && rq.length && !rq.some((r) => sh.some((s) => s.start === r.start && s.end === r.end));
                  return (
                    <td key={d} className={`cell wd${weekdayOf(d)} ${sh.length ? (diff ? "diff" : "shift") : rq.length ? "req" : ""}`} onClick={() => onCell(st.id, d)}
                      title={rq.map((r) => `希望 ${r.allDay ? "終日可" : `${r.start}-${r.end}`} ${r.note || ""}`).join("\n")}>
                      {sh.map((s) => <div key={s.id}>{short(s.start)}<br />{short(s.end)}</div>)}
                      {!sh.length && rq.map((r) => <div key={r.id} className="req-text">{r.allDay ? "終日" : <>{short(r.start)}<br />{short(r.end)}</>}</div>)}
                    </td>
                  );
                })}
                <td className="r nowrap">{byStaff[st.id]?.days.size || 0}日</td>
                <td className="r nowrap">{hours(byStaff[st.id]?.workMin)}</td>
                <td className="r nowrap">{yen(byStaff[st.id]?.total)}</td>
              </tr>
            ))}
            {!staffRows.length && <tr><td colSpan={days.length + 4} className="muted center">この部門に所属するスタッフがいません</td></tr>}
            <tr>
              <td className="sticky name-col add-row" colSpan={1}>
                <button className="btn tiny primary" onClick={() => setAddOpen(true)}>＋ スタッフを追加</button>
              </td>
              <td colSpan={days.length + 3} className="muted small">他部門からの応援スタッフや新しいスタッフを、この月のシフト表に追加できます</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th className="sticky name-col">出勤人数</th>
              {days.map((d) => <td key={d} className="c">{new Set(deptShifts.filter((s) => s.date === d).map((s) => s.staffId)).size || ""}</td>)}
              <td className="r">{total?.days.size || 0}</td><td className="r">{hours(total?.workMin)}</td><td className="r">{yen(total?.total)}</td>
            </tr>
            <tr>
              <th className="sticky name-col">労働時間</th>
              {days.map((d) => <td key={d} className="c small">{byDate[d] ? (byDate[d].workMin / 60).toFixed(1) : ""}</td>)}
              <td colSpan={3} />
            </tr>
            <tr>
              <th className="sticky name-col">人件費</th>
              {days.map((d) => <td key={d} className="c tiny-num">{byDate[d] ? Math.round(byDate[d].total / 1000) + "k" : ""}</td>)}
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>

      {addOpen && (
        <AddStaffModal
          candidates={data.staff.filter((x) => x.active !== false && !staffRows.some((r) => r.id === x.id)).sort(sortStaff)}
          depts={depts}
          deptId={deptId}
          settings={settings}
          onAdd={(ids) => { addToRoster(ids); setAddOpen(false); }}
          onCreate={async (rec, addToDept) => {
            const st = { id: uid(), kana: "", active: true, note: "", ...rec, deptIds: addToDept ? [deptId] : [] };
            await save("staff", st);
            if (!addToDept) addToRoster([st.id]);
            setAddOpen(false);
          }}
          onClose={() => setAddOpen(false)}
        />
      )}
      {modal && (
        <ShiftModal
          {...modal}
          staff={staffMap[modal.staffId]}
          deptId={deptId}
          shifts={cellShifts(modal.staffId, modal.date)}
          reqs={cellReqs(modal.staffId, modal.date)}
          otherDept={monthShifts.filter((s) => s.staffId === modal.staffId && s.date === modal.date && s.deptId !== deptId)}
          depts={depts}
          times={times}
          settings={settings}
          onSave={(list, delIds) => { if (delIds.length) remove("shift", delIds); if (list.length) save("shift", list); setModal(null); }}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

function ShiftModal({ staffId, date, staff, deptId, shifts, reqs, otherDept, depts, times, settings, onSave, onClose }) {
  const blank = () => ({ id: uid(), staffId, deptId, date, start: "09:00", end: "17:00", breakMin: settings.autoBreak ? 60 : 0 });
  const [list, setList] = useState(shifts.length ? shifts.map((s) => ({ ...s })) : [reqs[0] ? shiftFromRequest(reqs[0], settings) : blank()]);
  const upd = (i, p) => setList((l) => l.map((s, k) => {
    if (k !== i) return s;
    const n = { ...s, ...p };
    if (settings.autoBreak && (p.start || p.end)) n.breakMin = legalBreak(toMin(n.end) - toMin(n.start));
    return n;
  }));
  const submit = () => {
    for (const s of list) if (toMin(s.end) <= toMin(s.start)) return alert("終了時刻は開始時刻より後にしてください");
    const keep = new Set(list.map((s) => s.id));
    onSave(list, shifts.filter((s) => !keep.has(s.id)).map((s) => s.id));
  };
  const deptName = (id) => depts.find((d) => d.id === id)?.name;

  return (
    <Modal title={`${staff?.name || ""} ／ ${fmtDate(date)}`} onClose={onClose}
      footer={<>
        <button className="btn danger" onClick={() => onSave([], shifts.map((s) => s.id))} disabled={!shifts.length}>この日のシフト削除</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>キャンセル</button>
        <button className="btn primary" onClick={submit}>保存</button>
      </>}>
      {reqs.length > 0 ? (
        <div className="banner info">
          希望：{reqs.map((r) => <span key={r.id}>{r.allDay ? "終日可" : `${shortTime(r.start)}〜${shortTime(r.end)}`}{r.note && `（${r.note}）`} </span>)}
        </div>
      ) : <div className="muted small">この日の希望は提出されていません</div>}
      {otherDept.length > 0 && (
        <div className="banner warn">他部門シフト：{otherDept.map((s) => `${deptName(s.deptId)} ${shortTime(s.start)}〜${shortTime(s.end)}`).join("、")}</div>
      )}
      {list.map((s, i) => (
        <div key={s.id} className="row wrap shift-line">
          <TimeSelect times={times} value={s.start} onChange={(v) => upd(i, { start: v })} />〜
          <TimeSelect times={times} value={s.end} onChange={(v) => upd(i, { end: v })} />
          <label className="inline">休憩
            <select value={s.breakMin} onChange={(e) => setList((l) => l.map((x, k) => (k === i ? { ...x, breakMin: Number(e.target.value) } : x)))}>
              {[0, 15, 30, 45, 60, 75, 90, 120].map((m) => <option key={m} value={m}>{m}分</option>)}
            </select>
          </label>
          <span className="muted small">実働 {hours(toMin(s.end) - toMin(s.start) - s.breakMin)}</span>
          {toMin(s.end) - toMin(s.start) - s.breakMin > 480 && <span className="tag red">8h超</span>}
          {s.breakMin < legalBreak(toMin(s.end) - toMin(s.start)) && <span className="tag red">法定休憩不足</span>}
          <button className="btn tiny ghost" onClick={() => setList((l) => l.filter((_, k) => k !== i))}>✕</button>
        </div>
      ))}
      <div className="row wrap">
        <button className="btn tiny" onClick={() => setList((l) => [...l, blank()])}>＋ 時間帯を追加（分割勤務）</button>
        {reqs.map((r) => (
          <button key={r.id} className="btn tiny" onClick={() => setList([{ ...shiftFromRequest(r, settings), id: list[0]?.id || uid() }])}>希望どおりに設定</button>
        ))}
      </div>
    </Modal>
  );
}

function AddStaffModal({ candidates, depts, deptId, settings, onAdd, onCreate, onClose }) {
  const [tab, setTab] = useState(candidates.length ? "pick" : "new");
  const [picked, setPicked] = useState([]);
  const [q, setQ] = useState("");
  const [f, setF] = useState({ name: "", category: settings.categories[0] || "", wage: 1100, transport: 0, addToDept: true });
  const deptName = (id) => depts.find((d) => d.id === id)?.name;
  const list = candidates.filter((s) => !q || `${s.name}${s.kana || ""}`.includes(q));
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const create = () => {
    if (!f.name.trim()) return alert("氏名を入力してください");
    onCreate({ name: f.name.trim(), category: f.category, wage: Number(f.wage) || 0, transport: Number(f.transport) || 0 }, f.addToDept);
  };
  return (
    <Modal title={`${deptName(deptId)} にスタッフを追加`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>キャンセル</button>
        {tab === "pick"
          ? <button className="btn primary" disabled={!picked.length} onClick={() => onAdd(picked)}>追加（{picked.length}名）</button>
          : <button className="btn primary" onClick={create}>登録して追加</button>}
      </>}>
      <div className="seg">
        <button className={tab === "pick" ? "on" : ""} onClick={() => setTab("pick")}>登録済みスタッフから選ぶ</button>
        <button className={tab === "new" ? "on" : ""} onClick={() => setTab("new")}>新しく登録する</button>
      </div>
      {tab === "pick" ? (
        <>
          <input placeholder="氏名で検索" value={q} onChange={(e) => setQ(e.target.value)} />
          {!list.length ? <p className="muted">追加できるスタッフがいません。「新しく登録する」から登録してください。</p> : (
            <div className="pick-list">
              {list.map((s) => (
                <label key={s.id} className="inline pick-item">
                  <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
                  <b>{s.name}</b>
                  <span className="muted small">{s.category} {yen(s.wage)}</span>
                  <span className="small">{(s.deptIds || []).map((id) => deptName(id) && <span key={id} className="tag">{deptName(id)}</span>)}</span>
                </label>
              ))}
            </div>
          )}
          <p className="muted small">他部門のスタッフは「応援」として今月のこの部門のシフト表にだけ追加されます（所属部門は変わりません）。</p>
        </>
      ) : (
        <>
          <div className="grid2">
            <label>氏名 *<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
            <label>区分
              <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                <option value="">-</option>
                {settings.categories.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>時給（円）<input type="number" min="0" step="10" value={f.wage} onChange={(e) => setF({ ...f, wage: e.target.value })} /></label>
            <label>交通費（円／出勤1日）<input type="number" min="0" step="10" value={f.transport} onChange={(e) => setF({ ...f, transport: e.target.value })} /></label>
          </div>
          <label className="inline"><input type="checkbox" checked={f.addToDept} onChange={(e) => setF({ ...f, addToDept: e.target.checked })} />この部門の所属スタッフとしてマスタに登録する（外すと今月の応援扱い）</label>
          <p className="muted small">フリガナ・備考などはあとで「スタッフマスタ」から編集できます。</p>
        </>
      )}
    </Modal>
  );
}
