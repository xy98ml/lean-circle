'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

test('公开成员页不包含首位用户的真实菜单、身体目标或具体饮品命名', () => {
  const dashboard = fs.readFileSync(path.join(projectRoot, 'fat-loss-dashboard.html'), 'utf8');
  const forbidden = [
    '82 → 77', '82.0', '83.0', '2200–2350', '140–150', '130 克蛋白质',
    '老干妈', '生椰拿铁', '珍珠奶茶', '小黄油', '麻爪爪',
    '辣子鸡', '魔芋烧鸭', '毛血旺', '藤椒鸡丝'
  ];

  forbidden.forEach(value => assert.equal(dashboard.includes(value), false, `不应公开包含：${value}`));
  assert.equal(dashboard.includes('偶尔一天只有 130 克蛋白质不用补偿'), false, '不得保留旧的个人化蛋白质文案');
  assert.equal(/\b(?:laoganma|chiliOil)\b/.test(dashboard), false, '字段 ID 也不得保留个人化命名');
});

test('入组页不再把整份健康问卷写入浏览器本地存储', () => {
  const joinScript = fs.readFileSync(path.join(projectRoot, 'js/join.js'), 'utf8');

  assert.equal(joinScript.includes('localStorage.setItem'), false);
  assert.equal(joinScript.includes('restoreDraft'), false);
  assert.match(joinScript, /localStorage\.removeItem\(`fatLoss\.onboardingDraft\.v1\.\$\{session\.user\.id\}`\)/);
});
