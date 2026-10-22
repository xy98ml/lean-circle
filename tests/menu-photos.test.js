'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../js/menu-photos.js');

const userId = '123e4567-e89b-42d3-a456-426614174000';
const id = '223e4567-e89b-42d3-a456-426614174000';
const image = (type = 'image/jpeg', size = 100) => ({ type, size });

test('单日照片生成用户私有的 JPG 对象路径', () => {
  assert.deepEqual(api.buildSubmission(image(), 'day', '2026-10-22', userId, id), {
    id, user_id: userId, scope: 'day', start_date: '2026-10-22', object_path: `${userId}/${id}.jpg`
  });
});

test('整周只接受周一；日期、类型、大小和用户 UUID 均校验', () => {
  assert.equal(api.buildSubmission(image('image/png'), 'week', '2026-10-19', userId, id).object_path, `${userId}/${id}.png`);
  for (const input of [
    [image(), 'week', '2026-10-20', userId, id],
    [image(), 'day', '2026-02-30', userId, id],
    [image('image/heic'), 'day', '2026-10-22', userId, id],
    [image('image/jpeg', 10 * 1024 * 1024 + 1), 'day', '2026-10-22', userId, id],
    [image(), 'day', '2026-10-22', 'other-user', id]
  ]) assert.throws(() => api.buildSubmission(...input));
});

test('私有桶只授权本人及有效邀请对应管理员读取照片', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase-menu-photos.sql'), 'utf8');
  assert.match(sql, /values \('menu-photos', 'menu-photos', false/);
  assert.match(sql, /m\.member_user_id = target_user_id/);
  assert.match(sql, /m\.admin_user_id = auth\.uid\(\) and m\.active/);
  assert.match(sql, /on storage\.objects for select to authenticated/);
  assert.doesNotMatch(sql, /on storage\.objects for select to anon/);
  assert.match(sql, /on storage\.objects for insert to authenticated/);
  assert.match(sql, /on public\.menu_photo_submissions for insert to authenticated/);
  assert.match(sql, /on storage\.objects for delete to authenticated[\s\S]*?not exists \(select 1 from public\.menu_photo_submissions/);
});

test('个人与管理员页面均加载独立菜单照片组件', () => {
  for (const [file, kind] of [['fat-loss-dashboard.html', 'member'], ['admin.html', 'admin']]) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(html, new RegExp(`data-menu-photos="${kind}"`));
    assert.match(html, /js\/menu-photos\.js/);
    assert.match(html, /css\/menu-photos\.css/);
  }
  const admin = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(admin, /data-view="menuPhotos"/);
});
