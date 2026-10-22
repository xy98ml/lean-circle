'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePlanTargets, validateImportedPlan } = require('../js/plan-engine.js');

test('Node require 导出模块且不污染 Node 全局对象', () => {
  assert.equal(typeof calculatePlanTargets, 'function');
  assert.equal(typeof validateImportedPlan, 'function');
  assert.equal(globalThis.FatLossPlanEngine, undefined);
});

test('82 kg、173 cm、29 岁男性得到视频公式与 BMR 下限共同约束的目标', () => {
  const targets = calculatePlanTargets({ weightKg: 82, heightCm: 173, age: 29, sex: 'male' });

  assert.deepEqual(targets, {
    weightLb: 180.4,
    videoCalories: 1984.4,
    bmr: 1761.25,
    caloriesCenter: 2000,
    caloriesMin: 1900,
    caloriesMax: 2100,
    proteinTarget: 145,
    proteinMin: 140,
    proteinMax: 150,
    fatTarget: 55,
    fatMin: 50,
    fatMax: 60,
    carbTarget: 230,
    carbMin: 220,
    carbMax: 240,
    fiberTarget: 28,
    calculationMethod: 'video_formula_with_bmr_floor'
  });
});

test('女性与其他性别使用各自的 Mifflin BMR 偏移量', () => {
  const female = calculatePlanTargets({ weightKg: 60, heightCm: 165, age: 30, sex: 'female' });
  const other = calculatePlanTargets({ weightKg: 60, heightCm: 165, age: 30, sex: 'other' });

  assert.equal(female.bmr, 1320.25);
  assert.equal(other.bmr, 1403.25);
});

test('视频公式低于 BMR 时热量下限仍不低于向上取整的 BMR', () => {
  const targets = calculatePlanTargets({ weightKg: 50, heightCm: 200, age: 18, sex: 'male' });

  assert.equal(targets.videoCalories, 1210);
  assert.equal(targets.bmr, 1665);
  assert.equal(targets.caloriesMin, 1665);
});

test('非整 50 的 BMR 不会让中心热量跌破安全下限或落在区间外', () => {
  const targets = calculatePlanTargets({ weightKg: 50, heightCm: 200.2, age: 18, sex: 'male' });

  assert.ok(targets.caloriesCenter >= Math.ceil(targets.bmr));
  assert.ok(targets.caloriesMin <= targets.caloriesCenter);
  assert.ok(targets.caloriesCenter <= targets.caloriesMax);
});

test('低体重女性仍遵守数据库 1000 kcal 下限且中心位于区间内', () => {
  const targets = calculatePlanTargets({ weightKg: 35, heightCm: 150, age: 29, sex: 'female' });

  assert.ok(targets.caloriesCenter >= 1000);
  assert.ok(targets.caloriesMin >= 1000);
  assert.ok(targets.caloriesMin <= targets.caloriesCenter);
  assert.ok(targets.caloriesCenter <= targets.caloriesMax);
});

test('取整后的宏量营养目标与中心热量保持近似守恒', () => {
  const targets = calculatePlanTargets({ weightKg: 82, heightCm: 173, age: 29, sex: 'male' });
  const macroCalories = (targets.proteinTarget * 4) + (targets.fatTarget * 9) + (targets.carbTarget * 4);

  assert.ok(Math.abs(macroCalories - targets.caloriesCenter) <= 10);
});

test('非法身体数据会明确抛错', () => {
  assert.throws(
    () => calculatePlanTargets({ weightKg: 0, heightCm: 173, age: 29, sex: 'male' }),
    /weightKg/
  );
  assert.throws(
    () => calculatePlanTargets({ weightKg: 82, heightCm: Number.NaN, age: 29, sex: 'male' }),
    /heightCm/
  );
  assert.throws(
    () => calculatePlanTargets({ weightKg: 82, heightCm: 173, age: -1, sex: 'male' }),
    /age/
  );
  assert.throws(
    () => calculatePlanTargets({ weightKg: 82, heightCm: 173, age: 29, sex: 'unknown' }),
    /sex/
  );
});

function validImportedPlan() {
  return {
    plan: {
      calories_min: 1900,
      calories_max: 2100,
      protein_min: 140,
      protein_max: 150,
      fat_min: 50,
      fat_max: 60,
      carb_min: 220,
      carb_max: 240,
      fiber_target: 28,
      steps_target: 8000,
      strength_days: 4,
      cardio_sessions: 2,
      cardio_minutes: 20,
      training_plan: { note: '一周四练' },
      nutrition_notes: '按餐盘结构安排饮食。',
      adjustment_reason: '依据当前体重和训练频率生成起始计划。'
    },
    menu_assignment: {
      period_start: '2026-10-26',
      period_end: '2026-11-01',
      days: [{ date: '2026-10-26', meals: [] }]
    }
  };
}

test('结构完整且不低于 BMR 的导入计划通过校验', () => {
  const result = validateImportedPlan(validImportedPlan(), { bmr: 1761.25 });

  assert.deepEqual(result, { valid: true, errors: [] });
});

test('空菜单数组允许只下发计划', () => {
  const imported = validImportedPlan();
  imported.menu_assignment.days = [];

  assert.deepEqual(validateImportedPlan(imported, { bmr: 1761.25 }), { valid: true, errors: [] });
});

test('导入校验逐字段报告类型、范围、区间、BMR、日期与必填内容错误', () => {
  const imported = validImportedPlan();
  imported.plan.calories_min = 1700;
  imported.plan.calories_max = 1600;
  imported.plan.protein_min = '140';
  imported.plan.fat_max = 500;
  imported.plan.adjustment_reason = '  ';
  imported.menu_assignment.period_end = '2026-10-01';
  imported.menu_assignment.days = [{ date: '2026-02-30', meals: [] }];

  const result = validateImportedPlan(imported, { bmr: 1761.25 });
  const fields = result.errors.map(error => error.field);

  assert.equal(result.valid, false);
  assert.ok(fields.includes('plan.calories_min'));
  assert.ok(fields.includes('plan.calories_max'));
  assert.ok(fields.includes('plan.protein_min'));
  assert.ok(fields.includes('plan.fat_max'));
  assert.ok(fields.includes('plan.adjustment_reason'));
  assert.ok(fields.includes('menu_assignment.period_end'));
  assert.ok(fields.includes('menu_assignment.days[0].date'));
  assert.equal(imported.plan.protein_min, '140', '校验器不能静默修正输入');
});

test('导入校验拒绝缺少根对象或 BMR 校验上下文', () => {
  const missingPayload = validateImportedPlan(null, { bmr: 1761.25 });
  const missingBmr = validateImportedPlan(validImportedPlan());

  assert.equal(missingPayload.valid, false);
  assert.ok(missingPayload.errors.some(error => error.field === 'payload'));
  assert.equal(missingBmr.valid, false);
  assert.ok(missingBmr.errors.some(error => error.field === 'bmr'));
});

