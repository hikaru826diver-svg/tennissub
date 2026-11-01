// ===== データストア（複数施設対応） =====
// - Supabase 設定時：Supabase Auth でログインした管理者だけが、所属施設のデータを読み書きできます（RLS）。
//   スタッフのシフト希望入力はログイン不要で、専用の関数（portal_*）経由で必要最小限のデータだけを扱います。
// - Supabase 未設定・未セットアップ時：ブラウザの localStorage に保存します（端末間で共有されません）。
import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { uid } from "./utils.js";

const SB_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const TABLE = "shift_records";
export const KINDS = ["department", "staff", "request", "shift", "setting", "roster"];
// roster: 部門×月ごとに手動追加したスタッフ { id:"deptId|YYYY-MM", deptId, month, staffIds:[] }

export const supabase = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY) : null;
const empty = () => KINDS.reduce((o, k) => ({ ...o, [k]: [] }), {});
const settingsId = (fid) => `settings:${fid}`;

// ---- 保存用ユーティリティ ----
export const safeLS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const safeSS = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

// =====================================================================
// localStorage バックエンド
// =====================================================================
const LS_KEY = "shift-app-data-v2";
const LS_KEY_V1 = "shift-app-data-v1";
const LS_SESSION = "shift-app-local-session";
let memory = null; // localStorage が使えない環境用

function lsLoad() {
  let all = null;
  try { all = JSON.parse(localStorage.getItem(LS_KEY)); } catch { /* ignore */ }
  all = all || (memory ? JSON.parse(JSON.stringify(memory)) : null);
  if (!all) all = migrateV1() || { facilities: {}, records: {}, hqPass: "admin" };
  all.facilities ||= {};
  all.records ||= {};
  return all;
}
function lsSave(all) {
  memory = all;
  try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch { /* 保存不可の環境ではメモリのみ */ }
}
/** 旧形式（単一施設）のデータを「施設1」として移行 */
function migrateV1() {
  let v1 = null;
  try { v1 = JSON.parse(localStorage.getItem(LS_KEY_V1)); } catch { /* ignore */ }
  if (!v1 || !Object.values(v1).some((v) => v && Object.keys(v).length)) return null;
  const fid = uid();
  const records = {};
  for (const k of KINDS) {
    records[k] = {};
    for (const r of Object.values(v1[k] || {})) {
      const id = k === "setting" ? settingsId(fid) : r.id;
      records[k][id] = { ...r, id, facilityId: fid };
    }
  }
  const name = Object.values(v1.setting || {})[0]?.orgName || "施設1";
  const all = { facilities: { [fid]: { id: fid, name, code: "f1" } }, records, hqPass: "admin" };
  lsSave(all);
  return all;
}
/** デモ用：データが空なら初期データを投入 */
export function seedLocal(all) {
  const cur = lsLoad();
  if (Object.keys(cur.facilities).length) return;
  lsSave(all);
}
export function resetLocal() {
  safeLS.del(LS_KEY);
  safeLS.del(LS_KEY_V1);
  safeSS.del(LS_SESSION);
  memory = null;
}

const pickRecords = (all, fid) => {
  const out = empty();
  for (const k of KINDS) out[k] = Object.values(all.records[k] || {}).filter((r) => r.facilityId === fid);
  return out;
};
const publicStaff = (s) => ({ id: s.id, name: s.name, kana: s.kana, deptIds: s.deptIds, active: s.active });
const publicSettings = (s = {}) => ({ id: s.id, orgName: s.orgName, dayStart: s.dayStart, dayEnd: s.dayEnd, stepMin: s.stepMin, collection: s.collection });

