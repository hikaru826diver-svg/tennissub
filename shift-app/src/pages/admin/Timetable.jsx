import { useEffect, useMemo, useRef, useState } from "react";
import { addTask, taskSegSlots, copyShiftTo, daysInMonth, WEEK, autoPlaceBreak, breaksText, normalizeTasks, taskAt, taskColor, fmtDate, hours, inBreak, legalBreak, shortTime, sortStaff, toHHMM, toMin, weekdayOf, withBreaks } from "../../utils.js";
import { exportTimetable } from "../../excel.js";
import { CalendarPicker, Modal, MonthInput } from "../../components.jsx";
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
  const [mode, setMode] = useState("view"); // view | break | task
  const breakMode = mode === "break";
  const taskMode = mode === "task";
  const labels = settings.taskLabels || [];
  const [taskLabel, setTaskLabel] = useState(labels[0] || "");
  const [drag, setDrag] = useState(null); // {shiftId, from, to}
  const [editing, setEditing] = useState(null); // shift
  const [copying, setCopying] = useState(null); // shift
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
      if (d.kind === "task") save("shift", { ...sh, tasks: addTask(sh.tasks, { start: toHHMM(a), end: toHHMM(b), label: d.label }, sh) });
      else save("shift", withBreaks(sh, [...(sh.breaks || []), { start: toHHMM(a), end: toHHMM(b) }]));
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [data.shift, save]);

  const onSlotDown = (s, m, e) => {
    if (taskMode) {
      e.preventDefault();
      const t = taskAt(s, m);
      if (t) return save("shift", { ...s, tasks: (s.tasks || []).filter((x) => x !== t) }); // 既存の業務をクリック → 削除
      if (!taskLabel.trim()) return alert("業務名を選択または入力してください");
      return setDrag({ shiftId: s.id, from: m, to: m, kind: "task", label: taskLabel.trim() });
    }
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
          <button className={mode === "view" ? "on" : ""} onClick={() => setMode("view")}>表示</button>
          <button className={breakMode ? "on" : ""} onClick={() => setMode("break")}>☕ 休憩入力</button>
          <button className={taskMode ? "on" : ""} onClick={() => setMode("task")}>📝 業務入力</button>
        </div>
        {taskMode && (
          <div className="row wrap">
            {labels.map((l) => (
              <button key={l} className="btn tiny" style={{ background: taskColor(l, labels), borderColor: taskLabel === l ? "#1f2933" : "transparent", fontWeight: taskLabel === l ? 700 : 400, color: "#1f2933" }} onClick={() => setTaskLabel(l)}>{l}</button>
            ))}
            <input className="task-input" list="task-labels" value={taskLabel} onChange={(e) => setTaskLabel(e.target.value)} placeholder="業務名を入力" style={{ width: 140 }} />
            <datalist id="task-labels">{labels.map((l) => <option key={l} value={l} />)}</datalist>
          </div>
        )}
        <button className="btn small" onClick={() => autoAll(dayShifts)} disabled={!dayShifts.length}>休憩を自動配置</button>
      </div>
      <div className="legend-row small muted">
        {breakMode
          ? <span className="tag green">休憩入力モード：勤務バーの上をドラッグ（またはクリック）で休憩を登録、休憩部分をクリックで削除</span>
          : taskMode
            ? <span className="tag green">業務入力モード：業務名を選んで（または入力して）勤務バーの上をドラッグで登録、登録済みの業務をクリックで削除</span>
            : <span>※シフト作成ツールで登録したシフトが自動反映されます。氏名をクリックすると休憩・業務・メモを編集できます。</span>}
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
              <table className={`tt ${breakMode ? "break-mode" : ""} ${taskMode ? "task-mode" : ""}`}>
                <thead>
                  <tr>
                    <th className="sticky name-col">氏名</th>
                    <th className="sticky2">時間 / 休憩 / メモ</th>
                    {tl.slots.filter((m) => m % 60 === 0).map((m) => <th key={m} colSpan={60 / SLOT} className="hour">{m / 60}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => {
                    const st = toMin(s.start), en = toMin(s.end);
                    const short = (s.breakMin || 0) < legalBreak(en - st);
                    return (
                      <tr key={s.id}>
                        <td className="sticky name-col clickable" onClick={() => setEditing(s)} title="休憩・業務・メモを編集">
                          <b>{staffMap[s.staffId]?.name || "(削除済)"}</b> <span className="muted small">✎</span>
                          <div><button className="btn tiny copy-btn" onClick={(e) => { e.stopPropagation(); setCopying(s); }} title="この人のタイムテーブルを他の日にコピー">⧉ 他の日にコピー</button></div>
                        </td>
                        <td className="sticky2 nowrap small">
                          {shortTime(s.start)}〜{shortTime(s.end)}
                          <div className="muted">
                            {s.breaks?.length ? `休 ${breaksText(s.breaks)}` : s.breakMin ? `休${s.breakMin}分（時間帯未設定）` : "休憩なし"}
                          </div>
                          <div className="muted">実{hours(workMin(s))} {short && <span className="tag red">法定休憩不足</span>}</div>
                          {s.memo && <div className="small memo">📝 {s.memo}</div>}
                        </td>
                        {tl.slots.map((m) => {
                          const on = m >= st && m < en;
                          const brk = on && inBreak(s, m);
                          const sel = on && inDrag(s, m);
                          const task = on && !brk ? taskAt(s, m) : null;
                          const taskStart = task && (m === toMin(task.start) || m === st || inBreak(s, m - SLOT));
                          const bg = sel ? undefined : brk ? undefined : task ? taskColor(task.label, labels) : on ? dept.color : undefined;
                          return (
                            <td key={m}
                              className={`slot ${m % 60 === 0 ? "h" : ""} ${on ? "on" : ""} ${brk ? "brk" : ""} ${sel ? "sel" : ""} ${task ? "task" : ""}`}
                              style={brk ? { "--c": dept.color } : bg ? { background: bg } : undefined}
                              title={on ? `${toHHMM(m)}〜${toHHMM(m + SLOT)}${brk ? " 休憩" : task ? ` ${task.label}（${task.start}〜${task.end}）` : ""}` : undefined}
                              onMouseDown={on ? (e) => onSlotDown(s, m, e) : undefined}
                              onMouseEnter={on ? () => onSlotEnter(s, m) : undefined}
                            >
                              {taskStart && <span className="task-label" style={{ width: taskSegSlots(s, m, SLOT) * 14 }}><span className="task-text">{[...task.label].map((c, k) => <span key={k}>{c}</span>)}</span></span>}
                            </td>
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

      {copying && (
        <CopyModal
          src={data.shift.find((x) => x.id === copying.id) || copying}
          staff={staffMap[copying.staffId]}
          dept={depts.find((d) => d.id === copying.deptId)}
          allShifts={data.shift}
          settings={settings}
          onSave={(recs) => recs.length && save("shift", recs)}
          onClose={() => setCopying(null)}
        />
      )}
      {editing && (
        <BreakModal
          shift={data.shift.find((s) => s.id === editing.id) || editing}
          staff={staffMap[editing.staffId]}
          labels={labels}
          onSave={(sh) => { save("shift", sh); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function BreakModal({ shift, staff, labels, onSave, onClose }) {
  const st = toMin(shift.start), en = toMin(shift.end);
  const times = [];
  for (let m = st; m <= en; m += SLOT) times.push(toHHMM(m));
  const legal = legalBreak(en - st);
  const [breaks, setBreaks] = useState(() =>
    shift.breaks?.length ? shift.breaks.map((b) => ({ ...b })) : shift.breakMin ? autoPlaceBreak(shift, shift.breakMin) : []
  );
  const [tasks, setTasks] = useState(() => (shift.tasks || []).map((t) => ({ ...t })));
  const [memo, setMemo] = useState(shift.memo || "");
  const preview = { ...withBreaks(shift, breaks), tasks: normalizeTasks(tasks, shift.start, shift.end), memo: memo.trim() };
  const updT = (i, p) => setTasks((l) => l.map((t, k) => (k === i ? { ...t, ...p } : t)));
  const addT = () => {
    const last = tasks[tasks.length - 1];
    const a = last ? Math.min(toMin(last.end), en - SLOT) : st;
    setTasks([...tasks, { start: toHHMM(a), end: toHHMM(Math.min(a + 60, en)), label: labels[0] || "" }]);
  };
  const upd = (i, p) => setBreaks((l) => l.map((b, k) => (k === i ? { ...b, ...p } : b)));
  const add = () => {
    const last = breaks[breaks.length - 1];
    const a = last ? Math.min(toMin(last.end) + 60, en - SLOT) : Math.max(st, Math.round((st + (en - st) / 2) / SLOT) * SLOT);
    setBreaks([...breaks, { start: toHHMM(a), end: toHHMM(Math.min(a + 15, en)) }]);
  };
  const invalid = breaks.some((b) => toMin(b.end) <= toMin(b.start)) || tasks.some((t) => toMin(t.end) <= toMin(t.start) || !t.label.trim());

  return (
    <Modal title={`休憩・業務の登録：${staff?.name || ""}（${shortTime(shift.start)}〜${shortTime(shift.end)}）`} onClose={onClose}
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

      <h3 style={{ marginTop: 6 }}>業務（休憩以外の項目）</h3>
      {tasks.map((t, i) => (
        <div key={i} className="row wrap shift-line">
          <TimeSelect times={times} value={t.start} onChange={(v) => updT(i, { start: v })} />〜
          <TimeSelect times={times} value={t.end} onChange={(v) => updT(i, { end: v })} />
          <input list="task-labels-modal" value={t.label} onChange={(e) => updT(i, { label: e.target.value })} placeholder="業務名（例：受付）" style={{ width: 150, background: t.label ? taskColor(t.label.trim(), labels) : undefined }} />
          {(toMin(t.end) <= toMin(t.start) || !t.label.trim()) && <span className="tag red">{!t.label.trim() ? "業務名を入力" : "終了が開始より前"}</span>}
          <button className="btn tiny ghost" onClick={() => setTasks(tasks.filter((_, k) => k !== i))}>✕</button>
        </div>
      ))}
      <datalist id="task-labels-modal">{labels.map((l) => <option key={l} value={l} />)}</datalist>
      {!tasks.length && <p className="muted small">業務は登録されていません（例：受付、清掃、監視、会議 など）。</p>}
      <div className="row wrap"><button className="btn tiny" onClick={addT}>＋ 業務を追加</button></div>

      <label>メモ（タイムテーブルに表示）
        <textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="例：14時から新人研修担当、鍵当番 など" />
      </label>
    </Modal>
  );
}

function CopyModal({ src, staff, dept, allShifts, settings, onSave, onClose }) {
  const [month, setMonth] = useState(src.date.slice(0, 7));
  const [selected, setSelected] = useState({});
  const [opts, setOpts] = useState({ time: true, breaks: true, tasks: true, memo: true, create: true });
  const [done, setDone] = useState(null);
  const mine = (d) => allShifts.filter((x) => x.staffId === src.staffId && x.deptId === src.deptId && x.date === d).sort((a, b) => a.start.localeCompare(b.start));
  const hasShift = new Set(allShifts.filter((x) => x.staffId === src.staffId && x.deptId === src.deptId && x.date.startsWith(month)).map((x) => x.date));
  const toggle = (d) => d !== src.date && setSelected((s) => { const n = { ...s }; if (n[d]) delete n[d]; else n[d] = true; return n; });
  const pick = (fn) => setSelected((s) => { const n = { ...s }; daysInMonth(month).filter((d) => d !== src.date && fn(d)).forEach((d) => (n[d] = true)); return n; });
  const dates = Object.keys(selected).sort();

  // プレビュー
  const plan = dates.map((d) => {
    const t = mine(d)[0] || null;
    const rec = copyShiftTo(src, t, d, { ...opts, autoBreak: settings.autoBreak });
    return { date: d, target: t, rec, action: !rec ? "skip" : t ? "update" : "create" };
  });
  const cnt = (a) => plan.filter((p) => p.action === a).length;
  const nothing = !opts.time && !opts.breaks && !opts.tasks && !opts.memo;

  const run = () => {
    const recs = plan.filter((p) => p.rec).map((p) => p.rec);
    if (!recs.length) return;
    if (cnt("update") && !window.confirm(`${cnt("update")}日分は既存のシフトの内容を上書きします。よろしいですか？`)) return;
    onSave(recs);
    setDone(recs.length);
    setSelected({});
  };
  const desc = [
    `${src.start}〜${src.end}`,
    src.breaks?.length ? `休憩 ${breaksText(src.breaks, true)}` : src.breakMin ? `休憩${src.breakMin}分` : "休憩なし",
    src.tasks?.length ? `業務 ${src.tasks.map((t) => `${t.label}(${t.start}〜${t.end})`).join("、")}` : "",
    src.memo ? `メモ「${src.memo}」` : "",
  ].filter(Boolean).join(" ／ ");
  const OPT = [["time", "勤務時間"], ["breaks", "休憩"], ["tasks", "業務"], ["memo", "メモ"]];

  return (
    <Modal title={`タイムテーブルのコピー：${staff?.name || ""}（${dept?.name || ""}）`} onClose={onClose}
      footer={<>
        <span className="muted small" style={{ flex: 1 }}>{dates.length ? `新規 ${cnt("create")}日・上書き ${cnt("update")}日${cnt("skip") ? `・対象外 ${cnt("skip")}日` : ""}` : "コピー先の日を選んでください"}</span>
        <button className="btn" onClick={onClose}>閉じる</button>
        <button className="btn primary" disabled={!dates.length || nothing || !(cnt("create") + cnt("update"))} onClick={run}>コピーする</button>
      </>}>
      <div className="banner info"><b>コピー元：{fmtDate(src.date)}</b><div className="small">{desc}</div></div>
      {done != null && <div className="banner ok">{done}日分にコピーしました。続けて別の日を選んでコピーすることもできます。</div>}
      <div className="field">
        <div className="small muted">コピーする内容</div>
        <div className="row wrap">
          {OPT.map(([k, label]) => (
            <label key={k} className="inline chip"><input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />{label}</label>
          ))}
        </div>
        <label className="inline small" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={opts.create} disabled={!opts.time} onChange={(e) => setOpts({ ...opts, create: e.target.checked })} />
          シフトがない日は新しくシフトを作成する（「勤務時間」をコピーする場合のみ）
        </label>
      </div>
      <div className="row between wrap">
        <div className="small muted">コピー先の日（複数選択可）</div>
        <MonthInput value={month} onChange={(m) => { setMonth(m); }} />
      </div>
      <CalendarPicker month={month} selected={selected} marked={hasShift} onToggle={toggle} disabledDates={new Set([src.date])} />
      <div className="row wrap small">
        <span className="muted">一括選択：</span>
        {WEEK.map((w, i) => <button key={w} className="btn tiny ghost" onClick={() => pick((d) => weekdayOf(d) === i)}>{w}</button>)}
        <button className="btn tiny ghost" onClick={() => pick((d) => hasShift.has(d))}>シフトがある日</button>
        <button className="btn tiny ghost" onClick={() => pick((d) => weekdayOf(d) === weekdayOf(src.date))}>同じ曜日</button>
        <button className="btn tiny ghost" onClick={() => setSelected({})}>選択解除</button>
        <span className="legend"><i className="dot sub" />シフトあり</span>
      </div>
      {dates.length > 0 && (
        <div className="scroll-x" style={{ maxHeight: 180, overflowY: "auto" }}>
          <table className="tbl compact">
            <tbody>
              {plan.map((p) => (
                <tr key={p.date}>
                  <td className={`wd${weekdayOf(p.date)} nowrap`}>{fmtDate(p.date)}</td>
                  <td>{p.action === "create" ? <span className="tag green">新規</span> : p.action === "update" ? <span className="tag">上書き</span> : <span className="tag red">対象外</span>}</td>
                  <td className="small">
                    {p.action === "skip" ? "シフトがないためコピーしません" : <>
                      {p.target && opts.time && p.target.start + "〜" + p.target.end !== p.rec.start + "〜" + p.rec.end ? `${p.target.start}〜${p.target.end} → ` : ""}{p.rec.start}〜{p.rec.end}
                      {p.target && mine(p.date).length > 1 && <span className="muted">（同日の最初の勤務に適用）</span>}
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
