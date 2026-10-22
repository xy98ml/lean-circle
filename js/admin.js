(function () {
  'use strict';

  const cloud = window.FatLossCloud;
  const client = cloud.client;
  const state = {
    session: null,
    profiles: [], memberships: [], questionnaires: [], requests: [],
    plans: [], versions: [], logs: [], invites: [], selectedUserId: null
  };

  const answerLabels = {
    body_fat: '估计体脂', weight_trend: '体重趋势', daily_steps: '日均步数',
    goal_weight_kg: '目标体重', target_weeks: '目标周期', priority: '优先目标',
    training_years: '健身年限', training_days: '每周训练', cardio_sessions: '每周有氧',
    cardio_minutes: '每次有氧时长', training_schedule: '训练安排', strength_notes: '力量表现',
    training_environment: '场地与器械', calorie_tracking: '热量记录',
    protein_intake: '当前蛋白质', sleep_hours: '睡眠', takeout_frequency: '外卖/聚餐',
    alcohol_frequency: '饮酒', sugary_drinks: '含糖饮料', stress_level: '压力', work_schedule: '工作作息', usual_meals: '常见饮食',
    diet_preferences: '忌口与偏好', injury_notes: '伤病说明', medications: '药物'
  };

  const valueLabels = {
    unknown: '不确定', rising: '上升', stable: '稳定', falling: '下降', fluctuating: '起伏较大',
    fat_loss: '减脂和腰腹', health: '改善健康', performance: '保持力量', habit: '建立习惯',
    none: '无/不记录', sometimes: '偶尔', regular: '经常', rare: '很少', weekly: '每周',
    often: '频繁', monthly: '每月少量', low: '较低', medium: '一般', high: '较高'
  };

  function message(id, text, kind = '') {
    const element = document.getElementById(id);
    element.textContent = text;
    element.className = `message ${kind}`.trim();
  }

  function statusText(status) {
    return ({ pending: '待设计', designing: '设计中', completed: '已完成', blocked: '安全提示' })[status] || status || '未提交';
  }

  function statusClass(status) {
    return status === 'completed' ? 'good' : status === 'blocked' ? 'danger' : 'warn';
  }

  function latestByUser(rows) {
    const result = new Map();
    rows.forEach(row => { if (!result.has(row.user_id)) result.set(row.user_id, row); });
    return result;
  }

  function profileFor(userId) { return state.profiles.find(item => item.user_id === userId); }
  function questionnaireFor(userId) { return state.questionnaires.find(item => item.user_id === userId); }
  function requestFor(userId) { return latestByUser(state.requests).get(userId); }
  function planFor(userId) { return state.plans.find(item => item.user_id === userId); }
  function versionsFor(planId) { return state.versions.filter(item => item.plan_id === planId).sort((a, b) => b.version - a.version); }
  function logsFor(userId) { return state.logs.filter(item => item.user_id === userId).sort((a, b) => b.log_date.localeCompare(a.log_date)); }

  function renderMetrics() {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 6);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    const latestRequests = [...latestByUser(state.requests).values()];
    document.getElementById('metricMembers').textContent = state.memberships.filter(item => item.active).length;
    document.getElementById('metricPending').textContent = latestRequests.filter(item => ['pending', 'designing', 'blocked'].includes(item.status)).length;
    document.getElementById('metricPlans').textContent = state.plans.filter(item => item.current_version > 0).length;
    document.getElementById('metricLogs').textContent = state.logs.filter(item => item.log_date >= cutoffKey).length;
  }

  function memberListItem(member, request) {
    const profile = profileFor(member.member_user_id);
    const logs = logsFor(member.member_user_id);
    const latestLog = logs[0];
    const plan = planFor(member.member_user_id);
    const name = profile?.nickname || '尚未填写问卷';
    return `<article class="list-item">
      <div><div class="inline-actions"><strong>${cloud.escapeHTML(name)}</strong><span class="status ${statusClass(request?.status)}">${cloud.escapeHTML(statusText(request?.status))}</span>${plan?.current_version ? `<span class="status good">计划 v${plan.current_version}</span>` : ''}</div>
      <p>${profile ? `${profile.age} 岁 · ${profile.height_cm} cm · ${profile.current_weight_kg} kg` : '已接受邀请，等待填写资料'}${latestLog ? ` · 最近记录 ${cloud.formatDate(latestLog.log_date)}` : ' · 暂无每日记录'}</p></div>
      <button class="btn small" type="button" data-open-member="${member.member_user_id}">查看与调整</button>
    </article>`;
  }

  function bindMemberButtons(root) {
    root.querySelectorAll('[data-open-member]').forEach(button => button.addEventListener('click', () => openMember(button.dataset.openMember)));
  }

  function renderRequests() {
    const list = document.getElementById('requestList');
    const requests = [...latestByUser(state.requests).values()].filter(item => ['pending', 'designing', 'blocked'].includes(item.status));
    const members = new Map(state.memberships.map(item => [item.member_user_id, item]));
    list.innerHTML = requests.length
      ? requests.map(request => memberListItem(members.get(request.user_id) || { member_user_id: request.user_id }, request)).join('')
      : '<p class="notice">目前没有待处理申请。</p>';
    document.getElementById('pendingBadge').textContent = `${requests.length} 项`;
    bindMemberButtons(list);
  }

  function renderMembers() {
    const list = document.getElementById('memberList');
    const members = state.memberships.filter(item => item.active);
    list.innerHTML = members.length
      ? members.map(member => memberListItem(member, requestFor(member.member_user_id))).join('')
      : '<p class="notice">还没有朋友加入，先创建邀请链接吧。</p>';
    document.getElementById('memberBadge').textContent = `${members.length} 人`;
    bindMemberButtons(list);
  }

  function inviteState(invite) {
    if (invite.disabled_at) return ['danger', '已停用'];
    if (new Date(invite.expires_at) <= new Date()) return ['warn', '已过期'];
    if (invite.use_count >= invite.max_uses) return ['', '已用完'];
    return ['good', '可使用'];
  }

  function renderInvites() {
    const body = document.getElementById('inviteTableBody');
    body.innerHTML = state.invites.length ? state.invites.map(invite => {
      const [kind, label] = inviteState(invite);
      return `<tr><td>${cloud.formatDateTime(invite.created_at)}</td><td>${cloud.formatDateTime(invite.expires_at)}</td><td>${invite.use_count} / ${invite.max_uses}</td><td><span class="status ${kind}">${label}</span></td><td>${!invite.disabled_at && label === '可使用' ? `<button class="btn small danger" type="button" data-disable-invite="${invite.id}">停用</button>` : '—'}</td></tr>`;
    }).join('') : '<tr><td colspan="5">尚未创建邀请</td></tr>';
    body.querySelectorAll('[data-disable-invite]').forEach(button => button.addEventListener('click', () => disableInvite(button.dataset.disableInvite)));
  }

  function renderAll() {
    renderMetrics(); renderRequests(); renderMembers(); renderInvites();
    document.getElementById('lastRefresh').textContent = `最近刷新：${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }

  async function loadData() {
    document.getElementById('refreshButton').disabled = true;
    const queries = [
      client.from('coach_memberships').select('*').eq('active', true).order('created_at', { ascending: false }),
      client.from('profiles').select('*').order('updated_at', { ascending: false }),
      client.from('questionnaires').select('*').order('submitted_at', { ascending: false }),
      client.from('plan_requests').select('*').order('requested_at', { ascending: false }),
      client.from('plans').select('*'),
      client.from('plan_versions').select('*').order('version', { ascending: false }),
      client.from('daily_logs').select('*').order('log_date', { ascending: false }).limit(2000),
      client.from('coach_invites').select('*').order('created_at', { ascending: false })
    ];
    const results = await Promise.all(queries);
    document.getElementById('refreshButton').disabled = false;
    const error = results.find(result => result.error)?.error;
    if (error) { document.getElementById('lastRefresh').textContent = cloud.friendlyError(error); return; }
    [state.memberships, state.profiles, state.questionnaires, state.requests, state.plans, state.versions, state.logs, state.invites] = results.map(result => result.data || []);
    renderAll();
  }

  function answerValue(key, value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? '是' : '否';
    return valueLabels[value] || String(value);
  }

  function fillPlanForm(version, request, profile, questionnaire) {
    const suggested = request?.suggested_targets || {};
    const source = version || suggested;
    const payload = questionnaire?.payload || {};
    const values = {
      caloriesMin: source.calories_min || 1900,
      caloriesMax: source.calories_max || 2100,
      proteinMin: source.protein_min || Math.round(Number(profile?.current_weight_kg || 70) * 1.6),
      proteinMax: source.protein_max || Math.round(Number(profile?.current_weight_kg || 70) * 1.8),
      stepsTarget: source.steps_target || 8000,
      strengthDays: source.strength_days ?? payload.training_days ?? 3,
      cardioCount: source.cardio_sessions ?? 2,
      cardioMinutes: source.cardio_minutes ?? 20,
      planGoalWeight: version?.goal_weight_kg ?? payload.goal_weight_kg ?? '',
      planWeeks: version?.target_weeks ?? payload.target_weeks ?? '',
      trainingDetails: version?.training_plan?.note || payload.training_schedule || '',
      nutritionDetails: version?.nutrition_notes || '',
      adjustmentReason: ''
    };
    Object.entries(values).forEach(([id, value]) => { document.getElementById(id).value = value; });
  }

  function renderMemberLogs(userId) {
    const days = Number(document.getElementById('memberLogWindow').value) || 14;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days + 1);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    const logs = logsFor(userId).filter(log => log.log_date >= cutoffKey);
    const weights = logs.filter(log => Number(log.weight));
    const calorieValues = logs.map(log => Number(log.calories)).filter(Boolean);
    const weightChange = weights.length > 1 ? Number(weights[0].weight) - Number(weights.at(-1).weight) : null;
    const averageCalories = calorieValues.length ? Math.round(calorieValues.reduce((sum, value) => sum + value, 0) / calorieValues.length) : null;
    const trend = weightChange === null ? '晨重不足 2 次' : `体重 ${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)} kg`;
    document.getElementById('memberLogSummary').textContent = `近 ${days} 天记录 ${logs.length} 天 · ${trend}${averageCalories ? ` · 平均 ${averageCalories} kcal` : ''}`;
    document.getElementById('memberLogRows').innerHTML = logs.length ? logs.map(log => `<tr><td>${cloud.formatDate(log.log_date)}</td><td>${log.weight ?? '—'}</td><td>${log.calories ?? '—'}</td><td>${log.protein ?? '—'}</td><td>${log.steps ?? '—'}</td><td>${log.strength ? '力量' : log.cardio ? '有氧' : '休息'}</td></tr>`).join('') : '<tr><td colspan="6">该周期暂无记录</td></tr>';
  }

  function openMember(userId) {
    state.selectedUserId = userId;
    const profile = profileFor(userId);
    const questionnaire = questionnaireFor(userId);
    const request = requestFor(userId);
    const plan = planFor(userId);
    const versions = versionsFor(plan?.id);
    const current = versions.find(item => item.version === plan?.current_version) || versions[0];
    const name = profile?.nickname || '未填写资料';

    document.getElementById('memberDialogTitle').textContent = name;
    document.getElementById('memberDialogSubtitle').textContent = `${profile ? `${profile.age} 岁 · ${profile.sex === 'male' ? '男' : profile.sex === 'female' ? '女' : '其他'} · ${profile.height_cm} cm` : '等待填写问卷'} · ${statusText(request?.status)}`;
    document.getElementById('memberMetrics').innerHTML = [
      ['当前体重', profile ? `${profile.current_weight_kg} kg` : '—'],
      ['腰围', profile?.waist_cm ? `${profile.waist_cm} cm` : '—'],
      ['记录天数', `${state.logs.filter(item => item.user_id === userId).length} 天`],
      ['计划版本', plan?.current_version ? `v${plan.current_version}` : '未发布']
    ].map(([label, value]) => `<div class="card soft metric"><span class="subtle">${label}</span><strong>${value}</strong></div>`).join('');

    const payload = questionnaire?.payload || {};
    const risks = questionnaire?.risk_flags || {};
    const answers = {
      计划方式: questionnaire?.route === 'template' ? '快速套用' : questionnaire?.route === 'personalized' ? '个性化设计' : '—',
      安全筛查: questionnaire?.risk_blocked ? '需要专业评估' : '未触发自动阻断',
      ...Object.fromEntries(Object.entries(payload).map(([key, value]) => [answerLabels[key] || key, answerValue(key, value)])),
      风险项目: Object.entries(risks).filter(([, value]) => value).map(([key]) => key).join('、') || '无'
    };
    document.getElementById('questionnaireAnswers').innerHTML = Object.entries(answers).map(([label, value]) => `<div class="answer"><span>${cloud.escapeHTML(label)}</span><strong>${cloud.escapeHTML(value)}</strong></div>`).join('');

    document.getElementById('memberLogWindow').value = '14';
    renderMemberLogs(userId);

    document.getElementById('currentPlanVersion').textContent = current ? `当前 v${current.version}` : '尚无计划';
    fillPlanForm(current, request, profile, questionnaire);
    message('planMessage', request?.status === 'blocked' ? '安全筛查已阻断普通计划。只有在成员获得医生或合格专业人士确认后，才应发布新计划。' : '', request?.status === 'blocked' ? 'error' : '');
    document.getElementById('planHistory').innerHTML = versions.length ? versions.map(version => `<article class="list-item"><div><strong>v${version.version} · ${version.calories_min}–${version.calories_max} kcal · ${version.protein_min}–${version.protein_max} g</strong><p>${cloud.escapeHTML(version.adjustment_reason)} · ${cloud.formatDateTime(version.published_at)}</p></div><span class="status ${version.version === plan.current_version ? 'good' : ''}">${version.source === 'automatic' ? '自动生成' : '管理员调整'}</span></article>`).join('') : '<p class="notice">尚未发布计划。</p>';

    document.getElementById('planForm').dataset.userId = userId;
    document.getElementById('memberDialog').showModal();
  }

  async function publishPlan(event) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const button = document.getElementById('publishPlanButton');
    button.disabled = true;
    message('planMessage', '正在发布新版本…');
    const nullableNumber = id => document.getElementById(id).value === '' ? null : Number(document.getElementById(id).value);
    const { error } = await client.rpc('publish_member_plan', {
      target_member_user_id: event.currentTarget.dataset.userId,
      calories_minimum: Number(document.getElementById('caloriesMin').value),
      calories_maximum: Number(document.getElementById('caloriesMax').value),
      protein_minimum: Number(document.getElementById('proteinMin').value),
      protein_maximum: Number(document.getElementById('proteinMax').value),
      daily_steps_target: Number(document.getElementById('stepsTarget').value),
      weekly_strength_days: Number(document.getElementById('strengthDays').value),
      weekly_cardio_sessions: Number(document.getElementById('cardioCount').value),
      cardio_session_minutes: Number(document.getElementById('cardioMinutes').value),
      goal_weight: nullableNumber('planGoalWeight'),
      duration_weeks: nullableNumber('planWeeks'),
      training_details: { note: document.getElementById('trainingDetails').value.trim() },
      nutrition_details: document.getElementById('nutritionDetails').value.trim(),
      reason: document.getElementById('adjustmentReason').value.trim()
    });
    button.disabled = false;
    if (error) { message('planMessage', cloud.friendlyError(error), 'error'); return; }
    message('planMessage', '新版本已经发布。', 'success');
    await loadData();
    openMember(state.selectedUserId);
  }

  async function createInvite() {
    const button = document.getElementById('createInviteButton');
    button.disabled = true;
    message('inviteMessage', '正在创建邀请…');
    const { data, error } = await client.rpc('create_coach_invite', {
      valid_days: Number(document.getElementById('inviteDays').value),
      allowed_uses: Number(document.getElementById('inviteUses').value)
    });
    button.disabled = false;
    if (error) { message('inviteMessage', cloud.friendlyError(error), 'error'); return; }
    const url = new URL('join.html', window.location.href);
    url.searchParams.set('invite', data.token);
    document.getElementById('newInviteLink').value = url.href;
    document.getElementById('newInviteResult').classList.remove('hidden');
    message('inviteMessage', `邀请已创建，有效期至 ${cloud.formatDateTime(data.expires_at)}。`, 'success');
    await loadData();
  }

  async function disableInvite(inviteId) {
    if (!confirm('停用后，这条链接将无法再用于加入。继续吗？')) return;
    const { error } = await client.rpc('disable_coach_invite', { invite_id: inviteId });
    if (error) { message('inviteMessage', cloud.friendlyError(error), 'error'); return; }
    await loadData();
  }

  async function copyInvite() {
    const input = document.getElementById('newInviteLink');
    try {
      await navigator.clipboard.writeText(input.value);
      message('inviteMessage', '邀请链接已复制。', 'success');
    } catch {
      input.select(); document.execCommand('copy');
      message('inviteMessage', '邀请链接已复制。', 'success');
    }
  }

  function renderAccess(isAdmin) {
    const signedIn = Boolean(state.session?.user);
    document.getElementById('adminAuth').classList.toggle('hidden', signedIn);
    document.getElementById('accessDenied').classList.toggle('hidden', !signedIn || isAdmin);
    document.getElementById('adminApp').classList.toggle('hidden', !signedIn || !isAdmin);
    document.getElementById('signOutButton').classList.toggle('hidden', !signedIn);
    document.getElementById('adminAccount').textContent = state.session?.user?.email || '未登录';
  }

  async function authenticate() {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    if (!email || !password) { message('authMessage', '请输入邮箱和密码。', 'error'); return; }
    document.getElementById('signInButton').disabled = true;
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    document.getElementById('signInButton').disabled = false;
    if (error) { message('authMessage', cloud.friendlyError(error), 'error'); return; }
    state.session = data.session;
    await enterAdmin();
  }

  async function enterAdmin() {
    if (!state.session) { renderAccess(false); return; }
    let isAdmin = false;
    try { isAdmin = await cloud.checkAdmin(); }
    catch (error) { message('authMessage', cloud.friendlyError(error), 'error'); }
    renderAccess(isAdmin);
    if (isAdmin) await loadData();
  }

  async function init() {
    if (!client) { message('authMessage', 'Supabase 客户端未加载，请检查网络。', 'error'); return; }
    state.session = await cloud.getSession().catch(() => null);
    await enterAdmin();
    client.auth.onAuthStateChange((_event, session) => {
      state.session = session;
      setTimeout(() => enterAdmin(), 0);
    });
  }

  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === button.dataset.view));
  }));
  document.getElementById('signInButton').addEventListener('click', authenticate);
  document.getElementById('signOutButton').addEventListener('click', () => client.auth.signOut());
  document.getElementById('refreshButton').addEventListener('click', loadData);
  document.getElementById('createInviteButton').addEventListener('click', createInvite);
  document.getElementById('copyInviteButton').addEventListener('click', copyInvite);
  document.getElementById('closeMemberDialog').addEventListener('click', () => document.getElementById('memberDialog').close());
  document.getElementById('memberLogWindow').addEventListener('change', () => {
    if (state.selectedUserId) renderMemberLogs(state.selectedUserId);
  });
  document.getElementById('planForm').addEventListener('submit', publishPlan);

  void init();
})();

