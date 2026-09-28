"use strict";

const DAY_MS = 86400000;

function startOfUtcMonth(date) {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function startOfNextUtcMonth(date) {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function computePacedIntervalMs({
    quota,
    callsThisMonth,
    routesCount,
    now = Date.now(),
    configuredIntervalMs,
    minIntervalMs = 60000,
    maxIntervalMs = DAY_MS
}) {
    const remainingQuota = Math.max(0, quota - callsThisMonth);
    const daysRemaining = Math.max((startOfNextUtcMonth(new Date(now)) - now) / DAY_MS, 1 / 24);
    const callsPerDayBudget = remainingQuota / daysRemaining;
    const cycleIntervalMs = callsPerDayBudget > 0
        ? (DAY_MS * routesCount) / callsPerDayBudget
        : maxIntervalMs;
    return Math.min(maxIntervalMs, Math.max(configuredIntervalMs, minIntervalMs, cycleIntervalMs));
}

function resolvePacedIntervalMs(apiConfig, { routesCount, callsThisMonth, now, configuredIntervalMs }) {
    const adaptive = apiConfig?.adaptivePacing !== false;
    const quota = apiConfig?.monthlyQuota ?? 20000;
    if (!adaptive || !quota || !routesCount) return null;
    return computePacedIntervalMs({ quota, callsThisMonth, routesCount, now, configuredIntervalMs });
}

module.exports = { computePacedIntervalMs, resolvePacedIntervalMs, startOfUtcMonth, startOfNextUtcMonth, DAY_MS };
