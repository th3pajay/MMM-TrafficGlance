const NodeHelper = require("node_helper");
// node:sqlite requires Node >=22.5; add --experimental-sqlite to MM start cmd if on Node 22.5-22.10
const { DatabaseSync } = require("node:sqlite");

module.exports = NodeHelper.create({
    start() {
        this.quotaExhausted = false;
        this.nextMidnightUTC = 0;
        this._busy = false;
        this._lastCleanup = 0;
    },

    stop() {
        if (this.intervalId) clearInterval(this.intervalId);
        if (this._midnightId) clearInterval(this._midnightId);
        this.db?.close?.();
    },

    _initDb() {
        this.db = new DatabaseSync(__dirname + "/traffic.db");
        const v = this.db.prepare("PRAGMA user_version").get().user_version;
        if (v < 1) {
            this.db.exec("DROP TABLE IF EXISTS traffic_history");
            this.db.exec("PRAGMA user_version=1");
        }
        this.db.exec("CREATE TABLE IF NOT EXISTS traffic_history(route_id TEXT,travel_time INTEGER,timestamp INTEGER)");
        this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_traffic_rt ON traffic_history(route_id,timestamp)");
        this.db.exec("DROP INDEX IF EXISTS idx_traffic_ts");
        this.db.exec("CREATE TABLE IF NOT EXISTS incident_history(route_id TEXT,timestamp INTEGER,category TEXT,magnitude INTEGER,delay_seconds INTEGER)");
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_incident_rt ON incident_history(route_id,timestamp)");
        this._ins = this.db.prepare("INSERT OR IGNORE INTO traffic_history VALUES(?,?,?)");
        this._sel = this.db.prepare("SELECT travel_time,timestamp FROM traffic_history WHERE route_id=? AND timestamp>=? ORDER BY timestamp DESC LIMIT ?");
        this._insIncident = this.db.prepare("INSERT INTO incident_history VALUES(?,?,?,?,?)");
        this._selIncident = this.db.prepare("SELECT timestamp,category,magnitude FROM incident_history WHERE route_id=? AND timestamp>=? ORDER BY timestamp");
    },

    _sparkline(routeId) {
        if (!this.db) return { points: [], baseline: null, stdDev: null, incidents: [] };
        const hours = this.config.sparkline?.lookbackHours ?? 48;
        const max = this.config.sparkline?.maxDataPoints ?? 50;
        const cutoff = Math.floor(Date.now() / 1000) - hours * 3600;
        const rows = this._sel.all(routeId, cutoff, max).reverse();
        if (!rows.length) return { points: [], baseline: null, stdDev: null, incidents: [] };
        const vals = rows.map(r => Math.round(r.travel_time / 60));
        const baseline = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
        const sd = Math.sqrt(vals.reduce((s, v) => s + (v - baseline) ** 2, 0) / vals.length);
        const timestamps = rows.map(r => r.timestamp);
        const severity = { ROAD_CLOSURE: 3, JAM: 2, ROAD_WORK: 1, OTHER: 0 };
        const byPoint = new Map();
        for (const inc of this._selIncident.all(routeId, cutoff)) {
            let nearest = 0, best = Infinity;
            for (let i = 0; i < timestamps.length; i++) {
                const d = Math.abs(timestamps[i] - inc.timestamp);
                if (d < best) { best = d; nearest = i; }
            }
            const rank = severity[inc.category] ?? 0;
            const existing = byPoint.get(nearest);
            if (!existing || rank > existing.rank) byPoint.set(nearest, { pointIndex: nearest, category: inc.category, magnitude: inc.magnitude, timestamp: inc.timestamp, rank });
        }
        return {
            points: rows.map((r, i) => ({ timestamp: r.timestamp, value: vals[i], zScore: sd > 0 ? (vals[i] - baseline) / sd : 0 })),
            baseline,
            stdDev: sd,
            incidents: [...byPoint.values()].map(({ pointIndex, category, magnitude, timestamp }) => ({ pointIndex, category, magnitude, timestamp }))
        };
    },

    async _fetch(route) {
        const api = this.config.api ?? {};
        const avoid = [api.avoidTolls && "tollRoads", api.avoidHighways && "motorways"].filter(Boolean).join(",");
        const params = {
            key: this.config.apiKey, traffic: api.traffic !== false, departAt: "now",
            routeType: api.routeType ?? "fastest", computeTravelTimeFor: "all",
            routeRepresentation: "polyline", sectionType: "traffic", travelMode: api.travelMode ?? "car"
        };
        if (avoid) params.avoid = avoid;
        const origin = String(route.origin).replace(/\s+/g, "");
        const dest = String(route.destination).replace(/\s+/g, "");
        const res = await fetch(
            `https://api.tomtom.com/routing/1/calculateRoute/${origin}:${dest}/json?${new URLSearchParams(params)}`,
            { signal: AbortSignal.timeout(api.timeout ?? 10000) }
        );
        if (res.status === 429) throw Object.assign(new Error("quota"), { quota: true });
        if (res.status === 403) {
            const body = await res.json().catch(() => ({}));
            if (body?.detailedError?.code === "APP_QUOTA_EXCEEDED") throw Object.assign(new Error("quota"), { quota: true });
            throw Object.assign(new Error("auth"), { auth: true });
        }
        if (!res.ok) throw new Error(res.statusText);
        const json = await res.json();
        const r = json.routes?.[0];
        if (!r) return null;
        const s = r.summary;
        const polyline = r.legs?.flatMap(leg => leg.points) ?? [];
        const now = Math.floor(Date.now() / 1000);
        if (this.db) this._ins.run(route.id, s.travelTimeInSeconds, now);
        const live = Math.round(s.travelTimeInSeconds / 60);
        const hist = Math.round(s.historicTrafficTravelTimeInSeconds / 60);
        const ntt = s.noTrafficTravelTimeInSeconds;
        const incidents = !api.incidents ? [] : (r.sections ?? [])
            .filter(x => x.sectionType === "TRAFFIC" && x.delayInSeconds > 30)
            .filter(x => !api.incidentCategories || api.incidentCategories.includes(x.simpleCategory))
            .map(({ startPointIndex, endPointIndex, magnitudeOfDelay: magnitude, simpleCategory: category, delayInSeconds: delaySeconds }) =>
                ({ startPointIndex, endPointIndex, magnitude, category, delaySeconds }));
        if (this.db) for (const inc of incidents) this._insIncident.run(route.id, now, inc.category, inc.magnitude, inc.delaySeconds);
        return {
            id: route.id, name: route.name,
            currentDuration: live, historicalAverage: hist,
            delayFactor: ntt > 0 ? s.travelTimeInSeconds / ntt : 1,
            trendDirection: live > hist ? "up" : live < hist ? "down" : "stable",
            incidents,
            polyline,
            sparklineData: this._sparkline(route.id)
        };
    },

    async _update() {
        if (!this.config || this.quotaExhausted || this._busy) return;
        if (!Array.isArray(this.config.routes) || !this.config.routes.length) {
            this.sendSocketNotification("FETCH_ERROR", { category: "config" });
            return;
        }
        this._busy = true;
        const now = Date.now();
        if (this.db && now - this._lastCleanup > 86400000) {
            const cutoff = Math.floor(now / 1000) - 90 * 86400;
            this.db.prepare("DELETE FROM traffic_history WHERE timestamp<?").run(cutoff);
            this.db.prepare("DELETE FROM incident_history WHERE timestamp<?").run(cutoff);
            this._lastCleanup = now;
        }
        try {
            const results = await Promise.all(
                this.config.routes.map(r => this._fetch(r).catch(e => {
                    if (e.quota || e.auth) throw e;
                    console.warn(`[MMM-TrafficGlance] fetch failed for route "${r.id ?? r.name}":`, e.message);
                    return null;
                }))
            );
            const routes = results.filter(Boolean);
            this.sendSocketNotification(routes.length ? "TRAFFIC_UPDATE" : "FETCH_ERROR",
                routes.length ? routes : { category: "network" });
        } catch (e) {
            if (e.auth) {
                this.sendSocketNotification("FETCH_ERROR", { category: "auth" });
                return;
            }
            this.quotaExhausted = true;
            const m = new Date(); m.setUTCHours(24, 0, 0, 0);
            this.nextMidnightUTC = m.getTime();
            this.sendSocketNotification("QUOTA_EXHAUSTED", { nextResetTime: this.nextMidnightUTC });
            if (this._midnightId) clearInterval(this._midnightId);
            this._midnightId = setInterval(() => {
                if (Date.now() < this.nextMidnightUTC) return;
                clearInterval(this._midnightId); this._midnightId = null;
                this.quotaExhausted = false;
                this.sendSocketNotification("QUOTA_RESTORED", {});
                this._update();
            }, 60000);
        } finally { this._busy = false; }
    },

    socketNotificationReceived(notification, payload) {
        if (notification !== "CONFIG") return;
        if (this.intervalId) clearInterval(this.intervalId);
        this.config = payload;
        if (!this.db) try { this._initDb(); } catch { this.db = null; }
        this._update();
        const interval = Math.max(60000, this.config.updateInterval ?? 300000);
        this.intervalId = setInterval(() => this._update(), interval);
    }
});
