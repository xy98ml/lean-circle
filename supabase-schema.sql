-- 减脂执行面板：Supabase 数据表与用户隔离策略
-- 在 Supabase Dashboard → SQL Editor 中整段执行一次。

create table if not exists public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  log_date date not null,
  weight numeric(5, 2),
  waist numeric(5, 2),
  calories integer,
  protein integer,
  steps integer,
  sleep numeric(4, 2),
  strength boolean not null default false,
  cardio boolean not null default false,
  creatine boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, log_date)
);

create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid()
    references auth.users(id) on delete cascade,
  menu jsonb not null default '{}'::jsonb,
  menu_picks jsonb not null default '{}'::jsonb,
  menu_focus boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists daily_logs_set_updated_at on public.daily_logs;
create trigger daily_logs_set_updated_at
before update on public.daily_logs
for each row execute function public.set_updated_at();

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();

alter table public.daily_logs enable row level security;
alter table public.user_settings enable row level security;

revoke all on public.daily_logs from anon;
revoke all on public.user_settings from anon;
grant select, insert, update, delete on public.daily_logs to authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;

drop policy if exists "daily_logs_select_own" on public.daily_logs;
create policy "daily_logs_select_own"
on public.daily_logs for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "daily_logs_insert_own" on public.daily_logs;
create policy "daily_logs_insert_own"
on public.daily_logs for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "daily_logs_update_own" on public.daily_logs;
create policy "daily_logs_update_own"
on public.daily_logs for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "daily_logs_delete_own" on public.daily_logs;
create policy "daily_logs_delete_own"
on public.daily_logs for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own"
on public.user_settings for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own"
on public.user_settings for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own"
on public.user_settings for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "user_settings_delete_own" on public.user_settings;
create policy "user_settings_delete_own"
on public.user_settings for delete to authenticated
using ((select auth.uid()) = user_id);

