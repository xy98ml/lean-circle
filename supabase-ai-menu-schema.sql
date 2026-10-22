-- AI 辅助计划、资料历史与私有菜单迁移
-- 前置条件：已执行 supabase-schema.sql 与旧版 supabase-friends-schema.sql。
-- 本迁移幂等、只新增或扩展结构，不删除现有业务数据。
-- 维护约定：本文件是 canonical；主迁移中的同名标记段由本文件去掉事务包裹后同步。

begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.member_profile_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check (version > 0),
  profile_snapshot jsonb not null check (jsonb_typeof(profile_snapshot) = 'object'),
  questionnaire_snapshot jsonb not null check (jsonb_typeof(questionnaire_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (user_id, version)
);

create table if not exists public.menu_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  title text not null check (char_length(trim(title)) between 1 and 120),
  menu_payload jsonb not null check (jsonb_typeof(menu_payload) = 'object'),
  notes text not null default '' check (char_length(notes) <= 4000),
  status text not null default 'submitted'
    check (status in ('submitted', 'reviewed', 'published')),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.menu_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid references public.menu_submissions(id) on delete set null,
  version integer not null check (version > 0),
  period_start date not null,
  period_end date not null,
  menu_payload jsonb not null check (jsonb_typeof(menu_payload) = 'object'),
  nutrition_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(nutrition_summary) = 'object'),
  reason text not null check (char_length(trim(reason)) between 2 and 1000),
  source text not null check (source in ('manual', 'external_ai')),
  client_request_id uuid not null default gen_random_uuid(),
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (user_id, version),
  constraint menu_assignments_client_request_id_key unique (client_request_id)
);

create index if not exists member_profile_versions_user_version_idx
  on public.member_profile_versions(user_id, version desc);
create index if not exists menu_submissions_user_week_idx
  on public.menu_submissions(user_id, week_start desc, submitted_at desc);
create index if not exists menu_submissions_status_idx
  on public.menu_submissions(status, submitted_at desc);
create index if not exists menu_assignments_user_period_idx
  on public.menu_assignments(user_id, period_start desc, version desc);
create index if not exists menu_assignments_submission_idx
  on public.menu_assignments(submission_id)
  where submission_id is not null;

drop trigger if exists menu_submissions_set_updated_at on public.menu_submissions;
create trigger menu_submissions_set_updated_at
before update on public.menu_submissions
for each row execute function public.set_updated_at();

-- 第一版尚无业务计划数据：直接收紧为严格的新契约，不制造猜测性的历史宏量数据。
alter table public.plan_versions
  add column if not exists fat_min integer,
  add column if not exists fat_max integer,
  add column if not exists carb_min integer,
  add column if not exists carb_max integer,
  add column if not exists fiber_target integer,
  add column if not exists calculation_method text,
  add column if not exists client_request_id uuid default gen_random_uuid();

alter table public.menu_assignments
  add column if not exists client_request_id uuid default gen_random_uuid();

alter table public.plan_versions
  alter column fat_min set not null,
  alter column fat_max set not null,
  alter column carb_min set not null,
  alter column carb_max set not null,
  alter column fiber_target set not null,
  alter column calculation_method set not null,
  alter column client_request_id set default gen_random_uuid(),
  alter column client_request_id set not null;

alter table public.menu_assignments
  alter column client_request_id set default gen_random_uuid(),
  alter column client_request_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.plan_versions'::regclass
      and conname = 'plan_versions_fat_range_check'
  ) then
    alter table public.plan_versions
      add constraint plan_versions_fat_range_check
      check (fat_min between 20 and 200 and fat_max between fat_min and 250);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.plan_versions'::regclass
      and conname = 'plan_versions_carb_range_check'
  ) then
    alter table public.plan_versions
      add constraint plan_versions_carb_range_check
      check (carb_min between 0 and 800 and carb_max between carb_min and 900);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.plan_versions'::regclass
      and conname = 'plan_versions_fiber_target_check'
  ) then
    alter table public.plan_versions
      add constraint plan_versions_fiber_target_check
      check (fiber_target between 1 and 100);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.plan_versions'::regclass
      and conname = 'plan_versions_calculation_method_check'
  ) then
    alter table public.plan_versions
      add constraint plan_versions_calculation_method_check
      check (calculation_method in (
        'video_formula_with_bmr_floor',
        'external_ai_validated',
        'admin_manual'
      ));
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.plan_versions'::regclass
      and conname = 'plan_versions_client_request_id_key'
  ) then
    alter table public.plan_versions
      add constraint plan_versions_client_request_id_key unique (client_request_id);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.menu_assignments'::regclass
      and conname = 'menu_assignments_client_request_id_key'
  ) then
    alter table public.menu_assignments
      add constraint menu_assignments_client_request_id_key unique (client_request_id);
  end if;
end
$$;

