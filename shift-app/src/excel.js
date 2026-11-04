// ===== Excel 出力（exceljs を必要時に読み込み） =====
import { aggregate, taskSegSlots, breaksText, calcPayroll, datesBetween, payMonthOf, inBreak, taskAt, taskColor, rosterStaff, daysInMonth, fmtDate, fmtMonth, shortTime, sortStaff, toMin, weekdayOf, WEEK } from "./utils.js";

const THIN = { style: "thin", color: { argb: "FFBFBFBF" } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
const SAT = "FF1E5BB8";
const SUN = "FFC62828";
const argb = (hex) => "FF" + (hex || "#2f80ed").replace("#", "").toUpperCase();
const lighten = (hex, r = 0.6) => {
  const h = (hex || "#2f80ed").replace("#", "");
  const c = [0, 2, 4].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) + (255 - parseInt(h.slice(i, i + 2), 16)) * r));
  return "FF" + c.map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
};
const safeSheet = (s) => s.replace(/[\\/?*[\]:]/g, "_").slice(0, 31);

async function newBook() {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "シフト作成アプリ";
  wb.created = new Date();
  return wb;
}
async function download(wb, name) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function styleRange(ws, r1, c1, r2, c2, style) {
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) Object.assign(ws.getCell(r, c), style);
}
const wdColor = (d) => (weekdayOf(d) === 0 ? SUN : weekdayOf(d) === 6 ? SAT : "FF000000");

