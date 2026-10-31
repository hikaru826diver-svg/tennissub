import { useEffect, useState } from "react";
import { useStore, getSettings } from "./store.js";
import StaffEntry from "./pages/StaffEntry.jsx";
import AdminApp from "./pages/admin/AdminApp.jsx";

function useHash() {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const f = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return hash;
}

export default function App() {
  const store = useStore();
  const hash = useHash();
  const settings = getSettings(store.data);
  const route = hash.replace(/^#\//, "").split("/");

  useEffect(() => {
    document.title = `${settings.orgName} | シフト作成アプリ`;
  }, [settings.orgName]);

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">📅 {settings.orgName}</a>
        <nav>
          <a href="#/staff" className={route[0] === "staff" ? "active" : ""}>シフト希望入力</a>
          <a href="#/admin" className={route[0] === "admin" ? "active" : ""}>管理者</a>
        </nav>
      </header>
      {store.mode === "local" && (
        <div className="banner warn">
          ローカル保存モード：データはこのブラウザ内にのみ保存され、他の端末とは共有されません。共有するには README の手順で Supabase を設定してください。
        </div>
      )}
      {store.error && <div className="banner error">{store.error}</div>}
      {store.loading ? (
        <div className="center muted">読み込み中…</div>
      ) : route[0] === "staff" ? (
        <StaffEntry store={store} settings={settings} />
      ) : route[0] === "admin" ? (
        <AdminApp store={store} settings={settings} sub={route[1] || "requests"} />
      ) : (
        <Home />
      )}
    </div>
  );
}

function Home() {
  return (
    <main className="home">
      <a className="home-card" href="#/staff">
        <div className="home-icon">✍️</div>
        <h2>シフト希望入力</h2>
        <p>アルバイトスタッフの方はこちらから勤務希望を提出してください。</p>
      </a>
      <a className="home-card" href="#/admin">
        <div className="home-icon">🛠️</div>
        <h2>管理者画面</h2>
        <p>スタッフ登録・希望一覧・シフト作成・タイムテーブル・給与計算・Excel出力</p>
      </a>
    </main>
  );
}