const local = {
  name: "local",
  // --- 認証（パスコード） ---
  async getSession() {
    try { return JSON.parse(safeSS.get(LS_SESSION)); } catch { return null; }
  },
  async signIn({ facilityId, pass, hq }) {
    const all = lsLoad();
    if (hq) {
      if (pass !== (all.hqPass || "admin")) throw new Error("本部パスコードが違います");
      const s = { role: "hq", label: "本部" };
      safeSS.set(LS_SESSION, JSON.stringify(s));
      return s;
    }
    const st = Object.values(all.records.setting || {}).find((r) => r.facilityId === facilityId) || {};
    if (pass !== (st.adminPass || "admin")) throw new Error("パスコードが違います");
    const s = { role: "admin", facilityIds: [facilityId], label: all.facilities[facilityId]?.name };
    safeSS.set(LS_SESSION, JSON.stringify(s));
    return s;
  },
  async signOut() { safeSS.del(LS_SESSION); },
  onAuthChange() { return () => {}; },
  async isHq(session) { return session?.role === "hq"; },
  async setHqPass(pass) { const all = lsLoad(); all.hqPass = pass; lsSave(all); },
  // --- 施設 ---
  async publicFacilities() {
    return Object.values(lsLoad().facilities).map(({ code, name }) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  },
  async listFacilities(session) {
    const list = Object.values(lsLoad().facilities).sort((a, b) => a.name.localeCompare(b.name, "ja"));
    return session?.role === "hq" ? list : list.filter((f) => session?.facilityIds?.includes(f.id));
  },
  async saveFacility(f) {
    const all = lsLoad();
    if (Object.values(all.facilities).some((x) => x.code === f.code && x.id !== f.id)) throw new Error("その施設コードは既に使われています");
    const rec = { ...f, id: f.id || uid() };
    all.facilities[rec.id] = rec;
    lsSave(all);
    return rec;
  },
  async deleteFacility(id) {
    const all = lsLoad();
    delete all.facilities[id];
    for (const k of KINDS) for (const [rid, r] of Object.entries(all.records[k] || {})) if (r.facilityId === id) delete all.records[k][rid];
    lsSave(all);
  },
  // --- 施設データ（管理者） ---
  async loadFacility(fid) { return pickRecords(lsLoad(), fid); },
  async upsert(fid, kind, recs) {
    const all = lsLoad();
    all.records[kind] ||= {};
    recs.forEach((r) => (all.records[kind][r.id] = { ...r, facilityId: fid }));
    lsSave(all);
  },
  async remove(fid, kind, ids) {
    const all = lsLoad();
    ids.forEach((id) => { if (all.records[kind]?.[id]?.facilityId === fid) delete all.records[kind][id]; });
    lsSave(all);
  },
  // --- スタッフ用（ログイン不要） ---
  async portalGet(code) {
    const all = lsLoad();
    const f = Object.values(all.facilities).find((x) => x.code === code);
    if (!f) throw new Error("施設が見つかりません。URLを確認してください。");
    const d = pickRecords(all, f.id);
    return {
      facility: { id: f.id, name: f.name, code: f.code },
      department: d.department,
      staff: d.staff.map(publicStaff),
      setting: d.setting.map(publicSettings),
    };
  },
  async portalRequests(code, staffId) {
    const all = lsLoad();
    const f = Object.values(all.facilities).find((x) => x.code === code);
    if (!f) return [];
    return pickRecords(all, f.id).request.filter((r) => r.staffId === staffId);
  },
  async portalSubmit(code, staffId, recs, replaceIds) {
    const all = lsLoad();
    const f = Object.values(all.facilities).find((x) => x.code === code);
    if (!f) throw new Error("施設が見つかりません");
    const st = Object.values(all.records.setting || {}).find((r) => r.facilityId === f.id) || {};
    assertOpen(st.collection);
    replaceIds.forEach((id) => {
      const r = all.records.request?.[id];
      if (r && r.facilityId === f.id && r.staffId === staffId) delete all.records.request[id];
    });
    all.records.request ||= {};
    recs.forEach((r) => (all.records.request[r.id] = { ...r, staffId, facilityId: f.id }));
    lsSave(all);
  },
  async portalDelete(code, staffId, id) {
    const all = lsLoad();
    const f = Object.values(all.facilities).find((x) => x.code === code);
    const r = all.records.request?.[id];
    const st = Object.values(all.records.setting || {}).find((x) => x.facilityId === f?.id) || {};
    assertOpen(st.collection);
    if (f && r && r.facilityId === f.id && r.staffId === staffId) delete all.records.request[id];
    lsSave(all);
  },
  // --- 管理者メンバー（ローカルでは各施設のパスコードで代用） ---
  membersSupported: false,
};

function assertOpen(col = {}) {
  const t = new Date();
  const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  if (col.open === false || (col.deadline && today > col.deadline)) throw new Error("現在シフト希望の受付は終了しています");
}

// =====================================================================
// Supabase バックエンド
// =====================================================================
const rpc = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(friendly(error));
  return data;
};
function friendly(e) {
  const m = e?.message || String(e);
  if (/closed/i.test(m)) return "現在シフト希望の受付は終了しています";
  if (/facility not found/i.test(m)) return "施設が見つかりません。URLを確認してください。";
  if (/Invalid login credentials/i.test(m)) return "メールアドレスまたはパスワードが違います";
  if (/user not found/i.test(m)) return "そのメールアドレスのユーザーが見つかりません（先に Supabase でユーザーを作成してください）";
  if (/permission denied|row-level security/i.test(m)) return "この操作を行う権限がありません";
  return m;
}

