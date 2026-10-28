"use strict";

const { DatabaseSync } = require("node:sqlite");
const { INCIDENT_SEVERITY } = require("./configNormalizer");

const SCHEMA_VERSION = 2;
const DAY_SEC = 86400;
const SLOT_MINUTES = 15;
const BASELINE_WEEKS = 8;
const MIN_BASELINE_DAYS = 3;
const SPAN_GAP_SEC = 1800;
const SPAN_POSITION_TOLERANCE = 0.1;
const RAW_RETENTION_SEC = 7 * DAY_SEC;
const SLOT_RETENTION_SEC = (BASELINE_WEEKS * 7 + 1) * DAY_SEC;
const CALL_RETENTION_SEC = 62 * DAY_SEC;
const EMPTY_SPARKLINE = Object.freeze({ points: [], baseline: null, stdDev: null, incidents: [] });

const nowSec = () => Math.floor(Date.now() / 1000);
const localDayKey = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const utcDayKey = d => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();

function routeKey(route, api = {}) {
    const clean = v => String(v ?? "").replace(/\s+/g, "");
    return [
        clean(route.origin), clean(route.destination),
        api.travelMode ?? "car", api.routeType ?? "fastest",
        [...(api.avoid ?? [])].sort().join("+"),
        api.traffic === false ? "notraffic" : "traffic"
    ].join("|");
}

function slotOf(ts) {
    const d = new Date(ts * 1000);
    return { dow: d.getDay(), slot: Math.floor((d.getHours() * 60 + d.getMinutes()) / SLOT_MINUTES), day: localDayKey(d) };
}

