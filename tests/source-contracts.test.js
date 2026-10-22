'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

test('个人面板用会话 generation 阻止旧异步请求跨账号回写', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'fat-loss-dashboard.html'), 'utf8');
  assert.match(source, /sessionGeneration:\s*0/);
  assert.match(source, /context\.generation === state\.sessionGeneration/);
  assert.match(source, /state\.sessionGeneration \+= 1/);
  ['syncLog', 'deleteCloudLog', 'syncAll', 'loadMemberPlan', 'loadPrivateMenus'].forEach((name) => {
    const start = source.indexOf(`async function ${name}(`);
    const nextFunction = source.indexOf('\n      function ', start + 1);
    const nextAsyncFunction = source.indexOf('\n      async function ', start + 1);
    const endCandidates = [nextFunction, nextAsyncFunction].filter(index => index > start);
    const end = endCandidates.length ? Math.min(...endCandidates) : source.length;
    const body = source.slice(start, end);
    assert.notEqual(start, -1, `缺少 ${name}`);
    assert.match(body, /const context = sessionContext\(\)/, `${name} 必须固定会话上下文`);
    assert.match(body, /isCurrentSession\(context\)/, `${name} 必须丢弃旧会话结果`);
  });
});

test('入组仅调用带邀请令牌的原子 onboarding RPC', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'js/join.js'), 'utf8');
  assert.equal(source.includes("rpc('accept_coach_invite'"), false);
  assert.match(source, /rpc\('submit_member_onboarding'/);
  assert.match(source, /invite_token:\s*inviteToken/);
});