// ---------- シフト表（部門×月） ----------
export async function exportShiftTable({ data, settings, depts, month }) {
  const wb = await newBook();
  const staffMap = Object.fromEntries(data.staff.map((s) => [s.id, s]));
  const monthShifts = data.shift.filter((s) => s.date.startsWith(month));
  const pay = calcPayroll(monthShifts, staffMap, settings);
  const days = daysInMonth(month);

  for (const dept of depts) {
    const ws = wb.addWorksheet(safeSheet(dept.name), {
      pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
      views: [{ state: "frozen", xSplit: 2, ySplit: 4 }],
    });
    const shifts = monthShifts.filter((s) => s.deptId === dept.id);
    const deptPay = pay.filter((r) => r.deptId === dept.id);
    const byStaff = aggregate(deptPay, (r) => r.staffId);
    const staff = rosterStaff(data, dept.id, month);
    const lastCol = 2 + days.length + 3;

    ws.mergeCells(1, 1, 1, lastCol);
    ws.getCell(1, 1).value = `${settings.orgName}　${dept.name}　${fmtMonth(month)} シフト表`;
    ws.getCell(1, 1).font = { size: 14, bold: true };
    ws.getCell(2, 1).value = `出力日時：${new Date().toLocaleString("ja-JP")}`;
    ws.getCell(2, 1).font = { size: 9, color: { argb: "FF666666" } };

    // ヘッダー（日付・曜日）
    ws.getCell(3, 1).value = "氏名";
    ws.getCell(3, 2).value = "区分";
    ws.mergeCells(3, 1, 4, 1);
    ws.mergeCells(3, 2, 4, 2);
    days.forEach((d, i) => {
      const c = 3 + i;
      ws.getCell(3, c).value = Number(d.slice(8));
      ws.getCell(4, c).value = WEEK[weekdayOf(d)];
      ws.getCell(3, c).font = ws.getCell(4, c).font = { bold: true, color: { argb: wdColor(d) } };
    });
    ["出勤日数", "実働時間", "給与概算"].forEach((t, i) => {
      ws.getCell(3, 3 + days.length + i).value = t;
      ws.mergeCells(3, 3 + days.length + i, 4, 3 + days.length + i);
    });
    styleRange(ws, 3, 1, 4, lastCol, { fill: HEAD_FILL, border: BORDER, alignment: { horizontal: "center", vertical: "middle", wrapText: true } });
    for (let c = 1; c <= 2; c++) ws.getCell(3, c).font = { bold: true };

    let r = 5;
    for (const st of staff) {
      ws.getCell(r, 1).value = st.name;
      ws.getCell(r, 2).value = st.category || "";
      days.forEach((d, i) => {
        const list = shifts.filter((s) => s.staffId === st.id && s.date === d).sort((a, b) => a.start.localeCompare(b.start));
        const cell = ws.getCell(r, 3 + i);
        if (list.length) {
          cell.value = list.map((s) => `${s.start}\n${s.end}`).join("\n");
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: lighten(dept.color, 0.75) } };
        }
      });
      const a = byStaff[st.id];
      ws.getCell(r, 3 + days.length).value = a?.days.size || 0;
      ws.getCell(r, 4 + days.length).value = a ? Math.round((a.workMin / 60) * 100) / 100 : 0;
      ws.getCell(r, 5 + days.length).value = a?.total || 0;
      ws.getRow(r).height = 30;
      r++;
    }
    // 集計行
    const sumRows = [
      ["出勤人数", (d) => new Set(shifts.filter((s) => s.date === d).map((s) => s.staffId)).size || ""],
      ["労働時間", (d) => { const m = deptPay.filter((p) => p.date === d).reduce((s, p) => s + p.workMin, 0); return m ? Math.round((m / 60) * 10) / 10 : ""; }],
      ["人件費", (d) => deptPay.filter((p) => p.date === d).reduce((s, p) => s + p.total, 0) || ""],
    ];
    const tot = aggregate(deptPay, () => "t").t;
    sumRows.forEach(([label, fn], k) => {
      ws.getCell(r, 1).value = label;
      ws.mergeCells(r, 1, r, 2);
      days.forEach((d, i) => (ws.getCell(r, 3 + i).value = fn(d)));
      if (k === 0) {
        ws.getCell(r, 3 + days.length).value = tot?.days.size || 0;
        ws.getCell(r, 4 + days.length).value = tot ? Math.round((tot.workMin / 60) * 100) / 100 : 0;
        ws.getCell(r, 5 + days.length).value = tot?.total || 0;
      }
      styleRange(ws, r, 1, r, lastCol, { fill: HEAD_FILL });
      ws.getCell(r, 1).font = { bold: true };
      r++;
    }
    );
    styleRange(ws, 5, 1, r - 1, lastCol, { border: BORDER });
    for (let rr = 5; rr < r; rr++) {
      for (let c = 3; c < 3 + days.length; c++) ws.getCell(rr, c).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      ws.getCell(rr, 1).alignment = { vertical: "middle" };
      ws.getCell(rr, 3 + days.length + 1).numFmt = "0.00";
      ws.getCell(rr, 3 + days.length + 2).numFmt = "#,##0";
    }
    for (let c = 3; c < 3 + days.length; c++) ws.getCell(r - 1, c).numFmt = "#,##0";
    for (let c = 3; c < 3 + days.length; c++) ws.getCell(r - 1, c).font = { size: 8 };
    ws.getColumn(1).width = 14;
    ws.getColumn(2).width = 8;
    days.forEach((_, i) => (ws.getColumn(3 + i).width = 6.4));
    ws.getColumn(3 + days.length).width = 8;
    ws.getColumn(4 + days.length).width = 9;
    ws.getColumn(5 + days.length).width = 11;
    ws.getRow(3).height = 18;
  }
  await download(wb, `シフト表_${month}${depts.length === 1 ? `_${depts[0].name}` : ""}.xlsx`);
}

