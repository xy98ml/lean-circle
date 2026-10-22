(function (global) {
  'use strict';

  const PROJECT_URL = 'https://orpcidyavhpdhsbmuixy.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_cJmGcZ9grJ6BXsqhhYcscA_HEbS7oCd';
  const client = global.supabase?.createClient(PROJECT_URL, PUBLISHABLE_KEY) || null;

  function friendlyError(error) {
    const message = error?.message || String(error || '未知错误');
    const mappings = [
      [/invalid login credentials/i, '邮箱或密码不正确。'],
      [/email not confirmed/i, '邮箱尚未确认，请先点击确认邮件中的链接。'],
      [/user already registered/i, '这个邮箱已经注册，请直接登录。'],
      [/password.*6|weak password/i, '密码强度不足，请至少使用 8 位字符。'],
      [/invalid invite/i, '邀请链接无效，请联系管理员重新生成。'],
      [/invite expired/i, '邀请链接已经过期，请联系管理员重新生成。'],
      [/invite exhausted/i, '邀请链接的使用次数已用完。'],
      [/invite disabled/i, '邀请链接已经停用。'],
      [/active invite membership required/i, '请先通过有效邀请链接加入。'],
      [/admin access required/i, '当前账号不是总管理员。'],
      [/schema cache|does not exist|could not find/i, '多人协作数据表尚未安装，请先执行迁移 SQL。'],
      [/failed to fetch|network|load failed/i, '网络连接失败，请稍后重试。']
    ];
    return mappings.find(([pattern]) => pattern.test(message))?.[1] || message;
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  async function getSession() {
    if (!client) return null;
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function checkAdmin() {
    if (!client) return false;
    const { data, error } = await client.rpc('is_app_admin');
    if (error) throw error;
    return Boolean(data);
  }

  function formatDateTime(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00`)
      : new Date(value);
    return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
  }

  global.FatLossCloud = {
    client,
    PROJECT_URL,
    PUBLISHABLE_KEY,
    friendlyError,
    escapeHTML,
    getSession,
    checkAdmin,
    formatDate,
    formatDateTime
  };
})(window);

