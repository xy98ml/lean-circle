'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeLogsByUpdatedAt } = require('../js/dashboard-state.js');

test('日志合并按 _updatedAt 选择较新版本，并保留两边独有日期', () => {
  const account = {
    '2026-10-19': { weight: 81, _updatedAt: '2026-10-19T09:00:00Z' },
    '2026-10-18': { weight: 82, _updatedAt: '2026-10-18T09:00:00Z' }
  };
  const anonymous = {
    '2026-10-19': { weight: 80.8, _updatedAt: '2026-10-19T10:00:00Z' },
    '2026-10-20': { weight: 80.5, _updatedAt: '2026-10-20T09:00:00Z' }
  };

  const merged = mergeLogsByUpdatedAt(account, anonymous);

  assert.equal(merged['2026-10-19'].weight, 80.8);
  assert.equal(merged['2026-10-18'].weight, 82);
  assert.equal(merged['2026-10-20'].weight, 80.5);
  assert.notEqual(merged['2026-10-19'], anonymous['2026-10-19']);
});

test('时间相同或都缺失时保留账号内已有记录', () => {
  const account = { '2026-10-19': { weight: 81 } };
  const anonymous = { '2026-10-19': { weight: 79 } };
  assert.equal(mergeLogsByUpdatedAt(account, anonymous)['2026-10-19'].weight, 81);
});

test('已登录但尚无计划时使用计划状态文案，而不是登录提示', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'fat-loss-dashboard.html'), 'utf8');
  assert.match(source, /document\.getElementById\('hero-title'\)\.textContent = request && \['pending', 'designing'\]\.includes\(request\.status\)[\s\S]{0,100}'尚未下发个人计划'/);
  assert.match(source, /document\.getElementById\('hero-title'\)\.textContent = version\.goal_weight_kg[\s\S]{0,100}'个人计划已就绪'/);
});
