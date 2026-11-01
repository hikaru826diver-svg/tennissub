-- =====================================================================
-- シフト作成アプリ（複数施設対応）Supabase セットアップ
--   Supabase の SQL Editor に貼り付けて実行してください（何度実行しても安全です）。
--
--   権限の考え方
--   ・本部（hq_members に登録されたユーザー）     … 全施設の閲覧・編集、施設の作成・削除、管理者の割り当て
--   ・施設管理者（facility_members に登録）        … 割り当てられた施設だけ閲覧・編集
--   ・スタッフ（ログインなし）                      … portal_* 関数経由で、施設の部門・氏名・回収設定の参照と
--                                                    自分のシフト希望の提出・取消だけが可能（時給などは見えない）
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

-- ---------- 権限チェック用の関数 ----------
create or replace function public.is_hq() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from hq_members where user_id = auth.uid());
$$;

create or replace function public.is_member(p_facility_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from facility_members where user_id = auth.uid() and facility_id = p_facility_id);
$$;

-- ---------- 行レベルセキュリティ（RLS） ----------
alter table public.facilities       enable row level security;
alter table public.hq_members       enable row level security;
alter table public.facility_members enable row level security;
alter table public.shift_records    enable row level security;

-- 旧バージョンの「誰でも読み書きできる」ポリシーを削除
drop policy if exists "shift_records_anon_all" on public.shift_records;

drop policy if exists facilities_select on public.facilities;
create policy facilities_select on public.facilities for select to authenticated
  using (public.is_hq() or public.is_member(id));
drop policy if exists facilities_write on public.facilities;
create policy facilities_write on public.facilities for all to authenticated
  using (public.is_hq()) with check (public.is_hq());

drop policy if exists hq_members_select on public.hq_members;
create policy hq_members_select on public.hq_members for select to authenticated
  using (user_id = auth.uid());

drop policy if exists facility_members_select on public.facility_members;
create policy facility_members_select on public.facility_members for select to authenticated
  using (user_id = auth.uid() or public.is_hq());

drop policy if exists shift_records_member on public.shift_records;
create policy shift_records_member on public.shift_records for all to authenticated
  using (public.is_hq() or public.is_member(facility_id))
  with check (public.is_hq() or public.is_member(facility_id));

-- anon（未ログイン）からのテーブル直接アクセスは不可。スタッフは下の portal_* 関数のみ使用。
revoke all on public.shift_records, public.facilities, public.facility_members, public.hq_members from anon;

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
                                                             'stepMin', data->'stepMin', 'collection', data->'collection'))
                         from shift_records where facility_id = f.id and kind = 'setting'), '[]'::jsonb)
  );
end $$;

-- 指定スタッフの提出済み希望（直近のみ）
create or replace function public.portal_requests(p_code text, p_staff_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f facilities;
begin
  select * into f from facilities where code = p_code;
  if not found then raise exception 'facility not found'; end if;
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

-- シフト希望の提出（同じ日の既存希望は p_replace_ids で置き換え）
create or replace function public.portal_submit(p_code text, p_staff_id text, p_records jsonb, p_replace_ids text[])
returns void language plpgsql security definer set search_path = public as $$
declare f facilities; st jsonb; r jsonb;
begin
  select * into f from facilities where code = p_code;
  if not found then raise exception 'facility not found'; end if;
  perform portal_assert_open(f.id);
  select data into st from shift_records where facility_id = f.id and kind = 'staff' and id = p_staff_id;
  if st is null or (st->>'active') = 'false' then raise exception 'staff not found'; end if;
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
end $$;

-- シフト希望の取消
create or replace function public.portal_delete(p_code text, p_staff_id text, p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare f facilities;
begin
  select * into f from facilities where code = p_code;
  if not found then raise exception 'facility not found'; end if;
  perform portal_assert_open(f.id);
  delete from shift_records where facility_id = f.id and kind = 'request' and id = p_id and data->>'staffId' = p_staff_id;
end $$;

-- ---------- 本部用：施設管理者の割り当て ----------
create or replace function public.list_members(p_facility_id text)
returns table (user_id uuid, email text, role text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_hq() then raise exception 'permission denied'; end if;
  return query select m.user_id, u.email::text, m.role from facility_members m join auth.users u on u.id = m.user_id
               where m.facility_id = p_facility_id order by u.email;
end $$;

create or replace function public.add_member(p_facility_id text, p_email text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid;
begin
  if not is_hq() then raise exception 'permission denied'; end if;
  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then raise exception 'user not found'; end if;
  insert into facility_members (user_id, facility_id) values (v_uid, p_facility_id) on conflict do nothing;
end $$;

create or replace function public.remove_member(p_facility_id text, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_hq() then raise exception 'permission denied'; end if;
  delete from facility_members where facility_id = p_facility_id and user_id = p_user_id;
end $$;

-- 関数の実行権限（このアプリの関数だけを対象にする）
revoke execute on function public.portal_facilities(), public.portal_get(text), public.portal_requests(text, text),
  public.portal_submit(text, text, jsonb, text[]), public.portal_delete(text, text, text), public.is_hq(), public.is_member(text),
  public.portal_assert_open(text), public.list_members(text), public.add_member(text, text), public.remove_member(text, uuid) from public;
grant execute on function public.portal_facilities(), public.portal_get(text), public.portal_requests(text, text),
  public.portal_submit(text, text, jsonb, text[]), public.portal_delete(text, text, text) to anon, authenticated;
grant execute on function public.is_hq(), public.is_member(text), public.portal_assert_open(text),
  public.list_members(text), public.add_member(text, text), public.remove_member(text, uuid) to authenticated;

-- =====================================================================
-- 初回だけ行う作業（コメントを外して実行）
-- =====================================================================
-- (1) 本部ユーザーの登録
--     先に Supabase の「Authentication → Users → Add user」でユーザーを作成してから実行
-- insert into public.hq_members (user_id) select id from auth.users where email = 'honbu@example.com';

-- (2) 旧バージョン（単一施設）のデータがある場合：施設を作ってデータを割り当てる
-- insert into public.facilities (id, name, code) values ('f1', '〇〇体育館', 'f1') on conflict do nothing;
-- update public.shift_records set facility_id = 'f1' where facility_id is null;
-- update public.shift_records set id = 'settings:f1', data = data || '{"id":"settings:f1"}' where id = 'settings';
