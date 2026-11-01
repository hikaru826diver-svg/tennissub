// ===== データストア =====
// Supabase の `shift_records` テーブル（1レコード=1行）に保存します。
// テーブル未作成・接続不可の場合はブラウザの localStorage に保存します（端末間で共有されません）。
import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";

const URL = import.meta.env.VITE_SUPABASE_URL || "";
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const TABLE = "shift_records";
const LS_KEY = "shift-app-data-v1";
export const KINDS = ["department", "staff", "request", "shift", "setting", "roster"];
// roster: 部門×月ごとに手動追加したスタッフ { id:"deptId|YYYY-MM", deptId, month, staffIds:[] }

const supabase = URL && KEY ? createClient(URL, KEY) : null;

// ---- localStorage backend ----
let memory = null; // localStorage が使えない環境用
function lsLoad() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || memory || {};
  } catch {
    return memory ? JSON.parse(JSON.stringify(memory)) : {};
  }
}
function lsSave(all) {
  memory = all;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* 保存不可の環境ではメモリのみ */
  }
}
/** デモ用：データが空なら初期データを投入 */
export function seedLocal(all) {
  const cur = lsLoad();
  if (Object.values(cur).some((v) => v && Object.keys(v).length)) return;
  lsSave(all);
}

const local = {
  name: "local",
  async loadAll() {
    const all = lsLoad();
    return KINDS.reduce((o, k) => ({ ...o, [k]: Object.values(all[k] || {}) }), {});
  },
  async upsert(kind, recs) {
    const all = lsLoad();
    all[kind] ||= {};
    recs.forEach((r) => (all[kind][r.id] = r));
    lsSave(all);
  },
  async remove(kind, ids) {
    const all = lsLoad();
    ids.forEach((id) => delete (all[kind] || {})[id]);
    lsSave(all);
  },
};

// ---- Supabase backend ----
const remote = {
  name: "supabase",
  async loadAll() {
    const out = KINDS.reduce((o, k) => ({ ...o, [k]: [] }), {});
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from(TABLE).select("id,kind,data").range(from, from + pageSize - 1);
      if (error) throw error;
      data.forEach((r) => out[r.kind]?.push({ ...r.data, id: r.id }));
      if (data.length < pageSize) break;
    }
    return out;
  },
  async upsert(kind, recs) {
    if (!recs.length) return;
    const rows = recs.map((r) => ({ id: r.id, kind, data: r, updated_at: new Date().toISOString() }));
    const { error } = await supabase.from(TABLE).upsert(rows);
    if (error) throw error;
  },
  async remove(kind, ids) {
    if (!ids.length) return;
    const { error } = await supabase.from(TABLE).delete().in("id", ids);
    if (error) throw error;
  },
};

let backend = null;
async function pickBackend() {
  if (backend) return backend;
  if (supabase) {
    const { error } = await supabase.from(TABLE).select("id").limit(1);
    if (!error) return (backend = remote);
    console.warn("Supabase に接続できないため localStorage を使用します:", error.message);
  }
  return (backend = local);
}

const POLL_MS = 15000;

/**
 * アプリ全体のデータを扱うフック
 * data: { department:[], staff:[], request:[], shift:[], setting:[] }
 */
export function useStore() {
  const [data, setData] = useState(() => KINDS.reduce((o, k) => ({ ...o, [k]: [] }), {}));
  const [mode, setMode] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const busy = useRef(0);

  const reload = useCallback(async () => {
    try {
      const b = await pickBackend();
      setMode(b.name);
      const all = await b.loadAll();
      if (busy.current === 0) setData(all);
      setError(null);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(() => document.visibilityState === "visible" && reload(), POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  /** 楽観的更新 → 保存 */
  const save = useCallback(async (kind, recs) => {
    recs = Array.isArray(recs) ? recs : [recs];
    setData((d) => {
      const map = Object.fromEntries(d[kind].map((r) => [r.id, r]));
      recs.forEach((r) => (map[r.id] = r));
      return { ...d, [kind]: Object.values(map) };
    });
    busy.current++;
    try {
      await (await pickBackend()).upsert(kind, recs);
      setError(null);
    } catch (e) {
      setError(`保存に失敗しました: ${e.message}`);
      throw e;
    } finally {
      busy.current--;
    }
  }, []);

  const remove = useCallback(async (kind, ids) => {
    ids = Array.isArray(ids) ? ids : [ids];
    const set = new Set(ids);
    setData((d) => ({ ...d, [kind]: d[kind].filter((r) => !set.has(r.id)) }));
    busy.current++;
    try {
      await (await pickBackend()).remove(kind, ids);
      setError(null);
    } catch (e) {
      setError(`削除に失敗しました: ${e.message}`);
      throw e;
    } finally {
      busy.current--;
    }
  }, []);

  return { data, mode, error, loading, reload, save, remove };
}

// ---- 設定値 ----
export const DEFAULT_SETTINGS = {
  id: "settings",
  orgName: "シフト管理",
  adminPass: "admin",
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
  taskLabels: ["受付", "レジ", "清掃", "監視", "指導", "事務", "会議"],
};
export function getSettings(data) {
  const s = data.setting.find((r) => r.id === "settings") || {};
  return { ...DEFAULT_SETTINGS, ...s, collection: { ...DEFAULT_SETTINGS.collection, ...(s.collection || {}) } };
}
