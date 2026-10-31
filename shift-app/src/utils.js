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
      const brk = Math.min(span, Number(s.breakMin || 0));
      const work = span - brk;
      const night = Math.min(work, nightMinutes(st, en));
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
