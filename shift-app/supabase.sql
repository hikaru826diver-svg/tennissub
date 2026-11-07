-- =====================================================================
-- シフト作成アプリ（複数施設対応）Supabase セットアップ
--   Supabase の SQL Editor に貼り付けて実行してください（何度実行しても安全です）。
--
--   権限の考え方
--   ・本部（hq_members に登録されたユーザー）     … 全施設の閲覧・編集、施設の作成・削除、管理者の割り当て
--   ・施設管理者（facility_members に登録）        … 割り当てられた施設だけ閲覧・編集
--   ・スタッフ（ログインなし）                      … portal_* 関数経由で、施設の部門・氏名・回収設定の参照と
--                                                    自分のシフト希望の提出・取消だけが可能（時給などは見えない）
--                                                    提出・閲覧・取消には個人PINが必要（施設の設定で無効化も可）
--   ・操作記録（audit_logs）                        … データの追加・変更・削除を自動で記録（誰が・いつ・何を）
--   ・二段階認証                                    … 本部が「必須」にすると、二段階認証を済ませた管理者だけがデータを扱える
-- =====================================================================

-- ---------- テーブル ----------
create table if not exists public.facilities (
  id          text primary key,
  name        text not null,
  code        text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  created_at  timestamptz not null default now()
);

create table if not exists public.hq_members (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.facility_members (
  user_id     uuid not null references auth.users (id) on delete cascade,
  facility_id text not null references public.facilities (id) on delete cascade,
  role        text not null default 'admin',
  primary key (user_id, facility_id)
);

create table if not exists public.shift_records (
  id          text primary key,
  kind        text not null,          -- department / staff / request / shift / setting / roster
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.shift_records add column if not exists facility_id text references public.facilities (id) on delete cascade;
create index if not exists shift_records_facility_kind_idx on public.shift_records (facility_id, kind);
-- 通信量を抑えるための索引（差分の取得・日付範囲での取得）
create index if not exists shift_records_facility_updated_idx on public.shift_records (facility_id, updated_at);
create index if not exists shift_records_facility_kind_date_idx on public.shift_records (facility_id, kind, (data->>'date'));

-- 更新日時はサーバーの時刻で記録する（端末の時計のずれに影響されないように）
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists shift_records_touch on public.shift_records;
create trigger shift_records_touch before insert or update on public.shift_records
  for each row execute function public.touch_updated_at();

-- スタッフの個人PIN（ハッシュのみ保存。管理者も元のPINは見られない）
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.staff_pins (
  facility_id  text not null references public.facilities (id) on delete cascade,
  staff_id     text not null,
  pin_hash     text not null,
  failed       int  not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (facility_id, staff_id)
);

-- 操作記録
create table if not exists public.audit_logs (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  facility_id text,
  actor       text not null,
  action      text not null,          -- insert / update / delete
  kind        text not null,          -- shift / request / staff / ... / facility / member / pin
  record_id   text,
  before      jsonb,
  after       jsonb
);
create index if not exists audit_logs_facility_at_idx on public.audit_logs (facility_id, at desc);
create index if not exists audit_logs_facility_deletes_idx on public.audit_logs (facility_id, at) where action = 'delete';

-- アプリ全体の設定（1行のみ）
create table if not exists public.app_config (
  id          int primary key default 1 check (id = 1),
  require_mfa boolean not null default false
);
alter table public.app_config add column if not exists audit_retention_years int not null default 3 check (audit_retention_years between 1 and 10);
insert into public.app_config (id) values (1) on conflict do nothing;

-- ---------- 権限チェック用の関数 ----------
create or replace function public.is_hq() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from hq_members where user_id = auth.uid());
$$;

create or replace function public.is_member(p_facility_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from facility_members where user_id = auth.uid() and facility_id = p_facility_id);
$$;

-- 二段階認証が必須の場合、二段階認証済み（aal2）のセッションだけを許可
create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select not coalesce((select require_mfa from app_config where id = 1), false)
      or coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

-- ---------- 行レベルセキュリティ（RLS） ----------
alter table public.facilities       enable row level security;
alter table public.hq_members       enable row level security;
alter table public.facility_members enable row level security;
alter table public.shift_records    enable row level security;
alter table public.staff_pins       enable row level security;   -- ポリシーなし＝関数経由のみ
alter table public.audit_logs       enable row level security;
alter table public.app_config       enable row level security;

-- 旧バージョンの「誰でも読み書きできる」ポリシーを削除
drop policy if exists "shift_records_anon_all" on public.shift_records;

drop policy if exists facilities_select on public.facilities;
create policy facilities_select on public.facilities for select to authenticated
  using (public.mfa_ok() and (public.is_hq() or public.is_member(id)));
drop policy if exists facilities_write on public.facilities;
create policy facilities_write on public.facilities for all to authenticated
  using (public.mfa_ok() and public.is_hq()) with check (public.mfa_ok() and public.is_hq());

drop policy if exists hq_members_select on public.hq_members;
create policy hq_members_select on public.hq_members for select to authenticated
  using (user_id = auth.uid());

drop policy if exists facility_members_select on public.facility_members;
create policy facility_members_select on public.facility_members for select to authenticated
  using (user_id = auth.uid() or public.is_hq());

drop policy if exists shift_records_member on public.shift_records;
create policy shift_records_member on public.shift_records for all to authenticated
  using (public.mfa_ok() and (public.is_hq() or public.is_member(facility_id)))
  with check (public.mfa_ok() and (public.is_hq() or public.is_member(facility_id)));

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.mfa_ok() and (public.is_hq() or public.is_member(facility_id)));

