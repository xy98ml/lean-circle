(function (root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else if (root) {
    root.FatLossDashboardState = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function timestamp(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  }

  function mergeLogsByUpdatedAt(accountLogs, incomingLogs) {
    const merged = {};
    Object.entries(accountLogs || {}).forEach(([date, log]) => {
      if (log && typeof log === 'object' && !Array.isArray(log)) merged[date] = { ...log };
    });
    Object.entries(incomingLogs || {}).forEach(([date, log]) => {
      if (!log || typeof log !== 'object' || Array.isArray(log)) return;
      const current = merged[date];
      if (!current || timestamp(log._updatedAt) > timestamp(current._updatedAt)) {
        merged[date] = { ...log };
      }
    });
    return merged;
  }

  return { mergeLogsByUpdatedAt };
}));
