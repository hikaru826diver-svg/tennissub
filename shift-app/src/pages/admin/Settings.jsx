import { useState } from "react";
import { KINDS } from "../../store.js";
import { thisMonth } from "../../utils.js";
import { MonthInput } from "../../components.jsx";
import { buildSample } from "../../sample.js";
import { staffUrl as staffUrlOf } from "./FacilityManager.jsx";

export default function Settings({ store, settings, facility, backend }) {
  const { data, save, remove } = store;
  const [f, setF] = useState(() => ({
    ...settings,
    categoriesText: settings.categories.join("、"),
    taskLabelsText: (settings.taskLabels || []).join("、"),
    patternsText: (settings.patterns || []).map((p) => `${p.start}-${p.end}`).join("、"),
  }));
  const [saved, setSaved] = useState(false);
  const set = (p) => { setF((x) => ({ ...x, ...p })); setSaved(false); };
  const setCol = (p) => set({ collection: { ...f.collection, ...p } });
  const staffUrl = staffUrlOf(facility.code);

  const submit = async () => {
    const patterns = f.patternsText.split(/[、,\s]+/).filter(Boolean).map((t) => {
      const m = t.match(/^(\d{1,2}):?(\d{2})?-(\d{1,2}):?(\d{2})?$/);
      if (!m) return null;
      const hm = (h, mm) => `${String(h).padStart(2, "0")}:${mm || "00"}`;
      return { start: hm(m[1], m[2]), end: hm(m[3], m[4]) };
    }).filter(Boolean);
    const { categoriesText, patternsText, taskLabelsText, ...rest } = f;
    await save("setting", {
      ...rest,
      id: "settings",
      dayStart: Number(f.dayStart),
      dayEnd: Number(f.dayEnd),
      stepMin: Number(f.stepMin),
      overtimeRate: Number(f.overtimeRate),
      nightRate: Number(f.nightRate),
      categories: categoriesText.split(/[、,]/).map((s) => s.trim()).filter(Boolean),
      taskLabels: taskLabelsText.split(/[、,]/).map((s) => s.trim()).filter(Boolean),
      patterns,
      lastBackupAt: settings.lastBackupAt, // バックアップ日時はフォームで上書きしない
    });
    setSaved(true);
  };

  const backup = async () => {
    // 画面には直近の期間だけを読み込んでいるため、バックアップは全期間を改めて取得する
    let full;
    try { full = await backend.loadFacility(facility.id); } catch (e) { return alert(`バックアップ用のデータを取得できませんでした：${e.message}`); }
    const blob = new Blob([JSON.stringify({ facility, exportedAt: new Date().toISOString(), ...full }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `shift-backup-${facility.code}-${new Date().toISOString().slice(0, 10)}.json`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    await save("setting", { ...settings, lastBackupAt: new Date().toISOString() });
  };
  const restore = async (file) => {
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (!window.confirm("バックアップを読み込みます。同じIDのデータは上書きされます。よろしいですか？")) return;
      for (const k of KINDS) if (Array.isArray(json[k]) && json[k].length) await save(k, json[k]);
      alert("読み込みました");
    } catch (e) {
      alert(`読み込みに失敗しました: ${e.message}`);
    }
  };
  const purgeOld = async () => {
    const m = window.prompt("この年月より前の希望・シフトを削除します（YYYY-MM）", thisMonth(-12));
    if (!m) return;
    const req = data.request.filter((r) => r.date < `${m}-01`).map((r) => r.id);
    const sh = data.shift.filter((r) => r.date < `${m}-01`).map((r) => r.id);
    if (!window.confirm(`希望 ${req.length}件・シフト ${sh.length}件 を削除します。元に戻せません。`)) return;
    await remove("request", req);
    await remove("shift", sh);
  };

  return (
    <>
      <h1>回収・各種設定</h1>

      <div className="card">
        <h3>シフト希望の回収</h3>
        <div className="grid2">
          <label className="span2">回収対象月（空欄なら月を自由に選択）
            <div className="row wrap">
              {f.collection.month ? <MonthInput value={f.collection.month} onChange={(m) => setCol({ month: m })} /> : <span className="muted">指定なし</span>}
              {f.collection.month ? <button className="btn tiny ghost" onClick={() => setCol({ month: "" })}>指定解除</button> : <button className="btn tiny" onClick={() => setCol({ month: thisMonth(1) })}>翌月を指定</button>}
            </div>
          </label>
          <label>提出期限<input type="date" value={f.collection.deadline} onChange={(e) => setCol({ deadline: e.target.value })} /></label>
          <label>受付状態
            <select value={f.collection.open ? "1" : "0"} onChange={(e) => setCol({ open: e.target.value === "1" })}>
              <option value="1">受付中</option><option value="0">受付停止</option>
            </select>
          </label>
          <label>スタッフ入力画面URL（LINE等で共有）
            <div className="row"><input readOnly style={{ flex: 1, minWidth: 0 }} value={staffUrl} onFocus={(e) => e.target.select()} /><button className="btn tiny" onClick={() => navigator.clipboard?.writeText(staffUrl).catch(() => {})}>コピー</button></div>
          </label>
        </div>
        <label>スタッフへのお知らせ<textarea rows={2} value={f.collection.message} onChange={(e) => setCol({ message: e.target.value })} placeholder="例：12月分のシフト希望を11/20までに提出してください" /></label>
      </div>

      <div className="card">
        <h3>基本設定</h3>
        <div className="grid2">
          <label>施設・組織名<input value={f.orgName} onChange={(e) => set({ orgName: e.target.value })} /></label>
          {backend.name === "local" && <label>管理者パスコード（この施設）<input value={f.adminPass} onChange={(e) => set({ adminPass: e.target.value })} /></label>}
          <label>営業開始（時）<input type="number" min="0" max="23" value={f.dayStart} onChange={(e) => set({ dayStart: e.target.value })} /></label>
          <label>営業終了（時）<input type="number" min="1" max="30" value={f.dayEnd} onChange={(e) => set({ dayEnd: e.target.value })} /></label>
          <label>時刻の選択単位
            <select value={f.stepMin} onChange={(e) => set({ stepMin: e.target.value })}>
              {[15, 30, 60].map((m) => <option key={m} value={m}>{m}分</option>)}
            </select>
          </label>
          <label>スタッフ区分（「、」区切り）<input value={f.categoriesText} onChange={(e) => set({ categoriesText: e.target.value })} /></label>
          <label>タイムテーブルの業務項目（「、」区切り）<input value={f.taskLabelsText} onChange={(e) => set({ taskLabelsText: e.target.value })} placeholder="受付、レジ、清掃、監視" /></label>
          <label>シフトパターン（例：9-17、9:30-13:00）<input value={f.patternsText} onChange={(e) => set({ patternsText: e.target.value })} placeholder="9-17、9-13、13-17、17-22" /></label>
        </div>
      </div>

      <div className="card">
        <h3>セキュリティ</h3>
        <label className="inline"><input id="require-pin" type="checkbox" checked={f.requirePin !== false} onChange={(e) => set({ requirePin: e.target.checked })} />スタッフのシフト希望入力に個人PINを必須にする（推奨）</label>
        <p className="small muted">PINは「スタッフマスタ」で発行します。無効にすると、施設のURLを知っている人は誰でもスタッフ名で希望を提出できます。</p>
      </div>

      <div className="card">
        <h3>給与計算ルール</h3>
        <div className="grid2">
          <label className="inline"><input type="checkbox" checked={f.overtimePremium} onChange={(e) => set({ overtimePremium: e.target.checked })} />時間外割増（1日8時間超）</label>
          <label>時間外割増率<input type="number" step="0.05" value={f.overtimeRate} onChange={(e) => set({ overtimeRate: e.target.value })} /></label>
          <label className="inline"><input type="checkbox" checked={f.nightPremium} onChange={(e) => set({ nightPremium: e.target.checked })} />深夜割増（22:00〜翌5:00）</label>
          <label>深夜割増率<input type="number" step="0.05" value={f.nightRate} onChange={(e) => set({ nightRate: e.target.value })} /></label>
          <label>給与締め日（単月集計の対象期間）
            <select value={f.closingDay || 0} onChange={(e) => set({ closingDay: Number(e.target.value) })}>
              <option value={0}>末日締め（1日〜末日）</option>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}日締め（前月{d + 1}日〜当月{d}日）</option>)}
            </select>
          </label>
          <label className="inline"><input type="checkbox" checked={f.autoBreak} onChange={(e) => set({ autoBreak: e.target.checked })} />法定休憩を自動設定（6h超45分・8h超60分）</label>
        </div>
      </div>

      <div className="row">
        <button className="btn primary" onClick={submit}>設定を保存</button>
        {saved && <span className="tag green">保存しました</span>}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h3>データ管理</h3>
        <p className="small">前回のバックアップ：{settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString("ja-JP") : <span className="tag red">未実施</span>}（月1回以上、施設内の保管場所に保存することをおすすめします）</p>
        <div className="row wrap">
          <button className="btn small" onClick={backup}>バックアップ（JSON）をダウンロード</button>
          <label className="btn small">バックアップから復元<input type="file" accept=".json" hidden onChange={(e) => restore(e.target.files[0])} /></label>
          <button className="btn small danger" onClick={purgeOld}>古いデータを削除</button>
          {!data.staff.length && <button className="btn small" onClick={() => loadSample(save, settings).then(() => setF((x) => ({ ...x, collection: { ...x.collection, month: thisMonth(1) } })))}>サンプルデータを投入</button>}
        </div>
        <p className="muted small">登録件数：部門 {data.department.length} ／ スタッフ {data.staff.length} ／ 希望 {data.request.length} ／ シフト {data.shift.length}</p>
      </div>
    </>
  );
}

async function loadSample(save, settings) {
  const d = buildSample();
  for (const k of ["department", "staff", "request"]) await save(k, d[k]);
  // 希望一覧・シフト作成ですぐ確認できるよう、回収対象月をサンプルの月（翌月）に合わせる
  await save("setting", { ...settings, collection: { ...settings.collection, month: d.month } });
  alert(`サンプルデータを投入しました（今月・翌月の希望 ${d.request.length}件、回収対象月：${d.month}）`);
}