create or replace function public.can_administer_member(
  target_member_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and public.is_app_admin(auth.uid())
    and exists (
      select 1
      from public.coach_memberships membership
      where membership.member_user_id = target_member_user_id
        and membership.admin_user_id = auth.uid()
        and membership.active
    );
$$;

-- 入组只保留一个原子入口；旧的两阶段邀请 RPC 与旧签名不再暴露。
drop function if exists public.accept_coach_invite(text);
drop function if exists public.submit_member_onboarding(
  text, integer, text, numeric, numeric, numeric, text, jsonb, jsonb
);

create or replace function public.submit_member_onboarding(
  member_nickname text,
  member_age integer,
  member_sex text,
  member_height_cm numeric,
  member_weight_kg numeric,
  member_waist_cm numeric,
  selected_route text,
  answers jsonb,
  submitted_risk_flags jsonb,
  invite_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  questionnaire_id uuid;
  request_id uuid;
  member_plan_id uuid;
  next_plan_version integer;
  next_profile_version integer;
  risk_blocked boolean;
  bmr numeric;
  weight_lb numeric;
  video_calories numeric;
  calorie_target integer;
  calorie_minimum integer;
  protein_target integer;
  fat_target integer;
  carb_target integer;
  fiber_target_value integer;
  step_target integer;
  training_days integer;
  requested_cardio_minutes integer;
  current_steps integer;
  goal_weight numeric;
  target_weeks integer;
  request_status text;
  risk_key text;
  invite_row public.coach_invites%rowtype;
  targets jsonb := '{}'::jsonb;
  safe_answers jsonb := coalesce(answers, '{}'::jsonb);
  safe_risk_flags jsonb := coalesce(submitted_risk_flags, '{}'::jsonb);
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text, 0)
  );

  if char_length(trim(coalesce(member_nickname, ''))) not between 1 and 40 then
    raise exception 'nickname must be between 1 and 40 characters';
  end if;
  if member_age is null or member_age not between 18 and 100 then raise exception 'only adults are supported'; end if;
  if member_sex is null or member_sex not in ('male', 'female', 'other') then raise exception 'invalid sex'; end if;
  if member_height_cm is null or member_height_cm not between 120 and 230 then raise exception 'invalid height'; end if;
  if member_weight_kg is null or member_weight_kg not between 35 and 250 then raise exception 'invalid weight'; end if;
  if member_waist_cm is not null and member_waist_cm not between 40 and 220 then
    raise exception 'invalid waist';
  end if;
  if selected_route not in ('template', 'personalized') then raise exception 'invalid route'; end if;
  if jsonb_typeof(safe_answers) is distinct from 'object'
    or jsonb_typeof(safe_risk_flags) is distinct from 'object' then
    raise exception 'answers and risk flags must be objects';
  end if;

  foreach risk_key in array array[
    'medical_condition', 'pregnancy', 'eating_disorder',
    'recent_surgery', 'acute_symptoms'
  ] loop
    if safe_risk_flags ? risk_key
      and jsonb_typeof(safe_risk_flags -> risk_key) is distinct from 'boolean' then
      raise exception 'risk flag % must be a JSON boolean', risk_key;
    end if;
  end loop;

  risk_blocked := coalesce((safe_risk_flags->>'medical_condition')::boolean, false)
    or coalesce((safe_risk_flags->>'pregnancy')::boolean, false)
    or coalesce((safe_risk_flags->>'eating_disorder')::boolean, false)
    or coalesce((safe_risk_flags->>'recent_surgery')::boolean, false)
    or coalesce((safe_risk_flags->>'acute_symptoms')::boolean, false);

  perform 1
  from public.coach_memberships
  where member_user_id = auth.uid() and active
  for update;

  if not found then
    if char_length(trim(coalesce(invite_token, ''))) < 1 then
      raise exception 'invite token is required';
    end if;

    select * into invite_row
    from public.coach_invites
    where token_hash = encode(extensions.digest(invite_token, 'sha256'), 'hex')
    for update;

    if not found then raise exception 'invalid invite'; end if;
    if invite_row.disabled_at is not null then raise exception 'invite disabled'; end if;
    if invite_row.expires_at <= now() then raise exception 'invite expired'; end if;
    if invite_row.use_count >= invite_row.max_uses then raise exception 'invite exhausted'; end if;
    if invite_row.created_by = auth.uid() then raise exception 'admin cannot join as member'; end if;

    insert into public.coach_memberships (
      member_user_id, admin_user_id, invite_id, consented_at, active
    ) values (
      auth.uid(), invite_row.created_by, invite_row.id, now(), true
    )
    on conflict (member_user_id) do update set
      admin_user_id = excluded.admin_user_id,
      invite_id = excluded.invite_id,
      consented_at = excluded.consented_at,
      active = true;

    update public.coach_invites
    set use_count = use_count + 1
    where id = invite_row.id;
  end if;

  insert into public.profiles (
    user_id, nickname, age, sex, height_cm, current_weight_kg, waist_cm, onboarding_completed
  ) values (
    auth.uid(), trim(member_nickname), member_age, member_sex,
    member_height_cm, member_weight_kg, member_waist_cm, true
  )
  on conflict (user_id) do update set
    nickname = excluded.nickname,
    age = excluded.age,
    sex = excluded.sex,
    height_cm = excluded.height_cm,
    current_weight_kg = excluded.current_weight_kg,
    waist_cm = excluded.waist_cm,
    onboarding_completed = true;

  insert into public.questionnaires (
    user_id, route, status, payload, risk_flags, risk_blocked, submitted_at
  ) values (
    auth.uid(), selected_route, 'submitted', safe_answers,
    safe_risk_flags, risk_blocked, now()
  )
  on conflict (user_id) do update set
    route = excluded.route,
    status = excluded.status,
    payload = excluded.payload,
    risk_flags = excluded.risk_flags,
    risk_blocked = excluded.risk_blocked,
    submitted_at = excluded.submitted_at
  returning id into questionnaire_id;

  select coalesce(max(version), 0) + 1
  into next_profile_version
  from public.member_profile_versions
  where user_id = auth.uid();

  insert into public.member_profile_versions (
    user_id, version, profile_snapshot, questionnaire_snapshot
  ) values (
    auth.uid(),
    next_profile_version,
    jsonb_build_object(
      'nickname', trim(member_nickname),
      'age', member_age,
      'sex', member_sex,
      'height_cm', member_height_cm,
      'current_weight_kg', member_weight_kg,
      'waist_cm', member_waist_cm,
      'onboarding_completed', true
    ),
    jsonb_build_object(
      'route', selected_route,
      'status', 'submitted',
      'payload', safe_answers,
      'risk_flags', safe_risk_flags,
      'risk_blocked', risk_blocked,
      'submitted_at', now()
    )
  );

  training_days := greatest(0, least(7, coalesce(nullif(safe_answers->>'training_days', '')::integer, 3)));
  requested_cardio_minutes := greatest(0, least(300, coalesce(nullif(safe_answers->>'cardio_minutes', '')::integer, 20)));
  current_steps := greatest(0, coalesce(nullif(safe_answers->>'daily_steps', '')::integer, 6000));
  goal_weight := nullif(safe_answers->>'goal_weight_kg', '')::numeric;
  target_weeks := nullif(safe_answers->>'target_weeks', '')::integer;

  if member_sex = 'male' then
    bmr := 10 * member_weight_kg + 6.25 * member_height_cm - 5 * member_age + 5;
  elsif member_sex = 'female' then
    bmr := 10 * member_weight_kg + 6.25 * member_height_cm - 5 * member_age - 161;
  else
    bmr := 10 * member_weight_kg + 6.25 * member_height_cm - 5 * member_age - 78;
  end if;

  weight_lb := member_weight_kg * 2.2;
  video_calories := weight_lb * 11;
  calorie_target := (ceil(greatest(video_calories, bmr, 1000) / 50) * 50)::integer;
  calorie_minimum := greatest(1000, ceil(bmr)::integer, calorie_target - 100);
  protein_target := least(395, greatest(35, (round((weight_lb * 0.8) / 5) * 5)::integer));
  fat_target := least(245, greatest(25, (round((weight_lb * 0.3) / 5) * 5)::integer));
  carb_target := least(
    890,
    greatest(
      10,
      (round((((calorie_target - protein_target * 4 - fat_target * 9) / 4.0) / 5)) * 5)::integer
    )
  );
  fiber_target_value := least(100, greatest(1, round((calorie_target / 1000.0) * 14)::integer));
  step_target := least(50000, greatest(current_steps, 8000));

  targets := jsonb_build_object(
    'calories_min', calorie_minimum,
    'calories_max', calorie_target + 100,
    'protein_min', greatest(30, protein_target - 5),
    'protein_max', protein_target + 5,
    'fat_min', greatest(20, fat_target - 5),
    'fat_max', fat_target + 5,
    'carb_min', greatest(0, carb_target - 10),
    'carb_max', carb_target + 10,
    'fiber_target', fiber_target_value,
    'steps_target', step_target,
    'strength_days', greatest(3, least(5, training_days)),
    'cardio_sessions', 2,
    'cardio_minutes', requested_cardio_minutes,
    'bmr', round(bmr, 2),
    'video_calories', round(video_calories, 2),
    'calculation_method', 'video_formula_with_bmr_floor'
  );

  request_status := case
    when risk_blocked then 'blocked'
    when selected_route = 'template' then 'completed'
    else 'pending'
  end;

  insert into public.plan_requests (
    user_id, questionnaire_id, route, status, suggested_targets
  ) values (
    auth.uid(), questionnaire_id, selected_route, request_status, targets
  ) returning id into request_id;

  if risk_blocked then
    update public.plans set status = 'paused' where user_id = auth.uid();
  end if;

  if selected_route = 'template' and not risk_blocked then
    insert into public.plans (user_id) values (auth.uid())
    on conflict (user_id) do nothing;

    select id, current_version + 1 into member_plan_id, next_plan_version
    from public.plans where user_id = auth.uid() for update;

    insert into public.plan_versions (
      plan_id, version, calories_min, calories_max, protein_min, protein_max,
      fat_min, fat_max, carb_min, carb_max, fiber_target, calculation_method,
      steps_target, strength_days, cardio_sessions, cardio_minutes,
      goal_weight_kg, target_weeks, training_plan, nutrition_notes,
      adjustment_reason, source, created_by
    ) values (
      member_plan_id, next_plan_version,
      calorie_minimum, calorie_target + 100,
      greatest(30, protein_target - 5), protein_target + 5,
      greatest(20, fat_target - 5), fat_target + 5,
      greatest(0, carb_target - 10), carb_target + 10,
      fiber_target_value, 'video_formula_with_bmr_floor',
      step_target, greatest(3, least(5, training_days)), 2, requested_cardio_minutes,
      goal_weight, target_weeks,
      jsonb_build_object('type', '基础模板', 'note', '优先保持力量训练和稳定日常活动'),
      '按视频公式与 BMR 安全下限生成；管理员可根据实际趋势继续调整。',
      '根据入组问卷自动生成基础计划', 'automatic', auth.uid()
    );
    update public.plans
    set current_version = next_plan_version, status = 'active'
    where id = member_plan_id;
  end if;

  return jsonb_build_object(
    'questionnaire_id', questionnaire_id,
    'request_id', request_id,
    'profile_version', next_profile_version,
    'plan_id', member_plan_id,
    'risk_blocked', risk_blocked,
    'status', request_status,
    'targets', targets
  );
