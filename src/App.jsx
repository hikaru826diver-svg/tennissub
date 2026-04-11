import { useState, useEffect, useCallback } from “react”;
import { createClient } from “@supabase/supabase-js”;

const SUPABASE_URL = “https://zjftchjyotjvvstzbzsq.supabase.co”;
const SUPABASE_ANON_KEY = “eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqZnRjaGp5b3RqdnZzdHpienNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NzMxMDcsImV4cCI6MjA5MTQ0OTEwN30.YU9c9KGlS3V3OTFNCSJt8MAG7BN4_0bzFtv6_U0Ug7E”;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const initialInstructors = [
{ id: 1, name: “田中 剛”, specialties: [“ストローク”, “サーブ”], available: true },
{ id: 2, name: “鈴木 美咲”, specialties: [“ボレー”, “ジュニア指導”], available: false },
{ id: 3, name: “佐藤 健”, specialties: [“フィジカル”, “戦術”], available: true },
{ id: 4, name: “伊藤 凛”, specialties: [“ジュニア指導”, “ストローク”], available: true },
{ id: 5, name: “渡辺 大樹”, specialties: [“サーブ”, “メンタル”], available: false },
];

const initialRequests = [
{ id: 1, date: “2026-04-14”, time: “18:00〜20:00”, classType: “一般レッスン”, level: “初中級”, status: “募集中”, applicants: [3], note: “ストローク基礎を中心に。ボール出し機あり。” },
{ id: 2, date: “2026-04-16”, time: “10:00〜12:00”, classType: “ジュニアクラス”, level: “初心者”, status: “決定済”, applicants: [4], note: “小学生クラス。楽しく元気よく。” },
{ id: 3, date: “2026-04-18”, time: “19:00〜21:00”, classType: “上級クラス”, level: “上級”, status: “募集中”, applicants: [], note: “試合形式メイン。戦術指導ができる方優先。” },
];

const SPECIALTIES_OPTIONS = [“ストローク”, “サーブ”, “ボレー”, “リターン”, “フォアハンド”, “バックハンド”, “戦術”, “フィジカル”, “ジュニア指導”, “シニア指導”, “メンタル”, “その他”];
const POLL_INTERVAL = 5000;

