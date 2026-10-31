import { useEffect, useMemo, useRef, useState } from "react";
import { autoPlaceBreak, breaksText, fmtDate, hours, inBreak, legalBreak, shortTime, sortStaff, toHHMM, toMin, weekdayOf, withBreaks } from "../../utils.js";
import { exportTimetable } from "../../excel.js";
import { Modal } from "../../components.jsx";
import { TimeSelect } from "../StaffEntry.jsx";

const SLOT = 15; // 15分単位

export function buildTimeline(settings, shifts) {
  let start = settings.dayStart * 60;
  let end = settings.dayEnd * 60;
  shifts.forEach((s) => {
    start = Math.min(start, Math.floor(toMin(s.start) / 60) * 60);
    end = Math.max(end, Math.ceil(toMin(s.end) / 60) * 60);
  });
  const slots = [];
  for (let m = start; m < end; m += SLOT) slots.push(m);
  return { start, end, slots };
}

const workMin = (s) => toMin(s.end) - toMin(s.start) - (s.breakMin || 0);

export default function Timetable({ store, settings, depts, ctx }) {
  const { data, save } = store;
  const date = ctx.date && ctx.date.startsWith(ctx.month) ? ctx.date : `${ctx.month}-01`;
  const deptView = ctx.ttDept ?? ctx.deptId; // "" = 全部門
  const staffMap = useMemo(() => Object.fromEntries(data.staff.map((s) => [s.id, s])), [data.staff]);
  const [breakMode, setBreakMode] = useState(false);
  const [drag, setDrag] = useState(null); // {shiftId, from, to}
  const [editing, setEditing] = useState(null); // shift
  const dragRef = useRef(null);
  dragRef.current = drag;

  const moveDay = (n) => {
    const [y, m, d] = date.split("-").map(Number);
    const x = new Date(y, m - 1, d + n);
    const nd = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    ctx.set({ date: nd, month: nd.slice(0, 7) });
  };
  const shownDepts = deptView ? depts.filter((d) => d.id === deptView) : depts;
  const dayShifts = data.shift.filter((s) => s.date === date && shownDepts.some((d) => d.id === s.deptId));
  const tl = buildTimeline(settings, dayShifts);

  // ドラッグで休憩を登録
  useEffect(() => {
    const up = () => {
      const d = dragRef.current;
      if (!d) return;
      setDrag(null);
      const sh = data.shift.find((s) => s.id === d.shiftId);
      if (!sh) return;
      const a = Math.min(d.from, d.to), b = Math.max(d.from, d.to) + SLOT;
      save("shift", withBreaks(sh, [...(sh.breaks || []), { start: toHHMM(a), end: toHHMM(b) }]));
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [data.shift, save]);

  const onSlotDown = (s, m, e) => {
    if (!breakMode) return;
    e.preventDefault();
    if (inBreak(s, m)) {
      // 既存の休憩をクリック → その休憩を削除
      const rest = (s.breaks || []).filter((b) => !(m >= toMin(b.start) && m < toMin(b.end)));
      save("shift", withBreaks(s, rest));
      return;
    }
    setDrag({ shiftId: s.id, from: m, to: m });
  };
  const onSlotEnter = (s, m) => {
    if (drag && drag.shiftId === s.id) setDrag({ ...drag, to: m });
  };
  const inDrag = (s, m) => drag && drag.shiftId === s.id && m >= Math.min(drag.from, drag.to) && m <= Math.max(drag.from, drag.to);

  const autoAll = (list) => {
    const target = list.filter((s) => !(s.breaks || []).length && legalBreak(toMin(s.end) - toMin(s.start)) > 0);
    if (!target.length) return alert("自動配置の対象（休憩時間帯が未登録で、法定休憩が必要なシフト）はありません");
    if (!window.confirm(`${target.length}件のシフトに休憩時間帯を自動配置しますか？\n（休憩分数＝登録済みの休憩時間と法定休憩の多い方、勤務時間の中央付近に配置）`)) return;
    save("shift", target.map((s) => withBreaks(s, autoPlaceBreak(s, Math.max(s.breakMin || 0, legalBreak(toMin(s.end) - toMin(s.start)))))));
  };

  return (
    <>
      <div className="row between wrap">
        <h1>日毎タイムテーブル</h1>
        <div className="row wrap">
          <button className="btn small" onClick={() => exportTimetable({ data, settings, depts: shownDepts, dates: [date] })}>⬇ Excel（この日）</button>
          <button className="btn small" onClick={() => exportTimetable({ data, settings, depts: shownDepts, month: ctx.month })}>⬇ Excel（月間・日別シート）</button>
        </div>
      </div>
      <div className="card row wrap">
        <button className="btn tiny ghost" onClick={() => moveDay(-1)}>◀ 前日</button>
        <input type="date" value={date} onChange={(e) => e.target.value && ctx.set({ date: e.target.value, month: e.target.value.slice(0, 7) })} />
        <button className="btn tiny ghost" onClick={() => moveDay(1)}>翌日 ▶</button>
        <b className={`wd${weekdayOf(date)}`}>{fmtDate(date)}</b>
        <select value={deptView} onChange={(e) => ctx.set({ ttDept: e.target.value })}>
          <option value="">全部門</option>
          {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="seg">
          <button className={!breakMode ? "on" : ""} onClick={() => setBreakMode(false)}>表示</button>
          <button className={breakMode ? "on" : ""} onClick={() => setBreakMode(true)}>☕ 休憩入力</button>
        </div>
        <button className="btn small" onClick={() => autoAll(dayShifts)} disabled={!dayShifts.length}>休憩を自動配置</button>
      </div>
      <div className="legend-row small muted">
        {breakMode
          ? <span className="tag green">休憩入力モード：勤務バーの上をドラッグ（またはクリック）で休憩を登録、休憩部分をクリックで削除</span>
          : <span>※シフト作成ツールで登録したシフトが自動反映されます。氏名をクリックすると休憩時間を編集できます。</span>}
        <span><i className="sw brk" />休憩</span>
      </div>

      {shownDepts.map((dept) => {
        const list = dayShifts
          .filter((s) => s.deptId === dept.id)
          .sort((a, b) => a.start.localeCompare(b.start) || sortStaff(staffMap[a.staffId] || {}, staffMap[b.staffId] || {}));
        return (
          <div key={dept.id} className="card scroll-x pad0">
            <div className="tt-title"><span className="dept-dot" style={{ background: dept.color }} />{dept.name}　<span className="muted small">{new Set(list.map((s) => s.staffId)).size}名</span></div>
            {!list.length ? (
              <div className="muted center" style={{ padding: 16 }}>この日のシフトはありません</div>
            ) : (
              <table className={`tt ${breakMode ? "break-mode" : ""}`}>
                <thead>
                  <tr>
                    <th className="sticky name-col">氏名</th>
                    <th className="sticky2">時間 / 休憩</th>
                    {tl.slots.filter((m) => m % 60 === 0).map((m) => <th key={m} colSpan={60 / SLOT} className="hour">{m / 60}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => {
                    const st = toMin(s.start), en = toMin(s.end);
                    const short = (s.breakMin || 0) < legalBreak(en - st);
                    return (
                      <tr key={s.id}>
                        <td className="sticky name-col clickable" onClick={() => setEditing(s)} title="休憩を編集">
                          <b>{staffMap[s.staffId]?.name || "(削除済)"}</b> <span className="muted small">✎</span>
                        </td>
                        <td className="sticky2 nowrap small">
                          {shortTime(s.start)}〜{shortTime(s.end)}
                          <div className="muted">
                            {s.breaks?.length ? `休 ${breaksText(s.breaks)}` : s.breakMin ? `休${s.breakMin}分（時間帯未設定）` : "休憩なし"}
                          </div>
                          <div className="muted">実{hours(workMin(s))} {short && <span className="tag red">法定休憩不足</span>}</div>
                        </td>
                        {tl.slots.map((m) => {
                          const on = m >= st && m < en;
                          const brk = on && inBreak(s, m);
                          const sel = on && inDrag(s, m);
                          return (
                            <td key={m}
                              className={`slot ${m % 60 === 0 ? "h" : ""} ${on ? "on" : ""} ${brk ? "brk" : ""} ${sel ? "sel" : ""}`}
                              style={on && !brk && !sel ? { background: dept.color } : brk ? { "--c": dept.color } : undefined}
                              title={on ? `${toHHMM(m)}〜${toHHMM(m + SLOT)}${brk ? " 休憩" : ""}` : undefined}
                              onMouseDown={on ? (e) => onSlotDown(s, m, e) : undefined}
                              onMouseEnter={on ? () => onSlotEnter(s, m) : undefined}
                            />
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th className="sticky name-col">配置人数</th>
                    <th className="sticky2 small muted">休憩中を除く</th>
                    {tl.slots.map((m, i) => {
                      const cnt = (x) => list.filter((s) => x >= toMin(s.start) && x < toMin(s.end) && !inBreak(s, x)).length;
                      const n = cnt(m);
                      const show = n && (m % 60 === 0 || i === 0 || cnt(m - SLOT) !== n);
                      return <td key={m} className={`slot cnt ${m % 60 === 0 ? "h" : ""}`}>{show ? n : ""}</td>;
                    })}
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        );
      })}

      {editing && (
        <BreakModal
          shift={data.shift.find((s) => s.id === editing.id) || editing}
          staff={staffMap[editing.staffId]}
          onSave={(sh) => { save("shift", sh); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function BreakModal({ shift, staff, onSave, onClose }) {
  const st = toMin(shift.start), en = toMin(shift.end);
  const times = [];
  for (let m = st; m <= en; m += SLOT) times.push(toHHMM(m));
  const legal = legalBreak(en - st);
  const [breaks, setBreaks] = useState(() =>
    shift.breaks?.length ? shift.breaks.map((b) => ({ ...b })) : shift.breakMin ? autoPlaceBreak(shift, shift.breakMin) : []
  );
  const preview = withBreaks(shift, breaks);
  const upd = (i, p) => setBreaks((l) => l.map((b, k) => (k === i ? { ...b, ...p } : b)));
  const add = () => {
    const last = breaks[breaks.length - 1];
    const a = last ? Math.min(toMin(last.end) + 60, en - SLOT) : Math.max(st, Math.round((st + (en - st) / 2) / SLOT) * SLOT);
    setBreaks([...breaks, { start: toHHMM(a), end: toHHMM(Math.min(a + 15, en)) }]);
  };
  const invalid = breaks.some((b) => toMin(b.end) <= toMin(b.start));

  return (
    <Modal title={`休憩の登録：${staff?.name || ""}（${shortTime(shift.start)}〜${shortTime(shift.end)}）`} onClose={onClose}
      footer={<>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>キャンセル</button>
        <button className="btn primary" disabled={invalid} onClick={() => onSave(preview)}>保存</button>
      </>}>
      {!shift.breaks?.length && shift.breakMin > 0 && (
        <div className="banner info">休憩{shift.breakMin}分（時間帯未設定）を中央付近に仮配置しています。時間を調整して保存してください。</div>
      )}
      {breaks.map((b, i) => (
        <div key={i} className="row wrap shift-line">
          <span>休憩{i + 1}</span>
          <TimeSelect times={times} value={b.start} onChange={(v) => upd(i, { start: v })} />〜
          <TimeSelect times={times} value={b.end} onChange={(v) => upd(i, { end: v })} />
          <span className="muted small">{Math.max(0, toMin(b.end) - toMin(b.start))}分</span>
          {toMin(b.end) <= toMin(b.start) && <span className="tag red">終了が開始より前</span>}
          <button className="btn tiny ghost" onClick={() => setBreaks(breaks.filter((_, k) => k !== i))}>✕</button>
        </div>
      ))}
      {!breaks.length && <p className="muted">休憩は登録されていません。</p>}
      <div className="row wrap">
        <button className="btn tiny" onClick={add}>＋ 休憩を追加</button>
        {legal > 0 && <button className="btn tiny" onClick={() => setBreaks(autoPlaceBreak(shift, legal))}>法定休憩（{legal}分）を自動配置</button>}
        {breaks.length > 0 && <button className="btn tiny ghost" onClick={() => setBreaks([])}>すべて削除</button>}
      </div>
      <div className="banner info">
        休憩合計 <b>{preview.breakMin}分</b> ／ 実働 <b>{hours(en - st - preview.breakMin)}</b>
        {preview.breakMin < legal && <span className="tag red" style={{ marginLeft: 8 }}>法定休憩不足（{legal}分以上必要）</span>}
        <div className="muted small">※重なる休憩は結合、勤務時間外の部分は除外して保存します。給与計算に反映されます。</div>
      </div>
    </Modal>
  );
}
