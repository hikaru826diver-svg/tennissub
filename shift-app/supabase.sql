-- シフト作成アプリ用テーブル（Supabase の SQL Editor で実行してください）
create table if not exists public.shift_records (
  id          text primary key,
  kind        text not null,          -- department / staff / request / shift / setting
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);
create index if not exists shift_records_kind_idx on public.shift_records (kind);

alter table public.shift_records enable row level security;

-- 簡易運用向け：anon キーで読み書きを許可
-- ※ URL と anon キーを知っている人は全データ（時給を含む）を読み書きできます。
--    本番運用では Supabase Auth を導入し、管理者のみ staff/shift/setting を参照できるポリシーに変更してください。
drop policy if exists "shift_records_anon_all" on public.shift_records;
create policy "shift_records_anon_all" on public.shift_records
  for all to anon, authenticated using (true) with check (true);