drop policy if exists app_config_select on public.app_config;
create policy app_config_select on public.app_config for select to authenticated using (true);

-- anon（未ログイン）からのテーブル直接アクセスは不可。スタッフは下の portal_* 関数のみ使用。
revoke all on public.shift_records, public.facilities, public.facility_members, public.hq_members,
  public.staff_pins, public.audit_logs, public.app_config from anon;
-- 操作記録は書き換え不可（記録はトリガーだけが行う）。PIN・全体設定は関数経由のみ。
revoke insert, update, delete, truncate on public.audit_logs from authenticated;
revoke all on public.staff_pins from authenticated;
revoke insert, update, delete, truncate on public.app_config from authenticated;

-- ---------- 操作記録（トリガー） ----------
create or replace function public.audit_actor() returns text
language sql stable security definer set search_path = public, auth as $$
  select coalesce(nullif(current_setting('app.actor', true), ''),
                  (select email::text from auth.users where id = auth.uid()),
                  'system');
$$;

-- 記録する内容を軽くする（容量の節約）
--   追加：だれの・いつの・何時から何時か など、内容がわかる項目だけ
--   変更：上の項目＋実際に変わった項目だけ（変更前・変更後）
--   削除：元に戻す手がかりとして、削除前の内容をすべて
create or replace function public.audit_slim(p_old jsonb, p_new jsonb, out o_before jsonb, out o_after jsonb)
language plpgsql immutable as $$
declare
  ident text[] := array['staffId', 'deptId', 'date', 'start', 'end', 'allDay', 'name', 'month', 'wage', 'category'];
  skip  text[] := array['id', 'facilityId', 'updated_at'];
begin
  if p_old is null then
    select coalesce(jsonb_object_agg(k, p_new -> k), '{}') into o_after
      from jsonb_object_keys(p_new) as t(k) where k = any (ident);
    return;
  end if;
  if p_new is null then
    o_before := p_old - skip;
    return;
  end if;
  select jsonb_strip_nulls(coalesce(jsonb_object_agg(k, p_old -> k), '{}')),
         jsonb_strip_nulls(coalesce(jsonb_object_agg(k, p_new -> k), '{}'))
    into o_before, o_after
    from jsonb_object_keys(p_old || p_new) as t(k)
   where not (k = any (skip)) and (k = any (ident) or (p_old -> k) is distinct from (p_new -> k));
