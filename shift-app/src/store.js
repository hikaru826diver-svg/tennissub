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

/** PIN 関連のエラー（画面で個別に案内する） */
export class PinError extends Error {
  constructor(code) {
    super({ "pin not set": "PINが未発行です。施設の管理者にPINの発行を依頼してください。", "pin locked": "PINを5回続けて間違えたため、15分間ロックされています。時間をおいて再度お試しください。", "invalid pin": "PINが違います。", "pin required": "PINを入力してください。" }[code] || code);
    this.code = code;
  }
}
const AUDIT_MAX = 5000;
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
  if (Object.keys(cur.facilities).length) return false;
  lsSave(all);
  return true;
}
/** デモ用：全スタッフに同じPINを設定（操作記録には残さない） */
export async function seedDemoPins(pin) {
  const all = lsLoad();
  all.pins ||= {};
  for (const st of Object.values(all.records.staff || {})) {
    const salt = uid();
    (all.pins[st.facilityId] ||= {})[st.id] = { salt, hash: await sha256(salt + pin), failed: 0, lockedUntil: null, updatedAt: new Date().toISOString() };
  }
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
const publicSettings = (s = {}) => ({ id: s.id, orgName: s.orgName, dayStart: s.dayStart, dayEnd: s.dayEnd, stepMin: s.stepMin, collection: s.collection, requirePin: s.requirePin !== false });

// ---- localStorage：PIN（ハッシュで保存）と操作記録 ----
async function sha256(text) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    let h = 0; for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `x${h}`; // crypto が使えない環境用（デモ）
  }
}
function localActor() {
  try { return JSON.parse(safeSS.get(LS_SESSION))?.label || "管理者"; } catch { return "管理者"; }
}
function pushAudit(all, entry) {
  all.audit ||= [];
  all.audit.push({ id: uid(), at: new Date().toISOString(), actor: localActor(), ...entry });
  if (all.audit.length > AUDIT_MAX) all.audit.splice(0, all.audit.length - AUDIT_MAX);
}
async function localCheckPin(all, fid, staffId, pin) {
  const st = Object.values(all.records.setting || {}).find((r) => r.facilityId === fid) || {};
  if (st.requirePin === false) return;
  const p = all.pins?.[fid]?.[staffId];
  if (!p) throw new PinError("pin not set");
  if (p.lockedUntil && Date.parse(p.lockedUntil) > Date.now()) throw new PinError("pin locked");
  if (!pin) throw new PinError("pin required"); // 未入力は失敗回数に数えない
  if (p.hash === (await sha256(p.salt + (pin || "")))) { p.failed = 0; p.lockedUntil = null; lsSave(all); return; }
  p.failed = (p.failed || 0) + 1;
  if (p.failed >= 5) { p.failed = 0; p.lockedUntil = new Date(Date.now() + 15 * 60000).toISOString(); }
  lsSave(all);
  throw new PinError("invalid pin");
}

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
    const s = { role: "admin", facilityIds: [facilityId], label: `${all.facilities[facilityId]?.name || ""} 管理者` };
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
    recs.forEach((r) => {
      const before = all.records[kind][r.id];
      const after = { ...r, facilityId: fid };
      if (before && JSON.stringify(before) === JSON.stringify(after)) return;
      all.records[kind][r.id] = after;
      pushAudit(all, { facility_id: fid, action: before ? "update" : "insert", kind, record_id: r.id, before: before || null, after });
    });
    lsSave(all);
  },
  async remove(fid, kind, ids) {
    const all = lsLoad();
    ids.forEach((id) => {
      const before = all.records[kind]?.[id];
      if (before?.facilityId !== fid) return;
      delete all.records[kind][id];
      pushAudit(all, { facility_id: fid, action: "delete", kind, record_id: id, before, after: null });
    });
    lsSave(all);
  },
  async listAudit(fid, { from } = {}) {
    return (lsLoad().audit || []).filter((a) => a.facility_id === fid && (!from || a.at >= from)).reverse().slice(0, 1000);
  },
  // --- スタッフPIN ---
  pinsSupported: true,
  async pinStatus(fid) {
    const pins = lsLoad().pins?.[fid] || {};
    return Object.entries(pins).map(([staff_id, p]) => ({ staff_id, updated_at: p.updatedAt, locked: !!(p.lockedUntil && Date.parse(p.lockedUntil) > Date.now()) }));
  },
  async setPin(fid, staffId, pin) {
    if (!/^\d{4,8}$/.test(pin)) throw new Error("PINは4〜8桁の数字にしてください");
    const all = lsLoad();
    const salt = uid();
    all.pins ||= {};
    all.pins[fid] ||= {};
    all.pins[fid][staffId] = { salt, hash: await sha256(salt + pin), failed: 0, lockedUntil: null, updatedAt: new Date().toISOString() };
    pushAudit(all, { facility_id: fid, action: "update", kind: "pin", record_id: staffId });
    lsSave(all);
  },
  async clearPin(fid, staffId) {
    const all = lsLoad();
    if (all.pins?.[fid]) delete all.pins[fid][staffId];
    pushAudit(all, { facility_id: fid, action: "delete", kind: "pin", record_id: staffId });
    lsSave(all);
  },
  mfaSupported: false,
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
  async portalRequests(code, staffId, pin) {
    const all = lsLoad();
    const f = Object.values(all.facilities).find((x) => x.code === code);
    if (!f) return [];
    await localCheckPin(all, f.id, staffId, pin);
    return pickRecords(all, f.id).request.filter((r) => r.staffId === staffId);
  },
  async portalSubmit(code, staffId, pin, recs, replaceIds) {
    const all = lsLoad();
    const f = Object.values(all.facilities).find((x) => x.code === code);
    if (!f) throw new Error("施設が見つかりません");
    const st = Object.values(all.records.setting || {}).find((r) => r.facilityId === f.id) || {};
    assertOpen(st.collection);
    await localCheckPin(all, f.id, staffId, pin);
    const actor = `スタッフ本人：${all.records.staff?.[staffId]?.name || ""}`;
    const log = (e) => { all.audit ||= []; all.audit.push({ id: uid(), at: new Date().toISOString(), actor, facility_id: f.id, kind: "request", ...e }); };
    replaceIds.forEach((id) => {
      const r = all.records.request?.[id];
      if (r && r.facilityId === f.id && r.staffId === staffId) { delete all.records.request[id]; log({ action: "delete", record_id: id, before: r, after: null }); }
    });
    all.records.request ||= {};
    recs.forEach((r) => { const rec = { ...r, staffId, facilityId: f.id }; all.records.request[r.id] = rec; log({ action: "insert", record_id: r.id, before: null, after: rec }); });
    lsSave(all);
  },
  async portalDelete(code, staffId, pin, id) {
    const all = lsLoad();
    const f = Object.values(all.facilities).find((x) => x.code === code);
    const r = all.records.request?.[id];
    const st = Object.values(all.records.setting || {}).find((x) => x.facilityId === f?.id) || {};
    assertOpen(st.collection);
    await localCheckPin(all, f?.id, staffId, pin);
    if (f && r && r.facilityId === f.id && r.staffId === staffId) {
      delete all.records.request[id];
      all.audit ||= [];
      all.audit.push({ id: uid(), at: new Date().toISOString(), actor: `スタッフ本人：${all.records.staff?.[staffId]?.name || ""}`, facility_id: f.id, kind: "request", action: "delete", record_id: id, before: r, after: null });
    }
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
  if (/mfa required first/i.test(m)) return "先にご自身の二段階認証を設定・確認してから必須にしてください";
  if (/invalid pin format/i.test(m)) return "PINは4〜8桁の数字にしてください";
  if (/permission denied|row-level security/i.test(m)) return "この操作を行う権限がありません（二段階認証が必須の場合は、先に二段階認証を行ってください）";
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
  async portalRequests(code, staffId, pin) {
    const r = await rpc("portal_requests", { p_code: code, p_staff_id: staffId, p_pin: pin || "" });
    if (r && !Array.isArray(r) && r.error) throw new PinError(r.error);
    return r || [];
  },
  async portalSubmit(code, staffId, pin, recs, replaceIds) {
    const r = await rpc("portal_submit", { p_code: code, p_staff_id: staffId, p_pin: pin || "", p_records: recs, p_replace_ids: replaceIds });
    if (r?.error) throw new PinError(r.error);
  },
  async portalDelete(code, staffId, pin, id) {
    const r = await rpc("portal_delete", { p_code: code, p_staff_id: staffId, p_pin: pin || "", p_id: id });
    if (r?.error) throw new PinError(r.error);
  },
  // --- 操作記録 ---
  async listAudit(fid, { from } = {}) {
    let q = supabase.from("audit_logs").select("id,at,actor,action,kind,record_id,before,after").eq("facility_id", fid).order("at", { ascending: false }).limit(1000);
    if (from) q = q.gte("at", from);
    const { data, error } = await q;
    if (error) throw new Error(friendly(error));
    return data;
  },
  // --- スタッフPIN ---
  pinsSupported: true,
  async pinStatus(fid) { return (await rpc("staff_pin_status", { p_facility_id: fid })) || []; },
  async setPin(fid, staffId, pin) { await rpc("set_staff_pin", { p_facility_id: fid, p_staff_id: staffId, p_pin: pin }); },
  async clearPin(fid, staffId) { await rpc("clear_staff_pin", { p_facility_id: fid, p_staff_id: staffId }); },
  // --- 二段階認証（TOTP） ---
  mfaSupported: true,
  async mfaState() {
    const [{ data: aal }, { data: f }, { data: cfg }] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
      supabase.from("app_config").select("require_mfa").eq("id", 1).maybeSingle(),
    ]);
    const factors = (f?.totp || []).filter((x) => x.status === "verified");
    return {
      required: !!cfg?.require_mfa,
      current: aal?.currentLevel,
      factors,
      needVerify: aal?.nextLevel === "aal2" && aal?.currentLevel !== "aal2",
      needEnroll: !!cfg?.require_mfa && !factors.length,
    };
  },
  async mfaEnroll() {
    // 途中で止めた未確認の登録が残っていると新規登録できないため削除
    const { data: f } = await supabase.auth.mfa.listFactors();
    for (const x of f?.all || []) if (x.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: x.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `shift-app-${Date.now()}` });
    if (error) throw new Error(friendly(error));
    return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
  },
  async mfaVerify(factorId, code) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: String(code).trim() });
    if (error) throw new Error(/invalid|code/i.test(error.message) ? "確認コードが違います。アプリに表示されている6桁の数字を入力してください。" : friendly(error));
  },
  async mfaUnenroll(factorId) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw new Error(friendly(error));
  },
  async setRequireMfa(on) { await rpc("set_require_mfa", { p_on: on }); },
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
export function usePortal(backend, code, staffId, pin) {
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
  const [pinError, setPinError] = useState(null);
  const [verified, setVerified] = useState(false);
  const needPin = base ? base.setting?.[0]?.requirePin !== false : true;
  const reloadRequests = useCallback(async () => {
    setVerified(false);
    if (!backend || !code || !staffId) return setRequests([]);
    if (!base) return; // 施設情報の読み込み待ち
    if (needPin && !pin) { setRequests([]); setPinError(null); return; } // PIN未入力のうちは問い合わせない
    try {
      setRequests(await backend.portalRequests(code, staffId, pin));
      setPinError(null);
      setVerified(true);
    } catch (e) {
      setRequests([]);
      if (e instanceof PinError) setPinError(e); else setError(e.message);
    }
  }, [backend, code, staffId, pin, base, needPin]);

  useEffect(() => { setLoading(true); reloadBase(); }, [reloadBase]);
  useEffect(() => { reloadRequests(); }, [reloadRequests]);

  const data = { ...empty(), department: base?.department || [], staff: base?.staff || [], setting: base?.setting || [], request: requests };
  return {
    facility: base?.facility || null,
    data,
    error,
    loading,
    pinError,
    verified,
    retry: reloadRequests,
    async submitRequests(recs, replaceIds) {
      await backend.portalSubmit(code, staffId, pin, recs, replaceIds);
      await reloadRequests();
    },
    async deleteRequest(id) {
      await backend.portalDelete(code, staffId, pin, id);
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
  requirePin: true, // スタッフの希望入力に個人PINを必須にする
  lastBackupAt: "",
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
