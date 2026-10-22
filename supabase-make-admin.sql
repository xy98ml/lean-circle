-- 将下面的邮箱替换为你在减脂面板中注册并完成验证的真实邮箱，然后执行一次。
-- 这条语句只会把已存在的账号设为唯一总管理员，不会创建账号。
-- 如果已经存在另一位总管理员，唯一约束会拒绝新增，请先确认邮箱是否填写正确。

insert into public.app_admins (user_id)
select id
from auth.users
where lower(email) = lower('替换为你的登录邮箱')
on conflict (user_id) do nothing;

-- 应返回一行你的管理员账号；如果没有结果，请确认邮箱已经注册并完成验证。
select a.user_id, u.email, a.created_at
from public.app_admins a
join auth.users u on u.id = a.user_id;