end $$;

-- 保存期間（app_config.audit_retention_years、標準3年）を過ぎた記録を削除する
create or replace function public.audit_purge() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from audit_logs
   where at < now() - make_interval(years => coalesce((select audit_retention_years from app_config where id = 1), 3));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.audit_shift_records() returns trigger
language plpgsql security definer set search_path = public as $$
declare b jsonb; a jsonb;
begin
  if tg_op = 'UPDATE' and old.data = new.data and old.facility_id is not distinct from new.facility_id then return new; end if;
  select o_before, o_after into b, a
    from audit_slim(case when tg_op <> 'INSERT' then old.data end, case when tg_op <> 'DELETE' then new.data end);
  insert into audit_logs (facility_id, actor, action, kind, record_id, before, after)
  values (coalesce(new.facility_id, old.facility_id), audit_actor(), lower(tg_op), coalesce(new.kind, old.kind), coalesce(new.id, old.id), b, a);
  -- 保存期間の自動削除（専用の定期実行の仕組みがなくても動くよう、記録時にまれに実行）
  if random() < 0.002 then perform audit_purge(); end if;
  return coalesce(new, old);
end $$;
drop trigger if exists shift_records_audit on public.shift_records;
create trigger shift_records_audit after insert or update or delete on public.shift_records
  for each row execute function public.audit_shift_records();

create or replace function public.audit_facilities() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs (facility_id, actor, action, kind, record_id, before, after)
  values (coalesce(new.id, old.id), audit_actor(), lower(tg_op), 'facility', coalesce(new.id, old.id),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
drop trigger if exists facilities_audit on public.facilities;
create trigger facilities_audit after insert or update or delete on public.facilities
  for each row execute function public.audit_facilities();

create or replace function public.audit_members() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare em text;
begin
  select email into em from auth.users where id = coalesce(new.user_id, old.user_id);
  insert into audit_logs (facility_id, actor, action, kind, record_id, before, after)
  values (coalesce(new.facility_id, old.facility_id), audit_actor(), lower(tg_op), 'member', em,
          case when tg_op = 'DELETE' then jsonb_build_object('email', em) end, case when tg_op = 'INSERT' then jsonb_build_object('email', em) end);
  return coalesce(new, old);
end $$;
drop trigger if exists facility_members_audit on public.facility_members;
create trigger facility_members_audit after insert or delete on public.facility_members
  for each row execute function public.audit_members();

-- ---------- スタッフ用（ログイン不要）の関数 ----------
-- 施設の一覧（名前とコードのみ）
create or replace function public.portal_facilities()
returns table (code text, name text)
language sql stable security definer set search_path = public as $$
  select code, name from facilities order by name;
$$;

-- 施設の部門・スタッフ氏名・回収設定（時給・交通費・管理用設定は返さない）
create or replace function public.portal_get(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f facilities;
begin
  select * into f from facilities where code = p_code;
  if not found then raise exception 'facility not found'; end if;
  return jsonb_build_object(
    'facility', jsonb_build_object('id', f.id, 'name', f.name, 'code', f.code),
    'department', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', data->>'name', 'color', data->>'color', 'order', data->'order'))
                            from shift_records where facility_id = f.id and kind = 'department'), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', data->>'name', 'kana', data->>'kana', 'deptIds', data->'deptIds', 'active', data->'active'))
                       from shift_records where facility_id = f.id and kind = 'staff'), '[]'::jsonb),
    'setting', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'orgName', data->>'orgName', 'dayStart', data->'dayStart', 'dayEnd', data->'dayEnd',
                                                             'stepMin', data->'stepMin', 'collection', data->'collection',
                                                             'requirePin', coalesce((data->>'requirePin')::boolean, true)))
                         from shift_records where facility_id = f.id and kind = 'setting'), '[]'::jsonb)
  );
end $$;

