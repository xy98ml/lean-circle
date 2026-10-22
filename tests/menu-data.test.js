'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildMenuPayload,
  escapeHTML,
  normalizeMenuAssignment,
  parseIsoDate,
  selectMenuAssignment,
  splitCandidates
} = require('../js/menu-data.js');

test('菜单候选支持顿号、逗号和换行并清理空值', () => {
  assert.deepEqual(splitCandidates('选项 A、选项 B，\n选项 C,, '), ['选项 A', '选项 B', '选项 C']);
});

test('按周开始日期构造只包含已填写内容的七日菜单', () => {
  const payload = buildMenuPayload({
    weekStart: '2026-10-19',
    days: [
      { meals: { 早餐: { candidates: '选项 A、选项 B', note: '分量按计划' } } },
      { meals: {} },
      { meals: { 晚餐: { candidates: ['选项 C'], note: '' } } }
    ]
  });

  assert.equal(payload.schema_version, 1);
  assert.deepEqual(payload.days, [
    {
      date: '2026-10-19',
      label: '周一',
      meals: [{ type: '早餐', candidates: ['选项 A', '选项 B'], note: '分量按计划' }]
    },
    {
      date: '2026-10-21',
      label: '周三',
      meals: [{ type: '晚餐', candidates: ['选项 C'], note: '' }]
    }
  ]);
});

test('菜单构造拒绝非法日期和完全空白的候选菜', () => {
  assert.equal(parseIsoDate('2026-02-30'), null);
  assert.throws(() => buildMenuPayload({ weekStart: '2026-02-30', days: [] }), /日期/);
  assert.throws(() => buildMenuPayload({ weekStart: '2026-10-20', days: [] }), /周一/);
  assert.throws(() => buildMenuPayload({ weekStart: '2026-10-19', days: [{ meals: {} }] }), /至少填写/);
});

test('下发菜单解析兼容字符串、候选对象和空内容', () => {
  const assignment = normalizeMenuAssignment({
    id: 'assignment-id',
    version: 2,
    period_start: '2026-10-19',
    period_end: '2026-10-25',
    reason: '本周安排',
    menu_payload: {
      days: [{
        date: '2026-10-19',
        label: '训练日',
        meals: [
          '早餐方案',
          { type: '午餐', candidates: [{ name: '方案 A', portion: '一份' }, '方案 B'], note: '少量酱汁' },
          null
        ]
      }, { date: '2026-02-30', meals: ['无效日期'] }]
    }
  });

  assert.equal(assignment.days.length, 1);
  assert.deepEqual(assignment.days[0].meals[1], {
    type: '午餐',
    items: ['方案 A · 一份', '方案 B'],
    note: '少量酱汁'
  });
});

test('HTML 转义覆盖属性和正文危险字符', () => {
  assert.equal(escapeHTML(`<img src=x onerror='x'>&"`), '&lt;img src=x onerror=&#39;x&#39;&gt;&amp;&quot;');
});

test('下发菜单优先选择覆盖今天的周期，而不是单纯选择最近发布', () => {
  const selected = selectMenuAssignment([
    {
      id: 'future-latest', version: 3, period_start: '2026-10-26', period_end: '2026-11-01',
      published_at: '2026-10-20T12:00:00Z', menu_payload: { days: [] }
    },
    {
      id: 'covers-today', version: 2, period_start: '2026-10-19', period_end: '2026-10-25',
      published_at: '2026-10-19T12:00:00Z', menu_payload: { days: [] }
    }
  ], '2026-10-20');

  assert.equal(selected.id, 'covers-today');
});
