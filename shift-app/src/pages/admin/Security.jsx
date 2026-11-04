import { useEffect, useState } from "react";
import { Modal } from "../../components.jsx";

/** ログイン後：認証アプリの6桁コードを確認 */
export function MfaVerify({ backend, factors, onDone, onCancel }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try { await backend.mfaVerify(factors[0].id, code); onDone(); } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <main className="page narrow">
      <form className="card login" onSubmit={submit}>
        <h2>🔐 二段階認証</h2>
        <p className="small">スマートフォンの認証アプリ（Google Authenticator、Microsoft Authenticator など）に表示されている6桁のコードを入力してください。</p>
        <input id="mfa-code" className="pin-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" autoFocus />
        {err && <div className="banner error">{err}</div>}
        <button className="btn primary block" disabled={busy || code.length !== 6}>{busy ? "確認中…" : "確認"}</button>
        <button type="button" className="btn tiny ghost" onClick={onCancel}>ログアウト</button>
        <p className="small muted">スマートフォンを紛失した場合は、本部の管理者に連絡してください（Supabase の管理画面で二段階認証を解除できます）。</p>
      </form>
    </main>
  );
}

/** 二段階認証の登録（QRコードを読み取り → 6桁コードで確認） */
export function MfaEnroll({ backend, forced, onDone, onCancel }) {
  const [enroll, setEnroll] = useState(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { backend.mfaEnroll().then(setEnroll).catch((e) => setErr(e.message)); }, [backend]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try { await backend.mfaVerify(enroll.factorId, code); onDone(); } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  const body = (
    <form onSubmit={submit} className="mfa-enroll">
      {forced && <div className="banner warn">この組織では、管理者の二段階認証が必須です。設定を完了するとデータを利用できます。</div>}
      <ol className="steps">
        <li>スマートフォンに認証アプリ（Google Authenticator、Microsoft Authenticator など）を入れます。</li>
        <li>アプリで下のQRコードを読み取ります（読み取れない場合はキーを入力）。</li>
        <li>アプリに表示された6桁のコードを入力して「設定する」を押します。</li>
      </ol>
      {!enroll ? <p className="muted">{err || "準備中…"}</p> : (
        <div className="row wrap" style={{ alignItems: "flex-start" }}>
          <img src={enroll.qr} alt="二段階認証の登録用QRコード" width={180} height={180} className="mfa-qr" />
          <div className="small">
            <div className="muted">手入力用のキー</div>
            <code className="mfa-secret">{enroll.secret}</code>
          </div>
        </div>
      )}
      <div className="row wrap">
        <input id="mfa-enroll-code" className="pin-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" />
        <button className="btn primary" disabled={busy || !enroll || code.length !== 6}>{busy ? "確認中…" : "設定する"}</button>
      </div>
      {err && enroll && <div className="banner error">{err}</div>}
    </form>
  );
  if (!forced) return body;
  return (
    <main className="page narrow">
      <div className="card">
        <h2>🔐 二段階認証の設定</h2>
        {body}
        <button type="button" className="btn tiny ghost" onClick={onCancel}>ログアウト</button>
      </div>
    </main>
  );
}

/** 管理者メニュー：二段階認証の状態・設定・解除、本部は必須化の切り替え */
export function SecurityModal({ backend, isHq, state, onChange, onClose }) {
  const [mode, setMode] = useState("view");
  const [err, setErr] = useState("");
  const factors = state?.factors || [];
  const toggleRequired = async (on) => {
    setErr("");
    if (on && !window.confirm("すべての管理者に二段階認証を必須にします。未設定の管理者は、次回ログイン時に設定が求められます。よろしいですか？")) return;
    try { await backend.setRequireMfa(on); onChange(); } catch (e) { setErr(e.message); }
  };
  const remove = async (f) => {
    if (state?.required) return setErr("二段階認証が必須のため解除できません（本部が必須設定をオフにすると解除できます）");
    if (!window.confirm("二段階認証を解除しますか？セキュリティが下がります。")) return;
    try { await backend.mfaUnenroll(f.id); onChange(); } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title="🔐 二段階認証" onClose={onClose}>
      {err && <div className="banner error">{err}</div>}
      {mode === "enroll" ? (
        <MfaEnroll backend={backend} onDone={() => { setMode("view"); onChange(); }} />
      ) : (
        <>
          <p>
            あなたの状態：{factors.length ? <span className="tag green">設定済み</span> : <span className="tag red">未設定</span>}
            {state?.current === "aal2" && <span className="tag green">このログインは二段階認証済み</span>}
          </p>
          <p className="small muted">パスワードに加えて、スマートフォンの認証アプリのコードでログインします。パスワードが漏れても、不正にログインされるのを防げます。</p>
          {factors.length ? (
            <button className="btn small" onClick={() => remove(factors[0])}>二段階認証を解除</button>
          ) : (
            <button className="btn small primary" onClick={() => setMode("enroll")}>二段階認証を設定する</button>
          )}
          {isHq && (
            <div className="card" style={{ marginTop: 12 }}>
              <h3>全管理者への必須化（本部）</h3>
              <p className="small">現在：{state?.required ? <b>必須</b> : "任意"}</p>
              <p className="small muted">必須にすると、二段階認証を済ませていない管理者はデータを閲覧・編集できなくなります（データベース側で強制）。必須にする前に、ご自身の二段階認証を設定してください。</p>
              {state?.required
                ? <button className="btn small" onClick={() => toggleRequired(false)}>必須をやめる</button>
                : <button className="btn small primary" disabled={state?.current !== "aal2"} onClick={() => toggleRequired(true)}>必須にする</button>}
              {!state?.required && state?.current !== "aal2" && <p className="small muted">※ご自身の二段階認証を設定し、二段階認証でログインすると押せるようになります。</p>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
