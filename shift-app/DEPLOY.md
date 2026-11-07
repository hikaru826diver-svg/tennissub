# 公開手順書（GitHub × Cloudflare Pages × Supabase）

HOS シフト作成アプリを、インターネットに公開して本番運用を始めるまでの手順です。
所要時間の目安：初回 1〜2時間（施設・スタッフの登録を除く）

| サービス | 役割 | 個人情報 |
|---|---|---|
| GitHub | プログラムの保管庫（変更履歴） | 入らない |
| Cloudflare Pages | アプリの公開（URLの発行・配信・防御） | 入らない |
| Supabase | データの保存・ログイン・権限管理 | **入る** |

> 各サービスの画面の名前や配置は変わることがあります。見当たらない場合は、似た名前のメニューを探してください。

---

## 0. 事前に用意するもの
- [ ] GitHub アカウント（リポジトリ `hikaru826diver-svg/tennissub` にアクセスできるもの）
- [ ] Cloudflare アカウント（無料で作成可）
- [ ] Supabase アカウント（GitHub アカウントでも登録可）
- [ ] 本部の管理者が使うメールアドレス（受信できるもの）
- [ ] 認証アプリを入れたスマートフォン（Google Authenticator、Microsoft Authenticator など。二段階認証用）

各サービスのアカウントには、**必ず二段階認証を設定**してください。

---

## 1. GitHub：公開するプログラムを確定する

1. リポジトリが **非公開（Private）** になっていることを確認します（Settings → General → Danger Zone の「Change visibility」）。
2. 公開に使うブランチを決めます。
   - おすすめ：作業ブランチ `claude/shift-scheduling-web-app-5hlmcc` を **main に統合（プルリクエストを作成してマージ）** し、main を本番用にします。
   - すぐに試すだけなら、作業ブランチのままでも公開できます（手順3で指定）。

---

## 2. Supabase：データベースを準備する

### 2-1. プロジェクトを作る
1. https://supabase.com にログインし、「New project」を押します。
2. 次のように入力して作成します。
   - Name：例 `hos-shift`
   - Database Password：**強いパスワードを生成し、安全な場所に保管**（普段は使いませんが、紛失すると復旧が大変です）
   - Region：**Northeast Asia (Tokyo)**
   - Plan：本番運用は **Pro プラン以上を推奨**（無料プランは自動バックアップがなく、しばらく使われないと一時停止されるため）

### 2-2. テーブルと権限を作る（SQL の実行）
1. 左メニュー「SQL Editor」→「New query」を開きます。
2. リポジトリの `shift-app/supabase.sql` の中身を**すべて**貼り付け、「Run」を押します。
3. 「Success」と表示されれば完了です（何度実行しても問題ありません）。

### 2-3. ログインの設定
1. 「Authentication」→「Sign In / Providers」（または「Providers」）で、**Email** が有効になっていることを確認します。
2. 同じ画面の **「Allow new users to sign up（新規登録を許可）」をオフ**にします。
   - 管理者アカウントは本部が作成します。誰でも登録できる状態にしないためです。
3. 「Authentication」→「Multi-Factor」（または MFA）で、**TOTP（認証アプリ）** が有効になっていることを確認します（標準で有効）。

### 2-4. 本部の管理者アカウントを作る
1. 「Authentication」→「Users」→「Add user」→「Create new user」を選びます。
2. 本部のメールアドレスとパスワードを入力し、**「Auto Confirm User」にチェック**を入れて作成します。
3. 「SQL Editor」で次を実行し、本部の権限を付けます（メールアドレスは置き換えてください）。
   ```sql
   insert into public.hq_members (user_id)
   select id from auth.users where email = 'honbu@example.com';
   ```

### 2-5. 接続情報を控える
「Project Settings」→「API Keys」（または「API」）で、次の2つを控えます。
- **Project URL**（例：`https://xxxxxxxx.supabase.co`）
- **公開用のキー**：`publishable` キー（`sb_publishable_…`）、または `anon`（public）キー

> ⚠️ **`service_role` キー／`secret` キーは絶対に使わないでください**（全データを読み書きできる管理用の鍵です）。

---

## 3. Cloudflare Pages：アプリを公開する

1. https://dash.cloudflare.com にログインし、「Workers & Pages」→「作成（Create）」を押します。
2. 「**Pages**」タブ →「Git に接続（Connect to Git）」を選びます。
   - 画面に Workers しか出ない場合は、「Pages をお探しですか？」などのリンクから Pages を選びます。
3. GitHub との連携を許可します。アクセスを許可するリポジトリは **`tennissub` のみ** を選びます。
4. リポジトリ `tennissub` を選び、ビルド設定を次のように入力します。

   | 項目 | 設定値 |
   |---|---|
   | プロジェクト名 | 例 `hos-shift`（URL の一部になります） |
   | 本番ブランチ | `main`（手順1でマージしない場合は `claude/shift-scheduling-web-app-5hlmcc`） |
   | フレームワーク プリセット | `Vite`（なければ `None`） |
   | ビルドコマンド | `npm run build` |
   | ビルド出力ディレクトリ | `dist` |
   | ルートディレクトリ（詳細設定） | `shift-app` |

