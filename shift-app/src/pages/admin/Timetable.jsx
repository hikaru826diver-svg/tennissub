import { useMemo } from "react";
import { fmtDate, hours, shortTime, sortStaff, toMin, weekdayOf } from "../../utils.js";
import { exportTimetable } from "../../excel.js";

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

export default function Timetable({ store, settings, depts, ctx }) {
  const { data } = store;
  const date = ctx.date && ctx.date.startsWith(ctx.month) ? ctx.date : `${ctx.month}-01`;
  const deptView = ctx.ttDept ?? ctx.deptId; // "" = 全部門
  const staffMap = useMemo(() => Object.fromEntries(data.staff.map((s) => [s.id, s])), [data.staff]);

  const moveDay = (n) => {
    const [y, m, d] = date.split("-").map(Number);
    const x = new Date(y, m - 1, d + n);
    const nd = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    ctx.set({ date: nd, month: nd.slice(0, 7) });
  };
  const shownDepts = deptView ? depts.filter((d) => d.id === deptView) : depts;
  const dayShifts = data.shift.filter((s) => s.date === date && shownDepts.some((d) => d.id === s.deptId));
  const tl = buildTimeline(settings, dayShifts);

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
        <span className="muted small">※シフト作成ツールで登録したシフトが自動反映されます</span>
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
              <table className="tt">
                <thead>
                  <tr>
                    <th className="sticky name-col">氏名</th>
                    <th className="sticky2">時間</th>
                    {tl.slots.filter((m) => m % 60 === 0).map((m) => <th key={m} colSpan={60 / SLOT} className="hour">{m / 60}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => {
                    const st = toMin(s.start), en = toMin(s.end);
                    return (
                      <tr key={s.id}>
                        <td className="sticky name-col"><b>{staffMap[s.staffId]?.name || "(削除済)"}</b></td>
                        <td className="sticky2 nowrap small">{shortTime(s.start)}〜{shortTime(s.end)}{s.breakMin ? <div className="muted">休{s.breakMin}分 / 実{hours(en - st - s.breakMin)}</div> : null}</td>
                        {tl.slots.map((m) => {
                          const on = m >= st && m < en;
                          return <td key={m} className={`slot ${m % 60 === 0 ? "h" : ""} ${on ? "on" : ""} ${on && m === st ? "first" : ""}`} style={on ? { background: dept.color } : undefined} />;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th className="sticky name-col">人数</th>
                    <th className="sticky2" />
                    {tl.slots.map((m, i) => {
                      const cnt = (x) => list.filter((s) => x >= toMin(s.start) && x < toMin(s.end)).length;
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
    </>
  );
}
