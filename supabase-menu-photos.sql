-- 菜单照片：先执行 supabase-friends-schema.sql，再执行本文件。
-- 新增独立照片表和私有桶，不改变现有菜单、计划或每日记录。
begin;

create table if not exists public.menu_photo_submissions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('day', 'week')),
  start_date date not null,
  object_path text not null unique,
  created_at timestamptz not null default now(),
  check (scope <> 'week' or extract(isodow from start_date) = 1),
  check (object_path = user_id::text || '/' || id::text || '.jpg'
    or object_path = user_id::text || '/' || id::text || '.png'
    or object_path = user_id::text || '/' || id::text || '.webp')
);
create index if not exists menu_photo_submissions_user_created_idx
  on public.menu_photo_submissions(user_id, created_at desc);

create or replace function public.can_read_member_menu_photo(target_user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() = target_user_id or (
    public.is_app_admin(auth.uid()) and exists (
      select 1 from public.coach_memberships m
      where m.member_user_id = target_user_id
        and m.admin_user_id = auth.uid() and m.active
    )
  );
$$;
revoke all on function public.can_read_member_menu_photo(uuid) from public, anon;
grant execute on function public.can_read_member_menu_photo(uuid) to authenticated;

create or replace function public.can_upload_member_menu_photo(target_user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() = target_user_id and (
    public.is_app_admin(auth.uid()) or exists (
      select 1 from public.coach_memberships m
      where m.member_user_id = auth.uid() and m.active
    )
  );
$$;
revoke all on function public.can_upload_member_menu_photo(uuid) from public, anon;
grant execute on function public.can_upload_member_menu_photo(uuid) to authenticated;

alter table public.menu_photo_submissions enable row level security;
revoke all on public.menu_photo_submissions from anon, authenticated;
grant select, insert on public.menu_photo_submissions to authenticated;

drop policy if exists menu_photos_read on public.menu_photo_submissions;
create policy menu_photos_read on public.menu_photo_submissions for select to authenticated
using (public.can_read_member_menu_photo(user_id));

drop policy if exists menu_photos_insert on public.menu_photo_submissions;
create policy menu_photos_insert on public.menu_photo_submissions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.can_upload_member_menu_photo(user_id)
  and exists (
    select 1 from storage.objects o
    where o.bucket_id = 'menu-photos' and o.name = object_path
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-photos', 'menu-photos', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists menu_photo_objects_insert on storage.objects;
create policy menu_photo_objects_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'menu-photos'
  and name ~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')
  and (public.is_app_admin(auth.uid()) or exists (
    select 1 from public.coach_memberships m where m.member_user_id = auth.uid() and m.active
  ))
);

drop policy if exists menu_photo_objects_read on storage.objects;
create policy menu_photo_objects_read on storage.objects for select to authenticated
using (
  bucket_id = 'menu-photos' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.menu_photo_submissions p
      where p.object_path = name and public.can_read_member_menu_photo(p.user_id)
    )
  )
);

-- 只允许清理上传失败留下的未关联图片；已提交图片不能删除或覆盖。
drop policy if exists menu_photo_objects_cleanup on storage.objects;
create policy menu_photo_objects_cleanup on storage.objects for delete to authenticated
using (
  bucket_id = 'menu-photos' and (storage.foldername(name))[1] = auth.uid()::text
  and not exists (select 1 from public.menu_photo_submissions p where p.object_path = name)
);
commit;