// ---------- タイムテーブル（日×部門） ----------
const SLOT = 15;
export async function exportTimetable({ data, settings, depts, dates, month }) {
  dates = dates || daysInMonth(month);
  const wb = await newBook();
  const staffMap = Object.fromEntries(data.staff.map((s) => [s.id, s]));

  for (const date of dates) {
    const dayShifts = data.shift.filter((s) => s.date === date && depts.some((d) => d.id === s.deptId));
    if (month && !dayShifts.length) continue; // 月間出力時、シフトのない日は省略
    let start = settings.dayStart * 60, end = settings.dayEnd * 60;
    dayShifts.forEach((s) => { start = Math.min(start, Math.floor(toMin(s.start) / 60) * 60); end = Math.max(end, Math.ceil(toMin(s.end) / 60) * 60); });
    const slots = [];
    for (let m = start; m < end; m += SLOT) slots.push(m);
    const C0 = 4; // 時間帯の開始列
    const lastCol = C0 + slots.length - 1;

    const ws = wb.addWorksheet(safeSheet(`${Number(date.slice(5, 7))}-${Number(date.slice(8))}(${WEEK[weekdayOf(date)]})`), {
      pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    });
    ws.mergeCells(1, 1, 1, lastCol);
    ws.getCell(1, 1).value = `${settings.orgName}　タイムテーブル　${date.slice(0, 4)}年${fmtDate(date)}`;
    ws.getCell(1, 1).font = { size: 14, bold: true };
    ws.getColumn(1).width = 14;
    ws.getColumn(2).width = 12;
    ws.getColumn(3).width = 12;
    slots.forEach((_, i) => (ws.getColumn(C0 + i).width = 1.6));

    const taskRows = new Set(); // 業務がある行（縦書きのため高くする）
    let r = 3;
    for (const dept of depts) {
      const list = dayShifts.filter((s) => s.deptId === dept.id).sort((a, b) => a.start.localeCompare(b.start));
      if (!list.length && month) continue;
      ws.mergeCells(r, 1, r, lastCol);
      ws.getCell(r, 1).value = `■ ${dept.name}（${new Set(list.map((s) => s.staffId)).size}名）`;
      ws.getCell(r, 1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      ws.getCell(r, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(dept.color) } };
      r++;
      // 時刻ヘッダー
      ws.getCell(r, 1).value = "氏名";
      ws.getCell(r, 2).value = "勤務時間";
      ws.getCell(r, 3).value = "休憩";
      slots.forEach((m, i) => {
        if (m % 60 === 0) {
          ws.mergeCells(r, C0 + i, r, C0 + i + 3);
          ws.getCell(r, C0 + i).value = m / 60;
        }
      });
      styleRange(ws, r, 1, r, lastCol, { fill: HEAD_FILL, border: BORDER, alignment: { horizontal: "center" }, font: { bold: true, size: 9 } });
      r++;
      const first = r;
      for (const s of list) {
        ws.getCell(r, 1).value = staffMap[s.staffId]?.name || "";
        ws.getCell(r, 2).value = `${shortTime(s.start)}〜${shortTime(s.end)}`;
        ws.getCell(r, 3).value = [s.breaks?.length ? breaksText(s.breaks) : s.breakMin ? `${s.breakMin}分` : "", s.memo ? `メモ:${s.memo}` : ""].filter(Boolean).join("\n");
        ws.getCell(r, 3).font = { size: 8 };
        ws.getCell(r, 3).alignment = { wrapText: true, vertical: "middle" };
        const st = toMin(s.start), en = toMin(s.end);
        let hasTask = false;
        slots.forEach((m, i) => {
          if (m >= st && m < en) {
            const cell = ws.getCell(r, C0 + i);
            const task = inBreak(s, m) ? null : taskAt(s, m);
            cell.fill = inBreak(s, m)
              ? { type: "pattern", pattern: "lightUp", fgColor: { argb: argb(dept.color) }, bgColor: { argb: "FFFFFFFF" } }
              : { type: "pattern", pattern: "solid", fgColor: { argb: argb(task ? taskColor(task.label, settings.taskLabels || []) : dept.color) } };
            if (task && (m === toMin(task.start) || m === st || inBreak(s, m - SLOT))) {
              // 業務名は縦書き・区間を結合して中央に表示
              const n = taskSegSlots(s, m, SLOT);
              if (n > 1) ws.mergeCells(r, C0 + i, r, C0 + i + n - 1);
              cell.value = task.label;
              cell.font = { size: 8, bold: true };
              cell.alignment = { vertical: "middle", horizontal: "center", textRotation: "vertical" };
              hasTask = true;
            }
          }
        });
        if (hasTask) taskRows.add(r);
        r++;
      }
      if (!list.length) {
        ws.getCell(r, 1).value = "シフトなし";
        r++;
      }
      // 人数行
      ws.getCell(r, 1).value = "人数";
      slots.forEach((m, i) => {
        const n = list.filter((s) => m >= toMin(s.start) && m < toMin(s.end) && !inBreak(s, m)).length;
        if (m % 60 === 0) {
          ws.mergeCells(r, C0 + i, r, C0 + i + 1);
          ws.mergeCells(r, C0 + i + 2, r, C0 + i + 3);
        }
        if (m % 30 === 0) ws.getCell(r, C0 + i).value = n || "";
      });
      styleRange(ws, r, 1, r, lastCol, { fill: HEAD_FILL, font: { bold: true, size: 9 }, alignment: { horizontal: "center" } });
      // 罫線（1時間ごとに区切り線）
      for (let rr = first; rr <= r; rr++) {
        for (let c = 1; c <= lastCol; c++) {
          const cell = ws.getCell(rr, c);
          const isHour = c >= C0 && (slots[c - C0] % 60 === 0);
          cell.border = { top: THIN, bottom: THIN, left: c < C0 || isHour ? THIN : undefined, right: c === lastCol ? THIN : undefined };
        }
        ws.getRow(rr).height = taskRows.has(rr) ? 54 : 18;
      }
      r += 2;
    }
    if (r === 3) ws.getCell(3, 1).value = "この日のシフトはありません";
  }
  if (!wb.worksheets.length) wb.addWorksheet("データなし").getCell(1, 1).value = "対象期間のシフトはありません";
  const label = month ? month : dates[0];
  await download(wb, `タイムテーブル_${label}${depts.length === 1 ? `_${depts[0].name}` : ""}.xlsx`);
}

