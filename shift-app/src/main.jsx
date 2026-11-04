import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

async function boot() {
  if (import.meta.env.VITE_DEMO) {
    // デモモード：2施設のサンプルデータ投入・確認ダイアログ自動OK・本部としてログイン済み
    const { buildDemoStore } = await import("./sample.js");
    const { seedLocal, seedDemoPins } = await import("./store.js");
    if (seedLocal(buildDemoStore())) await seedDemoPins("1111");
    window.confirm = () => true;
    window.alert = (m) => console.info(m);
    try { sessionStorage.setItem("shift-app-local-session", JSON.stringify({ role: "hq", label: "本部（デモ）" })); } catch { /* ignore */ }
  } else if ("serviceWorker" in navigator && import.meta.env.PROD) {
    // PWA：オフライン時も画面を表示できるようにする
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
boot();