end;
$$;

create or replace function public.submit_member_menu(
  menu_week_start date,
  menu_title text,
  submitted_menu_payload jsonb,
  menu_notes text default '',
  existing_submission_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission_row public.menu_submissions%rowtype;
  day_item jsonb;
  meal_item jsonb;
  candidate_item jsonb;
  day_date date;
  seen_day_dates date[] := '{}'::date[];
  seen_meal_types text[];
  meal_type text;
  total_candidates integer := 0;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if not exists (
    select 1 from public.coach_memberships
    where member_user_id = auth.uid() and active
  ) then raise exception 'active invite membership required'; end if;
  if menu_week_start is null then raise exception 'week_start is required'; end if;
  if extract(isodow from menu_week_start) <> 1 then
    raise exception 'week_start must be a Monday';
  end if;
  if char_length(trim(coalesce(menu_title, ''))) not between 1 and 120 then
    raise exception 'title must be between 1 and 120 characters';
  end if;
  if jsonb_typeof(submitted_menu_payload) is distinct from 'object' then
    raise exception 'menu payload must be an object';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(submitted_menu_payload) as payload_key(key)
    where payload_key.key not in ('schema_version', 'days')
  ) then raise exception 'menu payload contains an unknown field'; end if;
  if submitted_menu_payload->'schema_version' is distinct from '1'::jsonb then
    raise exception 'unsupported menu schema version';
  end if;
  if jsonb_typeof(submitted_menu_payload->'days') is distinct from 'array'
    or jsonb_array_length(submitted_menu_payload->'days') not between 1 and 7 then
    raise exception 'menu days must contain between 1 and 7 days';
  end if;
  if char_length(submitted_menu_payload::text) > 100000 then
    raise exception 'menu payload is too large';
  end if;
  if char_length(coalesce(menu_notes, '')) > 4000 then
    raise exception 'notes are too long';
  end if;

  for day_item in
    select value from jsonb_array_elements(submitted_menu_payload->'days')
  loop
    if jsonb_typeof(day_item) is distinct from 'object' then
      raise exception 'each menu day must be an object';
    end if;
    if exists (
      select 1
      from jsonb_object_keys(day_item) as day_key(key)
      where day_key.key not in ('date', 'label', 'meals')
    ) then raise exception 'menu day contains an unknown field'; end if;
    if jsonb_typeof(day_item->'date') is distinct from 'string'
      or coalesce(day_item->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'menu day date must use YYYY-MM-DD';
    end if;

    begin
      day_date := (day_item->>'date')::date;
    exception when others then
      raise exception 'menu day date is invalid';
    end;
    if to_char(day_date, 'YYYY-MM-DD') <> day_item->>'date'
      or day_date not between menu_week_start and menu_week_start + 6 then
      raise exception 'menu day date must fall within the selected week';
    end if;
    if day_date = any(seen_day_dates) then raise exception 'menu day dates must be unique'; end if;
    seen_day_dates := array_append(seen_day_dates, day_date);

    if jsonb_typeof(day_item->'label') is distinct from 'string'
      or char_length(trim(day_item->>'label')) not between 1 and 40 then
      raise exception 'menu day label must be 1 to 40 characters';
    end if;
    if jsonb_typeof(day_item->'meals') is distinct from 'array'
      or jsonb_array_length(day_item->'meals') not between 1 and 3 then
      raise exception 'each menu day must contain between 1 and 3 meals';
    end if;

    seen_meal_types := '{}'::text[];
    for meal_item in select value from jsonb_array_elements(day_item->'meals')
    loop
      if jsonb_typeof(meal_item) is distinct from 'object' then
        raise exception 'each meal must be an object';
      end if;
      if exists (
        select 1
        from jsonb_object_keys(meal_item) as meal_key(key)
        where meal_key.key not in ('type', 'candidates', 'note')
      ) then raise exception 'meal contains an unknown field'; end if;
      if jsonb_typeof(meal_item->'type') is distinct from 'string' then
        raise exception 'meal type must be a string';
      end if;
      meal_type := meal_item->>'type';
      if meal_type not in ('早餐', '午餐', '晚餐') then raise exception 'invalid meal type'; end if;
      if meal_type = any(seen_meal_types) then raise exception 'meal types must be unique per day'; end if;
      seen_meal_types := array_append(seen_meal_types, meal_type);

      if jsonb_typeof(meal_item->'candidates') is distinct from 'array'
        or jsonb_array_length(meal_item->'candidates') > 30 then
        raise exception 'meal candidates must be an array with at most 30 items';
      end if;
      for candidate_item in select value from jsonb_array_elements(meal_item->'candidates')
      loop
        if jsonb_typeof(candidate_item) is distinct from 'string'
          or char_length(trim(candidate_item #>> '{}')) not between 1 and 200 then
          raise exception 'each menu candidate must be a 1 to 200 character string';
        end if;
        total_candidates := total_candidates + 1;
      end loop;

      if jsonb_typeof(meal_item->'note') is distinct from 'string'
        or char_length(meal_item->>'note') > 500 then
        raise exception 'meal note must be a string no longer than 500 characters';
      end if;
    end loop;
  end loop;

  if total_candidates < 1 then raise exception 'menu must contain at least one candidate'; end if;

  if existing_submission_id is null then
    insert into public.menu_submissions (
      user_id, week_start, title, menu_payload, notes, status, submitted_at
    ) values (
      auth.uid(), menu_week_start, trim(menu_title), submitted_menu_payload,
      coalesce(menu_notes, ''), 'submitted', now()
    ) returning * into submission_row;
  else
    select * into submission_row
    from public.menu_submissions
    where id = existing_submission_id and user_id = auth.uid()
    for update;

    if not found then raise exception 'menu submission not found'; end if;
    if submission_row.status = 'published' then
      raise exception 'published menu submission is immutable';
    end if;

    update public.menu_submissions
    set
      week_start = menu_week_start,
      title = trim(menu_title),
      menu_payload = submitted_menu_payload,
      notes = coalesce(menu_notes, ''),
      status = 'submitted',
      submitted_at = now()
    where id = existing_submission_id
    returning * into submission_row;
  end if;

  return to_jsonb(submission_row);
end;
$$;

drop function if exists public.publish_member_bundle(uuid, jsonb, jsonb, uuid);

create or replace function public.publish_member_bundle(
  target_member_user_id uuid,
  client_request_id uuid,
  plan_payload jsonb,
  menu_assignment jsonb default null,
  source_submission_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_plan_id uuid;
  next_plan_version integer;
  next_menu_version integer;
  assignment_id uuid;
  calories_minimum integer;
  calories_maximum integer;
  protein_minimum integer;
  protein_maximum integer;
  fat_minimum integer;
  fat_maximum integer;
  carb_minimum integer;
  carb_maximum integer;
  fiber_target_value integer;
  daily_steps_target integer;
  weekly_strength_days integer;
  weekly_cardio_sessions integer;
  cardio_session_minutes integer;
  goal_weight numeric;
  duration_weeks integer;
  training_details jsonb;
  nutrition_details text;
  reason text;
  calculation_method_value text;
  profile_bmr numeric;
  calorie_center numeric;
  macro_center numeric;
  assignment_start date;
  assignment_end date;
  assignment_source text;
  assignment_reason text;
  assignment_summary jsonb;
  existing_member_user_id uuid;
  existing_plan_id uuid;
  existing_plan_version integer;
  existing_assignment_id uuid;
  existing_menu_version integer;
  request_id_value uuid := client_request_id;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if request_id_value is null then raise exception 'client_request_id is required'; end if;
  if not public.can_administer_member(target_member_user_id) then
    raise exception 'active member not found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(request_id_value::text, 0)
  );

  select
    plan.user_id,
    plan_version.plan_id,
    plan_version.version,
    assignment.id,
    assignment.version
  into
    existing_member_user_id,
    existing_plan_id,
    existing_plan_version,
    existing_assignment_id,
    existing_menu_version
  from public.plan_versions plan_version
  join public.plans plan on plan.id = plan_version.plan_id
  left join public.menu_assignments assignment
    on assignment.client_request_id = plan_version.client_request_id
  where plan_version.client_request_id = request_id_value;

  if found then
    if existing_member_user_id <> target_member_user_id then
      raise exception 'client_request_id already belongs to another member';
    end if;
    return jsonb_build_object(
      'plan_id', existing_plan_id,
      'plan_version', existing_plan_version,
      'menu_assignment_id', existing_assignment_id,
      'menu_version', existing_menu_version,
      'client_request_id', request_id_value
    );
  end if;
  if exists (
    select 1
    from public.questionnaires
    where user_id = target_member_user_id and risk_blocked
  ) then raise exception 'member requires professional review before a plan can be published'; end if;
  if jsonb_typeof(plan_payload) is distinct from 'object' then raise exception 'plan payload must be an object'; end if;

  calories_minimum := nullif(plan_payload->>'calories_min', '')::integer;
  calories_maximum := nullif(plan_payload->>'calories_max', '')::integer;
  protein_minimum := nullif(plan_payload->>'protein_min', '')::integer;
  protein_maximum := nullif(plan_payload->>'protein_max', '')::integer;
  fat_minimum := nullif(plan_payload->>'fat_min', '')::integer;
  fat_maximum := nullif(plan_payload->>'fat_max', '')::integer;
  carb_minimum := nullif(plan_payload->>'carb_min', '')::integer;
  carb_maximum := nullif(plan_payload->>'carb_max', '')::integer;
  fiber_target_value := nullif(plan_payload->>'fiber_target', '')::integer;
  daily_steps_target := nullif(plan_payload->>'steps_target', '')::integer;
  weekly_strength_days := nullif(plan_payload->>'strength_days', '')::integer;
  weekly_cardio_sessions := nullif(plan_payload->>'cardio_sessions', '')::integer;
  cardio_session_minutes := nullif(plan_payload->>'cardio_minutes', '')::integer;
  goal_weight := nullif(plan_payload->>'goal_weight_kg', '')::numeric;
  duration_weeks := nullif(plan_payload->>'target_weeks', '')::integer;
  training_details := plan_payload->'training_plan';
  nutrition_details := trim(coalesce(plan_payload->>'nutrition_notes', ''));
  reason := trim(coalesce(plan_payload->>'adjustment_reason', ''));
  calculation_method_value := coalesce(
    nullif(trim(plan_payload->>'calculation_method'), ''),
    'external_ai_validated'
  );

  if calories_minimum is null or calories_maximum is null
    or protein_minimum is null or protein_maximum is null
    or fat_minimum is null or fat_maximum is null
    or carb_minimum is null or carb_maximum is null
    or fiber_target_value is null or daily_steps_target is null
    or weekly_strength_days is null or weekly_cardio_sessions is null
    or cardio_session_minutes is null then
    raise exception 'required plan targets are missing';
  end if;
  if calories_minimum not between 1000 and 6000
    or calories_maximum not between calories_minimum and 6500 then
    raise exception 'invalid calorie range';
  end if;
  if protein_minimum not between 30 and 350
    or protein_maximum not between protein_minimum and 400 then
    raise exception 'invalid protein range';
  end if;
  if fat_minimum not between 20 and 200
    or fat_maximum not between fat_minimum and 250 then
    raise exception 'invalid fat range';
  end if;
  if carb_minimum not between 0 and 800
    or carb_maximum not between carb_minimum and 900 then
    raise exception 'invalid carbohydrate range';
  end if;
  if fiber_target_value not between 1 and 100 then raise exception 'invalid fiber target'; end if;
  if daily_steps_target not between 1000 and 50000 then raise exception 'invalid steps target'; end if;
  if weekly_strength_days not between 0 and 7 then raise exception 'invalid strength days'; end if;
  if weekly_cardio_sessions not between 0 and 14 then raise exception 'invalid cardio sessions'; end if;
  if cardio_session_minutes not between 0 and 300 then raise exception 'invalid cardio minutes'; end if;
  if goal_weight is not null and goal_weight not between 35 and 250 then raise exception 'invalid goal weight'; end if;
  if duration_weeks is not null and duration_weeks not between 1 and 104 then raise exception 'invalid target weeks'; end if;
  if jsonb_typeof(training_details) is distinct from 'object' then raise exception 'training plan must be an object'; end if;
  if char_length(nutrition_details) not between 1 and 4000 then raise exception 'nutrition notes are required'; end if;
  if char_length(reason) not between 2 and 1000 then raise exception 'adjustment reason is required'; end if;
  if calculation_method_value not in (
    'video_formula_with_bmr_floor', 'external_ai_validated', 'admin_manual'
  ) then raise exception 'invalid calculation method'; end if;

  select case
    when sex = 'male' then 10 * current_weight_kg + 6.25 * height_cm - 5 * age + 5
    when sex = 'female' then 10 * current_weight_kg + 6.25 * height_cm - 5 * age - 161
    else 10 * current_weight_kg + 6.25 * height_cm - 5 * age - 78
  end
  into profile_bmr
  from public.profiles
  where user_id = target_member_user_id;

  if profile_bmr is null then raise exception 'member profile is required'; end if;
  if calories_minimum < ceil(profile_bmr)::integer then raise exception 'calories are below the BMR safety floor'; end if;

  calorie_center := (calories_minimum + calories_maximum)::numeric / 2;
  macro_center := ((protein_minimum + protein_maximum)::numeric / 2) * 4
    + ((fat_minimum + fat_maximum)::numeric / 2) * 9
    + ((carb_minimum + carb_maximum)::numeric / 2) * 4;
  if abs(macro_center - calorie_center) > greatest(100, calorie_center * 0.10) then
    raise exception 'macro calories do not match the calorie target';
  end if;

  if menu_assignment is null and source_submission_id is not null then
    raise exception 'a source submission requires a menu assignment';
  end if;
  if menu_assignment is not null then
    if jsonb_typeof(menu_assignment) is distinct from 'object' then raise exception 'menu assignment must be an object'; end if;
    if coalesce(menu_assignment->>'period_start', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(menu_assignment->>'period_end', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'menu period must use YYYY-MM-DD';
    end if;
    assignment_start := (menu_assignment->>'period_start')::date;
    assignment_end := (menu_assignment->>'period_end')::date;
    if assignment_end < assignment_start then raise exception 'menu period is invalid'; end if;
    if assignment_end - assignment_start > 366 then raise exception 'menu period is too long'; end if;
    if jsonb_typeof(menu_assignment->'days') is distinct from 'array' then raise exception 'menu days must be an array'; end if;
    if exists (
      select 1
      from jsonb_array_elements(menu_assignment->'days') as day(value)
      where jsonb_typeof(day.value) is distinct from 'object'
        or coalesce(day.value->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
        or jsonb_typeof(day.value->'meals') is distinct from 'array'
    ) then raise exception 'each menu day must contain a meals array'; end if;
    if exists (
      select 1
      from jsonb_array_elements(menu_assignment->'days') as day(value)
      where (day.value->>'date')::date not between assignment_start and assignment_end
    ) then raise exception 'menu day falls outside the assignment period'; end if;
    assignment_summary := coalesce(menu_assignment->'nutrition_summary', '{}'::jsonb);
    if jsonb_typeof(assignment_summary) is distinct from 'object' then raise exception 'nutrition summary must be an object'; end if;
    assignment_source := coalesce(nullif(trim(menu_assignment->>'source'), ''), 'external_ai');
    if assignment_source not in ('manual', 'external_ai') then raise exception 'invalid menu source'; end if;
    assignment_reason := coalesce(nullif(trim(menu_assignment->>'reason'), ''), reason);
    if char_length(assignment_reason) not between 2 and 1000 then raise exception 'menu reason is required'; end if;
  end if;

  if source_submission_id is not null then
    perform 1
    from public.menu_submissions
    where id = source_submission_id
      and user_id = target_member_user_id
      and status <> 'published'
    for update;
    if not found then raise exception 'source menu submission not found'; end if;
  end if;

  insert into public.plans (user_id) values (target_member_user_id)
  on conflict (user_id) do nothing;
  select id, current_version + 1 into member_plan_id, next_plan_version
  from public.plans where user_id = target_member_user_id for update;

  insert into public.plan_versions (
    plan_id, version, calories_min, calories_max, protein_min, protein_max,
    fat_min, fat_max, carb_min, carb_max, fiber_target, calculation_method,
    client_request_id,
    steps_target, strength_days, cardio_sessions, cardio_minutes,
    goal_weight_kg, target_weeks, training_plan, nutrition_notes,
    adjustment_reason, source, created_by
  ) values (
    member_plan_id, next_plan_version, calories_minimum, calories_maximum,
    protein_minimum, protein_maximum, fat_minimum, fat_maximum,
    carb_minimum, carb_maximum, fiber_target_value, calculation_method_value,
    request_id_value,
    daily_steps_target, weekly_strength_days, weekly_cardio_sessions,
    cardio_session_minutes, goal_weight, duration_weeks, training_details,
    nutrition_details, reason, 'admin', auth.uid()
  );
  update public.plans
  set current_version = next_plan_version, status = 'active'
  where id = member_plan_id;

  if menu_assignment is not null then
    select coalesce(max(version), 0) + 1
    into next_menu_version
    from public.menu_assignments
    where user_id = target_member_user_id;

    insert into public.menu_assignments (
      user_id, submission_id, version, period_start, period_end,
      menu_payload, nutrition_summary, reason, source, client_request_id, published_by
    ) values (
      target_member_user_id, source_submission_id, next_menu_version,
      assignment_start, assignment_end, menu_assignment, assignment_summary,
      assignment_reason, assignment_source, request_id_value, auth.uid()
    ) returning id into assignment_id;

    if source_submission_id is not null then
      update public.menu_submissions
      set status = 'published'
      where id = source_submission_id;
    end if;
  end if;

  update public.plan_requests
  set status = 'completed'
  where user_id = target_member_user_id and status in ('pending', 'designing');

  return jsonb_build_object(
    'plan_id', member_plan_id,
    'plan_version', next_plan_version,
    'menu_assignment_id', assignment_id,
    'menu_version', next_menu_version,
    'client_request_id', request_id_value
  );
end;
$$;

-- 第一版尚未投入使用，移除旧的宽参数发布入口，所有发布统一走 bundle RPC。
drop function if exists public.publish_member_plan(
  uuid, integer, integer, integer, integer, integer, integer, integer,
  integer, numeric, integer, jsonb, text, text
);

create or replace function public.set_plan_request_status(request_id uuid, next_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_member_user_id uuid;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if next_status not in ('pending', 'designing', 'completed', 'blocked') then
    raise exception 'invalid status';
  end if;

  select user_id into request_member_user_id
  from public.plan_requests
  where id = request_id
  for update;

  if not found or not public.can_administer_member(request_member_user_id) then
    raise exception 'plan request not found';
  end if;

  update public.plan_requests set status = next_status where id = request_id;
end;
$$;

alter table public.member_profile_versions enable row level security;
alter table public.menu_submissions enable row level security;
alter table public.menu_assignments enable row level security;

revoke all on public.member_profile_versions, public.menu_submissions,
  public.menu_assignments from anon, authenticated;
grant select on public.member_profile_versions, public.menu_submissions,
  public.menu_assignments to authenticated;

drop policy if exists "profile_versions_read_own_or_assigned_admin" on public.member_profile_versions;
create policy "profile_versions_read_own_or_assigned_admin"
on public.member_profile_versions for select to authenticated
using (
  user_id = (select auth.uid())
  or public.can_administer_member(user_id)
);

drop policy if exists "menu_submissions_read_own_or_assigned_admin" on public.menu_submissions;
create policy "menu_submissions_read_own_or_assigned_admin"
on public.menu_submissions for select to authenticated
using (
  user_id = (select auth.uid())
  or public.can_administer_member(user_id)
);

drop policy if exists "menu_assignments_read_own_or_assigned_admin" on public.menu_assignments;
create policy "menu_assignments_read_own_or_assigned_admin"
on public.menu_assignments for select to authenticated
using (
  user_id = (select auth.uid())
  or public.can_administer_member(user_id)
);

-- 收紧旧表的管理员读取范围：仅能读取由自己邀请且仍处于 active 状态的成员。
drop policy if exists "profiles_read_own_or_admin" on public.profiles;
drop policy if exists "profiles_read_own_or_assigned_admin" on public.profiles;
create policy "profiles_read_own_or_assigned_admin"
on public.profiles for select to authenticated
using (
  user_id = (select auth.uid())
  or public.can_administer_member(user_id)
);

drop policy if exists "questionnaires_read_own_or_admin" on public.questionnaires;
drop policy if exists "questionnaires_read_own_or_assigned_admin" on public.questionnaires;
create policy "questionnaires_read_own_or_assigned_admin"
on public.questionnaires for select to authenticated
using (
  user_id = (select auth.uid())
  or public.can_administer_member(user_id)
);

drop policy if exists "requests_read_own_or_admin" on public.plan_requests;
drop policy if exists "requests_read_own_or_assigned_admin" on public.plan_requests;
create policy "requests_read_own_or_assigned_admin"
on public.plan_requests for select to authenticated
using (
  user_id = (select auth.uid())
  or public.can_administer_member(user_id)
);

drop policy if exists "plans_read_own_or_admin" on public.plans;
drop policy if exists "plans_read_own_or_assigned_admin" on public.plans;
create policy "plans_read_own_or_assigned_admin"
on public.plans for select to authenticated
using (
  user_id = (select auth.uid())
  or public.can_administer_member(user_id)
);

drop policy if exists "plan_versions_read_own_or_admin" on public.plan_versions;
drop policy if exists "plan_versions_read_own_or_assigned_admin" on public.plan_versions;
create policy "plan_versions_read_own_or_assigned_admin"
on public.plan_versions for select to authenticated
using (
  exists (
    select 1
    from public.plans plan
    where plan.id = plan_versions.plan_id
      and (
        plan.user_id = (select auth.uid())
        or public.can_administer_member(plan.user_id)
      )
  )
);

drop policy if exists "memberships_read_own_or_admin" on public.coach_memberships;
drop policy if exists "memberships_read_own_or_assigned_admin" on public.coach_memberships;
create policy "memberships_read_own_or_assigned_admin"
on public.coach_memberships for select to authenticated
using (
  member_user_id = (select auth.uid())
  or (
    admin_user_id = (select auth.uid())
    and public.is_app_admin((select auth.uid()))
  )
);

drop policy if exists "admins_read_invites" on public.coach_invites;
drop policy if exists "admins_read_own_invites" on public.coach_invites;
create policy "admins_read_own_invites"
on public.coach_invites for select to authenticated
using (
  created_by = (select auth.uid())
  and public.is_app_admin((select auth.uid()))
);

revoke all on function public.can_administer_member(uuid) from public, anon, authenticated;
revoke all on function public.submit_member_onboarding(text, integer, text, numeric, numeric, numeric, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.submit_member_menu(date, text, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.publish_member_bundle(uuid, uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.set_plan_request_status(uuid, text) from public, anon, authenticated;

grant execute on function public.can_administer_member(uuid) to authenticated;
grant execute on function public.submit_member_onboarding(text, integer, text, numeric, numeric, numeric, text, jsonb, jsonb, text) to authenticated;
grant execute on function public.submit_member_menu(date, text, jsonb, text, uuid) to authenticated;
grant execute on function public.publish_member_bundle(uuid, uuid, jsonb, jsonb, uuid) to authenticated;
grant execute on function public.set_plan_request_status(uuid, text) to authenticated;

-- 只读验证查询（迁移执行成功后可单独运行）：
-- select tablename, rowsecurity
-- from pg_catalog.pg_tables
-- where schemaname = 'public'
--   and tablename in (
--     'daily_logs', 'user_settings', 'profiles', 'app_admins',
--     'coach_invites', 'coach_memberships', 'questionnaires', 'plan_requests',
--     'plans', 'plan_versions', 'member_profile_versions',
--     'menu_submissions', 'menu_assignments'
--   )
-- order by tablename;
--
-- select column_name, is_nullable, data_type
-- from information_schema.columns
-- where table_schema = 'public'
--   and (
--     (
--       table_name = 'plan_versions'
--       and column_name in (
--         'fat_min', 'fat_max', 'carb_min', 'carb_max',
--         'fiber_target', 'calculation_method', 'client_request_id'
--       )
--     )
--     or (table_name = 'menu_assignments' and column_name = 'client_request_id')
--   )
-- order by table_name, ordinal_position;
--
-- select routine_name, security_type
-- from information_schema.routines
-- where routine_schema = 'public'
--   and routine_name in (
--     'can_administer_member', 'submit_member_onboarding',
--     'submit_member_menu', 'publish_member_bundle'
--   )
-- order by routine_name;
--
-- select tablename, policyname, cmd, roles
-- from pg_catalog.pg_policies
-- where schemaname = 'public'
--   and tablename in (
--     'daily_logs', 'user_settings', 'profiles', 'app_admins',
--     'coach_invites', 'coach_memberships', 'questionnaires', 'plan_requests',
--     'plans', 'plan_versions', 'member_profile_versions',
--     'menu_submissions', 'menu_assignments'
--   )
-- order by tablename, policyname;
--
-- select routine_name, grantee, privilege_type
-- from information_schema.routine_privileges
-- where specific_schema = 'public'
--   and routine_name in (
--     'can_administer_member', 'submit_member_onboarding',
--     'submit_member_menu', 'publish_member_bundle', 'set_plan_request_status'
--   )
-- order by routine_name, grantee;
-- 预期业务 RPC 仅有 authenticated 的 EXECUTE；不应出现 anon 或 PUBLIC。
--
-- select count(*) = 0 as old_publish_member_plan_removed
-- from pg_catalog.pg_proc procedure
-- join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
-- where namespace.nspname = 'public' and procedure.proname = 'publish_member_plan';
--
-- select count(*) = 0 as old_accept_coach_invite_removed
-- from pg_catalog.pg_proc procedure
-- join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
-- where namespace.nspname = 'public' and procedure.proname = 'accept_coach_invite';

commit;
