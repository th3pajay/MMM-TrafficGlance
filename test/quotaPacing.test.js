"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computePacedIntervalMs, resolvePacedIntervalMs, DAY_MS } = require("../quotaPacing");

test("reproduces early exhaustion under the old fixed-interval behavior", () => {
    const quota = 20000;
    const routesCount = 2;
    const fixedIntervalMs = 180000;
    const callsPerDay = routesCount * (DAY_MS / fixedIntervalMs);
    const daysToExhaust = quota / callsPerDay;
    assert.ok(daysToExhaust < 24, `expected exhaustion before day 24, got day ${daysToExhaust}`);
});

test("paces out to roughly last the full month when budget is fresh", () => {
    const now = Date.UTC(2026, 8, 1, 0, 0, 0); // Sep 1, UTC month start
    const intervalMs = computePacedIntervalMs({
        quota: 20000,
        callsThisMonth: 0,
        routesCount: 2,
        now,
        configuredIntervalMs: 180000
    });
    const callsPerDay = 2 * (DAY_MS / intervalMs);
    const daysToExhaust = 20000 / callsPerDay;
    assert.ok(daysToExhaust >= 29, `expected pacing to cover ~30 days, got ${daysToExhaust}`);
});

test("never paces faster than the user-configured interval", () => {
    const now = Date.UTC(2026, 8, 1, 0, 0, 0);
    const intervalMs = computePacedIntervalMs({
        quota: 20000,
        callsThisMonth: 0,
        routesCount: 1,
        now,
        configuredIntervalMs: 300000
    });
    assert.ok(intervalMs >= 300000, `expected interval >= configured 300000, got ${intervalMs}`);
});

test("slows down sharply once most of the monthly budget is already spent", () => {
    const now = Date.UTC(2026, 8, 20, 0, 0, 0); // 10 days left in Sep
    const intervalMs = computePacedIntervalMs({
        quota: 20000,
        callsThisMonth: 19500, // only 500 calls left, 10 days remaining
        routesCount: 2,
        now,
        configuredIntervalMs: 180000
    });
    const callsPerDay = 2 * (DAY_MS / intervalMs);
    assert.ok(callsPerDay <= 50, `expected throttling to ~50 calls/day, got ${callsPerDay}`);
});

test("caps the interval instead of stalling forever when quota is fully spent", () => {
    const now = Date.UTC(2026, 8, 20, 0, 0, 0);
    const intervalMs = computePacedIntervalMs({
        quota: 20000,
        callsThisMonth: 20000,
        routesCount: 2,
        now,
        configuredIntervalMs: 180000
    });
    assert.equal(intervalMs, DAY_MS);
});

test("resolvePacedIntervalMs paces by default when api config is undefined", () => {
    const now = Date.UTC(2026, 8, 1, 0, 0, 0);
    const result = resolvePacedIntervalMs(undefined, { routesCount: 2, callsThisMonth: 0, now, configuredIntervalMs: 180000 });
    assert.ok(result !== null && result > 180000, `expected pacing to kick in by default, got ${result}`);
});

test("resolvePacedIntervalMs returns null (use updateInterval as-is) when adaptivePacing is false", () => {
    const now = Date.UTC(2026, 8, 1, 0, 0, 0);
    const result = resolvePacedIntervalMs({ adaptivePacing: false }, { routesCount: 2, callsThisMonth: 0, now, configuredIntervalMs: 180000 });
    assert.equal(result, null);
});

test("resolvePacedIntervalMs honors a custom monthlyQuota", () => {
    const now = Date.UTC(2026, 8, 1, 0, 0, 0);
    const generous = resolvePacedIntervalMs({ monthlyQuota: 200000 }, { routesCount: 2, callsThisMonth: 0, now, configuredIntervalMs: 180000 });
    assert.equal(generous, 180000, "ample quota should not stretch past the configured interval");
});