const remote = {
  name: "supabase",
  async getSession() {
    const { data } = await supabase.auth.getSession();
    const u = data.session?.user;
    return u ? { role: "user", userId: u.id, label: u.email } : null;
  },
  async signIn({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendly(error));
    return { role: "user", userId: data.user.id, label: data.user.email };
  },
  async resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
    if (error) throw new Error(friendly(error));
  },
  async updatePassword(password) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(friendly(error));
  },
  async signOut() { await supabase.auth.signOut(); },
  onAuthChange(cb) {
    const { data } = supabase.auth.onAuthStateChange((event) => cb(event));
    return () => data.subscription.unsubscribe();
  },
  async isHq() { return !!(await rpc("is_hq")); },
  async publicFacilities() { return (await rpc("portal_facilities")) || []; },
  async listFacilities() {
    const { data, error } = await supabase.from("facilities").select("id,name,code").order("name");
    if (error) throw new Error(friendly(error));
    return data;
  },
  async saveFacility(f) {
    const row = { id: f.id || uid(), name: f.name, code: f.code };
    const { data, error } = await supabase.from("facilities").upsert(row).select().single();
    if (error) throw new Error(/duplicate|unique/i.test(error.message) ? "その施設コードは既に使われています" : friendly(error));
    return data;
  },
  async deleteFacility(id) {
    const { error: e1 } = await supabase.from(TABLE).delete().eq("facility_id", id);
    if (e1) throw new Error(friendly(e1));
    const { error } = await supabase.from("facilities").delete().eq("id", id);
    if (error) throw new Error(friendly(error));
  },
  async loadFacility(fid) {
    const out = empty();
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from(TABLE).select("id,kind,data").eq("facility_id", fid).range(from, from + pageSize - 1);
      if (error) throw new Error(friendly(error));
      data.forEach((r) => out[r.kind]?.push({ ...r.data, id: r.id, facilityId: fid }));
      if (data.length < pageSize) break;
    }
    return out;
  },
  async upsert(fid, kind, recs) {
    if (!recs.length) return;
    const now = new Date().toISOString();
    const rows = recs.map((r) => ({ id: r.id, kind, facility_id: fid, data: { ...r, facilityId: fid }, updated_at: now }));
    const { error } = await supabase.from(TABLE).upsert(rows);
    if (error) throw new Error(friendly(error));
  },
  async remove(fid, kind, ids) {
    if (!ids.length) return;
    const { error } = await supabase.from(TABLE).delete().eq("facility_id", fid).in("id", ids);
    if (error) throw new Error(friendly(error));
  },
  async portalGet(code) { return await rpc("portal_get", { p_code: code }); },
  async portalRequests(code, staffId) { return (await rpc("portal_requests", { p_code: code, p_staff_id: staffId })) || []; },
  async portalSubmit(code, staffId, recs, replaceIds) {
    await rpc("portal_submit", { p_code: code, p_staff_id: staffId, p_records: recs, p_replace_ids: replaceIds });
  },
  async portalDelete(code, staffId, id) { await rpc("portal_delete", { p_code: code, p_staff_id: staffId, p_id: id }); },
  membersSupported: true,
  async listMembers(fid) { return (await rpc("list_members", { p_facility_id: fid })) || []; },
  async addMember(fid, email) { await rpc("add_member", { p_facility_id: fid, p_email: email }); },
  async removeMember(fid, userId) { await rpc("remove_member", { p_facility_id: fid, p_user_id: userId }); },
};

// =====================================================================
// バックエンド選択
// =====================================================================
let backendPromise = null;
export function getBackend() {
  if (!backendPromise) {
    backendPromise = (async () => {
      if (import.meta.env.VITE_DEMO || !supabase) return { backend: local, setupError: null };
      const { error } = await supabase.rpc("portal_facilities");
      if (!error) return { backend: remote, setupError: null };
      console.warn("Supabase が未セットアップのため localStorage を使用します:", error.message);
      return { backend: local, setupError: `Supabase のセットアップが完了していません（${error.message}）。README の手順で supabase.sql を実行してください。` };
    })();
  }
  return backendPromise;
}

export function useBackend() {
  const [state, setState] = useState({ backend: null, setupError: null });
  useEffect(() => { getBackend().then(setState); }, []);
  return state;
}

// =====================================================================
// 管理者：選択中の施設のデータ
// =====================================================================
const POLL_MS = 15000;

