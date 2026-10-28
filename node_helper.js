const NodeHelper = require("node_helper");
const { resolvePacedIntervalMs } = require("./quotaPacing");
const configFile = require("./configFile");
const basemapService = require("./basemapService");

module.exports = NodeHelper.create({
    start() {
        this.quotaExhausted = false;
        this.nextMidnightUTC = 0;
        this._busy = false;
        this._lastCleanup = 0;
        this._recent = new Map();
    },

    stop() {
        if (this.intervalId) clearTimeout(this.intervalId);
        if (this._midnightId) clearInterval(this._midnightId);
        this.store?.close();
    },

    _initStore() {
        try {
            const { TrafficStore, routeKey } = require("./trafficStore");
            this._routeKey = routeKey;
            const legacyKeys = new Map(this.config.routes.map(r => [r.id, routeKey(r, this.config.api)]));
            this.store = TrafficStore.open(__dirname + "/traffic.db", { legacyKeys });
        } catch (e) {
            this.store = null;
            console.warn("[MMM-TrafficGlance] history disabled, traffic.db unavailable:", e.message);
        }
    },

    _keyOf(route) {
        return this._routeKey(route, this.config.api);
    },

    async _fetch(route) {
        const api = this.config.api ?? {};
        const avoid = (api.avoid ?? []).join(",");
        const params = {
            key: this.config.apiKey, traffic: api.traffic !== false, departAt: "now",
            routeType: api.routeType ?? "fastest", computeTravelTimeFor: "all",
            routeRepresentation: "polyline", sectionType: "traffic", travelMode: api.travelMode ?? "car"
        };
        if (avoid) params.avoid = avoid;
        const origin = String(route.origin).replace(/\s+/g, "");
        const dest = String(route.destination).replace(/\s+/g, "");
        this.store?.recordCall();
        const res = await fetch(
            `https://api.tomtom.com/routing/1/calculateRoute/${origin}:${dest}/json?${new URLSearchParams(params)}`,
            { signal: AbortSignal.timeout(api.timeout ?? 10000) }
        );
        if (res.status === 429) throw Object.assign(new Error("quota"), { quota: true });
        if (res.status === 403) {
            const body = await res.json().catch(() => ({}));
            const code = body?.detailedError?.code;
            if (code === "APP_QUOTA_EXCEEDED" || code === "InsufficientFunds") throw Object.assign(new Error("quota"), { quota: true });
            console.warn(`[MMM-TrafficGlance] unrecognized 403 for route "${route.id ?? route.name}":`, JSON.stringify(body));
            throw Object.assign(new Error("auth"), { auth: true });
        }
        if (!res.ok) throw new Error(res.statusText);
        const json = await res.json();
        const r = json.routes?.[0];
        if (!r) return null;
        const s = r.summary;
        const polyline = r.legs?.flatMap(leg => leg.points) ?? [];
        const live = Math.round(s.travelTimeInSeconds / 60);
        const ntt = s.noTrafficTravelTimeInSeconds;
        const along = this._cumulativeDistance(polyline);
        const total = along[along.length - 1] || 0;
        const positionOf = (a, b) => total > 0 ? ((along[a] ?? 0) + (along[b] ?? along[a] ?? 0)) / 2 / total : 0;
        const incidents = !api.incidents ? [] : (r.sections ?? [])
            .filter(x => x.sectionType === "TRAFFIC" && x.delayInSeconds > 30)
            .filter(x => !api.incidentCategories || api.incidentCategories.includes(x.simpleCategory))
            .map(({ startPointIndex, endPointIndex, magnitudeOfDelay: magnitude, simpleCategory: category, delayInSeconds: delaySeconds }) =>
                ({ startPointIndex, endPointIndex, magnitude, category, delaySeconds, position: positionOf(startPointIndex, endPointIndex) }));
        const key = this.store ? this._keyOf(route) : null;
        this.store?.record(key, s.travelTimeInSeconds, incidents);
        const usual = this._usual(key, s.historicTrafficTravelTimeInSeconds);
        return {
            id: route.id, name: route.name,
            currentDuration: live,
            historicalAverage: usual.minutes,
            usualSource: usual.source,
            freeFlowDuration: ntt > 0 ? Math.round(ntt / 60) : null,
            distanceKm: s.lengthInMeters ? Math.round(s.lengthInMeters / 100) / 10 : null,
            arrivalTime: s.arrivalTime ?? null,
            delayFactor: ntt > 0 ? s.travelTimeInSeconds / ntt : 1,
            trendDirection: this._trend(key ?? route.id, live),
            incidents,
            polyline,
            sparklineData: this.store ? this.store.sparkline(key, this.config.sparkline) : { points: [], baseline: null, stdDev: null, incidents: [] }
        };
    },

    _usual(key, tomtomSeconds) {
        const own = this.store?.usualAt(key);
        if (own != null) return { minutes: Math.round(own / 60), source: "history" };
        if (tomtomSeconds > 0) return { minutes: Math.round(tomtomSeconds / 60), source: "tomtom" };
        return { minutes: null, source: null };
    },

    _cumulativeDistance(polyline) {
        const out = [0];
        for (let i = 1; i < polyline.length; i++) {
            const a = polyline[i - 1], b = polyline[i];
            const dx = (b.longitude - a.longitude) * Math.cos((a.latitude + b.latitude) * Math.PI / 360);
            out.push(out[i - 1] + Math.hypot(dx, b.latitude - a.latitude));
        }
        return out;
    },

    _trend(key, live) {
        const recent = this.store
            ? this.store.recent(key, 4).map(t => Math.round(t / 60))
            : [...(this._recent.get(key) ?? []), live].slice(-4);
        if (!this.store) this._recent.set(key, recent);
        const prior = recent.slice(0, -1);
        if (!prior.length) return "stable";
        const diff = live - prior.reduce((a, b) => a + b, 0) / prior.length;
        return diff >= 1 ? "up" : diff <= -1 ? "down" : "stable";
    },

    async _update() {
        if (!this.config || this.quotaExhausted || this._busy) return;
        if (!Array.isArray(this.config.routes) || !this.config.routes.length) {
            this.sendSocketNotification("FETCH_ERROR", { category: "config" });
            return;
        }
        this._busy = true;
        if (this.store && Date.now() - this._lastCleanup > 86400000) {
            this.store.prune({ lookbackHours: this.config.sparkline?.lookbackHours });
            this._lastCleanup = Date.now();
        }
        try {
            const routes = [];
            for (const [i, r] of this.config.routes.entries()) {
                if (i > 0) await new Promise(res => setTimeout(res, 300));
                const data = await this._fetch(r).catch(e => {
                    if (e.quota || e.auth) throw e;
                    console.warn(`[MMM-TrafficGlance] fetch failed for route "${r.id ?? r.name}":`, e.message);
                    return null;
                });
                if (data) routes.push(data);
            }
            this.sendSocketNotification(routes.length ? "TRAFFIC_UPDATE" : "FETCH_ERROR",
                routes.length ? routes : { category: "network" });
        } catch (e) {
            if (e.auth) {
                console.warn("[MMM-TrafficGlance] auth error, giving up until config changes");
                this.sendSocketNotification("FETCH_ERROR", { category: "auth" });
                return;
            }
            console.warn("[MMM-TrafficGlance] quota exhausted");
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

    _nextIntervalMs() {
        const configured = Math.max(60000, this.config.updateInterval ?? 300000);
        const routesCount = Array.isArray(this.config.routes) ? this.config.routes.length : 0;
        if (!this.store || !routesCount) return configured;
        const now = Date.now();
        const paced = resolvePacedIntervalMs(this.config.api, { routesCount, callsThisMonth: this.store.callsThisMonth(now), now, configuredIntervalMs: configured });
        return paced === null ? configured : Math.round(paced);
    },

    async _runLoop() {
        await this._update();
        this.intervalId = setTimeout(() => this._runLoop(), this._nextIntervalMs());
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "SETTINGS_LOAD") {
            this.sendSocketNotification("SETTINGS_DATA", configFile.load(configFile.CONFIG_PATH));
            return;
        }
        if (notification === "SETTINGS_SAVE") {
            const result = configFile.save(configFile.CONFIG_PATH, payload);
            this.sendSocketNotification(result.ok ? "SETTINGS_SAVED" : "SETTINGS_ERROR", result);
            return;
        }
        if (notification === "BASEMAP_REQUEST") {
            basemapService.getBasemap(payload).then(
                data => this.sendSocketNotification("BASEMAP_DATA", data),
                e => {
                    console.warn("[MMM-TrafficGlance] basemap unavailable:", e.message);
                    this.sendSocketNotification("BASEMAP_ERROR", { message: e.message });
                }
            );
            return;
        }
        if (notification !== "CONFIG") return;
        if (this.intervalId) clearTimeout(this.intervalId);
        this.config = payload;
        if (this.store === undefined && Array.isArray(this.config.routes)) this._initStore();
        this._runLoop();
    }
});
