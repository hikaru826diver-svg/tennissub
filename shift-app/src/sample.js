import { daysInMonth, shiftFromRequest, thisMonth, uid, weekdayOf } from "./utils.js";
import { DEFAULT_SETTINGS } from "./store.js";

const PRESETS = {
  gym: {
    depts: [["フロント", "#2f80ed"], ["ジム", "#27ae60"], ["プール監視", "#00a5a8"]],
    staff: [["佐藤 美咲", "学生", 1100, 300], ["鈴木 健太", "学生", 1100, 0], ["高橋 由美", "主婦・主夫", 1150, 500], ["田中 誠", "一般", 1200, 400], ["伊藤 さくら", "学生", 1100, 250], ["渡辺 隆", "シニア", 1150, 0], ["山本 葵", "一般", 1250, 600], ["中村 翔", "学生", 1100, 300]],
  },
  pool: {
    depts: [["受付", "#f2994a"], ["監視", "#2f80ed"], ["スクール", "#9b51e0"]],
    staff: [["小林 陽菜", "学生", 1120, 200], ["加藤 大輝", "学生", 1120, 350], ["吉田 恵", "主婦・主夫", 1150, 0], ["山田 拓也", "一般", 1250, 450], ["松本 結衣", "学生", 1120, 300], ["井上 修", "シニア", 1150, 0]],
  },
};

/**
 * サンプルデータ（部門3・スタッフ数名・今月と翌月の希望）
 * @returns { month, department, staff, request, shift, setting }  ※ setting は回収対象月＝翌月
 */
export function buildSample({ withShifts = false, preset = "gym", orgName = "" } = {}) {
  const P = PRESETS[preset] || PRESETS.gym;
  const department = P.depts.map(([name, color], i) => ({ id: uid(), name, color, order: i }));
  const staff = P.staff.map(([name, category, wage, transport], i) => ({
    id: uid(), name, kana: "", category, wage, transport, active: true, note: "",
    deptIds: [department[i % department.length].id, ...(i % 4 === 0 ? [department[(i + 1) % department.length].id] : [])],
  }));
  const month = thisMonth(1);
  const pats = [["09:00", "13:00"], ["13:00", "17:00"], ["17:00", "22:00"], ["09:00", "17:00"], ["09:00", "18:00"]];
  const request = [];
  for (const m of [thisMonth(), month]) {
    staff.forEach((s, i) => {
      daysInMonth(m).forEach((d, k) => {
        if ((k + i) % 3 === 0 && weekdayOf(d) !== i % 7) {
          const [start, end] = pats[(i + k) % pats.length];
          request.push({ id: uid(), staffId: s.id, deptId: s.deptIds[0], date: d, start, end, note: k % 7 === 0 ? "テスト期間" : "", submittedAt: new Date().toISOString() });
        }
      });
    });
  }
  const settings = { ...DEFAULT_SETTINGS, orgName, collection: { ...DEFAULT_SETTINGS.collection, month, message: "サンプルデータです。自由に操作してください。" } };
  // 希望の約2/3をシフトに反映済みにしておく
  const shift = withShifts ? request.filter((_, i) => i % 3 !== 2).map((r) => shiftFromRequest(r, settings)) : [];
  return { month, department, staff, request, shift, setting: [settings], roster: [] };
}

/** デモ用：2施設分のデータ（localStorage 形式） */
export function buildDemoStore() {
  const facilities = {};
  const records = {};
  const add = (name, code, preset) => {
    const id = uid();
    facilities[id] = { id, name, code };
    const d = buildSample({ withShifts: true, preset, orgName: name });
    for (const [k, list] of Object.entries(d)) {
      if (!Array.isArray(list)) continue;
      records[k] ||= {};
      for (const r of list) {
        const rid = k === "setting" ? `settings:${id}` : r.id;
        records[k][rid] = { ...r, id: rid, facilityId: id };
      }
    }
  };
  add("サンプル総合体育館", "sample-gym", "gym");
  add("サンプル市民プール", "sample-pool", "pool");
  return { facilities, records, hqPass: "admin" };
}
