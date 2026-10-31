import { daysInMonth, shiftFromRequest, thisMonth, uid, weekdayOf } from "./utils.js";
import { DEFAULT_SETTINGS } from "./store.js";

/** サンプルデータ（部門3・スタッフ8名・翌月の希望） */
export function buildSample({ withShifts = false } = {}) {
  const department = [
    { id: uid(), name: "フロント", color: "#2f80ed", order: 0 },
    { id: uid(), name: "ジム", color: "#27ae60", order: 1 },
    { id: uid(), name: "プール監視", color: "#00a5a8", order: 2 },
  ];
  const names = [["佐藤 美咲", "学生", 1100, 300], ["鈴木 健太", "学生", 1100, 0], ["高橋 由美", "主婦・主夫", 1150, 500], ["田中 誠", "一般", 1200, 400], ["伊藤 さくら", "学生", 1100, 250], ["渡辺 隆", "シニア", 1150, 0], ["山本 葵", "一般", 1250, 600], ["中村 翔", "学生", 1100, 300]];
  const staff = names.map(([name, category, wage, transport], i) => ({ id: uid(), name, kana: "", category, wage, transport, deptIds: [department[i % 3].id, ...(i % 4 === 0 ? [department[(i + 1) % 3].id] : [])], active: true, note: "" }));
  const month = thisMonth(1);
  const pats = [["09:00", "13:00"], ["13:00", "17:00"], ["17:00", "22:00"], ["09:00", "17:00"], ["09:00", "18:00"]];
  const request = [];
  staff.forEach((s, i) => {
    daysInMonth(month).forEach((d, k) => {
      if ((k + i) % 3 === 0 && weekdayOf(d) !== i % 7) {
        const [start, end] = pats[(i + k) % pats.length];
        request.push({ id: uid(), staffId: s.id, deptId: s.deptIds[0], date: d, start, end, note: k % 7 === 0 ? "テスト期間" : "", submittedAt: new Date().toISOString() });
      }
    });
  });
  const settings = { ...DEFAULT_SETTINGS, orgName: "サンプル総合体育館", collection: { ...DEFAULT_SETTINGS.collection, month, message: "サンプルデータです。自由に操作してください。" } };
  // 希望の約2/3をシフトに反映済みにしておく
  const shift = withShifts ? request.filter((_, i) => i % 3 !== 2).map((r) => shiftFromRequest(r, settings)) : [];
  return { month, department, staff, request, shift, setting: [settings] };
}

export function toLocalShape(d) {
  const by = (list) => Object.fromEntries(list.map((r) => [r.id, r]));
  return { department: by(d.department), staff: by(d.staff), request: by(d.request), shift: by(d.shift), setting: by(d.setting) };
}
