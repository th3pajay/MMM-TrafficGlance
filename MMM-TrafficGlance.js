Module.register("MMM-TrafficGlance", {
    defaults: {
        updateInterval: 300000, thresholds: { critical: 1.25 },
        mapWidth: "100%", mapHeight: "220px", mapZoom: null, mapCenter: null, mapPadding: [20, 20],
        api: { timeout: 10000, routeType: "fastest", travelMode: "car", traffic: true, avoidTolls: false, avoidHighways: false },
        sparkline: { enabled: true, width: 160, height: 40, showBaseline: true, showNowIndicator: true,
            showNowLabel: true, maxDataPoints: 50, lookbackHours: 48, showBaselineLabel: true, useZScoreColors: true }
    },

    getStyles: () => ["MMM-TrafficGlance.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"],
    getScripts: () => ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "ColorTheme.js", "MapRenderer.js", "TemplateEngine.js"],

    start() {
        this.trafficData = []; this._mapReady = false; this._mapEngine = null;
        this._wrapper = null; this._quotaExhausted = false; this._fetchError = null;
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
            this._wrapper = null; this._mapReady = false;
            if (this._mapEngine) this._mapEngine.switchTileLayer(this._quotaExhausted);
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
            w.insertAdjacentHTML("beforeend",
                `<div class="quota-warning">⚠️ API quota exceeded<br><small>Resets ${new Date(this._nextReset).toLocaleString()}</small></div>`);
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
        setTimeout(() => requestAnimationFrame(() => this._initMap()), 100);
        return w;
    },

    _routeRow(route) {
        const cc = ColorTheme.getRouteColorClass(route, this.config.thresholds?.critical);
        const d = document.createElement("div"); d.className = "route-row";
        d.innerHTML = `<div class="route-header"><span class="route-name"></span><div class="route-metrics">${
            route.trendDirection ? `<span class="trend-arrow ${route.trendDirection}">${{ up: "↑", down: "↓", stable: "→" }[route.trendDirection]}</span>` : ""
        }</div></div><div class="route-time ${cc}"><span class="big-num">${route.currentDuration}</span><span class="unit">mins</span></div>`;
        d.querySelector(".route-name").textContent = route.name;
        if (this.config.sparkline?.enabled !== false && route.sparklineData?.points?.length) {
            const sc = document.createElement("div"); sc.className = "sparkline-container";
            const c = document.createElement("canvas"); c.className = "sparkline-canvas";
            c.id = `spark-${route.id}`; c.width = this.config.sparkline.width; c.height = this.config.sparkline.height;
            sc.appendChild(c); d.querySelector(".route-metrics").prepend(sc);
            setTimeout(() => { const e = new SparklineEngine(c.id, route.sparklineData, this.config); if (e.canvas) e.render(); }, 100);
        }
        return d;
    },

    _updateRoutes() {
        const rc = this._wrapper?.querySelector(".route-container"); if (!rc) return;
        rc.innerHTML = ""; this.trafficData.forEach(r => rc.appendChild(this._routeRow(r)));
    },

    _initMap() {
        if (this._mapReady) return;
        const el = document.getElementById("traffic-map-container");
        if (!el || el.offsetParent === null) { setTimeout(() => this._initMap(), 1000); return; }
        if (this._mapEngine) { this._mapEngine.destroy(); this._mapEngine = null; }
        this._mapEngine = new MapRenderer("traffic-map-container", this.config);
        if (this.trafficData.length) this._mapEngine.draw(this.trafficData);
        else if (this._quotaExhausted) this._mapEngine.map.setView(this.config.mapCenter || [47.3, 19.1], this.config.mapZoom || 10);
        this._mapReady = true;
    }
});
