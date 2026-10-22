(function (root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else if (root) {
    root.FatLossPlanEngine = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function roundTo(value, step) {
    return Math.round(value / step) * step;
  }

  function roundUpTo(value, step) {
    return Math.ceil(value / step) * step;
  }

  function requirePositiveNumber(name, value) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`${name} 必须是大于 0 的有限数值`);
    }
  }

  function calculatePlanTargets(input) {
    if (!input || typeof input !== 'object') throw new TypeError('计划输入必须是对象');
    const { weightKg, heightCm, age, sex } = input;
    requirePositiveNumber('weightKg', weightKg);
    requirePositiveNumber('heightCm', heightCm);
    requirePositiveNumber('age', age);
    if (!['male', 'female', 'other'].includes(sex)) {
      throw new TypeError('sex 必须是 male、female 或 other');
    }

    const weightLb = weightKg * 2.2;
    const sexOffset = sex === 'male' ? 5 : sex === 'female' ? -161 : -78;
    const bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) + sexOffset;
    const videoCalories = weightLb * 11;
    const caloriesCenter = roundUpTo(Math.max(videoCalories, bmr, 1000), 50);
    const proteinTarget = roundTo(weightLb * 0.8, 5);
    const fatTarget = roundTo(weightLb * 0.3, 5);
    const carbTarget = roundTo((caloriesCenter - (proteinTarget * 4) - (fatTarget * 9)) / 4, 5);

    return {
      weightLb: Number(weightLb.toFixed(2)),
      videoCalories: Number(videoCalories.toFixed(2)),
      bmr: Number(bmr.toFixed(2)),
      caloriesCenter,
      caloriesMin: Math.max(1000, Math.ceil(bmr), caloriesCenter - 100),
      caloriesMax: caloriesCenter + 100,
      proteinTarget,
      proteinMin: proteinTarget - 5,
      proteinMax: proteinTarget + 5,
      fatTarget,
      fatMin: fatTarget - 5,
      fatMax: fatTarget + 5,
      carbTarget,
      carbMin: carbTarget - 10,
      carbMax: carbTarget + 10,
      fiberTarget: Math.round((caloriesCenter / 1000) * 14),
      calculationMethod: 'video_formula_with_bmr_floor'
    };
  }

  function validateImportedPlan(payload, options = {}) {
    const errors = [];
    const addError = (field, message) => errors.push({ field, message });

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      addError('payload', '导入内容必须是对象');
      return { valid: false, errors };
    }

    const bmr = options.bmr;
    if (!Number.isFinite(bmr) || bmr <= 0) addError('bmr', '校验计划时必须提供有效的 BMR');

    const plan = payload.plan;
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
      addError('plan', 'plan 必须是对象');
    } else {
      const numericRules = {
        calories_min: [1000, 6000],
        calories_max: [1000, 6500],
        protein_min: [30, 350],
        protein_max: [30, 400],
        fat_min: [20, 200],
        fat_max: [20, 250],
        carb_min: [0, 800],
        carb_max: [0, 900],
        fiber_target: [1, 100],
        steps_target: [1000, 50000],
        strength_days: [0, 7],
        cardio_sessions: [0, 14],
        cardio_minutes: [0, 300]
      };

      Object.entries(numericRules).forEach(([field, [minimum, maximum]]) => {
        const value = plan[field];
        if (!Number.isFinite(value)) {
          addError(`plan.${field}`, '必须是数值');
        } else if (!Number.isInteger(value) || value < minimum || value > maximum) {
          addError(`plan.${field}`, `必须是 ${minimum}–${maximum} 范围内的整数`);
        }
      });

      [
        ['calories_min', 'calories_max'],
        ['protein_min', 'protein_max'],
        ['fat_min', 'fat_max'],
        ['carb_min', 'carb_max']
      ].forEach(([minimumField, maximumField]) => {
        if (Number.isFinite(plan[minimumField]) && Number.isFinite(plan[maximumField])
          && plan[minimumField] > plan[maximumField]) {
          addError(`plan.${maximumField}`, `不能小于 ${minimumField}`);
        }
      });

      if (Number.isFinite(bmr) && Number.isFinite(plan.calories_min)
        && plan.calories_min < Math.ceil(bmr)) {
        addError('plan.calories_min', `不能低于 BMR 安全下限 ${Math.ceil(bmr)} kcal`);
      }

      const macroFields = ['protein_min', 'protein_max', 'fat_min', 'fat_max', 'carb_min', 'carb_max'];
      if (macroFields.every(field => Number.isFinite(plan[field]))
        && Number.isFinite(plan.calories_min) && Number.isFinite(plan.calories_max)) {
        const macroCenter = (((plan.protein_min + plan.protein_max) / 2) * 4)
          + (((plan.fat_min + plan.fat_max) / 2) * 9)
          + (((plan.carb_min + plan.carb_max) / 2) * 4);
        const calorieCenter = (plan.calories_min + plan.calories_max) / 2;
        if (Math.abs(macroCenter - calorieCenter) > Math.max(100, calorieCenter * 0.1)) {
          addError('plan.macros', '宏量营养换算热量与目标热量不一致');
        }
      }

      if (!plan.training_plan || typeof plan.training_plan !== 'object' || Array.isArray(plan.training_plan)) {
        addError('plan.training_plan', '必须是对象');
      }
      ['nutrition_notes', 'adjustment_reason'].forEach(field => {
        if (typeof plan[field] !== 'string' || !plan[field].trim()) {
          addError(`plan.${field}`, '不能为空');
        }
      });
    }

    const menu = payload.menu_assignment;
    if (!menu || typeof menu !== 'object' || Array.isArray(menu)) {
      addError('menu_assignment', 'menu_assignment 必须是对象');
    } else {
      const start = parseDate(menu.period_start);
      const end = parseDate(menu.period_end);
      if (!start) addError('menu_assignment.period_start', '必须是有效的 YYYY-MM-DD 日期');
      if (!end) addError('menu_assignment.period_end', '必须是有效的 YYYY-MM-DD 日期');
      if (start && end && end < start) addError('menu_assignment.period_end', '不能早于 period_start');

      if (!Array.isArray(menu.days)) {
        addError('menu_assignment.days', '必须是数组');
      } else {
        menu.days.forEach((day, index) => {
          if (!day || typeof day !== 'object' || Array.isArray(day)) {
            addError(`menu_assignment.days[${index}]`, '必须是对象');
            return;
          }
          if (!parseDate(day.date)) addError(`menu_assignment.days[${index}].date`, '必须是有效的 YYYY-MM-DD 日期');
          if (!Array.isArray(day.meals)) addError(`menu_assignment.days[${index}].meals`, '必须是数组');
        });
      }
    }

    return { valid: errors.length === 0, errors };
  }

  function parseDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date;
  }

  return { calculatePlanTargets, validateImportedPlan };
}));

