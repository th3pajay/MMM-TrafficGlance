Module.register("MMM-TrafficGlance", {
    defaults: {
        updateInterval: 300000, thresholds: { critical: 1.25 },
        mapWidth: "100%", mapHeight: "220px", mapZoom: null, mapCenter: null, mapPadding: [20, 20],
        api: { timeout: 10000, routeType: "fastest", travelMode: "car", traffic: true, avoidTolls: false, avoidHighways: false },
        sparkline: { enabled: true, width: 160, height: 40, showBaseline: true, showNowIndicator: true,
            showNowLabel: true, maxDataPoints: 50, lookbackHours: 48, showBaselineLabel: true, useZScoreColors: true,
            showXAxisLabels: true, showIncidents: true }
    },

    getStyles: () => ["MMM-TrafficGlance.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"],
    getScripts: () => ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "ColorTheme.js", "MapRenderer.js", "TemplateEngine.js"],

    start() {
        this.trafficData = []; this._mapReady = false; this._mapEngine = null;
        this._wrapper = null; this._quotaExhausted = false; this._fetchError = null;
        this._nextReset = null; this._initMapPending = false;
        this.sendSocketNotification("CONFIG", this.config);
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "TRAFFIC_UPDATE") {
            this._fetchError = null; this.trafficData = payload;
            if (this._mapReady && this._mapEngine && this._wrapper) {
                this._updateRoutes(); this._mapEngine.draw(this.trafficData);
            } else { this.updateDom(300); }
        } else if (notification === "QUOTA_EXHAUSTED" || notification === "QUOTA_RESTORED") {
            this._quotaExhausted = notification === "QUOTA_EXHAUSTED";
            if (this._quotaExhausted) this._nextReset = payload.nextResetTime;
            if (this._mapEngine) { this._mapEngine.destroy(); this._mapEngine = null; }
            this._wrapper = null; this._mapReady = false;
            this.updateDom();
        } else if (notification === "FETCH_ERROR") {
            this._fetchError = payload.category;
            if (!this.trafficData.length) this.updateDom();
        }
    },

    getDom() {
        if (this._wrapper) { this._updateRoutes(); return this._wrapper; }
        const w = document.createElement("div"); w.className = "traffic-root";
        if (this._quotaExhausted) {
            const resetStr = this._nextReset ? new Date(this._nextReset).toLocaleString() : "midnight UTC";
            w.insertAdjacentHTML("beforeend",
                `<div class="quota-warning">⚠️ API quota exceeded<br><small>Resets ${resetStr}</small></div>`);
        }
        if (!this.trafficData.length && !this._quotaExhausted) {
            w.insertAdjacentHTML("beforeend",
                `<div class="loading">${this._fetchError ? "Traffic data unavailable — retrying..." : "Analyzing TomTom Traffic..."}</div>`);
            return w;
        }
        if (!this._quotaExhausted) {
            const rc = w.appendChild(document.createElement("div")); rc.className = "route-container";
            this.trafficData.forEach(r => rc.appendChild(this._routeRow(r)));
        }
        const m = w.appendChild(document.createElement("div"));
        m.id = "traffic-map-container"; m.style.cssText = `height:${this.config.mapHeight};width:${this.config.mapWidth}`;
        this._wrapper = w;
        if (!this._initMapPending) {
            this._initMapPending = true;
            setTimeout(() => requestAnimationFrame(() => this._initMap()), 100);
        }
        return w;
    },

    _incidentLabel(incident) {
        const mins = Math.round((incident.delaySeconds ?? 0) / 60);
        const suffix = mins > 0 ? ` +${mins}m` : "";
        switch (incident.category) {
            case "ROAD_CLOSURE": return "Closure";
            case "JAM": return `Jam${suffix}`;
            case "ROAD_WORK": return `Roadwork${suffix}`;
            default: return `Delay${suffix}`;
        }
    },

    _incidentsHtml(route) {
        if (!this.config.api?.incidents || !route.incidents?.length) return "";
        const severity = { ROAD_CLOSURE: 3, JAM: 2, ROAD_WORK: 1, OTHER: 0 };
        const sorted = [...route.incidents].sort((a, b) =>
            (severity[b.category] ?? 0) - (severity[a.category] ?? 0)
            || (b.magnitude ?? 0) - (a.magnitude ?? 0)
            || (b.delaySeconds ?? 0) - (a.delaySeconds ?? 0));
        const shown = sorted.slice(0, 2);
        const rest = sorted.length - shown.length;
        const tags = shown.map(i =>
            `<span class="incident-tag" style="color:${ColorTheme.getIncidentColor(i.category, i.magnitude)}">●</span> ${this._incidentLabel(i)}`
        ).join('<span class="incident-sep">·</span>');
        const more = rest > 0 ? `<span class="incident-sep">·</span>+${rest} more` : "";
        return `<div class="route-incidents">${tags}${more}</div>`;
    },

    _routeRow(route) {
        const cc = ColorTheme.getRouteColorClass(route, this.config.thresholds?.critical);
        const deltaVal = route.historicalAverage ? Math.round(route.currentDuration - route.historicalAverage) : null;
        const deltaHtml = deltaVal !== null && deltaVal !== 0
            ? `<span class="route-delta ${cc}">${deltaVal > 0 ? "+" : ""}${deltaVal}m</span>` : "";
        const d = document.createElement("div"); d.className = "route-row";
        d.innerHTML = `<div class="route-header"><span class="route-name"></span><div class="route-metrics">${
            route.trendDirection ? `<span class="trend-arrow ${route.trendDirection}">${{ up: "↑", down: "↓", stable: "→" }[route.trendDirection]}</span>` : ""
        }</div></div><div class="route-time ${cc}"><span class="big-num">${route.currentDuration}</span><span class="unit">mins</span>${deltaHtml}</div>${this._incidentsHtml(route)}`;
        d.querySelector(".route-name").textContent = route.name;
        if (this.config.sparkline?.enabled !== false && route.sparklineData?.points?.length) {
            const sc = document.createElement("div"); sc.className = "sparkline-container";
            const c = document.createElement("canvas"); c.className = "sparkline-canvas";
            c.id = `spark-${route.id}`; c.width = this.config.sparkline.width; c.height = this.config.sparkline.height;
            sc.appendChild(c); d.querySelector(".route-metrics").prepend(sc);
            setTimeout(() => { if (!c.isConnected) return; const e = new SparklineEngine(c.id, route.sparklineData, this.config); if (e.canvas) e.render(); }, 100);
        }
        return d;
    },

    _updateRoutes() {
        const rc = this._wrapper?.querySelector(".route-container"); if (!rc) return;
        rc.innerHTML = ""; this.trafficData.forEach(r => rc.appendChild(this._routeRow(r)));
    },

    _initMap(attempt = 0) {
        if (this._mapReady) { this._initMapPending = false; return; }
        if (attempt > 10) {
            console.warn("[MMM-TrafficGlance] Map failed to initialize after 10 attempts");
            this._initMapPending = false;
            return;
        }
        const el = document.getElementById("traffic-map-container");
        if (!el || el.offsetParent === null) { setTimeout(() => this._initMap(attempt + 1), 1000); return; }
        if (this._mapEngine) { this._mapEngine.destroy(); this._mapEngine = null; }
        this._mapEngine = new MapRenderer("traffic-map-container", this.config);
        if (this.trafficData.length) { this._mapEngine.draw(this.trafficData); this._mapEngine.map.invalidateSize(); }
        else if (this._quotaExhausted) this._mapEngine.map.setView(this.config.mapCenter || [47.3, 19.1], this.config.mapZoom || 10);
        this._mapReady = true;
        this._initMapPending = false;
    }
});
