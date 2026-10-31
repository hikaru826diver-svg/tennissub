import { useMemo, useState } from "react";
import { aggregate, calcPayroll, daysInMonth, fmtDate, fmtMonth, hours, sortStaff, weekdayOf, yen } from "../../utils.js";
import { MonthInput } from "../../components.jsx";
import { exportPayroll } from "../../excel.js";

export default function Payroll({ store, settings, depts, ctx }) {
  const { data } = store;
  const [view, setView] = useState("staff");
  const [deptFilter, setDeptFilter] = useState("");
  const staffMap = useMemo(() => Object.fromEntries(data.staff.map((s) => [s.id, s])), [data.staff]);
  const all = useMemo(() => calcPayroll(data.shift.filter((s) => s.date.startsWith(ctx.month)), staffMap, settings), [data.shift, ctx.month, staffMap, settings]);
  const rows = deptFilter ? all.filter((r) => r.deptId === deptFilter) : all;
  const total = aggregate(rows, () => "t").t;
  const byDept = aggregate(all, (r) => r.deptId);
  const byStaff = aggregate(rows, (r) => r.staffId);
  const byDate = aggregate(rows, (r) => r.date);
  const byDateDept = aggregate(rows, (r) => `${r.date}|${r.deptId}`);
  const shownDepts = deptFilter ? depts.filter((d) => d.id === deptFilter) : depts;
  const staffIds = Object.keys(byStaff).sort((a, b) => sortStaff(staffMap[a] || { name: "" }, staffMap[b] || { name: "" }));

  return (
    <>
      <div className="row between wrap">
        <h1>アルバイト給与計算</h1>
        <button className="btn small" onClick={() => exportPayroll({ data, settings, depts, month: ctx.month })}>⬇ Excel出力</button>
      </div>
      <div className="card row wrap">
        <MonthInput value={ctx.month} onChange={(m) => ctx.set({ month: m })} />
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
          <option value="">全部門</option>
          {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="seg">
          <button className={view === "staff" ? "on" : ""} onClick={() => setView("staff")}>スタッフ別（月）</button>
          <button className={view === "dept" ? "on" : ""} onClick={() => setView("dept")}>部門別（月）</button>
          <button className={view === "daily" ? "on" : ""} onClick={() => setView("daily")}>日毎</button>
        </div>
      </div>

      <div className="kpis">
        <Kpi label={`${fmtMonth(ctx.month)} 支給総額`} value={yen(total?.total)} />
        <Kpi label="賃金" value={yen(total?.wagePay)} sub={`うち割増 ${yen((total?.otPay || 0) + (total?.nightPay || 0))}`} />
        <Kpi label="交通費" value={yen(total?.transport)} />
        <Kpi label="総労働時間" value={hours(total?.workMin)} sub={`延べ ${total?.days.size || 0}人日`} />
      </div>

      {view === "staff" && (
        <div className="card scroll-x">
          <table className="tbl">
            <thead><tr><th>氏名</th><th>区分</th><th className="r">時給</th><th className="r">出勤日数</th><th className="r">実働</th><th className="r">時間外</th><th className="r">深夜</th><th className="r">基本給</th><th className="r">割増</th><th className="r">交通費</th><th className="r">支給合計</th></tr></thead>
            <tbody>
              {staffIds.map((id) => {
                const a = byStaff[id], s = staffMap[id] || {};
                return (
                  <tr key={id}>
                    <td><b>{s.name || "(削除済)"}</b></td><td>{s.category}</td><td className="r">{yen(s.wage)}</td>
                    <td className="r">{a.days.size}日</td><td className="r">{hours(a.workMin)}</td><td className="r">{hours(a.otMin)}</td><td className="r">{hours(a.nightMin)}</td>
                    <td className="r">{yen(a.basePay)}</td><td className="r">{yen(a.otPay + a.nightPay)}</td><td className="r">{yen(a.transport)}</td><td className="r"><b>{yen(a.total)}</b></td>
                  </tr>
                );
              })}
              {!staffIds.length && <tr><td colSpan={11} className="muted center">シフトがありません</td></tr>}
            </tbody>
            {total && <tfoot><tr><th colSpan={3}>合計</th><td className="r">{total.days.size}</td><td className="r">{hours(total.workMin)}</td><td className="r">{hours(total.otMin)}</td><td className="r">{hours(total.nightMin)}</td><td className="r">{yen(total.basePay)}</td><td className="r">{yen(total.otPay + total.nightPay)}</td><td className="r">{yen(total.transport)}</td><td className="r"><b>{yen(total.total)}</b></td></tr></tfoot>}
          </table>
        </div>
      )}

      {view === "dept" && (
        <div className="card scroll-x">
          <table className="tbl">
            <thead><tr><th>部門</th><th className="r">延べ人日</th><th className="r">実働</th><th className="r">基本給</th><th className="r">割増</th><th className="r">交通費</th><th className="r">支給合計</th><th className="r">構成比</th></tr></thead>
            <tbody>
              {shownDepts.map((d) => {
                const a = byDept[d.id];
                const grand = aggregate(all, () => "t").t?.total || 1;
                return (
                  <tr key={d.id}>
                    <td><span className="dept-dot" style={{ background: d.color }} />{d.name}</td>
                    <td className="r">{a?.days.size || 0}</td><td className="r">{hours(a?.workMin)}</td><td className="r">{yen(a?.basePay)}</td>
                    <td className="r">{yen((a?.otPay || 0) + (a?.nightPay || 0))}</td><td className="r">{yen(a?.transport)}</td><td className="r"><b>{yen(a?.total)}</b></td>
                    <td className="r">{(((a?.total || 0) / grand) * 100).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
            {total && <tfoot><tr><th>合計</th><td className="r">{total.days.size}</td><td className="r">{hours(total.workMin)}</td><td className="r">{yen(total.basePay)}</td><td className="r">{yen(total.otPay + total.nightPay)}</td><td className="r">{yen(total.transport)}</td><td className="r"><b>{yen(total.total)}</b></td><td /></tr></tfoot>}
          </table>
        </div>
      )}

      {view === "daily" && (
        <div className="card scroll-x">
          <table className="tbl compact">
            <thead>
              <tr><th>日付</th>{shownDepts.map((d) => <th key={d.id} className="r">{d.name}</th>)}<th className="r">人数</th><th className="r">実働</th><th className="r">日計</th></tr>
            </thead>
            <tbody>
              {daysInMonth(ctx.month).map((d) => (
                <tr key={d}>
                  <td className={`wd${weekdayOf(d)} nowrap`}>{fmtDate(d)}</td>
                  {shownDepts.map((dp) => <td key={dp.id} className="r">{byDateDept[`${d}|${dp.id}`] ? yen(byDateDept[`${d}|${dp.id}`].total) : ""}</td>)}
                  <td className="r">{byDate[d]?.days.size || ""}</td>
                  <td className="r">{byDate[d] ? hours(byDate[d].workMin) : ""}</td>
                  <td className="r"><b>{byDate[d] ? yen(byDate[d].total) : ""}</b></td>
                </tr>
              ))}
            </tbody>
            {total && <tfoot><tr><th>合計</th>{shownDepts.map((d) => <td key={d.id} className="r">{yen(byDept[d.id]?.total)}</td>)}<td className="r">{total.days.size}</td><td className="r">{hours(total.workMin)}</td><td className="r"><b>{yen(total.total)}</b></td></tr></tfoot>}
          </table>
        </div>
      )}

      <p className="muted small">
        計算ルール：実働＝勤務時間−休憩。時間外割増（1日8時間超）{settings.overtimePremium ? `${settings.overtimeRate * 100}%` : "なし"}、深夜割増（22:00〜翌5:00）{settings.nightPremium ? `${settings.nightRate * 100}%` : "なし"}。
        交通費は出勤1日につき1回（その日最初のシフトの部門に計上）。金額はシフト単位で円未満を四捨五入。社会保険料・所得税等の控除前の概算額です。
      </p>
    </>
  );
}

function Kpi({ label, value, sub }) {
  return (
    <div className="kpi">
      <div className="muted small">{label}</div>
      <div className="kpi-v">{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}
