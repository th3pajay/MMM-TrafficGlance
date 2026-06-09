const NodeHelper = require("node_helper");
// node:sqlite requires Node >=22.5; add --experimental-sqlite to MM start cmd if on Node 22.5-22.10
const { DatabaseSync } = require("node:sqlite");

module.exports = NodeHelper.create({
    start() {
        this.quotaExhausted = false;
        this.nextMidnightUTC = 0;
        this._busy = false;
        this._polylines = {};
    },

    _initDb() {
        this.db = new DatabaseSync(__dirname + "/traffic.db");
        const info = this.db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('traffic_history')").get();
        if (info.n > 0 && info.n !== 3) this.db.exec("DROP TABLE traffic_history");
        this.db.exec("CREATE TABLE IF NOT EXISTS traffic_history(route_id TEXT,travel_time INTEGER,timestamp INTEGER)");
        this.db.prepare("DELETE FROM traffic_history WHERE timestamp<?").run(Math.floor(Date.now() / 1000) - 90 * 86400);
        this._ins = this.db.prepare("INSERT INTO traffic_history VALUES(?,?,?)");
        this._sel = this.db.prepare("SELECT travel_time,timestamp FROM traffic_history WHERE route_id=? AND timestamp>=? ORDER BY timestamp DESC LIMIT ?");
    },

    _sparkline(routeId) {
        const hours = this.config.sparkline?.lookbackHours ?? 48;
        const max = this.config.sparkline?.maxDataPoints ?? 50;
        const cutoff = Math.floor(Date.now() / 1000) - hours * 3600;
        const rows = this._sel.all(routeId, cutoff, max).reverse();
        if (!rows.length) return { points: [], baseline: null, stdDev: null };
        const vals = rows.map(r => Math.round(r.travel_time / 60));
        const baseline = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
        const sd = Math.sqrt(vals.reduce((s, v) => s + (v - baseline) ** 2, 0) / vals.length);
        return {
            points: rows.map((r, i) => ({ timestamp: r.timestamp, value: vals[i], zScore: sd > 0 ? (vals[i] - baseline) / sd : 0 })),
            baseline,
            stdDev: sd
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
        if (res.status === 403 || res.status === 429) throw Object.assign(new Error("quota"), { quota: true });
        if (!res.ok) throw new Error(res.statusText);
        const json = await res.json();
        const r = json.routes?.[0];
        if (!r) return null;
        const s = r.summary;
        if (!this._polylines[route.id]) this._polylines[route.id] = r.legs[0].points;
        this._ins.run(route.id, s.travelTimeInSeconds, Math.floor(Date.now() / 1000));
        const live = Math.round(s.travelTimeInSeconds / 60);
        const hist = Math.round(s.historicTrafficTravelTimeInSeconds / 60);
        return {
            id: route.id, name: route.name,
            currentDuration: live, historicalAverage: hist,
            delayFactor: s.travelTimeInSeconds / s.noTrafficTravelTimeInSeconds,
            trendDirection: live > hist ? "up" : live < hist ? "down" : "stable",
            bottlenecks: (r.sections ?? [])
                .filter(x => x.sectionType === "traffic" && x.delayInSeconds > 30)
                .map(({ startPointIndex, endPointIndex, magnitudeOfDelay: magnitude }) => ({ startPointIndex, endPointIndex, magnitude })),
            polyline: this._polylines[route.id],
            sparklineData: this._sparkline(route.id)
        };
    },

    async _update() {
        if (!this.config || this.quotaExhausted || this._busy) return;
        this._busy = true;
        try {
            const results = await Promise.all(
                this.config.routes.map(r => this._fetch(r).catch(e => { if (e.quota) throw e; return null; }))
            );
            const routes = results.filter(Boolean);
            this.sendSocketNotification(routes.length ? "TRAFFIC_UPDATE" : "FETCH_ERROR",
                routes.length ? routes : { category: "network" });
        } catch (e) {
            this.quotaExhausted = true;
            const m = new Date(); m.setUTCHours(24, 0, 0, 0);
            this.nextMidnightUTC = m.getTime();
            this.sendSocketNotification("QUOTA_EXHAUSTED", { nextResetTime: this.nextMidnightUTC, useTomTomTiles: true });
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
        this.config = payload;
        if (!this.db) this._initDb();
        this._update();
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = setInterval(() => this._update(), this.config.updateInterval);
    }
});