-- 旧バージョン（PINなし）の関数を削除
drop function if exists public.portal_requests(text, text);
drop function if exists public.portal_submit(text, text, jsonb, text[]);
drop function if exists public.portal_delete(text, text, text);

-- PINの確認。成功時 null、失敗時はエラーコード（invalid pin / pin not set / pin locked）を返す
--   ※ 失敗回数を確実に記録するため、例外ではなく戻り値で知らせる。5回連続で失敗すると15分ロック。
create or replace function public.portal_check_pin(p_facility_id text, p_staff_id text, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare need boolean; sp staff_pins;
begin
  select coalesce((data->>'requirePin')::boolean, true) into need from shift_records where facility_id = p_facility_id and kind = 'setting' limit 1;
  if not coalesce(need, true) then return null; end if;
  select * into sp from staff_pins where facility_id = p_facility_id and staff_id = p_staff_id for update;
  if not found then return 'pin not set'; end if;
  if coalesce(p_pin, '') = '' then return 'pin required'; end if;   -- 未入力は失敗回数に数えない
  if sp.locked_until is not null and sp.locked_until > now() then return 'pin locked'; end if;
  if sp.pin_hash = crypt(coalesce(p_pin, ''), sp.pin_hash) then
    update staff_pins set failed = 0, locked_until = null where facility_id = p_facility_id and staff_id = p_staff_id;
    return null;
  end if;
  update staff_pins set failed = case when failed + 1 >= 5 then 0 else failed + 1 end,
                        locked_until = case when failed + 1 >= 5 then now() + interval '15 minutes' else locked_until end
   where facility_id = p_facility_id and staff_id = p_staff_id;
  return 'invalid pin';
end $$;

-- 指定スタッフの提出済み希望（直近のみ）。PINが違う場合は {"error": "..."} を返す
create or replace function public.portal_requests(p_code text, p_staff_id text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f facilities; err text;
begin
  select * into f from facilities where code = p_code;
  if not found then raise exception 'facility not found'; end if;
  err := portal_check_pin(f.id, p_staff_id, p_pin);
  if err is not null then return jsonb_build_object('error', err); end if;
  return coalesce((select jsonb_agg(data || jsonb_build_object('id', id)) from shift_records
                   where facility_id = f.id and kind = 'request' and data->>'staffId' = p_staff_id
                     and data->>'date' >= to_char((now() at time zone 'Asia/Tokyo') - interval '62 days', 'YYYY-MM-DD')), '[]'::jsonb);
end $$;

-- 受付中かどうか（受付停止・提出期限切れなら例外）
create or replace function public.portal_assert_open(p_facility_id text) returns void
language plpgsql stable security definer set search_path = public as $$
declare col jsonb;
begin
  select data->'collection' into col from shift_records where facility_id = p_facility_id and kind = 'setting' limit 1;
  if col is not null and ((col->>'open') = 'false'
     or (coalesce(col->>'deadline', '') <> '' and (col->>'deadline') < to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM-DD'))) then
    raise exception 'closed';
  end if;
end $$;

-- シフト希望の提出（同じ日の既存希望は p_replace_ids で置き換え）。戻り値 {"ok": true} または {"error": "..."}
create or replace function public.portal_submit(p_code text, p_staff_id text, p_pin text, p_records jsonb, p_replace_ids text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare f facilities; st jsonb; r jsonb; err text;
begin
  select * into f from facilities where code = p_code;
  if not found then raise exception 'facility not found'; end if;
  perform portal_assert_open(f.id);
  select data into st from shift_records where facility_id = f.id and kind = 'staff' and id = p_staff_id;
  if st is null or (st->>'active') = 'false' then raise exception 'staff not found'; end if;
  err := portal_check_pin(f.id, p_staff_id, p_pin);
  if err is not null then return jsonb_build_object('error', err); end if;
  perform set_config('app.actor', 'スタッフ本人：' || coalesce(st->>'name', ''), true);
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 62 then raise exception 'invalid records'; end if;

  delete from shift_records
   where facility_id = f.id and kind = 'request' and id = any (coalesce(p_replace_ids, '{}')) and data->>'staffId' = p_staff_id;

  for r in select * from jsonb_array_elements(p_records) loop
    if not (st->'deptIds' ? (r->>'deptId')) then raise exception 'invalid department'; end if;
    if (r->>'date') !~ '^\d{4}-\d{2}-\d{2}$' or (r->>'start') !~ '^\d{2}:\d{2}$' or (r->>'end') !~ '^\d{2}:\d{2}$' then
      raise exception 'invalid record';
    end if;
    insert into shift_records (id, kind, facility_id, data)
    values (gen_random_uuid()::text, 'request', f.id, jsonb_build_object(
      'staffId', p_staff_id, 'deptId', r->>'deptId', 'date', r->>'date', 'start', r->>'start', 'end', r->>'end',
      'allDay', coalesce((r->>'allDay')::boolean, false), 'note', left(coalesce(r->>'note', ''), 500), 'submittedAt', now()));
  end loop;
  return jsonb_build_object('ok', true);
end $$;

-- シフト希望の取消。戻り値 {"ok": true} または {"error": "..."}
create or replace function public.portal_delete(p_code text, p_staff_id text, p_pin text, p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f facilities; err text; nm text;
begin
  select * into f from facilities where code = p_code;
  if not found then raise exception 'facility not found'; end if;
  perform portal_assert_open(f.id);
  err := portal_check_pin(f.id, p_staff_id, p_pin);
  if err is not null then return jsonb_build_object('error', err); end if;
  select data->>'name' into nm from shift_records where facility_id = f.id and kind = 'staff' and id = p_staff_id;
  perform set_config('app.actor', 'スタッフ本人：' || coalesce(nm, ''), true);
  delete from shift_records where facility_id = f.id and kind = 'request' and id = p_id and data->>'staffId' = p_staff_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 管理者用：スタッフPINの発行・削除・状態 ----------
create or replace function public.can_manage(p_facility_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select mfa_ok() and (is_hq() or is_member(p_facility_id));
$$;

create or replace function public.set_staff_pin(p_facility_id text, p_staff_id text, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not can_manage(p_facility_id) then raise exception 'permission denied'; end if;
  if p_pin !~ '^\d{4,8}$' then raise exception 'invalid pin format'; end if;
  -- 同じ数字の繰り返し・連番（0000、1234、9876 など）は推測されやすいため拒否
  if p_pin ~ '^(\d)\1+$' or position(p_pin in '0123456789') > 0 or position(p_pin in '9876543210') > 0 then
    raise exception 'weak pin';
  end if;
  if not exists (select 1 from shift_records where facility_id = p_facility_id and kind = 'staff' and id = p_staff_id) then
    raise exception 'staff not found';
  end if;
  insert into staff_pins (facility_id, staff_id, pin_hash) values (p_facility_id, p_staff_id, crypt(p_pin, gen_salt('bf')))
  on conflict (facility_id, staff_id) do update set pin_hash = excluded.pin_hash, failed = 0, locked_until = null, updated_at = now();
  insert into audit_logs (facility_id, actor, action, kind, record_id) values (p_facility_id, audit_actor(), 'update', 'pin', p_staff_id);
end $$;

create or replace function public.clear_staff_pin(p_facility_id text, p_staff_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_manage(p_facility_id) then raise exception 'permission denied'; end if;
  delete from staff_pins where facility_id = p_facility_id and staff_id = p_staff_id;
  insert into audit_logs (facility_id, actor, action, kind, record_id) values (p_facility_id, audit_actor(), 'delete', 'pin', p_staff_id);
end $$;

create or replace function public.staff_pin_status(p_facility_id text)
returns table (staff_id text, updated_at timestamptz, locked boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_manage(p_facility_id) then raise exception 'permission denied'; end if;
  return query select sp.staff_id, sp.updated_at, coalesce(sp.locked_until > now(), false) from staff_pins sp where sp.facility_id = p_facility_id;
end $$;

-- ---------- 本部用：二段階認証の必須化 ----------
-- 必須にするには、本部自身が二段階認証を済ませた状態（aal2）で実行する必要がある（締め出し防止）
create or replace function public.set_require_mfa(p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_hq() then raise exception 'permission denied'; end if;
  if p_on and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then raise exception 'mfa required first'; end if;
  update app_config set require_mfa = p_on where id = 1;
  insert into audit_logs (facility_id, actor, action, kind, record_id, after) values (null, audit_actor(), 'update', 'config', 'require_mfa', jsonb_build_object('require_mfa', p_on));
end $$;

-- ---------- 本部用：施設管理者の割り当て ----------
create or replace function public.list_members(p_facility_id text)
returns table (user_id uuid, email text, role text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not (is_hq() and mfa_ok()) then raise exception 'permission denied'; end if;
  return query select m.user_id, u.email::text, m.role from facility_members m join auth.users u on u.id = m.user_id
               where m.facility_id = p_facility_id order by u.email;
end $$;

create or replace function public.add_member(p_facility_id text, p_email text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid;
begin
  if not (is_hq() and mfa_ok()) then raise exception 'permission denied'; end if;
  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then raise exception 'user not found'; end if;
  insert into facility_members (user_id, facility_id) values (v_uid, p_facility_id) on conflict do nothing;
end $$;

create or replace function public.remove_member(p_facility_id text, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_hq() and mfa_ok()) then raise exception 'permission denied'; end if;
  delete from facility_members where facility_id = p_facility_id and user_id = p_user_id;
end $$;

-- 関数の実行権限（このアプリの関数だけを対象にする）
revoke execute on function public.portal_facilities(), public.portal_get(text), public.portal_requests(text, text, text),
  public.portal_submit(text, text, text, jsonb, text[]), public.portal_delete(text, text, text, text), public.portal_check_pin(text, text, text),
  public.portal_assert_open(text), public.is_hq(), public.is_member(text), public.mfa_ok(), public.can_manage(text), public.audit_actor(),
  public.list_members(text), public.add_member(text, text), public.remove_member(text, uuid),
  public.set_staff_pin(text, text, text), public.clear_staff_pin(text, text), public.staff_pin_status(text), public.set_require_mfa(boolean),
  public.audit_purge(), public.audit_slim(jsonb, jsonb) from public;
grant execute on function public.portal_facilities(), public.portal_get(text), public.portal_requests(text, text, text),
  public.portal_submit(text, text, text, jsonb, text[]), public.portal_delete(text, text, text, text) to anon, authenticated;
grant execute on function public.is_hq(), public.is_member(text), public.mfa_ok(), public.can_manage(text),
  public.list_members(text), public.add_member(text, text), public.remove_member(text, uuid),
  public.set_staff_pin(text, text, text), public.clear_staff_pin(text, text), public.staff_pin_status(text), public.set_require_mfa(boolean) to authenticated;

-- =====================================================================
-- 初回だけ行う作業（コメントを外して実行）
-- =====================================================================
-- (1) 本部ユーザーの登録
--     先に Supabase の「Authentication → Users → Add user」でユーザーを作成してから実行
-- insert into public.hq_members (user_id) select id from auth.users where email = 'honbu@example.com';

-- (2) 操作記録の保存期間：標準は3年（期限を過ぎた記録は自動で削除されます）
--     保存期間を変える場合（例：5年）：
-- update public.app_config set audit_retention_years = 5 where id = 1;
--     今すぐ期限切れの記録を削除する場合：
-- select public.audit_purge();

-- (3) 旧バージョン（単一施設）のデータがある場合：施設を作ってデータを割り当てる
-- insert into public.facilities (id, name, code) values ('f1', '〇〇体育館', 'f1') on conflict do nothing;
-- update public.shift_records set facility_id = 'f1' where facility_id is null;
-- update public.shift_records set id = 'settings:f1', data = data || '{"id":"settings:f1"}' where id = 'settings';
