(function () {
  'use strict';

  const cloud = window.FatLossCloud;
  const client = cloud.client;
  const inviteToken = new URLSearchParams(window.location.search).get('invite')?.trim() || '';
  let session = null;
  let sessionGeneration = 0;

  const invalidInvite = document.getElementById('invalidInvite');
  const authCard = document.getElementById('authCard');
  const form = document.getElementById('questionnaireForm');
  const successCard = document.getElementById('successCard');
  const joinStatus = document.getElementById('joinStatus');
  const signOutButton = document.getElementById('signOutButton');

  function showMessage(id, message, kind = '') {
    const element = document.getElementById(id);
    element.textContent = message;
    element.className = `message ${kind}`.trim();
  }

  function setAuthBusy(busy) {
    ['signInButton', 'signUpButton'].forEach(id => { document.getElementById(id).disabled = busy; });
  }

  function renderSession() {
    const signedIn = Boolean(session?.user);
    invalidInvite.classList.toggle('hidden', Boolean(inviteToken));
    authCard.classList.toggle('hidden', !inviteToken || signedIn);
    document.getElementById('accountSettings').classList.toggle('hidden', !inviteToken || !signedIn);
    form.classList.toggle('hidden', !inviteToken || !signedIn || !successCard.classList.contains('hidden'));
    signOutButton.classList.toggle('hidden', !signedIn);
    joinStatus.textContent = !inviteToken ? '邀请无效' : signedIn ? '可以填写' : '等待登录';
    joinStatus.className = `status ${signedIn ? 'good' : !inviteToken ? 'danger' : ''}`.trim();
    document.getElementById('accountLabel').textContent = session?.user?.email || '已登录';
    if (signedIn) {
      try { localStorage.removeItem(`fatLoss.onboardingDraft.v1.${session.user.id}`); } catch {}
    }
    const submitButton = document.getElementById('submitButton');
    if (submitButton && !submitButton.dataset.submitting) submitButton.disabled = false;
  }

  function credentials() {
    return {
      email: document.getElementById('authEmail').value.trim(),
      password: document.getElementById('authPassword').value
    };
  }

  async function signIn() {
    const { email, password } = credentials();
    if (!email || password.length < 8) {
      showMessage('authMessage', '请输入有效邮箱和至少 8 位密码。', 'error');
      return;
    }
    setAuthBusy(true);
    showMessage('authMessage', '正在登录…');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    setAuthBusy(false);
    if (error) { showMessage('authMessage', cloud.friendlyError(error), 'error'); return; }
    session = data.session;
    renderSession();
  }

  async function signUp() {
    const { email, password } = credentials();
    if (!email || password.length < 8) {
      showMessage('authMessage', '请输入有效邮箱和至少 8 位密码。', 'error');
      return;
    }
    setAuthBusy(true);
    showMessage('authMessage', '正在创建账号…');
    const options = /^https?:$/.test(window.location.protocol) ? { emailRedirectTo: window.location.href } : undefined;
    const { data, error } = await client.auth.signUp({ email, password, options });
    setAuthBusy(false);
    if (error) { showMessage('authMessage', cloud.friendlyError(error), 'error'); return; }
    session = data.session;
    if (session) {
      renderSession();
    } else {
      showMessage('authMessage', '注册成功，请打开邮箱确认链接，然后回到这条邀请链接登录。', 'success');
    }
  }

  function numberOrNull(formData, key) {
    const value = formData.get(key);
    return value === '' || value === null ? null : Number(value);
  }

  function buildPayload(formData) {
    return {
      body_fat: numberOrNull(formData, 'body_fat'),
      weight_trend: formData.get('weight_trend'),
      daily_steps: numberOrNull(formData, 'daily_steps'),
      goal_weight_kg: numberOrNull(formData, 'goal_weight_kg'),
      target_weeks: numberOrNull(formData, 'target_weeks'),
      priority: formData.get('priority'),
      training_years: numberOrNull(formData, 'training_years'),
      training_days: numberOrNull(formData, 'training_days'),
      cardio_sessions: numberOrNull(formData, 'cardio_sessions'),
      cardio_minutes: numberOrNull(formData, 'cardio_minutes'),
      training_schedule: formData.get('training_schedule')?.trim(),
      strength_notes: formData.get('strength_notes')?.trim(),
      training_environment: formData.get('training_environment')?.trim(),
      calorie_tracking: formData.get('calorie_tracking'),
      protein_intake: numberOrNull(formData, 'protein_intake'),
      sleep_hours: numberOrNull(formData, 'sleep_hours'),
      takeout_frequency: formData.get('takeout_frequency'),
      alcohol_frequency: formData.get('alcohol_frequency'),
      sugary_drinks: formData.get('sugary_drinks'),
      stress_level: formData.get('stress_level'),
      work_schedule: formData.get('work_schedule')?.trim(),
      usual_meals: formData.get('usual_meals')?.trim(),
      diet_preferences: formData.get('diet_preferences')?.trim(),
      injury_notes: formData.get('injury_notes')?.trim(),
      medications: formData.get('medications')?.trim()
    };
  }

  function buildRiskFlags(formData) {
    return {
      medical_condition: formData.has('medical_condition'),
      acute_symptoms: formData.has('acute_symptoms'),
      eating_disorder: formData.has('eating_disorder'),
      recent_surgery: formData.has('recent_surgery'),
      pregnancy: formData.has('pregnancy')
    };
  }

  function renderResult(result, route) {
    form.classList.add('hidden');
    successCard.classList.remove('hidden');
    const subtitle = document.getElementById('successSubtitle');
    const notice = document.getElementById('resultNotice');
    const summary = document.getElementById('targetSummary');

    if (result.risk_blocked) {
      subtitle.textContent = '资料的新版本已保存，但安全筛查需要优先处理。';
      notice.textContent = '系统没有自动生成普通减脂方案。请先咨询医生或合格专业人士，管理员也会在后台看到这项提示。';
      notice.className = 'notice danger';
      summary.classList.add('hidden');
    } else if (route === 'personalized') {
      subtitle.textContent = '资料的新版本已保存，申请已经进入管理员的待设计列表。';
      notice.textContent = '可以先开始记录体重、饮食、步数与训练。管理员发布计划后，你的面板会自动显示最新目标。';
      notice.className = 'notice';
      summary.classList.add('hidden');
    } else {
      subtitle.textContent = '资料的新版本已保存，基础计划已经生成。';
      const targets = result.targets || {};
      summary.innerHTML = [
        ['每日热量', `${targets.calories_min}–${targets.calories_max} kcal`],
        ['每日蛋白质', `${targets.protein_min}–${targets.protein_max} g`],
        ['每日步数', `${Number(targets.steps_target || 0).toLocaleString('zh-CN')}`],
        ['每周训练', `${targets.strength_days} 力量 + ${targets.cardio_sessions} 有氧`]
      ].map(([label, value]) => `<div class="card soft metric"><span class="subtle">${cloud.escapeHTML(label)}</span><strong>${cloud.escapeHTML(value)}</strong></div>`).join('');
      summary.classList.remove('hidden');
      notice.textContent = '这是根据入组数据计算的执行起点，不是医学处方。先稳定执行两周，再根据趋势调整。';
      notice.className = 'notice';
    }
    joinStatus.textContent = '已加入';
    window.scrollTo({ top: successCard.offsetTop - 90, behavior: 'smooth' });
  }

  async function submitQuestionnaire(event) {
    event.preventDefault();
    if (!session?.user) { renderSession(); return; }
    if (!form.reportValidity()) return;
    const submitButton = document.getElementById('submitButton');
    submitButton.disabled = true;
    submitButton.dataset.submitting = 'true';
    const requestGeneration = sessionGeneration;
    const requestUserId = session.user.id;
    showMessage('formMessage', '正在验证邀请并提交资料…');
    const formData = new FormData(form);

    const route = formData.get('route');
    const { data, error } = await client.rpc('submit_member_onboarding', {
      member_nickname: formData.get('nickname')?.trim(),
      member_age: Number(formData.get('age')),
      member_sex: formData.get('sex'),
      member_height_cm: Number(formData.get('height')),
      member_weight_kg: Number(formData.get('weight')),
      member_waist_cm: numberOrNull(formData, 'waist'),
      selected_route: route,
      answers: buildPayload(formData),
      submitted_risk_flags: buildRiskFlags(formData),
      invite_token: inviteToken
    });
    delete submitButton.dataset.submitting;
    if (requestGeneration !== sessionGeneration || session?.user?.id !== requestUserId) return;
    submitButton.disabled = false;
    if (error) { showMessage('formMessage', cloud.friendlyError(error), 'error'); return; }
    showMessage('formMessage', '提交成功。', 'success');
    renderResult(data, route);
  }

  async function init() {
    if (!client) {
      invalidInvite.classList.remove('hidden');
      invalidInvite.querySelector('.notice').textContent = 'Supabase 客户端没有加载，请检查网络后刷新。';
      return;
    }
    session = await cloud.getSession().catch(() => null);
    renderSession();
    client.auth.onAuthStateChange((_event, nextSession) => {
      sessionGeneration += 1;
      session = nextSession;
      renderSession();
    });
  }

  document.getElementById('signInButton').addEventListener('click', signIn);
  document.getElementById('signUpButton').addEventListener('click', signUp);
  signOutButton.addEventListener('click', () => client.auth.signOut());
  document.getElementById('updatePasswordButton').addEventListener('click', async () => {
    const message = document.getElementById('passwordMessage');
    if (!client || !session?.user) { message.textContent = '请先登录。'; message.className = 'message error'; return; }
    const nextPassword = document.getElementById('newPassword').value;
    const confirmation = document.getElementById('confirmPassword').value;
    if (nextPassword.length < 8) { message.textContent = '新密码至少需要 8 位。'; message.className = 'message error'; return; }
    if (nextPassword !== confirmation) { message.textContent = '两次输入的新密码不一致。'; message.className = 'message error'; return; }
    const button = document.getElementById('updatePasswordButton');
    button.disabled = true;
    message.textContent = '正在更新密码…'; message.className = 'message';
    const { error } = await client.auth.updateUser({ password: nextPassword });
    button.disabled = false;
    if (error) { message.textContent = cloud.friendlyError(error); message.className = 'message error'; return; }
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
    message.textContent = '密码已更新。'; message.className = 'message success';
  });
  form.addEventListener('submit', submitQuestionnaire);
  document.getElementById('editAgainButton').addEventListener('click', () => {
    successCard.classList.add('hidden');
    form.classList.remove('hidden');
    renderSession();
  });

  void init();
})();
