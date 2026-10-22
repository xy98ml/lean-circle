# 减脂协作面板

这是一个纯静态前端 + Supabase 的熟人减脂协作工具。成员可以记录每日数据、填写入组问卷并查看自己的计划；总管理员可以创建邀请、查看成员趋势并发布版本化计划，但不能修改成员的原始每日记录。

## 页面

- `index.html`：站点入口，自动进入个人面板。
- `fat-loss-dashboard.html`：个人记录、菜单、计划和云端同步。
- `join.html?invite=...`：朋友通过邀请加入并填写问卷。
- `admin.html`：总管理员后台。

## 第一次配置

1. 在 Supabase SQL Editor 执行 `supabase-schema.sql`，创建个人记录表。
2. 确认个人面板可以注册、登录和同步。
3. 执行 `supabase-friends-schema.sql`，安装邀请、问卷、计划版本和 RLS。
4. 用管理员邮箱注册并完成邮箱验证。
5. 把 `supabase-make-admin.sql` 中的占位邮箱替换为真实管理员邮箱，再执行一次。
6. 打开 `admin.html`，创建一条测试邀请并完成端到端验收。

7. 如需朋友用照片提交单日或整周菜单，在好友协作迁移后执行 `supabase-menu-photos.sql`。该迁移创建私有照片桶和权限策略；用户及其对应管理员可查看，匿名用户和其他成员不可访问。完成 GitHub Pages 发布后即可使用。

`js/supabase-config.js` 中只允许放 Supabase Project URL 和 publishable key。不要把 `service_role`、`sb_secret_...` 或数据库密码写进网页或提交到 Git。

## 发布到 GitHub Pages

这个项目不需要自建服务器。GitHub Pages 托管 HTML、CSS 和 JavaScript，Supabase 负责登录和数据同步。

1. 新建一个 GitHub 仓库并上传以下文件：`index.html`、`404.html`、三个业务 HTML、`css/`、`js/` 和 SQL/说明文件。
2. 在仓库的 **Settings → Pages** 中选择 **Deploy from a branch**。
3. 选择发布分支和 `/ (root)`，保存后等待 Pages 地址生成。
4. 在 Supabase **Authentication → URL Configuration** 中把 Pages 地址设为 Site URL，并加入 Redirect URLs，例如 `https://你的用户名.github.io/仓库名/**`。
5. 使用线上 `admin.html` 重新生成邀请。邀请链接会自动使用当前线上域名。

## 权限边界

- 普通成员只能读取自己的资料、问卷、计划和每日记录。
- 总管理员可以读取所有已加入成员的数据并发布计划版本。
- 总管理员没有成员每日记录的更新或删除权限。
- 所有关键限制由 Supabase RLS 和数据库函数执行，不依赖页面按钮隐藏。

## 验收

按 `docs/friends-coaching-test-checklist.md` 完成测试。尤其要用两个不同账号验证普通成员之间互不可见，并确认同一浏览器切换账号时本地数据不会串用。
