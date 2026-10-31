import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

async function boot() {
  if (import.meta.env.VITE_DEMO) {
    // デモモード：サンプルデータ投入・確認ダイアログ自動OK・管理者ログイン済み
    const { buildSample, toLocalShape } = await import("./sample.js");
    const { seedLocal } = await import("./store.js");
    seedLocal(toLocalShape(buildSample({ withShifts: true })));
    window.confirm = () => true;
    window.alert = (m) => console.info(m);
    try { sessionStorage.setItem("shift-app-admin", "1"); } catch { /* ignore */ }
  }
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
boot();
