'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { escapeHTML, normalizeMenuAssignment } = require('../js/menu-data.js');

test('云端训练周表与饮食说明可展示，清空时不保留上个账号的内容', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'fat-loss-dashboard.html'), 'utf8');
  const match = source.match(/      function renderPersonalPlanDetails\(version\) \{[\s\S]*?\n      \}/);
  assert.ok(match, '应有云端个人计划展示入口');
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', classList: { toggle() {} } });
    return elements.get(id);
  } };
  const sandbox = { document, escapeHTML };
  vm.runInNewContext(match[0] + '\nthis.render = renderPersonalPlanDetails;', sandbox);
  sandbox.render({ training_plan: { note: '训练说明', week: [{ title: '<img src=x>', note: '保留余力' }] }, nutrition_notes: '个人饮食建议', fiber_target: 28 });
  assert.match(document.getElementById('trainingWeek').innerHTML, /&lt;img src=x&gt;/);
  assert.doesNotMatch(document.getElementById('trainingWeek').innerHTML, /<img/);
  assert.equal((document.getElementById('trainingWeek').innerHTML.match(/class="training-day"/g) || []).length, 7);
  assert.equal(document.getElementById('personalNutritionAdvice').textContent, '个人饮食建议');
  assert.match(document.getElementById('nutritionFiber').textContent, /28/);
  sandbox.render(null);
  assert.doesNotMatch(document.getElementById('trainingWeek').innerHTML, /余力/);
  assert.equal(document.getElementById('personalNutritionAdvice').textContent, '');
  assert.equal(document.getElementById('trainingPlanNote').textContent, '');
  assert.equal(document.getElementById('nutritionFiber').textContent, '');
});

test('菜单保留管理员明确下发的选择和热量等级，无效等级不透传', () => {
  const meal = { type: '午餐', candidates: ['选项'], recommendation: 'preferred', energy_level: 'low', note: '少酱' };
  const parse = value => normalizeMenuAssignment({ menu_payload: { days: [{ date: '2026-10-19', meals: [value] }] } }).days[0].meals[0];
  assert.equal(parse(meal).recommendation, 'preferred');
  assert.equal(parse(meal).energyLevel, 'low');
  assert.equal(parse({ ...meal, energy_level: '<script>' }).energyLevel, undefined);
});

test('菜单卡片显示云端等级和建议，并转义菜名及说明', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'fat-loss-dashboard.html'), 'utf8');
  const match = source.match(/      function mealItemsMarkup\(meal\) \{[\s\S]*?\n      \}/);
  const sandbox = { escapeHTML };
  vm.runInNewContext(match[0] + '\nthis.render = mealItemsMarkup;', sandbox);
  const markup = sandbox.render({ items: ['<script>'], note: '<img>', recommendation: 'preferred', energyLevel: 'low' });
  assert.match(markup, /优先选择/);
  assert.match(markup, /相对热量较低/);
  assert.match(markup, /&lt;script&gt;/);
  assert.doesNotMatch(markup, /<img>/);
  const legacy = sandbox.render({ items: ['普通选项'], note: '' });
  assert.doesNotMatch(legacy, /优先选择|相对热量/);
});