const statusColor = {
“募集中”: { bg: “rgba(56,142,60,0.15)”, text: “#66bb6a”, dot: “#43a047”, border: “rgba(56,142,60,0.3)” },
“決定済”: { bg: “rgba(30,136,229,0.15)”, text: “#64b5f6”, dot: “#1e88e5”, border: “rgba(30,136,229,0.3)” },
“キャンセル”: { bg: “rgba(229,57,53,0.12)”, text: “#ef9a9a”, dot: “#e53935”, border: “rgba(229,57,53,0.25)” },
};

const emptyInstructor = { name: “”, specialties: [], available: true };

// — Supabase helpers —
async function dbGet(table) {
const { data, error } = await supabase.from(table).select(“data”).eq(“id”, 1).single();
if (error) return null;
return data?.data ?? null;
}

async function dbSet(table, value) {
const { error } = await supabase.from(table).upsert({ id: 1, data: value, updated_at: new Date().toISOString() });
if (error) throw error;
}

export default function App() {
const [tab, setTab] = useState(“requests”);
const [requests, setRequests] = useState([]);
const [instructors, setInstructors] = useState([]);
const [showRequestForm, setShowRequestForm] = useState(false);
const [showInstructorForm, setShowInstructorForm] = useState(false);
const [selectedRequest, setSelectedRequest] = useState(null);
const [confirmDelete, setConfirmDelete] = useState(null);
const [filterStatus, setFilterStatus] = useState(“すべて”);
const [loading, setLoading] = useState(true);
const [syncStatus, setSyncStatus] = useState(“synced”);
const [newRequest, setNewRequest] = useState({ date: “”, time: “”, classType: “”, level: “”, note: “” });
const [newInstructor, setNewInstructor] = useState(emptyInstructor);
const [specialtyInput, setSpecialtyInput] = useState(””);

const loadAll = useCallback(async (silent = false) => {
try {
let reqs = await dbGet(“requests”);
let insts = await dbGet(“instructors”);
if (!reqs) { reqs = initialRequests; await dbSet(“requests”, reqs); }
if (!insts) { insts = initialInstructors; await dbSet(“instructors”, insts); }
setRequests(reqs);
setInstructors(insts);
} catch (e) {
if (!silent) console.error(e);
setSyncStatus(“error”);
} finally {
setLoading(false);
}
}, []);

useEffect(() => { loadAll(); }, [loadAll]);
useEffect(() => {
const t = setInterval(() => loadAll(true), POLL_INTERVAL);
return () => clearInterval(t);
}, [loadAll]);

const saveRequests = async (data) => {
setSyncStatus(“saving”);
try { await dbSet(“requests”, data); setSyncStatus(“synced”); }
catch { setSyncStatus(“error”); }
};
const saveInstructors = async (data) => {
setSyncStatus(“saving”);
try { await dbSet(“instructors”, data); setSyncStatus(“synced”); }
catch { setSyncStatus(“error”); }
};

const updateRequests = async (updater) => {
const updated = typeof updater === “function” ? updater(requests) : updater;
setRequests(updated);
await saveRequests(updated);
};
const updateInstructors = async (updater) => {
const updated = typeof updater === “function” ? updater(instructors) : updater;
setInstructors(updated);
await saveInstructors(updated);
};

const handleApply = (reqId, instId) => updateRequests(prev => prev.map(r => r.id === reqId && !r.applicants.includes(instId) ? { …r, applicants: […r.applicants, instId] } : r));
const handleDecide = (reqId, instId) => updateRequests(prev => prev.map(r => r.id === reqId ? { …r, status: “決定済”, applicants: [instId] } : r));
const handleCancel = (reqId) => { updateRequests(prev => prev.map(r => r.id === reqId ? { …r, status: “キャンセル” } : r)); setSelectedRequest(null); };
const handleSubmitRequest = () => {
if (!newRequest.date || !newRequest.time) return;
updateRequests(prev => [{ …newRequest, id: Date.now(), status: “募集中”, applicants: [] }, …prev]);
setNewRequest({ date: “”, time: “”, classType: “”, level: “”, note: “” });
setShowRequestForm(false);
};

const handleAddInstructor = () => {
if (!newInstructor.name) return;
updateInstructors(prev => […prev, { …newInstructor, id: Date.now() }]);
setNewInstructor(emptyInstructor);
setSpecialtyInput(””);
setShowInstructorForm(false);
};
const handleDeleteInstructor = (id) => {
updateInstructors(prev => prev.filter(i => i.id !== id));
updateRequests(prev => prev.map(r => ({ …r, applicants: r.applicants.filter(a => a !== id) })));
setConfirmDelete(null);
};
const toggleAvailable = (id) => updateInstructors(prev => prev.map(i => i.id === id ? { …i, available: !i.available } : i));
const addSpecialty = (s) => { if (s && !newInstructor.specialties.includes(s)) setNewInstructor(p => ({ …p, specialties: […p.specialties, s] })); setSpecialtyInput(””); };
const removeSpecialty = (s) => setNewInstructor(p => ({ …p, specialties: p.specialties.filter(x => x !== s) }));

const getInst = (id) => instructors.find(i => i.id === id);
const openRequest = selectedRequest ? requests.find(r => r.id === selectedRequest) : null;
const filteredRequests = requests.filter(r => filterStatus === “すべて” || r.status === filterStatus);

return (
<div style={{ fontFamily: “‘Noto Sans JP’, sans-serif”, background: “#0a1628”, minHeight: “100vh”, color: “#e8f0fe” }}>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&family=Outfit:wght@700;800&display=swap" rel="stylesheet" />
<style>{`* { box-sizing: border-box; margin: 0; padding: 0; } ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0a1628; } ::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 2px; } input, select, textarea { outline: none; font-family: 'Noto Sans JP', sans-serif; } button { cursor: pointer; font-family: 'Noto Sans JP', sans-serif; } @keyframes slideUp { from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)} } @keyframes fadeIn { from{opacity:0}to{opacity:1} } @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} } @keyframes spin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} } .card { transition: all 0.2s ease; border: 1px solid #1e3a5f; } .card:hover { transform: translateY(-2px); border-color: #2a5298; box-shadow: 0 8px 32px rgba(42,82,152,0.2); } .tab-btn { transition: all 0.2s; border: none; } .input-field { background: #0d1f3c; border: 1px solid #1e3a5f; border-radius: 8px; padding: 9px 12px; color: #e8f0fe; font-size: 13px; width: 100%; transition: border-color 0.2s; } .input-field:focus { border-color: #4a8af4; } .btn-primary { background: linear-gradient(135deg, #2a5298, #4a8af4); border: none; border-radius: 8px; color: #fff; font-weight: 700; transition: all 0.2s; } .btn-primary:hover { opacity: 0.9; box-shadow: 0 4px 16px rgba(74,138,244,0.4); } .btn-danger:hover { background: #3a1a1a !important; } .btn-decide:hover { background: #1a4a2a !important; } .btn-apply:hover { background: #2a4a6a !important; } .recruiting-dot { animation: pulse 2s infinite; } .spinner { animation: spin 1s linear infinite; display: inline-block; } .toggle { cursor: pointer; transition: all 0.2s; } .toggle:hover { opacity: 0.8; }`}</style>

```
  <div style={{ position: "fixed", inset: 0, opacity: 0.025, backgroundImage: "repeating-linear-gradient(0deg,#4a8af4 0,#4a8af4 1px,transparent 1px,transparent 64px),repeating-linear-gradient(90deg,#4a8af4 0,#4a8af4 1px,transparent 1px,transparent 64px)", pointerEvents: "none" }} />

  {/* Header */}
  <div style={{ background: "linear-gradient(180deg,#0d1f3c 0%,#0a1628 100%)", borderBottom: "1px solid #1e3a5f", padding: "0 16px", position: "sticky", top: 0, zIndex: 50 }}>
    <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 58 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 38, height: 38, background: "linear-gradient(135deg,#1a3a8a,#4a8af4)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, boxShadow: "0 2px 12px rgba(74,138,244,0.35)" }}>🎾</div>
        <div>
          <div style={{ fontFamily: "'Outfit',sans-serif", fontSize: 19, fontWeight: 800, color: "#fff", lineHeight: 1 }}>Tennis<span style={{ color: "#4a8af4" }}>Sub</span></div>
          <div style={{ fontSize: 9, color: "#2a5a8a", letterSpacing: 2, marginTop: 1 }}>INSTRUCTOR MATCH</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
          {syncStatus === "saving" && <><span className="spinner" style={{ fontSize: 12 }}>⟳</span><span style={{ color: "#4a6fa5" }}>同期中</span></>}
          {syncStatus === "synced" && <><span style={{ color: "#43a047" }}>●</span><span style={{ color: "#2a5a8a" }}>同期済</span></>}
          {syncStatus === "error" && <><span style={{ color: "#e53935" }}>●</span><span style={{ color: "#ef9a9a" }}>エラー</span></>}
        </div>
        <div style={{ display: "flex", gap: 2, background: "#081428", borderRadius: 8, padding: 3, border: "1px solid #1e3a5f" }}>
          {[["requests", "依頼一覧"], ["instructors", "メンバー"]].map(([key, label]) => (
            <button key={key} className="tab-btn" onClick={() => setTab(key)} style={{
              padding: "5px 14px", borderRadius: 6, fontSize: 12,
              background: tab === key ? "linear-gradient(135deg,#2a5298,#4a8af4)" : "transparent",
              color: tab === key ? "#fff" : "#2a5a8a", fontWeight: tab === key ? 700 : 400,
            }}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  </div>

  <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px" }}>
    {loading ? (
      <div style={{ textAlign: "center", padding: 60, color: "#2a5a8a" }}>
        <div className="spinner" style={{ fontSize: 28, display: "block", marginBottom: 12 }}>⟳</div>
        <div style={{ fontSize: 13 }}>データを読み込み中...</div>
      </div>
    ) : (
      <>
        {/* REQUESTS TAB */}
        {tab === "requests" && (
          <div style={{ animation: "fadeIn 0.3s ease" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
              {[["募集中", requests.filter(r=>r.status==="募集中").length, "#66bb6a"], ["決定済", requests.filter(r=>r.status==="決定済").length, "#64b5f6"], ["合計", requests.length, "#4a6fa5"]].map(([label, count, color]) => (
                <div key={label} style={{ background: "#0d1f3c", borderRadius: 10, padding: "10px 12px", border: "1px solid #1e3a5f", textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "'Outfit',sans-serif", lineHeight: 1 }}>{count}</div>
                  <div style={{ fontSize: 11, color: "#2a5a8a", marginTop: 3 }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input-field" style={{ flex: 1 }}>
                {["すべて","募集中","決定済","キャンセル"].map(s => <option key={s}>{s}</option>)}
              </select>
              <button onClick={() => setShowRequestForm(!showRequestForm)} className="btn-primary" style={{ padding: "9px 14px", fontSize: 13, whiteSpace: "nowrap" }}>＋ 依頼</button>
            </div>

            {showRequestForm && (
              <div style={{ background: "#0d1f3c", border: "1px solid #2a5298", borderRadius: 12, padding: 16, marginBottom: 14, animation: "slideUp 0.25s ease" }}>
                <div style={{ fontWeight: 700, marginBottom: 12, color: "#4a8af4", fontSize: 14 }}>🎾 新規代行依頼登録</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <input type="date" value={newRequest.date} onChange={e=>setNewRequest(p=>({...p,date:e.target.value}))} className="input-field" />
                  <input placeholder="時間（例: 18:00〜20:00）" value={newRequest.time} onChange={e=>setNewRequest(p=>({...p,time:e.target.value}))} className="input-field" />
                  <input placeholder="クラス（例: 一般レッスン）" value={newRequest.classType} onChange={e=>setNewRequest(p=>({...p,classType:e.target.value}))} className="input-field" />
                  <input placeholder="レベル（例: 初中級）" value={newRequest.level} onChange={e=>setNewRequest(p=>({...p,level:e.target.value}))} className="input-field" />
                </div>
                <textarea placeholder="備考・要望" value={newRequest.note} onChange={e=>setNewRequest(p=>({...p,note:e.target.value}))} rows={2} className="input-field" style={{ marginTop: 8, resize: "none" }} />
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button onClick={handleSubmitRequest} className="btn-primary" style={{ flex: 1, padding: "10px", fontSize: 14 }}>登録する</button>
                  <button onClick={() => setShowRequestForm(false)} style={{ padding: "10px 16px", background: "#1a2a40", border: "1px solid #1e3a5f", borderRadius: 8, color: "#4a6fa5", fontSize: 13 }}>キャンセル</button>
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredRequests.length === 0 && <div style={{ textAlign: "center", color: "#1e3a5f", padding: 48, fontSize: 14 }}>依頼が見つかりません</div>}
              {filteredRequests.map(req => {
                const sc = statusColor[req.status];
                return (
                  <div key={req.id} className="card" onClick={() => setSelectedRequest(req.id)} style={{ background: "#0d1f3c", borderRadius: 12, padding: "14px 16px", cursor: "pointer" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <div>
                        <div style={{ marginTop: 2, display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {req.classType && <span style={{ background: "#1e3a5f", borderRadius: 4, padding: "2px 8px", fontSize: 11, color: "#64b5f6" }}>{req.classType}</span>}
                          {req.level && <span style={{ background: "#1a2a1a", borderRadius: 4, padding: "2px 8px", fontSize: 11, color: "#81c784" }}>{req.level}</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, background: sc.bg, border: `1px solid ${sc.border}`, borderRadius: 20, padding: "3px 10px" }}>
                        <div className={req.status==="募集中"?"recruiting-dot":""} style={{ width: 6, height: 6, borderRadius: "50%", background: sc.dot }} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: sc.text }}>{req.status}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#2a5a8a" }}>
                      <span>📅 {req.date}</span>
                      <span>🕐 {req.time}</span>
                    </div>
                    <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: "#1e4a7a" }}>代行可能 {req.applicants.length}名</span>
                      {req.note && <span style={{ fontSize: 11, color: "#1a3a5a", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{req.note}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* INSTRUCTORS TAB */}
        {tab === "instructors" && (
          <div style={{ animation: "fadeIn 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: "#2a5a8a" }}>登録インストラクター {instructors.length}名</div>
              <button onClick={() => setShowInstructorForm(!showInstructorForm)} className="btn-primary" style={{ padding: "8px 14px", fontSize: 13 }}>＋ 追加</button>
            </div>

            {showInstructorForm && (
              <div style={{ background: "#0d1f3c", border: "1px solid #2a5298", borderRadius: 12, padding: 16, marginBottom: 14, animation: "slideUp 0.25s ease" }}>
                <div style={{ fontWeight: 700, marginBottom: 12, color: "#4a8af4", fontSize: 14 }}>👤 インストラクター追加</div>
                <input placeholder="氏名" value={newInstructor.name} onChange={e=>setNewInstructor(p=>({...p,name:e.target.value}))} className="input-field" style={{ marginBottom: 8 }} />
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: "#2a5a8a", marginBottom: 6 }}>得意分野</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                    {newInstructor.specialties.map(s => (
                      <span key={s} style={{ background: "#1e3a5f", borderRadius: 4, padding: "3px 8px", fontSize: 11, color: "#64b5f6", display: "flex", alignItems: "center", gap: 4 }}>
                        {s}
                        <button onClick={() => removeSpecialty(s)} style={{ background: "none", border: "none", color: "#4a6fa5", fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <select value={specialtyInput} onChange={e => setSpecialtyInput(e.target.value)} className="input-field" style={{ flex: 1 }}>
                      <option value="">得意分野を選択</option>
                      {SPECIALTIES_OPTIONS.filter(s => !newInstructor.specialties.includes(s)).map(s => <option key={s}>{s}</option>)}
                    </select>
                    <button onClick={() => addSpecialty(specialtyInput)} style={{ background: "#1e3a5f", border: "none", borderRadius: 8, color: "#64b5f6", padding: "0 14px", fontSize: 13, fontWeight: 700 }}>追加</button>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 12, color: "#4a6fa5" }}>対応状況:</span>
                  <button onClick={() => setNewInstructor(p=>({...p,available:!p.available}))} style={{ background: newInstructor.available ? "rgba(56,142,60,0.15)" : "rgba(229,57,53,0.12)", border: `1px solid ${newInstructor.available ? "rgba(56,142,60,0.3)" : "rgba(229,57,53,0.25)"}`, borderRadius: 20, padding: "4px 12px", fontSize: 12, fontWeight: 700, color: newInstructor.available ? "#66bb6a" : "#ef9a9a" }}>
                    {newInstructor.available ? "● 対応可" : "● 対応不可"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={handleAddInstructor} className="btn-primary" style={{ flex: 1, padding: "10px", fontSize: 14 }}>追加する</button>
                  <button onClick={() => { setShowInstructorForm(false); setNewInstructor(emptyInstructor); setSpecialtyInput(""); }} style={{ padding: "10px 16px", background: "#1a2a40", border: "1px solid #1e3a5f", borderRadius: 8, color: "#4a6fa5", fontSize: 13 }}>キャンセル</button>
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {instructors.map(inst => (
                <div key={inst.id} className="card" style={{ background: "#0d1f3c", borderRadius: 12, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                      <div style={{ width: 46, height: 46, borderRadius: "50%", background: inst.available ? "linear-gradient(135deg,#0d2a3c,#1a4a6a)" : "linear-gradient(135deg,#1a1a28,#252535)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, border: `2px solid ${inst.available ? "#2a5298" : "#252535"}`, flexShrink: 0 }}>🎾</div>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{inst.name}</span>
                        <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                          {inst.specialties.map(s => <span key={s} style={{ background: "#1e3a5f", borderRadius: 4, padding: "2px 8px", fontSize: 11, color: "#64b5f6" }}>{s}</span>)}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, marginLeft: 8 }}>
                      <button onClick={() => setConfirmDelete(inst.id)} className="btn-danger" style={{ background: "rgba(229,57,53,0.1)", border: "1px solid rgba(229,57,53,0.2)", borderRadius: 6, color: "#ef9a9a", padding: "4px 10px", fontSize: 11, fontWeight: 700 }}>削除</button>
                      <button className="toggle" onClick={() => toggleAvailable(inst.id)} style={{ background: inst.available ? "rgba(56,142,60,0.15)" : "rgba(229,57,53,0.12)", border: `1px solid ${inst.available ? "rgba(56,142,60,0.3)" : "rgba(229,57,53,0.25)"}`, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: inst.available ? "#66bb6a" : "#ef9a9a" }}>
                        {inst.available ? "● 対応可" : "● 対応不可"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    )}
  </div>

  {/* Delete confirm */}
  {confirmDelete && (
    <div onClick={() => setConfirmDelete(null)} style={{ position: "fixed", inset: 0, background: "rgba(5,10,20,0.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, animation: "fadeIn 0.2s ease", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0d1f3c", border: "1px solid #2a2a4a", borderRadius: 16, padding: 24, width: "100%", maxWidth: 340, animation: "slideUp 0.2s ease" }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>インストラクターを削除</div>
        <div style={{ fontSize: 13, color: "#4a6fa5", marginBottom: 20 }}>「{instructors.find(i=>i.id===confirmDelete)?.name}」を削除しますか？<br /><span style={{ color: "#ef9a9a", fontSize: 12 }}>この操作は元に戻せません。</span></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => handleDeleteInstructor(confirmDelete)} style={{ flex: 1, background: "rgba(229,57,53,0.15)", border: "1px solid rgba(229,57,53,0.3)", borderRadius: 8, color: "#ef9a9a", padding: "10px", fontSize: 14, fontWeight: 700 }}>削除する</button>
          <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, background: "#1a2a40", border: "1px solid #1e3a5f", borderRadius: 8, color: "#4a6fa5", padding: "10px", fontSize: 14 }}>キャンセル</button>
        </div>
      </div>
    </div>
  )}

  {/* Request detail modal */}
  {openRequest && (
    <div onClick={() => setSelectedRequest(null)} style={{ position: "fixed", inset: 0, background: "rgba(5,10,20,0.88)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100, animation: "fadeIn 0.2s ease" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0d1f3c", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 720, padding: "20px 16px 32px", maxHeight: "85vh", overflowY: "auto", animation: "slideUp 0.25s ease", border: "1px solid #1e3a5f", borderBottom: "none" }}>
        <div style={{ width: 36, height: 4, background: "#1e3a5f", borderRadius: 2, margin: "0 auto 16px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {openRequest.classType && <span style={{ background: "#1e3a5f", borderRadius: 4, padding: "2px 8px", fontSize: 11, color: "#64b5f6" }}>{openRequest.classType}</span>}
            {openRequest.level && <span style={{ background: "#1a2a1a", borderRadius: 4, padding: "2px 8px", fontSize: 11, color: "#81c784" }}>{openRequest.level}</span>}
            {(() => { const sc = statusColor[openRequest.status]; return <span style={{ background: sc.bg, border: `1px solid ${sc.border}`, borderRadius: 4, padding: "2px 8px", fontSize: 11, color: sc.text, fontWeight: 700 }}>{openRequest.status}</span>; })()}
          </div>
          <button onClick={() => setSelectedRequest(null)} style={{ background: "#1a2a40", border: "1px solid #1e3a5f", borderRadius: 8, color: "#4a6fa5", padding: "6px 12px", fontSize: 14 }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {[["📅 日付", openRequest.date], ["🕐 時間", openRequest.time]].map(([label, val]) => (
            <div key={label} style={{ background: "#081428", borderRadius: 8, padding: "9px 12px", border: "1px solid #1a2a40" }}>
              <div style={{ fontSize: 10, color: "#2a5a8a", marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#c8d8f0" }}>{val}</div>
            </div>
          ))}
        </div>

        {openRequest.note && (
          <div style={{ background: "#081428", borderRadius: 8, padding: "10px 12px", marginBottom: 14, border: "1px solid #1a2a40" }}>
            <div style={{ fontSize: 10, color: "#2a5a8a", marginBottom: 4 }}>📝 備考・要望</div>
            <div style={{ fontSize: 13, color: "#a0b8d0", lineHeight: 1.6 }}>{openRequest.note}</div>
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#4a8af4", display: "flex", alignItems: "center", gap: 6 }}>
            🎾 代行可能インストラクター
            <span style={{ background: "#1e3a5f", borderRadius: 10, padding: "1px 8px", fontSize: 11, color: "#64b5f6" }}>{openRequest.applicants.length}名</span>
          </div>
          {openRequest.applicants.length === 0 ? (
            <div style={{ color: "#1a3a5a", fontSize: 13, textAlign: "center", padding: 20, border: "1px dashed #1e3a5f", borderRadius: 8 }}>代行可能なインストラクターがいません</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {openRequest.applicants.map(id => {
                const inst = getInst(id);
                if (!inst) return null;
                const isDecided = openRequest.status === "決定済";
                return (
                  <div key={id} style={{ background: "#081428", borderRadius: 8, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", border: isDecided ? "1px solid rgba(30,136,229,0.3)" : "1px solid #1a2a40" }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{inst.name}</span>
                      <div style={{ marginTop: 5, display: "flex", gap: 4 }}>
                        {inst.specialties.map(s => <span key={s} style={{ background: "#1e3a5f", borderRadius: 4, padding: "1px 6px", fontSize: 10, color: "#64b5f6" }}>{s}</span>)}
                      </div>
                    </div>
                    {openRequest.status === "募集中" ? (
                      <button className="btn-decide" onClick={() => handleDecide(openRequest.id, id)} style={{ background: "#0d2a1a", border: "1px solid #1a4a2a", borderRadius: 8, color: "#66bb6a", padding: "6px 14px", fontSize: 12, fontWeight: 700, transition: "background 0.2s" }}>代行依頼</button>
                    ) : isDecided && (
                      <span style={{ background: "rgba(30,136,229,0.15)", border: "1px solid rgba(30,136,229,0.3)", borderRadius: 8, color: "#64b5f6", padding: "6px 12px", fontSize: 12, fontWeight: 700 }}>✓ 代行決定</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {openRequest.status === "募集中" && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "#2a5a8a" }}>追加できるインストラクター</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {instructors.filter(i => i.available && !openRequest.applicants.includes(i.id)).length === 0 && <div style={{ color: "#1a3a5a", fontSize: 12, textAlign: "center", padding: 12 }}>対応可能なメンバーがいません</div>}
              {instructors.filter(i => i.available && !openRequest.applicants.includes(i.id)).map(inst => (
                <div key={inst.id} style={{ background: "#081428", borderRadius: 8, padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #1a2a40" }}>
                  <span style={{ fontSize: 13 }}>{inst.name}</span>
                  <button className="btn-apply" onClick={() => handleApply(openRequest.id, inst.id)} style={{ background: "#1e3a5f", border: "none", borderRadius: 8, color: "#64b5f6", padding: "5px 12px", fontSize: 11, fontWeight: 700, transition: "background 0.2s" }}>追加する</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {openRequest.status === "募集中" && (
          <button onClick={() => handleCancel(openRequest.id)} style={{ width: "100%", background: "transparent", border: "1px solid rgba(229,57,53,0.25)", borderRadius: 8, color: "#ef9a9a", padding: "10px", fontSize: 13, fontWeight: 600 }}>依頼をキャンセル</button>
        )}
      </div>
    </div>
  )}
</div>
```

);
}