5. 「環境変数（Environment variables）」に次の3つを追加します。

   | 変数名 | 値 |
   |---|---|
   | `VITE_SUPABASE_URL` | 2-5 の Project URL |
   | `VITE_SUPABASE_ANON_KEY` | 2-5 の publishable キー（または anon キー） |
   | `NODE_VERSION` | `20` |

6. 「保存してデプロイ」を押します。数分で `https://（プロジェクト名）.pages.dev` が発行されます。
7. セキュリティ用のヘッダー（`shift-app/public/_headers`）は自動で適用されます。追加の設定は不要です。

> 環境変数を後から変えた場合は、「デプロイ」→ 最新のデプロイの「再試行（Retry deployment）」で反映されます（この値はビルド時に組み込まれるため）。

---

## 4. Supabase：公開URLを登録する
パスワード再設定メールのリンク先を正しくするため、公開URLを登録します。
1. Supabase「Authentication」→「URL Configuration」を開きます。
2. **Site URL** に `https://（プロジェクト名）.pages.dev` を入力して保存します。
3. **Redirect URLs** にも同じURLを追加します。

---

## 5. アプリの初期設定（本部）
1. 公開URLを開き、「管理者」→ 本部のメールアドレスとパスワードでログインします。
   - 画面上部に「ブラウザ内保存モード」と表示される場合は、Supabase に接続できていません（手順3の環境変数と、2-2のSQL実行を確認してください）。
2. 画面上部の「🔐 二段階認証」→「二段階認証を設定する」で、認証アプリにQRコードを読み取らせて設定します。
3. 「施設管理（本部）」で施設を作成します（施設名・施設コード。コードはURLに使われ、後から変更できません）。
4. 施設の「開く」から、次を設定します。
   - 部門マスタ：部門を登録
   - スタッフマスタ：スタッフを登録し、**個人PINを設定**（「PIN設定」または「未発行の全員に発行」）
   - 回収・各種設定：回収対象月・提出期限・お知らせ、給与締め日、割増の設定など
5. 施設管理者を追加する場合
   1. Supabase「Authentication」→「Users」→「Add user」で管理者のアカウントを作成（Auto Confirm にチェック）
   2. アプリの「施設管理（本部）」→ 施設の「管理者」→ メールアドレスを追加
6. 全員の二段階認証の設定が済んだら、「🔐 二段階認証」→「必須にする」を押します。

---

## 6. スタッフへの案内
次の2点を、**スタッフ一人ひとりに個別に**伝えます。
- スタッフ用URL：`https://（プロジェクト名）.pages.dev/?f=施設コード#staff`
  （「施設管理」または「回収・各種設定」からコピーできます）
- 本人の個人PIN

案内文の例：
> シフト希望は次のURLから提出してください。開いたら「ホーム画面に追加」すると、次回からアプリのように開けます。
> URL：https://…/?f=chuo-gym#staff　／　あなたのPIN：（個別にお伝えします）

---

## 7. 公開後の動作確認チェックリスト
- [ ] 画面上部に「ブラウザ内保存モード」が**表示されない**
- [ ] 本部でログインでき、二段階認証のコード入力が求められる
- [ ] 別の端末（スマホ）でスタッフ用URLを開き、PINを入れてシフト希望を提出できる
- [ ] 管理者画面の「希望一覧」に、その希望が表示される
- [ ] シフト作成 → タイムテーブル → 給与計算の数字が表示され、Excel が出力できる
- [ ] 「操作履歴」に、提出や変更の記録が残っている
- [ ] 施設管理者でログインすると、担当外の施設が表示されない
- [ ] スマホで「ホーム画面に追加」すると、HOS のアイコンで起動する

---

## 8. 運用
| 作業 | 方法 |
|---|---|
| アプリの修正を反映 | GitHub の本番ブランチに反映すると、Cloudflare が自動で公開し直します |
| 修正前の確認 | 本番以外のブランチは、Cloudflare が確認用のURL（プレビュー）を自動で作ります |
| 問題があったときに戻す | Cloudflare「デプロイ」一覧から、以前のデプロイを本番に戻せます（ロールバック） |
| データのバックアップ | 各施設の「回収・各種設定」→「バックアップ」を月1回以上。加えて Supabase の自動バックアップ（有料プラン） |
| 退職者・異動者 | スタッフ：スタッフマスタで「退職」＋PIN削除／管理者：「管理者」から外し、Supabase のユーザーも削除 |
| 認証アプリの紛失 | Supabase「Authentication」→「Users」で該当ユーザーの二段階認証（MFA factor）を削除し、再設定してもらう |
| 操作履歴の保存期間 | 標準3年で自動削除。変更は `supabase.sql` 末尾のSQL（`audit_retention_years`）で |

### 独自ドメインを使う場合（任意）
Cloudflare Pages の「カスタムドメイン」から、例 `shift.example.co.jp` を追加できます。追加したら、手順4の Site URL と Redirect URLs も新しいURLに変更してください。
