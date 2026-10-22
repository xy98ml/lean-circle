(function (global) {
  'use strict';

  const BUCKET = 'menu-photos';
  const MAX_BYTES = 10 * 1024 * 1024;
  const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

  function buildSubmission(file, scope, startDate, userId, id) {
    if (!file || !TYPES[file.type]) throw new Error('请选择 JPG、PNG 或 WebP 图片；HEIC 照片请先转成 JPG。');
    if (!file.size || file.size > MAX_BYTES) throw new Error('每张图片需大于 0 且不超过 10 MB。');
    if (!['day', 'week'].includes(scope)) throw new Error('请选择单日或整周。');
    const date = new Date(`${startDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(date.getTime())
      || date.toISOString().slice(0, 10) !== startDate) throw new Error('请选择有效日期。');
    if (scope === 'week' && date.getUTCDay() !== 1) throw new Error('整周菜单请选择该周的周一。');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (!uuid.test(userId) || !uuid.test(id)) throw new Error('登录状态异常，请重新登录。');
    return { id, user_id: userId, scope, start_date: startDate, object_path: `${userId}/${id}.${TYPES[file.type]}` };
  }

  async function savePhoto(client, record, file, isCurrent) {
    const bucket = client.storage.from(BUCKET);
    const uploaded = await bucket.upload(record.object_path, file, { contentType: file.type, upsert: false });
    if (uploaded.error) throw uploaded.error;
    if (!isCurrent()) {
      await bucket.remove([record.object_path]).catch(() => {});
      throw new Error('账号已切换，请重新选择图片。');
    }
    let insertError;
    try {
      const result = await client.from('menu_photo_submissions').insert(record);
      insertError = result.error;
    } catch (error) { insertError = error; }
    if (!insertError) return;
    // 网络中断可能发生在数据库已经保存之后，先确认再清理图片。
    const existing = await client.from('menu_photo_submissions').select('id').eq('id', record.id).maybeSingle();
    if (existing.error) throw new Error('暂时无法确认保存结果，请先刷新提交记录，避免重复上传。');
    if (existing.data) return;
    await bucket.remove([record.object_path]).catch(() => {});
    throw insertError;
  }

  const api = { buildSubmission, savePhoto };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  global.MenuPhotos = api;
  const root = document.querySelector('[data-menu-photos]');
  if (!root) return;
  const client = global.FatLossCloud?.client;
  const admin = root.dataset.menuPhotos === 'admin';
  const escape = global.FatLossCloud.escapeHTML;
  let userId = null;
  let generation = 0;
  let loadGeneration = 0;
  let selectionGeneration = 0;
  let file = null;
  let previewURL = null;
  let busy = false;
  const imageURLs = new Set();

  root.innerHTML = `<div class="card-head"><div><h3>${admin ? '成员菜单照片' : '拍照提交菜单'}</h3><p class="subtle">${admin ? '查看自己和已加入成员的单日、整周原图。' : '选择单日或整周，拍照或从相册选一张图片，无需输入菜名。'}</p></div></div>
    <p class="subtle photo-message" role="status" aria-live="polite"></p>
    ${admin ? '' : `<form class="photo-form">
      <div class="form-grid"><div class="field"><label>菜单范围<select name="scope"><option value="day">单日</option><option value="week">整周</option></select></label></div>
      <div class="field"><label><span class="photo-date-label">菜单日期</span><input name="date" type="date" required></label></div></div>
      <div class="inline-actions photo-pickers"><label class="btn">拍照<input class="photo-file" name="camera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="拍照上传菜单"></label>
      <label class="btn">从相册选择<input class="photo-file" name="album" type="file" accept="image/jpeg,image/png,image/webp" aria-label="从相册选择菜单照片"></label></div>
      <p class="subtle">每次一张，JPG / PNG / WebP，最大 10 MB。整周请选择周一；请确认照片里的菜名清晰。</p>
      <img class="photo-preview" alt="待上传菜单预览" hidden>
      <button class="btn primary photo-submit" type="submit" disabled>上传菜单照片</button>
    </form>`}
    <div class="inline-actions photo-list-head"><h3>最近 50 条照片提交</h3><button class="btn small photo-refresh" type="button">刷新</button></div>
    <div class="photo-list"></div>`;

  const message = root.querySelector('.photo-message');
  const list = root.querySelector('.photo-list');
  const form = root.querySelector('form');
  const submit = root.querySelector('.photo-submit');
  const refresh = root.querySelector('.photo-refresh');

  function showMessage(text) { message.textContent = text; }
  function friendly(error) {
    const text = error?.message || String(error);
    if (/menu_photo_submissions|bucket.*not found|schema cache|relation.*not exist/i.test(text)) return '照片上传功能尚未启用，请管理员执行 supabase-menu-photos.sql。';
    if (/row.level|policy|unauthorized|permission/i.test(text)) return '没有操作权限，请确认已接受邀请；管理员请检查照片存储权限。';
    return text;
  }
  function current(captured) { return captured.generation === generation && captured.userId === userId; }
  function context() { return { generation, userId }; }
  function clearPreview() {
    selectionGeneration++;
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = null; file = null;
    if (form) {
      const preview = form.querySelector('img');
      preview.onload = null; preview.onerror = null;
      preview.hidden = true; preview.removeAttribute('src');
      form.querySelectorAll('input[type="file"]').forEach(input => { input.value = ''; });
      submit.disabled = true;
    }
  }
  function clearList() {
    imageURLs.forEach(url => URL.revokeObjectURL(url));
    imageURLs.clear(); list.replaceChildren();
  }
  function setBusy(value) {
    busy = value;
    if (form) {
      form.querySelectorAll('input, select').forEach(input => { input.disabled = value || !userId; });
      submit.disabled = value || !userId || !file;
      submit.textContent = value ? '正在上传…' : '上传菜单照片';
    }
  }

  async function load() {
    if (!userId || !client) return;
    const captured = context();
    const request = ++loadGeneration;
    refresh.disabled = true;
    clearList(); list.textContent = '正在读取…';
    try {
      if (admin) {
        const result = await client.rpc('is_app_admin');
        if (result.error) throw result.error;
        if (!result.data) throw new Error('当前账号不是管理员，请前往个人面板提交照片。');
      }
      if (!current(captured) || request !== loadGeneration) return;
      let query = client.from('menu_photo_submissions').select('*').order('created_at', { ascending: false }).limit(50);
      if (!admin) query = query.eq('user_id', captured.userId);
      const { data, error } = await query;
      if (error) throw error;
      let names = new Map();
      if (admin && data.length) {
        const profiles = await client.from('profiles').select('user_id,nickname').in('user_id', [...new Set(data.map(row => row.user_id))]);
        names = new Map((profiles.data || []).map(row => [row.user_id, row.nickname]));
      }
      if (!current(captured) || request !== loadGeneration) return;
      list.innerHTML = data.length ? data.map(row => `<article class="photo-entry"><div><strong>${escape(row.scope === 'week' ? '整周' : '单日')} · ${escape(row.start_date)}</strong>
        <p class="subtle">${admin ? `${escape(row.user_id === captured.userId ? '我自己' : names.get(row.user_id) || `成员 ${row.user_id.slice(0, 8)}`)} · ` : ''}${escape(global.FatLossCloud.formatDateTime(row.created_at))}</p></div>
        <button class="btn small photo-open" type="button">查看原图</button></article>`).join('') : '<p class="subtle">还没有菜单照片。</p>';
      list.querySelectorAll('.photo-open').forEach((button, index) => {
        button.addEventListener('click', () => viewPhoto(button, data[index], captured));
      });
    } catch (error) {
      if (current(captured) && request === loadGeneration) list.textContent = friendly(error);
    } finally {
      if (current(captured) && request === loadGeneration) refresh.disabled = false;
    }
  }

  async function viewPhoto(button, row, captured) {
    if (!current(captured)) return;
    const entry = button.closest('article');
    const previous = entry.querySelector('img');
    if (previous) {
      URL.revokeObjectURL(previous.src); imageURLs.delete(previous.src); previous.remove();
      button.textContent = '查看原图'; return;
    }
    button.disabled = true;
    try {
      const { data, error } = await client.storage.from(BUCKET).download(row.object_path);
      if (error) throw error;
      if (!current(captured) || !button.isConnected) return;
      if (!TYPES[data.type]) throw new Error('图片格式不受支持。');
      const img = document.createElement('img');
      img.alt = `${row.start_date} 菜单原图`; img.className = 'photo-original';
      img.src = URL.createObjectURL(data); imageURLs.add(img.src);
      entry.append(img); button.textContent = '收起图片';
    } catch (error) { if (current(captured)) showMessage(friendly(error)); }
    finally { if (current(captured)) button.disabled = false; }
  }

  if (form) {
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    form.elements.date.value = today.toISOString().slice(0, 10);
    form.elements.scope.addEventListener('change', () => {
      const weekly = form.elements.scope.value === 'week';
      root.querySelector('.photo-date-label').textContent = weekly ? '周开始日期（周一）' : '菜单日期';
      if (weekly && form.elements.date.value) {
        const date = new Date(`${form.elements.date.value}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
        form.elements.date.value = date.toISOString().slice(0, 10);
      }
    });
    form.querySelectorAll('input[type="file"]').forEach(input => input.addEventListener('change', () => {
      const picked = input.files[0];
      if (!picked) return;
      clearPreview();
      if (!userId) return;
      try {
        buildSubmission(picked, form.elements.scope.value, form.elements.date.value, userId, crypto.randomUUID());
        const selection = selectionGeneration;
        previewURL = URL.createObjectURL(picked);
        const preview = form.querySelector('img');
        preview.onload = () => {
          if (selection !== selectionGeneration) return;
          file = picked; submit.disabled = false;
          showMessage('请检查预览，确认无误后上传。');
        };
        preview.onerror = () => {
          if (selection !== selectionGeneration) return;
          clearPreview(); showMessage('图片无法打开，请换用 JPG、PNG 或 WebP 照片。');
        };
        preview.src = previewURL; preview.hidden = false;
        showMessage('正在读取图片…');
      } catch (error) { showMessage(friendly(error)); }
    }));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !userId || !file) return;
      const captured = context();
      let record;
      try { record = buildSubmission(file, form.elements.scope.value, form.elements.date.value, userId, crypto.randomUUID()); }
      catch (error) { showMessage(friendly(error)); return; }
      setBusy(true); showMessage('正在上传，请勿关闭页面…');
      try {
        await savePhoto(client, record, file, () => current(captured));
        if (!current(captured)) return;
        clearPreview(); showMessage('已保存到云端，管理员可以查看。');
        await load();
      } catch (error) { if (current(captured)) showMessage(friendly(error)); }
      finally { if (current(captured)) setBusy(false); }
    });
  }

  function applySession(session) {
    const nextId = session?.user?.id || null;
    if (nextId !== userId) {
      generation++; loadGeneration++; userId = nextId;
      clearPreview(); clearList(); setBusy(false);
      showMessage(userId ? '' : '请先登录后提交或查看菜单照片。');
      refresh.disabled = !userId;
    }
    if (userId) setTimeout(() => { void load(); }, 0);
  }
  refresh.addEventListener('click', () => { void load(); });
  setBusy(false); refresh.disabled = true;
  showMessage('请先登录后提交或查看菜单照片。');
  if (!client) { showMessage('云端客户端未加载，请检查网络后刷新。'); return; }
  let authEventSeen = false;
  client.auth.onAuthStateChange((_event, session) => { authEventSeen = true; applySession(session); });
  client.auth.getSession().then(({ data, error }) => {
    if (error) showMessage(friendly(error));
    else if (!authEventSeen) applySession(data.session);
  }).catch(error => showMessage(friendly(error)));
})(typeof window === 'undefined' ? globalThis : window);
