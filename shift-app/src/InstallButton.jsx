import { useEffect, useState } from "react";
import { Modal } from "./components.jsx";

const isStandalone = () => {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  } catch { return false; }
};
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** 「ホーム画面に追加」ボタン（Android/PC は標準のインストール、iPhone は手順を表示） */
export default function InstallButton() {
  const [prompt, setPrompt] = useState(null);
  const [help, setHelp] = useState(false);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setPrompt(e); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (installed || import.meta.env.VITE_DEMO) return null;
  if (!prompt && !isIOS()) return null;

  const click = async () => {
    if (prompt) {
      prompt.prompt();
      const r = await prompt.userChoice.catch(() => null);
      if (r?.outcome === "accepted") setInstalled(true);
      setPrompt(null);
    } else setHelp(true);
  };

  return (
    <>
      <button className="install-btn" onClick={click} title="ホーム画面に追加してアプリとして使う">📲 アプリとして追加</button>
      {help && (
        <Modal title="ホーム画面に追加する方法（iPhone・iPad）" onClose={() => setHelp(false)}>
          <ol className="steps">
            <li>Safari で開いていることを確認します（LINE などのアプリ内ブラウザの場合は「Safari で開く」を選びます）。</li>
            <li>画面下（iPad は上）の <b>共有ボタン</b>（四角から矢印が出ているアイコン）をタップします。</li>
            <li><b>「ホーム画面に追加」</b>をタップし、右上の「追加」を押します。</li>
          </ol>
          <p className="small muted">ホーム画面のアイコンから開くと、アドレスバーのないアプリのような画面で使えます。</p>
        </Modal>
      )}
    </>
  );
}
