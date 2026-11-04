import { useEffect, useMemo, useState } from "react";
import { daysInMonth, fmtDate, fmtMonth, shortTime, sortStaff, thisMonth, timeOptions, toMin, today, uid, weekdayOf, WEEK } from "../utils.js";
import { CalendarPicker, MonthInput } from "../components.jsx";
import { getSettings, PinError, usePortal } from "../store.js";

const LAST_KEY = "shift-app-last-staff";
const pinKey = (code, staffId) => `shift-app-pin:${code}:${staffId}`;
const loadPin = (code, staffId) => { try { return (staffId && localStorage.getItem(pinKey(code, staffId))) || ""; } catch { return ""; } };
const savePin = (code, staffId, pin) => { try { pin ? localStorage.setItem(pinKey(code, staffId), pin) : localStorage.removeItem(pinKey(code, staffId)); } catch { /* ignore */ } };

export default function StaffEntry({ backend, code, onChangeFacility, onTitle }) {
  const lastKey = `${LAST_KEY}:${code}`;
  const last = (() => {
    try { return JSON.parse(localStorage.getItem(lastKey)) || {}; } catch { return {}; }
  })();
  const [deptId, setDeptId] = useState(last.deptId || "");
  const [staffId, setStaffId] = useState(last.staffId || "");
  const [pin, setPin] = useState(() => loadPin(code, last.staffId));
  const [pinInput, setPinInput] = useState("");
  const [remember, setRemember] = useState(true);
  useEffect(() => { setPin(loadPin(code, staffId)); setPinInput(""); }, [code, staffId]);
  const portal = usePortal(backend, code, staffId, pin);
  const { data } = portal;
  const settings = getSettings(data, portal.facility);
  const requirePin = settings.requirePin !== false;
  const unlocked = !requirePin || portal.verified;
  // 記憶していたPINが無効になった場合は消す
  useEffect(() => { if (portal.pinError && pin) savePin(code, staffId, ""); }, [portal.pinError]); // eslint-disable-line
  const confirmPin = (e) => {
    e?.preventDefault();
    if (!/^\d{4,8}$/.test(pinInput)) return;
    if (pinInput === pin) portal.retry(); // 同じPINでも再確認する
    else setPin(pinInput);
    if (remember) savePin(code, staffId, pinInput);
  };
  const forgetPin = () => { savePin(code, staffId, ""); setPin(""); setPinInput(""); };
  const col = settings.collection;
  const depts = [...data.department].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  useEffect(() => { if (portal.facility) onTitle?.(settings.orgName); }, [portal.facility, settings.orgName]); // eslint-disable-line
  const [month, setMonth] = useState(col.month || thisMonth(1));
  const [selected, setSelected] = useState({}); // date -> {start,end,allDay,note}
  const [defaultTime, setDefaultTime] = useState({ start: "09:00", end: "17:00" });
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => { if (col.month) setMonth(col.month); }, [col.month]);

  const staffList = data.staff.filter((s) => s.active !== false && (!deptId || (s.deptIds || []).includes(deptId))).sort(sortStaff);
  useEffect(() => {
    if (!portal.loading && staffId && !staffList.some((s) => s.id === staffId)) setStaffId("");
  }, [deptId, portal.loading]); // eslint-disable-line

  const times = timeOptions(settings.dayStart, settings.dayEnd, settings.stepMin);
  const closed = col.open === false || (col.deadline && today() > col.deadline);
  const monthLocked = !!col.month && month !== col.month;

  const mine = useMemo(
    () => data.request.filter((r) => r.staffId === staffId && r.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)),
    [data.request, staffId, month]
  );
  const submittedDates = new Set(mine.filter((r) => r.deptId === deptId).map((r) => r.date));

  const toggle = (date) =>
    setSelected((s) => {
      const n = { ...s };
      if (n[date]) delete n[date];
      else n[date] = { ...defaultTime, allDay: false, note: "" };
      return n;
    });
  const update = (date, patch) => setSelected((s) => ({ ...s, [date]: { ...s[date], ...patch } }));
  const applyAll = () => setSelected((s) => Object.fromEntries(Object.entries(s).map(([d, v]) => [d, { ...v, ...defaultTime, allDay: false }])));
  const selectWeekday = (wd) =>
    setSelected((s) => {
      const n = { ...s };
      daysInMonth(month).filter((d) => weekdayOf(d) === wd).forEach((d) => (n[d] ||= { ...defaultTime, allDay: false, note: "" }));
      return n;
    });

  const submit = async () => {
    setMsg(null);
    const dates = Object.keys(selected).sort();
    if (!deptId || !staffId) return setMsg({ type: "error", text: "部門と氏名を選択してください。" });
    if (!dates.length) return setMsg({ type: "error", text: "希望日をカレンダーから選択してください。" });
    for (const d of dates) {
      const v = selected[d];
      if (!v.allDay && toMin(v.end) <= toMin(v.start)) return setMsg({ type: "error", text: `${fmtDate(d)} の終了時刻が開始時刻より前です。` });
    }
    const now = new Date().toISOString();
    const recs = dates.map((d) => {
      const v = selected[d];
      return {
        id: uid(),
        staffId,
        deptId,
        date: d,
        start: v.allDay ? `${String(settings.dayStart).padStart(2, "0")}:00` : v.start,
        end: v.allDay ? `${String(settings.dayEnd).padStart(2, "0")}:00` : v.end,
        allDay: !!v.allDay,
        note: [v.note, note].filter(Boolean).join(" / "),
        submittedAt: now,
      };
    });
    // 同じ日・同じ部門の既存希望は上書き
    const replaced = data.request.filter((r) => r.staffId === staffId && r.deptId === deptId && selected[r.date]).map((r) => r.id);
    setSending(true);
    try {
      await portal.submitRequests(recs, replaced);
      try { localStorage.setItem(lastKey, JSON.stringify({ deptId, staffId })); } catch { /* ignore */ }
      setSelected({});
      setNote("");
      setMsg({ type: "ok", text: `${recs.length}日分のシフト希望を提出しました。${replaced.length ? `（${replaced.length}件を上書き）` : ""}` });
    } catch (e) {
      if (e instanceof PinError) forgetPin();
      setMsg({ type: "error", text: `送信に失敗しました：${e.message || "通信環境を確認して再度お試しください。"}` });
    } finally {
      setSending(false);
    }
  };

  const deptName = (id) => data.department.find((d) => d.id === id)?.name || "-";

  if (portal.loading) return <div className="center muted" style={{ padding: 40 }}>読み込み中…</div>;
  if (!portal.facility) {
    return (
      <main className="page narrow">
        <div className="card">
          <p className="banner error">{portal.error || "施設が見つかりません。"}</p>
          <button className="btn" onClick={onChangeFacility}>施設を選び直す</button>
        </div>
      </main>
    );
  }

  return (
    <main className="page narrow">
      <div className="row between wrap">
        <h1>シフト希望入力</h1>
        <span className="small muted">{portal.facility.name} <button className="btn tiny ghost" onClick={onChangeFacility}>施設を変更</button></span>
      </div>
      <div className="card info">
        <div>
          <b>回収対象：</b>{col.month ? fmtMonth(col.month) : "指定なし"}
          {col.deadline && <> ／ <b>提出期限：</b>{fmtDate(col.deadline)}</>}
          {closed && <span className="tag red" style={{ marginLeft: 8 }}>受付終了</span>}
        </div>
        {col.message && <div className="pre">{col.message}</div>}
      </div>

      {!depts.length ? (
        <div className="card muted">部門が登録されていません。管理者に連絡してください。</div>
      ) : (
        <>
          <div className="card">
            <div className="grid2">
              <label>対象部門
                <select value={deptId} onChange={(e) => setDeptId(e.target.value)}>
                  <option value="">選択してください</option>
                  {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label>スタッフ氏名
                <select value={staffId} onChange={(e) => setStaffId(e.target.value)} disabled={!deptId}>
                  <option value="">選択してください</option>
                  {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            </div>
          </div>

          {deptId && staffId && requirePin && !portal.verified && (
            <form className="card pin-card" onSubmit={confirmPin}>
              <h3>🔒 本人確認</h3>
              <p className="small muted">施設から受け取った個人PIN（4〜8桁の数字）を入力してください。</p>
              {portal.pinError && (pin || portal.pinError.code !== "invalid pin") && <div className="banner error">{portal.pinError.message}</div>}
              <div className="row wrap">
                <input id="staff-pin" className="pin-input" type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={8}
                  value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))} placeholder="PIN" autoFocus />
                <button className="btn primary" disabled={!/^\d{4,8}$/.test(pinInput)}>確認</button>
              </div>
              <label className="inline small"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />この端末にPINを記憶する（共用の端末ではチェックを外してください）</label>
            </form>
          )}

          {deptId && staffId && unlocked && requirePin && (
            <div className="small muted pin-ok">🔓 本人確認済み <button className="btn tiny ghost" onClick={forgetPin}>この端末からPINを消す</button></div>
          )}

          {deptId && staffId && unlocked && (
            closed ? (
              <div className="card muted">現在シフト希望の受付は終了しています。</div>
            ) : (
              <>
                <div className="card">
                  <div className="row between">
                    <h3>① 対象年月日を選択</h3>
                    <MonthInput value={month} onChange={(m) => { setMonth(m); setSelected({}); }} disabled={!!col.month} />
                  </div>
                  {monthLocked && <p className="muted">回収対象月以外は選択できません。</p>}
                  <CalendarPicker month={month} selected={selected} marked={submittedDates} onToggle={toggle} />
                  <div className="row wrap small" style={{ marginTop: 8 }}>
                    <span className="muted">曜日で一括選択：</span>
                    {WEEK.map((w, i) => <button key={w} className="btn tiny ghost" onClick={() => selectWeekday(i)}>{w}</button>)}
                    <button className="btn tiny ghost" onClick={() => setSelected({})}>選択解除</button>
                    <span className="legend"><i className="dot sub" />提出済み</span>
                  </div>
                </div>

                <div className="card">
                  <h3>② シフト希望時間を選択</h3>
                  <div className="row wrap">
                    <span>一括設定：</span>
                    <TimeSelect times={times} value={defaultTime.start} onChange={(v) => setDefaultTime((t) => ({ ...t, start: v }))} />〜
                    <TimeSelect times={times} value={defaultTime.end} onChange={(v) => setDefaultTime((t) => ({ ...t, end: v }))} />
                    <button className="btn small" onClick={applyAll} disabled={!Object.keys(selected).length}>選択日すべてに適用</button>
                  </div>
                  {!Object.keys(selected).length ? (
                    <p className="muted">カレンダーで日付を選択すると、ここに時間入力欄が表示されます。</p>
                  ) : (
                    <table className="tbl compact" style={{ marginTop: 10 }}>
                      <thead><tr><th>日付</th><th>希望時間</th><th>終日可</th><th>日別メモ</th><th></th></tr></thead>
                      <tbody>
                        {Object.keys(selected).sort().map((d) => {
                          const v = selected[d];
                          return (
                            <tr key={d}>
                              <td className={`wd${weekdayOf(d)}`}>{fmtDate(d)}</td>
                              <td className="nowrap">
                                <TimeSelect times={times} value={v.start} disabled={v.allDay} onChange={(x) => update(d, { start: x })} />〜
                                <TimeSelect times={times} value={v.end} disabled={v.allDay} onChange={(x) => update(d, { end: x })} />
                              </td>
                              <td><input type="checkbox" checked={v.allDay} onChange={(e) => update(d, { allDay: e.target.checked })} /></td>
                              <td><input value={v.note} onChange={(e) => update(d, { note: e.target.value })} placeholder="任意" /></td>
                              <td><button className="btn tiny ghost" onClick={() => toggle(d)}>✕</button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="card">
                  <h3>③ 備考</h3>
                  <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：テスト期間のため◯日〜◯日は短時間希望 など" />
                  {msg && <div className={`banner ${msg.type === "ok" ? "ok" : "error"}`}>{msg.text}</div>}
                  <button className="btn primary block" onClick={submit} disabled={sending || !Object.keys(selected).length}>
                    {sending ? "送信中…" : `シフト希望を提出する（${Object.keys(selected).length}日）`}
                  </button>
                </div>
              </>
            )
          )}

          {staffId && unlocked && (
            <div className="card">
              <h3>提出済みの希望（{fmtMonth(month)}）</h3>
              {!mine.length ? (
                <p className="muted">まだ提出されていません。</p>
              ) : (
                <table className="tbl compact">
                  <thead><tr><th>日付</th><th>部門</th><th>時間</th><th>備考</th><th></th></tr></thead>
                  <tbody>
                    {mine.map((r) => (
                      <tr key={r.id}>
                        <td className={`wd${weekdayOf(r.date)}`}>{fmtDate(r.date)}</td>
                        <td>{deptName(r.deptId)}</td>
                        <td className="nowrap">{r.allDay ? "終日可" : `${shortTime(r.start)}〜${shortTime(r.end)}`}</td>
                        <td>{r.note}</td>
                        <td>{!closed && <button className="btn tiny danger" onClick={() => window.confirm("この希望を取り消しますか？") && portal.deleteRequest(r.id).catch((e) => setMsg({ type: "error", text: e.message }))}>取消</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}

export function TimeSelect({ times, value, onChange, disabled, full }) {
  const list = times.includes(value) || !value ? times : [...times, value].sort();
  return (
    <select className="time" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {list.map((t) => <option key={t} value={t}>{full ? t : shortTime(t)}</option>)}
    </select>
  );
}
