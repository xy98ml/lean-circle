(function (root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else if (root) {
    root.FatLossMenuData = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MEAL_TYPES = Object.freeze(['早餐', '午餐', '晚餐']);
  const DAY_LABELS = Object.freeze(['周一', '周二', '周三', '周四', '周五', '周六', '周日']);

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
  }

  function parseIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date;
  }

  function addDays(dateKey, offset) {
    const date = parseIsoDate(dateKey);
    if (!date) throw new TypeError('weekStart 必须是有效的 YYYY-MM-DD 日期');
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }

  function splitCandidates(value) {
    if (Array.isArray(value)) {
      return value.map(item => String(item ?? '').trim()).filter(Boolean);
    }
    return String(value ?? '').split(/[、，,\n]+/).map(item => item.trim()).filter(Boolean);
  }

  function buildMenuPayload({ weekStart, days } = {}) {
    const parsedWeekStart = parseIsoDate(weekStart);
    if (!parsedWeekStart) throw new TypeError('请选择有效的周开始日期');
    if (parsedWeekStart.getUTCDay() !== 1) throw new TypeError('周开始日期请选择周一');
    if (!Array.isArray(days)) throw new TypeError('菜单天数必须是数组');

    const normalizedDays = days.slice(0, 7).map((day, dayIndex) => {
      const meals = MEAL_TYPES.map(type => {
        const rawMeal = day?.meals?.[type] || {};
        const candidates = splitCandidates(rawMeal.candidates);
        const note = String(rawMeal.note ?? '').trim();
        return candidates.length || note ? { type, candidates, note } : null;
      }).filter(Boolean);
      if (!meals.length) return null;
      return {
        date: addDays(weekStart, dayIndex),
        label: DAY_LABELS[dayIndex],
        meals
      };
    }).filter(Boolean);

    if (!normalizedDays.some(day => day.meals.some(meal => meal.candidates.length))) {
      throw new TypeError('请至少填写一个候选菜');
    }

    return { schema_version: 1, days: normalizedDays };
  }

  function candidateText(candidate) {
    if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate).trim();
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return '';
    const name = candidate.text ?? candidate.name ?? candidate.dish ?? candidate.title ?? '';
    const portion = candidate.portion ?? candidate.portion_note ?? candidate.note ?? '';
    return [name, portion].map(value => String(value ?? '').trim()).filter(Boolean).join(' · ');
  }

  function normalizeMeal(meal, index) {
    if (typeof meal === 'string') {
      const text = meal.trim();
      return text ? { type: `餐次 ${index + 1}`, items: [text], note: '' } : null;
    }
    if (!meal || typeof meal !== 'object' || Array.isArray(meal)) return null;
    const type = String(meal.type ?? meal.label ?? meal.name ?? `餐次 ${index + 1}`).trim();
    const rawItems = meal.candidates ?? meal.items ?? meal.dishes ?? meal.foods ?? [];
    const sourceItems = Array.isArray(rawItems) ? rawItems : splitCandidates(rawItems);
    const items = sourceItems.map(candidateText).filter(Boolean);
    const note = String(meal.note ?? meal.portion_note ?? meal.portion ?? '').trim();
    if (!items.length && !note) return null;
    return {
      type: type || `餐次 ${index + 1}`, items, note,
      ...(['preferred', 'acceptable', 'caution'].includes(meal.recommendation) ? { recommendation: meal.recommendation } : {}),
      ...(['low', 'medium', 'high'].includes(meal.energy_level) ? { energyLevel: meal.energy_level } : {})
    };
  }

  function normalizeMenuAssignment(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const payload = row.menu_payload && typeof row.menu_payload === 'object' ? row.menu_payload : row;
    const periodStart = String(row.period_start ?? payload.period_start ?? '').trim();
    const periodEnd = String(row.period_end ?? payload.period_end ?? '').trim();
    const rawDays = Array.isArray(payload.days) ? payload.days : [];
    const days = rawDays.map((day, index) => {
      if (!day || typeof day !== 'object' || Array.isArray(day)) return null;
      const date = String(day.date ?? '').trim();
      const meals = (Array.isArray(day.meals) ? day.meals : [])
        .map(normalizeMeal)
        .filter(Boolean);
      if (!parseIsoDate(date) || !meals.length) return null;
      return {
        date,
        label: String(day.label ?? DAY_LABELS[index] ?? `第 ${index + 1} 天`).trim(),
        meals
      };
    }).filter(Boolean).sort((left, right) => left.date.localeCompare(right.date));

    return {
      id: row.id || null,
      version: Number(row.version) || null,
      periodStart: parseIsoDate(periodStart) ? periodStart : (days[0]?.date || ''),
      periodEnd: parseIsoDate(periodEnd) ? periodEnd : (days.at(-1)?.date || ''),
      reason: String(row.reason ?? payload.reason ?? '').trim(),
      publishedAt: String(row.published_at ?? '').trim(),
      days
    };
  }

  function selectMenuAssignment(rows, today) {
    const currentDate = parseIsoDate(today);
    const assignments = (Array.isArray(rows) ? rows : [])
      .map(normalizeMenuAssignment)
      .filter(Boolean);
    assignments.sort((left, right) => {
      const leftCurrent = currentDate && parseIsoDate(left.periodStart) && parseIsoDate(left.periodEnd)
        && left.periodStart <= today && today <= left.periodEnd;
      const rightCurrent = currentDate && parseIsoDate(right.periodStart) && parseIsoDate(right.periodEnd)
        && right.periodStart <= today && today <= right.periodEnd;
      if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
      const publishedDifference = Date.parse(right.publishedAt || '') - Date.parse(left.publishedAt || '');
      if (Number.isFinite(publishedDifference) && publishedDifference !== 0) return publishedDifference;
      return (right.version || 0) - (left.version || 0);
    });
    return assignments[0] || null;
  }

  return {
    DAY_LABELS,
    MEAL_TYPES,
    addDays,
    buildMenuPayload,
    escapeHTML,
    normalizeMenuAssignment,
    parseIsoDate,
    selectMenuAssignment,
    splitCandidates
  };
}));
