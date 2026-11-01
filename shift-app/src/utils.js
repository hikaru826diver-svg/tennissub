// ===== 日付・時刻ユーティリティ =====
export const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

export const pad = (n) => String(n).padStart(2, "0");
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** "HH:MM" -> 分 (24:00 以降も可: "25:00" = 1500) */
export function toMin(t) {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}
/** 分 -> "HH:MM" */
export function toHHMM(min) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}
/** 表示用短縮 "09:00" -> "9:00" */
export const shortTime = (t) => (t ? t.replace(/^0/, "") : "");

/** 指定刻みの時刻リスト */
export function timeOptions(startHour = 0, endHour = 24, stepMin = 30) {
  const out = [];
  for (let m = startHour * 60; m <= endHour * 60; m += stepMin) out.push(toHHMM(m));
  return out;
}

/** "YYYY-MM" の日付配列 ["YYYY-MM-01", ...] */
export function daysInMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${ym}-${pad(i + 1)}`);
}
export function weekdayOf(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}
export function thisMonth(offset = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function fmtDate(date) {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}(${WEEK[weekdayOf(date)]})`;
}
export function fmtMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${y}年${m}月`;
}
export const yen = (n) => `¥${Math.round(n || 0).toLocaleString("ja-JP")}`;
export const hours = (min) => `${(Math.round(((min || 0) / 60) * 100) / 100).toFixed(2)}h`;

/**
 * 労働基準法第34条に基づく法定休憩の最低時間
 * 6時間超 → 45分、8時間超 → 60分
 */
export function legalBreak(spanMin) {
  if (spanMin > 480) return 60;
  if (spanMin > 360) return 45;
  return 0;
}

// ===== 給与計算 =====
const NIGHT_RANGES = [
  [0, 5 * 60],
  [22 * 60, 29 * 60], // 22:00〜翌5:00
  [46 * 60, 48 * 60],
];
function overlap(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}
function nightMinutes(start, end) {
  return NIGHT_RANGES.reduce((s, [a, b]) => s + overlap(start, end, a, b), 0);
}

/**
 * シフト一覧から給与明細行を計算する
 * - 実働 = 拘束時間 − 休憩
 * - 時間外割増: 同一スタッフの1日実働合計が 8時間 を超えた分に 25%（settings.overtime）
 * - 深夜割増: 22:00〜翌5:00 の勤務に 25%（settings.night）
 * - 交通費: スタッフの「1日あたり交通費」を出勤日ごとに1回（その日最初のシフトの部門に計上）
 * 休憩は日中時間帯から控除したものとして扱う（深夜時間は控除しない）
 * @returns 各シフトに pay 情報を付与した配列
 */
export function calcPayroll(shifts, staffMap, settings = {}) {
  const otOn = settings.overtimePremium !== false;
  const nightOn = settings.nightPremium !== false;
  const otRate = Number(settings.overtimeRate ?? 0.25);
  const nightRate = Number(settings.nightRate ?? 0.25);

  // スタッフ×日でグループ化
  const groups = {};
  for (const s of shifts) {
    const key = `${s.staffId}|${s.date}`;
    (groups[key] ||= []).push(s);
  }
  const result = [];
  for (const list of Object.values(groups)) {
    list.sort((a, b) => toMin(a.start) - toMin(b.start));
    let worked = 0;
    list.forEach((s, idx) => {
      const staff = staffMap[s.staffId] || {};
      const wage = Number(s.wage ?? staff.wage ?? 0);
      const st = toMin(s.start);
      let en = toMin(s.end);
      if (en <= st) en += 24 * 60; // 日跨ぎ
      const span = en - st;
      const ranges = breakMinRanges(s.breaks, st);
      const brk = ranges.length ? Math.min(span, ranges.reduce((a, [b1, b2]) => a + overlap(st, en, b1, b2), 0)) : Math.min(span, Number(s.breakMin || 0));
      const work = span - brk;
      // 休憩時間帯が登録されていれば深夜帯の休憩を正確に控除、なければ休憩は日中に取ったものとみなす
      const night = ranges.length
        ? Math.max(0, nightMinutes(st, en) - ranges.reduce((a, [b1, b2]) => a + nightMinutes(Math.max(st, b1), Math.min(en, b2)), 0))
        : Math.min(work, nightMinutes(st, en));
      const before = worked;
      worked += work;
      const ot = Math.max(0, worked - 480) - Math.max(0, before - 480);
      const base = (work / 60) * wage;
      const otPay = otOn ? (ot / 60) * wage * otRate : 0;
      const nightPay = nightOn ? (night / 60) * wage * nightRate : 0;
      const transport = idx === 0 ? Number(staff.transport || 0) : 0;
      const wagePay = Math.round(base + otPay + nightPay);
      result.push({
        ...s,
        wage,
        spanMin: span,
        breakMin: brk,
        workMin: work,
        otMin: ot,
        nightMin: night,
        basePay: Math.round(base),
        otPay: Math.round(otPay),
        nightPay: Math.round(nightPay),
        wagePay,
        transport,
        total: wagePay + transport,
      });
    });
  }
  return result;
}

/** 明細行を key 関数で集計 */
export function aggregate(rows, keyFn) {
  const out = {};
  for (const r of rows) {
    const k = keyFn(r);
    const a = (out[k] ||= { workMin: 0, otMin: 0, nightMin: 0, basePay: 0, otPay: 0, nightPay: 0, wagePay: 0, transport: 0, total: 0, count: 0, days: new Set() });
    a.workMin += r.workMin;
    a.otMin += r.otMin;
    a.nightMin += r.nightMin;
    a.basePay += r.basePay;
    a.otPay += r.otPay;
    a.nightPay += r.nightPay;
    a.wagePay += r.wagePay;
    a.transport += r.transport;
    a.total += r.total;
    a.count += 1;
    a.days.add(`${r.staffId}|${r.date}`);
  }
  return out;
}

export function sortStaff(a, b) {
  return (a.kana || a.name).localeCompare(b.kana || b.name, "ja");
}

/** 希望 → シフトレコード（法定休憩を自動設定） */
export function shiftFromRequest(r, settings) {
  let span = toMin(r.end) - toMin(r.start);
  if (span < 0) span += 1440;
  return {
    id: uid(),
    staffId: r.staffId,
    deptId: r.deptId,
    date: r.date,
    start: r.start,
    end: r.end,
    breakMin: settings.autoBreak ? legalBreak(span) : 0,
    fromRequestId: r.id,
  };
}

/**
 * シフト表に表示するスタッフ
 * = 部門所属の在籍者 ＋ 手動追加（roster）＋ その月に部門のシフトがある人
 * 手動追加・応援の人には extra: true を付与
 */
export function rosterStaff(data, deptId, month) {
  const extraIds = new Set((data.roster || []).find((r) => r.id === `${deptId}|${month}`)?.staffIds || []);
  const shiftIds = new Set(data.shift.filter((s) => s.deptId === deptId && s.date.startsWith(month)).map((s) => s.staffId));
  return data.staff
    .filter((s) => (s.active !== false && (s.deptIds || []).includes(deptId)) || extraIds.has(s.id) || shiftIds.has(s.id))
    .map((s) => ({ ...s, extra: !(s.deptIds || []).includes(deptId), manual: extraIds.has(s.id) }))
    .sort(sortStaff);
}

// ===== 休憩時間帯 =====
/** breaks [{start,end}] → 分の区間（シフト開始より前の時刻は翌日扱い） */
function breakMinRanges(breaks, shiftStartMin = 0) {
  return (breaks || []).map((b) => {
    let a = toMin(b.start), e = toMin(b.end);
    // 日跨ぎシフト（例 18:00〜翌2:00）の 0:30 などは翌日扱い。開始直前の時刻は当日のまま（範囲外として除外される）
    if (a < shiftStartMin - 720) { a += 1440; e += 1440; }
    if (e <= a) e += 1440;
    return [a, e];
  });
}
/** 休憩の合計分 */
export function sumBreaks(breaks) {
  return breakMinRanges(breaks).reduce((a, [b1, b2]) => a + (b2 - b1), 0);
}
/** シフト時間内に収め、重なりを結合して並べ替え */
export function normalizeBreaks(breaks, start, end) {
  const st = toMin(start), en = toMin(end);
  const r = breakMinRanges(breaks, st)
    .map(([a, b]) => [Math.max(a, st), Math.min(b, en)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const cur of r) {
    const last = out[out.length - 1];
    if (last && cur[0] <= last[1]) last[1] = Math.max(last[1], cur[1]);
    else out.push([...cur]);
  }
  return out.map(([a, b]) => ({ start: toHHMM(a), end: toHHMM(b) }));
}
/** 休憩時間帯の更新（breakMin も同期） */
export function withBreaks(shift, breaks) {
  const b = normalizeBreaks(breaks, shift.start, shift.end);
  return { ...shift, breaks: b, breakMin: sumBreaks(b) };
}
/** 指定分の休憩をシフト中央付近（15分単位）に配置 */
export function autoPlaceBreak(shift, minutes) {
  if (!minutes) return [];
  const st = toMin(shift.start), en = toMin(shift.end);
  let a = Math.round((st + (en - st) / 2 - minutes / 2) / 15) * 15;
  a = Math.max(st, Math.min(a, en - minutes));
  return [{ start: toHHMM(a), end: toHHMM(a + minutes) }];
}
/** その時刻（分）が休憩中か */
export function inBreak(shift, m) {
  return breakMinRanges(shift.breaks, toMin(shift.start)).some(([a, b]) => m >= a && m < b);
}
/** 表示用 "12:00〜13:00、15:00〜15:15" */
export function breaksText(breaks, full = false) {
  const f = full ? (t) => t : shortTime;
  return (breaks || []).map((b) => `${f(b.start)}〜${f(b.end)}`).join("、");
}

// ===== 業務（休憩以外の手動入力項目） =====
export const TASK_COLORS = ["#f2c94c", "#6fcf97", "#bb8cf0", "#f2994a", "#56ccf2", "#ff8a8a", "#a3b8ff", "#c7d36f"];
/** 業務名 → 色（設定の並び順、なければ文字列から決定） */
export function taskColor(label, labels = []) {
  const i = labels.indexOf(label);
  if (i >= 0) return TASK_COLORS[i % TASK_COLORS.length];
  let h = 0;
  for (const c of label || "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TASK_COLORS[h % TASK_COLORS.length];
}
/** 業務を追加（重なる既存業務は新しい業務で上書き＝分割） */
export function addTask(tasks, task, shift) {
  const a = toMin(task.start), b = toMin(task.end);
  const out = [];
  for (const t of tasks || []) {
    const x = toMin(t.start), y = toMin(t.end);
    if (y <= a || x >= b) { out.push(t); continue; }
    if (x < a) out.push({ ...t, start: t.start, end: task.start });
    if (y > b) out.push({ ...t, start: task.end, end: t.end });
  }
  out.push(task);
  return normalizeTasks(out, shift.start, shift.end);
}
/** シフト時間内に収めて並べ替え */
export function normalizeTasks(tasks, start, end) {
  const st = toMin(start), en = toMin(end);
  return (tasks || [])
    .map((t) => ({ ...t, label: (t.label || "").trim() }))
    .map((t) => ({ ...t, s: Math.max(toMin(t.start), st), e: Math.min(toMin(t.end), en) }))
    .filter((t) => t.e > t.s && t.label)
    .sort((x, y) => x.s - y.s)
    .map(({ s, e, ...t }) => ({ ...t, start: toHHMM(s), end: toHHMM(e) }));
}
/** その時刻（分）の業務 */
export function taskAt(shift, m) {
  return (shift.tasks || []).find((t) => m >= toMin(t.start) && m < toMin(t.end));
}

// ===== 個人タイムテーブルのコピー =====
/**
 * src のタイムテーブル内容を別日にコピーした結果のシフトを返す
 * @param src     コピー元シフト
 * @param target  コピー先の日の同一スタッフ・同一部門のシフト（なければ null）
 * @param opts    { time, breaks, tasks, memo, create, autoBreak }
 * @returns 保存するシフト、対象外なら null
 */
export function copyShiftTo(src, target, date, opts, newId = uid()) {
  if (!target && !(opts.create && opts.time)) return null;
  let base = target ? { ...target } : { id: newId, staffId: src.staffId, deptId: src.deptId, date, start: src.start, end: src.end, breakMin: 0, breaks: [], tasks: [], memo: "", copiedFrom: src.id };
  if (opts.time) base = { ...base, start: src.start, end: src.end };
  // 休憩
  if (opts.breaks) {
    base = src.breaks?.length ? withBreaks(base, src.breaks) : { ...base, breaks: [], breakMin: src.breakMin || 0 };
  } else if (base.breaks?.length) {
    base = withBreaks(base, base.breaks);
  } else if (!target) {
    base.breakMin = opts.autoBreak ? legalBreak(toMin(base.end) - toMin(base.start)) : 0;
  }
  // 業務
  base.tasks = normalizeTasks(opts.tasks ? src.tasks : base.tasks, base.start, base.end);
  // メモ
  if (opts.memo) base.memo = src.memo || "";
  return base;
}