// ---------- 給与 ----------
export async function exportPayroll({ data, settings, depts, from, to, label }) {
  const dates = datesBetween(from, to);
  const wb = await newBook();
  const staffMap = Object.fromEntries(data.staff.map((s) => [s.id, s]));
  const deptMap = Object.fromEntries(depts.map((d) => [d.id, d]));
  const rows = calcPayroll(data.shift.filter((s) => s.date >= from && s.date <= to), staffMap, settings);
  const h = (m) => Math.round((m / 60) * 100) / 100;

  const sheet = (name, title, header, body, footer, widths) => {
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 3 }], pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.getCell(1, 1).value = `${settings.orgName}　${label}　${title}`;
    ws.getCell(1, 1).font = { size: 14, bold: true };
    ws.addRow([]);
    ws.addRow(header);
    body.forEach((b) => ws.addRow(b));
    if (footer) ws.addRow(footer);
    const last = ws.rowCount;
    styleRange(ws, 3, 1, 3, header.length, { fill: HEAD_FILL, font: { bold: true }, alignment: { horizontal: "center", vertical: "middle", wrapText: true } });
    styleRange(ws, 3, 1, last, header.length, { border: BORDER });
    if (footer) styleRange(ws, last, 1, last, header.length, { fill: HEAD_FILL, font: { bold: true } });
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    return ws;
  };
  const fmt = (ws, cols, f) => cols.forEach((c) => ws.getColumn(c).eachCell((cell, rn) => rn > 3 && (cell.numFmt = f)));

  // スタッフ別
  const bs = aggregate(rows, (r) => r.staffId);
  const ids = Object.keys(bs).sort((a, b) => sortStaff(staffMap[a] || { name: "" }, staffMap[b] || { name: "" }));
  const tot = aggregate(rows, () => "t").t;
  const ws1 = sheet("スタッフ別", "給与集計（スタッフ別）",
    ["氏名", "区分", "時給", "出勤日数", "実働(h)", "時間外(h)", "深夜(h)", "基本給", "時間外割増", "深夜割増", "交通費", "支給合計"],
    ids.map((id) => { const a = bs[id], s = staffMap[id] || {}; return [s.name || "(削除済)", s.category || "", s.wage || 0, a.days.size, h(a.workMin), h(a.otMin), h(a.nightMin), a.basePay, a.otPay, a.nightPay, a.transport, a.total]; }),
    tot ? ["合計", "", "", tot.days.size, h(tot.workMin), h(tot.otMin), h(tot.nightMin), tot.basePay, tot.otPay, tot.nightPay, tot.transport, tot.total] : null,
    [14, 9, 8, 9, 9, 9, 9, 11, 11, 11, 10, 12]);
  fmt(ws1, [3, 8, 9, 10, 11, 12], "#,##0");
  fmt(ws1, [5, 6, 7], "0.00");

  // 部門別
  const bd = aggregate(rows, (r) => r.deptId);
  const ws2 = sheet("部門別", "給与集計（部門別）",
    ["部門", "延べ人日", "実働(h)", "基本給", "割増", "交通費", "支給合計"],
    depts.map((d) => { const a = bd[d.id]; return [d.name, a?.days.size || 0, h(a?.workMin || 0), a?.basePay || 0, (a?.otPay || 0) + (a?.nightPay || 0), a?.transport || 0, a?.total || 0]; }),
    tot ? ["合計", tot.days.size, h(tot.workMin), tot.basePay, tot.otPay + tot.nightPay, tot.transport, tot.total] : null,
    [16, 10, 10, 12, 12, 12, 14]);
  fmt(ws2, [4, 5, 6, 7], "#,##0");

  // 日毎×部門
  const bdd = aggregate(rows, (r) => `${r.date}|${r.deptId}`);
  const bdate = aggregate(rows, (r) => r.date);
  const ws3 = sheet("日毎", "人件費（日毎・部門別）",
    ["日付", ...depts.map((d) => d.name), "人数", "実働(h)", "日計"],
    dates.map((d) => [`${d.slice(0, 4)}/${fmtDate(d)}`, ...depts.map((dp) => bdd[`${d}|${dp.id}`]?.total || 0), bdate[d]?.days.size || 0, h(bdate[d]?.workMin || 0), bdate[d]?.total || 0]),
    ["合計", ...depts.map((d) => bd[d.id]?.total || 0), tot?.days.size || 0, h(tot?.workMin || 0), tot?.total || 0],
    [11, ...depts.map(() => 12), 7, 9, 12]);
  fmt(ws3, [...depts.map((_, i) => i + 2), depts.length + 4], "#,##0");
  ws3.eachRow((row, rn) => {
    if (rn > 3 && rn < 4 + dates.length) {
      const d = dates[rn - 4];
      row.getCell(1).font = { color: { argb: wdColor(d) } };
    }
  });

  // 明細
  const detail = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const ws4 = sheet("明細", "勤務明細",
    ["日付", "部門", "氏名", "開始", "終了", "休憩(分)", "実働(h)", "時間外(h)", "深夜(h)", "時給", "基本給", "割増", "交通費", "合計"],
    detail.map((r) => [fmtDate(r.date), deptMap[r.deptId]?.name || "", staffMap[r.staffId]?.name || "", r.start, r.end, r.breakMin, h(r.workMin), h(r.otMin), h(r.nightMin), r.wage, r.basePay, r.otPay + r.nightPay, r.transport, r.total]),
    null,
    [11, 12, 14, 7, 7, 8, 8, 9, 8, 8, 10, 9, 9, 10]);
  fmt(ws4, [10, 11, 12, 13, 14], "#,##0");

  // 月別（複数の給与月にまたがる場合）
  const months = [...new Set(dates.map((d) => payMonthOf(d, settings.closingDay)))];
  if (months.length > 1) {
    const bm = aggregate(rows, (r) => payMonthOf(r.date, settings.closingDay));
    const bmd = aggregate(rows, (r) => `${payMonthOf(r.date, settings.closingDay)}|${r.deptId}`);
    const ws5 = sheet("月別", "人件費（月別・部門別）",
      ["給与月", ...depts.map((d) => d.name), "延べ人日", "実働(h)", "月計"],
      months.map((m) => [fmtMonth(m), ...depts.map((dp) => bmd[`${m}|${dp.id}`]?.total || 0), bm[m]?.days.size || 0, h(bm[m]?.workMin || 0), bm[m]?.total || 0]),
      ["合計", ...depts.map((d) => bd[d.id]?.total || 0), tot?.days.size || 0, h(tot?.workMin || 0), tot?.total || 0],
      [12, ...depts.map(() => 12), 9, 9, 12]);
    fmt(ws5, [...depts.map((_, i) => i + 2), depts.length + 4], "#,##0");
  }
  await download(wb, `給与集計_${from}_${to}.xlsx`);
}

// ---------- 操作履歴 ----------
export async function exportAudit({ facility, rows, kindLabel, actionLabel }) {
  const wb = await newBook();
  const ws = wb.addWorksheet("操作履歴", { views: [{ state: "frozen", ySplit: 3 }], pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.getCell(1, 1).value = `${facility.name}　操作履歴（出力日時：${new Date().toLocaleString("ja-JP")}）`;
  ws.getCell(1, 1).font = { size: 14, bold: true };
  ws.addRow([]);
  ws.addRow(["日時", "操作者", "操作", "種類", "内容"]);
  rows.forEach((a) => ws.addRow([new Date(a.at).toLocaleString("ja-JP"), a.actor, actionLabel[a.action] || a.action, kindLabel[a.kind] || a.kind, a.summary]));
  styleRange(ws, 3, 1, 3, 5, { fill: HEAD_FILL, font: { bold: true } });
  styleRange(ws, 3, 1, ws.rowCount, 5, { border: BORDER });
  [20, 26, 8, 16, 80].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getColumn(5).alignment = { wrapText: true, vertical: "top" };
  await download(wb, `操作履歴_${facility.code}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