function median(values) {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b), mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function createSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS samples(route_key TEXT NOT NULL, ts INTEGER NOT NULL, travel_time INTEGER NOT NULL,
            PRIMARY KEY(route_key, ts)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS slot_daily(route_key TEXT NOT NULL, dow INTEGER NOT NULL, slot INTEGER NOT NULL,
            day INTEGER NOT NULL, sum INTEGER NOT NULL, n INTEGER NOT NULL,
            PRIMARY KEY(route_key, dow, slot, day)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS incidents(id INTEGER PRIMARY KEY, route_key TEXT NOT NULL, category TEXT NOT NULL,
            magnitude INTEGER NOT NULL, position REAL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
            max_delay INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_incidents_route_seen ON incidents(route_key, last_seen);
        CREATE TABLE IF NOT EXISTS api_calls(day INTEGER PRIMARY KEY, n INTEGER NOT NULL) WITHOUT ROWID;
    `);
}

class TrafficStore {
    static open(path, { legacyKeys = new Map(), now = nowSec() } = {}) {
        const db = new DatabaseSync(path);
        db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL");
        createSchema(db);
        const store = new TrafficStore(db);
        store._migrate(legacyKeys, now);
        return store;
    }

    constructor(db) {
        this.db = db;
        const q = sql => db.prepare(sql);
        this._q = {
            insSample: q("INSERT OR IGNORE INTO samples(route_key, ts, travel_time) VALUES(?, ?, ?)"),
            upsertSlot: q(`INSERT INTO slot_daily(route_key, dow, slot, day, sum, n) VALUES(?, ?, ?, ?, ?, 1)
                ON CONFLICT(route_key, dow, slot, day) DO UPDATE SET sum = sum + excluded.sum, n = n + 1`),
            slotDays: q(`SELECT SUM(sum) * 1.0 / SUM(n) v FROM slot_daily
                WHERE route_key = ? AND dow = ? AND slot BETWEEN ? AND ? AND day < ?
                GROUP BY day ORDER BY day DESC LIMIT ?`),
            recent: q("SELECT travel_time FROM samples WHERE route_key = ? ORDER BY ts DESC LIMIT ?"),
            buckets: q(`SELECT CAST(AVG(ts) AS INTEGER) ts, AVG(travel_time) travel_time FROM samples
                WHERE route_key = ? AND ts >= ? GROUP BY CAST((ts - ?) / ? AS INTEGER) ORDER BY ts`),
            openSpans: q("SELECT id, category, position FROM incidents WHERE route_key = ? AND last_seen >= ?"),
            insSpan: q(`INSERT INTO incidents(route_key, category, magnitude, position, first_seen, last_seen, max_delay)
                VALUES(?, ?, ?, ?, ?, ?, ?)`),
            extendSpan: q(`UPDATE incidents SET last_seen = ?, magnitude = MAX(magnitude, ?), max_delay = MAX(max_delay, ?),
                position = COALESCE(?, position) WHERE id = ?`),
            spansSince: q("SELECT category, magnitude, first_seen FROM incidents WHERE route_key = ? AND last_seen >= ?"),
            countCall: q("INSERT INTO api_calls(day, n) VALUES(?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1"),
            addCalls: q("INSERT INTO api_calls(day, n) VALUES(?, ?) ON CONFLICT(day) DO UPDATE SET n = n + excluded.n"),
            callsSince: q("SELECT COALESCE(SUM(n), 0) n FROM api_calls WHERE day >= ?"),
            pruneSamples: q("DELETE FROM samples WHERE ts < ?"),
            pruneIncidents: q("DELETE FROM incidents WHERE last_seen < ?"),
            pruneSlots: q("DELETE FROM slot_daily WHERE day < ?"),
            pruneCalls: q("DELETE FROM api_calls WHERE day < ?")
        };
    }

    close() {
        this.db.close();
    }

    recordCall(ts = nowSec()) {
        this._q.countCall.run(utcDayKey(new Date(ts * 1000)));
    }

    callsThisMonth(nowMs = Date.now()) {
        const d = new Date(nowMs);
        return this._q.callsSince.get(d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + 1).n;
    }

    record(key, travelTime, incidents = [], ts = nowSec()) {
        this._tx(() => {
            this._addSample(key, travelTime, ts);
            this._trackIncidents(key, incidents, ts);
        });
    }

    usualAt(key, ts = nowSec()) {
        const { dow, slot, day } = slotOf(ts);
        const days = (from, to) => this._q.slotDays.all(key, dow, from, to, day, BASELINE_WEEKS).map(r => r.v);
        let values = days(slot, slot);
        if (values.length < MIN_BASELINE_DAYS) values = days(slot - 1, slot + 1);
        return values.length >= MIN_BASELINE_DAYS ? median(values) : null;
    }

    recent(key, count) {
        return this._q.recent.all(key, count).map(r => r.travel_time).reverse();
    }

    sparkline(key, { lookbackHours = 48, maxDataPoints = 50 } = {}, now = nowSec()) {
        const from = now - Math.round(lookbackHours * 3600);
        const bucket = Math.max(1, Math.ceil((now - from) / Math.max(1, maxDataPoints)));
        const rows = this._q.buckets.all(key, from, from, bucket);
        if (!rows.length) return { ...EMPTY_SPARKLINE };
        const values = rows.map(r => Math.round(r.travel_time / 60));
        const usualBySlot = new Map();
        const usualOf = ts => {
            const { day, slot } = slotOf(ts), k = day * 100 + slot;
            if (!usualBySlot.has(k)) usualBySlot.set(k, this.usualAt(key, ts));
            return usualBySlot.get(k);
        };
        const usuals = rows.map(r => {
            const u = usualOf(r.ts);
            return u == null ? null : Math.round(u / 60);
        });
        const baseline = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
        const stdDev = Math.sqrt(values.reduce((s, v) => s + (v - baseline) ** 2, 0) / values.length);
        return {
            points: rows.map((r, i) => ({
                timestamp: r.ts, value: values[i], usual: usuals[i],
                zScore: stdDev > 0 ? (values[i] - (usuals[i] ?? baseline)) / stdDev : 0
            })),
            baseline,
            stdDev,
            incidents: this._incidentMarkers(key, rows, rows[0].ts - bucket)
        };
    }

    prune({ lookbackHours = 48, now = nowSec() } = {}) {
        const rawCutoff = now - Math.max(RAW_RETENTION_SEC, Math.ceil(lookbackHours * 3600) + 3600);
        this._tx(() => {
            this._q.pruneSamples.run(rawCutoff);
            this._q.pruneIncidents.run(rawCutoff);
            this._q.pruneSlots.run(localDayKey(new Date((now - SLOT_RETENTION_SEC) * 1000)));
            this._q.pruneCalls.run(utcDayKey(new Date((now - CALL_RETENTION_SEC) * 1000)));
        });
    }

    _incidentMarkers(key, rows, since) {
        const byPoint = new Map();
        for (const span of this._q.spansSince.all(key, since)) {
            const onset = Math.max(span.first_seen, rows[0].ts);
            let nearest = 0, best = Infinity;
            for (let i = 0; i < rows.length; i++) {
                const d = Math.abs(rows[i].ts - onset);
                if (d < best) { best = d; nearest = i; }
            }
            const rank = INCIDENT_SEVERITY[span.category] ?? 0;
            const existing = byPoint.get(nearest);
            if (!existing || rank > existing.rank) {
                byPoint.set(nearest, { pointIndex: nearest, category: span.category, magnitude: span.magnitude, timestamp: span.first_seen, rank });
            }
        }
        return [...byPoint.values()].map(({ rank, ...marker }) => marker);
    }

    _addSample(key, travelTime, ts) {
        if (!this._q.insSample.run(key, ts, travelTime).changes) return;
        const { dow, slot, day } = slotOf(ts);
        this._q.upsertSlot.run(key, dow, slot, day, travelTime);
    }

    _trackIncidents(key, incidents, ts) {
        const open = this._q.openSpans.all(key, ts - SPAN_GAP_SEC);
        const used = new Set();
        for (const inc of incidents) {
            const position = inc.position ?? null;
            const match = open.find(s => !used.has(s.id) && s.category === inc.category
                && (s.position == null || position == null || Math.abs(s.position - position) <= SPAN_POSITION_TOLERANCE));
            if (match) {
                used.add(match.id);
                this._q.extendSpan.run(ts, inc.magnitude ?? 0, inc.delaySeconds ?? 0, position, match.id);
            } else {
                this._q.insSpan.run(key, inc.category, inc.magnitude ?? 0, position, ts, ts, inc.delaySeconds ?? 0);
            }
        }
    }

    _migrate(legacyKeys, now) {
        const version = this.db.prepare("PRAGMA user_version").get().user_version;
        if (version >= SCHEMA_VERSION) return;
        const hasTable = name => !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
        this._tx(() => {
            if (hasTable("traffic_history")) {
                this._backfillSamples(legacyKeys, now);
                this.db.exec("DROP TABLE traffic_history");
            }
            if (hasTable("incident_history")) {
                this._backfillIncidents(legacyKeys, now);
                this.db.exec("DROP TABLE incident_history");
            }
            this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
        });
    }

    _backfillSamples(legacyKeys, now) {
        const calls = new Map();
        const rows = this.db.prepare("SELECT route_id, travel_time, timestamp FROM traffic_history ORDER BY timestamp").all();
        for (const { route_id: id, travel_time: travelTime, timestamp: ts } of rows) {
            if (ts >= now - CALL_RETENTION_SEC) {
                const day = utcDayKey(new Date(ts * 1000));
                calls.set(day, (calls.get(day) ?? 0) + 1);
            }
            const key = legacyKeys.get(id);
            if (!key || ts < now - SLOT_RETENTION_SEC || !(travelTime > 0)) continue;
            this._addSample(key, travelTime, ts);
        }
        for (const [day, n] of calls) this._q.addCalls.run(day, n);
    }

    _backfillIncidents(legacyKeys, now) {
        const rows = this.db.prepare(`SELECT route_id, timestamp, category, magnitude, delay_seconds FROM incident_history
            WHERE timestamp >= ? ORDER BY route_id, category, timestamp`).all(now - RAW_RETENTION_SEC);
        let span = null;
        const flush = () => {
            if (span) this._q.insSpan.run(span.key, span.category, span.magnitude, null, span.first, span.last, span.delay);
            span = null;
        };
        for (const r of rows) {
            const key = legacyKeys.get(r.route_id);
            if (!key) continue;
            const continues = span && span.key === key && span.category === r.category && r.timestamp - span.last <= SPAN_GAP_SEC;
            if (!continues) {
                flush();
                span = { key, category: r.category, magnitude: 0, delay: 0, first: r.timestamp, last: r.timestamp };
            }
            span.last = r.timestamp;
            span.magnitude = Math.max(span.magnitude, r.magnitude ?? 0);
            span.delay = Math.max(span.delay, r.delay_seconds ?? 0);
        }
        flush();
    }

    _tx(fn) {
        if (this._inTx) return fn();
        this._inTx = true;
        this.db.exec("BEGIN");
        try {
            const result = fn();
            this.db.exec("COMMIT");
            return result;
        } catch (e) {
            this.db.exec("ROLLBACK");
            throw e;
        } finally {
            this._inTx = false;
        }
    }
}

module.exports = { TrafficStore, routeKey, slotOf, median };