export function useFacilityStore(backend, facilityId) {
  const [data, setData] = useState(empty);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const busy = useRef(0);

  const reload = useCallback(async () => {
    if (!backend || !facilityId) return;
    try {
      const all = await backend.loadFacility(facilityId);
      if (busy.current === 0) setData(all);
      setError(null);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [backend, facilityId]);

  useEffect(() => {
    setLoading(true);
    setData(empty());
    reload();
    const t = setInterval(() => document.visibilityState === "visible" && reload(), POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  /** 楽観的更新 → 保存 */
  const save = useCallback(async (kind, recs) => {
    recs = (Array.isArray(recs) ? recs : [recs]).map((r) => (kind === "setting" ? { ...r, id: settingsId(facilityId) } : r));
    setData((d) => {
      const map = Object.fromEntries(d[kind].map((r) => [r.id, r]));
      recs.forEach((r) => (map[r.id] = r));
      return { ...d, [kind]: Object.values(map) };
    });
    busy.current++;
    try {
      await backend.upsert(facilityId, kind, recs);
      setError(null);
    } catch (e) {
      setError(`保存に失敗しました: ${e.message}`);
      throw e;
    } finally {
      busy.current--;
    }
  }, [backend, facilityId]);

  const remove = useCallback(async (kind, ids) => {
    ids = Array.isArray(ids) ? ids : [ids];
    const set = new Set(ids);
    setData((d) => ({ ...d, [kind]: d[kind].filter((r) => !set.has(r.id)) }));
    busy.current++;
    try {
      await backend.remove(facilityId, kind, ids);
      setError(null);
    } catch (e) {
      setError(`削除に失敗しました: ${e.message}`);
      throw e;
    } finally {
      busy.current--;
    }
  }, [backend, facilityId]);

  return { data, error, loading, reload, save, remove, facilityId };
}

// =====================================================================
// スタッフ：シフト希望入力（ログイン不要）
// =====================================================================
export function usePortal(backend, code, staffId) {
  const [base, setBase] = useState(null);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const reloadBase = useCallback(async () => {
    if (!backend || !code) return;
    try {
      setBase(await backend.portalGet(code));
      setError(null);
    } catch (e) {
      setError(e.message);
      setBase(null);
    } finally {
      setLoading(false);
    }
  }, [backend, code]);
  const reloadRequests = useCallback(async () => {
    if (!backend || !code || !staffId) return setRequests([]);
    try { setRequests(await backend.portalRequests(code, staffId)); } catch (e) { setError(e.message); }
  }, [backend, code, staffId]);

  useEffect(() => { setLoading(true); reloadBase(); }, [reloadBase]);
  useEffect(() => { reloadRequests(); }, [reloadRequests]);

  const data = { ...empty(), department: base?.department || [], staff: base?.staff || [], setting: base?.setting || [], request: requests };
  return {
    facility: base?.facility || null,
    data,
    error,
    loading,
    async submitRequests(recs, replaceIds) {
      await backend.portalSubmit(code, staffId, recs, replaceIds);
      await reloadRequests();
    },
    async deleteRequest(id) {
      await backend.portalDelete(code, staffId, id);
      await reloadRequests();
    },
  };
}

// ---- 設定値 ----
export const DEFAULT_SETTINGS = {
  id: "settings",
  orgName: "",
  adminPass: "admin", // localStorage 運用時のみ使用
  dayStart: 6,
  dayEnd: 23,
  stepMin: 30,
  categories: ["学生", "一般", "主婦・主夫", "シニア", "その他"],
  collection: { month: "", deadline: "", open: true, message: "" },
  overtimePremium: true,
  overtimeRate: 0.25,
  nightPremium: true,
  nightRate: 0.25,
  autoBreak: true,
  closingDay: 0, // 給与締め日（0=末日）
  taskLabels: ["受付", "レジ", "清掃", "監視", "指導", "事務", "会議"],
};
export function getSettings(data, facility) {
  const s = data.setting[0] || {};
  const merged = { ...DEFAULT_SETTINGS, ...s, collection: { ...DEFAULT_SETTINGS.collection, ...(s.collection || {}) } };
  if (!merged.orgName) merged.orgName = facility?.name || "シフト管理";
  return merged;
}

// ---- 選択中の施設（端末ごとに記憶） ----
const LAST_CODE = "shift-app-last-facility-code";
const LAST_ADMIN_FID = "shift-app-admin-facility";
export function facilityCodeFromUrl() {
  try { return new URLSearchParams(window.location.search).get("f") || ""; } catch { return ""; }
}
export const lastFacilityCode = { get: () => safeLS.get(LAST_CODE) || "", set: (c) => safeLS.set(LAST_CODE, c) };
export const lastAdminFacility = { get: () => safeLS.get(LAST_ADMIN_FID) || "", set: (id) => safeLS.set(LAST_ADMIN_FID, id) };
