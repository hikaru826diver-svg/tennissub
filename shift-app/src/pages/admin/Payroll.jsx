import { useMemo, useState } from "react";
import { addMonths, aggregate, payMonthOf, calcPayroll, datesBetween, fmtDate, fmtMonth, fmtPeriod, hours, payPeriod, sortStaff, thisMonth, weekdayOf, yen } from "../../utils.js";
import { MonthInput } from "../../components.jsx";
import { exportPayroll } from "../../excel.js";

export default function Payroll({ store, settings, depts, ctx }) {
  const { data } = store;
  const closing = settings.closingDay;
  const [mode, setMode] = useState("month"); // month | range
  const [range, setRange] = useState(() => payPeriod(ctx.month, closing));
  const [view, setView] = useState("staff");
  const [deptFilter, setDeptFilter] = useState("");

  const period = mode === "month" ? payPeriod(ctx.month, closing) : range;
  const valid = period.from && period.to && period.from <= period.to;
  const dates = useMemo(() => (valid ? datesBetween(period.from, period.to) : []), [period.from, period.to, valid]);
  const title = mode === "month" ? `${fmtMonth(ctx.month)}分` : "期間";
  const label = `${title}（${valid ? fmtPeriod(period.from, period.to) : "-"}）`;

  // 期間のプリセット（給与月単位）
  const cur = thisMonth();
  const presets = [
    ["今月分", cur, cur],
    ["前月分", addMonths(cur, -1), addMonths(cur, -1)],
    ["直近3ヶ月", addMonths(cur, -2), cur],
    ["直近6ヶ月", addMonths(cur, -5), cur],
    ["今年度(4月〜)", `${Number(cur.slice(5)) >= 4 ? cur.slice(0, 4) : Number(cur.slice(0, 4)) - 1}-04`, cur],
    ["今年(1月〜)", `${cur.slice(0, 4)}-01`, cur],
  ];
  const applyPreset = (fromYm, toYm) => setRange({ from: payPeriod(fromYm, closing).from, to: payPeriod(toYm, closing).to });

  const staffMap = useMemo(() => Object.fromEntries(data.staff.map((s) => [s.id, s])), [data.staff]);
  const all = useMemo(
    () => (valid ? calcPayroll(data.shift.filter((s) => s.date >= period.from && s.date <= period.to), staffMap, settings) : []),
    [data.shift, period.from, period.to, valid, staffMap, settings]
  );
  const rows = deptFilter ? all.filter((r) => r.deptId === deptFilter) : all;
  const total = aggregate(rows, () => "t").t;
  const grand = aggregate(all, () => "t").t?.total || 1;
  const byDept = aggregate(all, (r) => r.deptId);
  const byStaff = aggregate(rows, (r) => r.staffId);
  const byDate = aggregate(rows, (r) => r.date);
  const byDateDept = aggregate(rows, (r) => `${r.date}|${r.deptId}`);
  const byMonth = aggregate(rows, (r) => payMonthOf(r.date, closing));
  const byMonthDept = aggregate(rows, (r) => `${payMonthOf(r.date, closing)}|${r.deptId}`);
  const months = [...new Set(dates.map((d) => payMonthOf(d, closing)))];
  const shownDepts = deptFilter ? depts.filter((d) => d.id === deptFilter) : depts;
  const staffIds = Object.keys(byStaff).sort((a, b) => sortStaff(staffMap[a] || { name: "" }, staffMap[b] || { name: "" }));

  const VIEWS = [["staff", "スタッフ別"], ["dept", "部門別"], ["daily", "日毎"], ...(months.length > 1 ? [["monthly", "月別"]] : [])];
  const curView = VIEWS.some(([k]) => k === view) ? view : "staff";

  return (
    <>
      <div className="row between wrap">
        <h1>アルバイト給与計算</h1>
        <button className="btn small" disabled={!valid} onClick={() => exportPayroll({ data, settings, depts, from: period.from, to: period.to, label })}>⬇ Excel出力</button>
      </div>
      <div className="card">
        <div className="row wrap">
          <div className="seg">
            <button className={mode === "month" ? "on" : ""} onClick={() => setMode("month")}>単月</button>
            <button className={mode === "range" ? "on" : ""} onClick={() => { if (mode !== "range") setRange(payPeriod(ctx.month, closing)); setMode("range"); }}>期間指定</button>
          </div>
          {mode === "month" ? (
            <>
              <MonthInput value={ctx.month} onChange={(m) => ctx.set({ month: m })} />
              <span className="muted small">対象：{fmtPeriod(period.from, period.to)}{Number(closing) > 0 && Number(closing) < 29 ? `（${closing}日締め）` : "（末日締め）"}</span>
            </>
          ) : (
            <>
              <input type="date" value={range.from} max={range.to || undefined} onChange={(e) => setRange({ ...range, from: e.target.value })} />〜
              <input type="date" value={range.to} min={range.from || undefined} onChange={(e) => setRange({ ...range, to: e.target.value })} />
              <span className="muted small">{valid ? `${dates.length}日間` : "開始日と終了日を正しく指定してください"}</span>
            </>
          )}
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">全部門</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        {mode === "range" && (
          <div className="row wrap small" style={{ marginTop: 8 }}>
            <span className="muted">よく使う期間：</span>
            {presets.map(([name, f, t]) => <button key={name} className="btn tiny ghost" onClick={() => applyPreset(f, t)}>{name}</button>)}
            <span className="muted">（給与月単位{Number(closing) > 0 && Number(closing) < 29 ? `・${closing}日締め` : ""}）</span>
          </div>
        )}
        <div className="row wrap" style={{ marginTop: 8 }}>
          <div className="seg">
            {VIEWS.map(([k, name]) => <button key={k} className={curView === k ? "on" : ""} onClick={() => setView(k)}>{name}</button>)}
          </div>
        </div>
      </div>

      <div className="kpis">
        <Kpi label={`${label} 支給総額`} value={yen(total?.total)} />
        <Kpi label="賃金" value={yen(total?.wagePay)} sub={`うち割増 ${yen((total?.otPay || 0) + (total?.nightPay || 0))}`} />
        <Kpi label="交通費" value={yen(total?.transport)} />
        <Kpi label="総労働時間" value={hours(total?.workMin)} sub={`延べ ${total?.days.size || 0}人日`} />
      </div>

      {curView === "staff" && (
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

      {curView === "dept" && (
        <div className="card scroll-x">
          <table className="tbl">
            <thead><tr><th>部門</th><th className="r">延べ人日</th><th className="r">実働</th><th className="r">基本給</th><th className="r">割増</th><th className="r">交通費</th><th className="r">支給合計</th><th className="r">構成比</th></tr></thead>
            <tbody>
              {shownDepts.map((d) => {
                const a = byDept[d.id];
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

      {curView === "monthly" && (
        <div className="card scroll-x">
          <table className="tbl compact">
            <thead><tr><th>給与月</th>{shownDepts.map((d) => <th key={d.id} className="r">{d.name}</th>)}<th className="r">延べ人日</th><th className="r">実働</th><th className="r">月計</th></tr></thead>
            <tbody>
              {months.map((m) => (
                <tr key={m}>
                  <td className="nowrap">{fmtMonth(m)}</td>
                  {shownDepts.map((dp) => <td key={dp.id} className="r">{byMonthDept[`${m}|${dp.id}`] ? yen(byMonthDept[`${m}|${dp.id}`].total) : ""}</td>)}
                  <td className="r">{byMonth[m]?.days.size || ""}</td>
                  <td className="r">{byMonth[m] ? hours(byMonth[m].workMin) : ""}</td>
                  <td className="r"><b>{byMonth[m] ? yen(byMonth[m].total) : ""}</b></td>
                </tr>
              ))}
            </tbody>
            {total && <tfoot><tr><th>合計</th>{shownDepts.map((d) => <td key={d.id} className="r">{yen(aggregate(rows.filter((r) => r.deptId === d.id), () => "t").t?.total)}</td>)}<td className="r">{total.days.size}</td><td className="r">{hours(total.workMin)}</td><td className="r"><b>{yen(total.total)}</b></td></tr></tfoot>}
          </table>
        </div>
      )}

      {curView === "daily" && (
        <div className="card scroll-x">
          <table className="tbl compact">
            <thead>
              <tr><th>日付</th>{shownDepts.map((d) => <th key={d.id} className="r">{d.name}</th>)}<th className="r">人数</th><th className="r">実働</th><th className="r">日計</th></tr>
            </thead>
            <tbody>
              {dates.map((d) => (
                <tr key={d}>
                  <td className={`wd${weekdayOf(d)} nowrap`}>{dates.length > 31 || d.slice(0, 4) !== dates[0].slice(0, 4) ? `${d.slice(0, 4)}/` : ""}{fmtDate(d)}</td>
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
        単月は「回収・各種設定」の給与締め日に基づく期間で集計します。
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
