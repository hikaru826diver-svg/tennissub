import { useEffect, useState } from "react";
import { facilityCodeFromUrl, lastFacilityCode, resetLocal, useBackend } from "./store.js";
import StaffEntry from "./pages/StaffEntry.jsx";
import AdminGate from "./pages/admin/AdminApp.jsx";
import InstallButton from "./InstallButton.jsx";

function useHash() {
  const [hash, setHash] = useState(window.location.hash || "#");
  useEffect(() => {
    const f = () => setHash(window.location.hash || "#");
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return hash;
}
function useOnline() {
  const [on, setOn] = useState(typeof navigator === "undefined" ? true : navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return on;
}

export default function App() {
  const { backend, setupError } = useBackend();
  const hash = useHash();
  const online = useOnline();
  const route = hash.replace(/^#\/?/, "").split(/[/-]/);
  const [code, setCode] = useState(() => facilityCodeFromUrl() || lastFacilityCode.get());
  const [title, setTitle] = useState("シフト管理");

  useEffect(() => { if (code) lastFacilityCode.set(code); }, [code]);
  useEffect(() => { document.title = `${title} | シフト作成アプリ`; }, [title]);
  useEffect(() => { if (route[0] !== "staff" && route[0] !== "admin") setTitle("シフト管理"); }, [route[0]]); // eslint-disable-line

  const changeFacility = () => {
    setCode("");
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("f");
      window.history.replaceState(null, "", u.toString());
    } catch { /* ignore */ }
  };
  const pickFacility = (c) => {
    setCode(c);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("f", c);
      window.history.replaceState(null, "", u.toString());
    } catch { /* ignore */ }
  };

  return (
    <div className="app">
      <header className="topbar">
        <a href="#" className="brand">📅 {title}</a>
        <nav>
          <a href="#staff" className={route[0] === "staff" ? "active" : ""}>シフト希望入力</a>
          <a href="#admin" className={route[0] === "admin" ? "active" : ""}>管理者</a>
          <InstallButton />
        </nav>
      </header>
      {!online && <div className="banner warn">オフラインです。通信が回復すると最新の内容を読み込みます（オフライン中は保存できません）。</div>}
      {import.meta.env.VITE_DEMO ? (
        <div className="banner warn">
          デモ版：サンプルの2施設（体育館・市民プール）入りで自由に操作できます。本部としてログイン済みです。スタッフの個人PINは全員「1111」です。変更はこのブラウザ内にのみ保存され、Excelのダウンロードは動作しません。
          <button className="btn tiny" style={{ marginLeft: 8 }} onClick={() => { resetLocal(); window.location.reload(); }}>サンプルを初期状態に戻す</button>
        </div>
      ) : backend?.name === "local" && (
        <div className="banner warn">
          ブラウザ内保存モード：データはこのブラウザ内にのみ保存され、他の端末とは共有されません。複数の端末・施設で使うには README の手順で Supabase を設定してください。
          {setupError && <div className="small">{setupError}</div>}
        </div>
      )}
      {!backend ? (
        <div className="center muted" style={{ padding: 40 }}>読み込み中…</div>
      ) : route[0] === "staff" ? (
        code ? (
          <StaffEntry key={code} backend={backend} code={code} onChangeFacility={changeFacility} onTitle={setTitle} />
        ) : (
          <FacilityPicker backend={backend} onPick={pickFacility} />
        )
      ) : route[0] === "admin" ? (
        <AdminGate backend={backend} sub={route[1] || "requests"} onTitle={setTitle} />
      ) : (
        <Home />
      )}
    </div>
  );
}

function FacilityPicker({ backend, onPick }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { backend.publicFacilities().then(setList).catch((e) => setErr(e.message)); }, [backend]);
  return (
    <main className="page narrow">
      <h1>シフト希望入力</h1>
      <div className="card">
        <h3>勤務する施設を選んでください</h3>
        {err && <div className="banner error">{err}</div>}
        {!list ? <p className="muted">読み込み中…</p> : !list.length ? <p className="muted">施設が登録されていません。管理者に連絡してください。</p> : (
          <div className="facility-list">
            {list.map((f) => <button key={f.code} className="btn facility-btn" onClick={() => onPick(f.code)}>{f.name}</button>)}
          </div>
        )}
        <p className="small muted">次回からは選んだ施設が自動で開きます。管理者から届いたURLを開いた場合は、この画面は表示されません。</p>
      </div>
    </main>
  );
}

function Home() {
  return (
    <main className="home">
      <a className="home-card" href="#staff">
        <div className="home-icon">✍️</div>
        <h2>シフト希望入力</h2>
        <p>アルバイトスタッフの方はこちらから勤務希望を提出してください。</p>
      </a>
      <a className="home-card" href="#admin">
        <div className="home-icon">🛠️</div>
        <h2>管理者画面</h2>
        <p>スタッフ登録・希望一覧・シフト作成・タイムテーブル・給与計算・Excel出力・施設の切り替え</p>
      </a>
    </main>
  );
}
