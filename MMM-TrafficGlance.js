Module.register("MMM-TrafficGlance", {
    defaults: {},

    getStyles: () => ["MMM-TrafficGlance.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"],
    getScripts: () => ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "configNormalizer.js", "ColorTheme.js", "MapRenderer.js", "SvgMapRenderer.js", "TemplateEngine.js", "SettingsPanel.js"],

    NARROW_PX: 320,

    start() {
        this.config = TrafficGlanceConfig.normalize(this.config);
        this._settings = new SettingsPanel({
            onLoad: () => this.sendSocketNotification("SETTINGS_LOAD"),
            onSave: changes => this.sendSocketNotification("SETTINGS_SAVE", changes)
        });
        this.trafficData = []; this._prev = new Map(); this._mapReady = false; this._mapEngine = null;
        this._wrapper = null; this._quotaExhausted = false; this._fetchError = null; this._updatedAt = null;
        this._nextReset = null; this._initMapPending = false; this._basemap = null;
        this._narrow = false; this._width = 0; this._heroId = null;
        this.sendSocketNotification("CONFIG", this.config);
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "SETTINGS_DATA") this._settings.showData(payload);
        else if (notification === "SETTINGS_SAVED") this._settings.showSaved();
        else if (notification === "SETTINGS_ERROR") this._settings.showError(payload);
        else if (notification === "BASEMAP_DATA") {
            this._basemap = payload;
            this._mapEngine?.setBasemap?.(payload);
        } else if (notification === "TRAFFIC_UPDATE") {
            this._fetchError = null; this.trafficData = payload; this._updatedAt = Date.now();
            this._refresh();
        } else if (notification === "QUOTA_EXHAUSTED" || notification === "QUOTA_RESTORED") {
            this._quotaExhausted = notification === "QUOTA_EXHAUSTED";
            if (this._quotaExhausted) this._nextReset = payload.nextResetTime;
            this._mapEngine?.setFlowOverlay(this._quotaExhausted);
            this._refresh();
        } else if (notification === "FETCH_ERROR") {
            this._fetchError = payload.category;
            this._refresh();
        }
    },

    _refresh() {
        if (this._wrapper) this._render(); else this.updateDom();
    },

    getDom() {
        if (!this._wrapper) this._build();
        this._render();
        return this._wrapper;
    },

    _animate() {
        return this.config.display.animations !== false;
    },

    _build() {
        const w = this._wrapper = document.createElement("div");
        const showMap = this.config.display.showMap !== false;
        w.className = "traffic-root";
        w.classList.toggle("tg-anim", this._animate());
        w.classList.toggle("tg-nomap", !showMap);
        if (this.config.maxWidth) w.style.setProperty("--tg-max", this.config.maxWidth);
        if (this.config.scale && this.config.scale !== 1) w.style.zoom = this.config.scale;
        w.style.setProperty("--tg-map-height", this.config.map.height);
        w.innerHTML = `<div class="tg-mapblk">${showMap ? '<div id="traffic-map-container"></div>' : ""}<div class="tg-hero"></div><span class="tg-stamp"></span></div>`
            + '<div class="tg-band"><div class="tg-rows"></div><div class="tg-axis"><span class="tg-axis-tools"></span><span class="tg-axis-scale"></span></div></div>';
        this._hero = w.querySelector(".tg-hero");
        this._stamp = w.querySelector(".tg-stamp");
        this._rows = w.querySelector(".tg-rows");
        this._scale = w.querySelector(".tg-axis-scale");
        this._settings.attach(w, w.querySelector(".tg-axis-tools"));
        if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => this._onResize()).observe(w);
        if (showMap && !this._initMapPending) {
            this._initMapPending = true;
            setTimeout(() => requestAnimationFrame(() => this._initMap()), 100);
        }
    },

    _onResize() {
        const width = this._wrapper.clientWidth;
        if (!width || width === this._width) return;
        this._width = width;
        const narrow = width < this.NARROW_PX;
        if (narrow !== this._narrow) {
            this._narrow = narrow;
            this._wrapper.classList.toggle("tg-narrow", narrow);
        }
        if (!narrow && !this._mapReady && !this._initMapPending && this.config.display.showMap !== false) this._initMap();
        if (this.trafficData.length && !this._quotaExhausted) {
            this._prev = new Map(this.trafficData.map(r => [r.id, r.currentDuration]));
            this._renderHero(this._pickHero());
        }
        if (this._mapReady) { this._mapEngine.invalidateSize(); this._drawMap(); }
    },

    _render() {
        const w = this._wrapper, has = this.trafficData.length > 0;
        w.classList.toggle("tg-loading", !has && !this._quotaExhausted);
        w.classList.toggle("tg-stale", has && !!this._fetchError);
        w.classList.toggle("tg-quota", this._quotaExhausted);
        const hero = has ? this._pickHero() : null;
        this._heroId = hero?.route.id ?? null;
        this._renderHero(hero);
        this._renderBand();
        this._renderStamp();
        if (has) this._drawMap();
        this._prev = new Map(this.trafficData.map(r => [r.id, r.currentDuration]));
    },

    _windows(v) {
        return (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map(x => String(x).replace(/\s+/g, "")).filter(Boolean);
    },

    _inWindow(win, minute) {
        const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(win);
        if (!m) return false;
        const a = m[1] * 60 + +m[2], b = m[3] * 60 + +m[4];
        return a <= b ? minute >= a && minute < b : minute >= a || minute < b;
    },

    _pickHero() {
        const d = new Date(), minute = d.getHours() * 60 + d.getMinutes();
        const cfg = new Map(this.config.routes.map(r => [r.id, r]));
        for (const route of this.trafficData) {
            const win = this._windows(cfg.get(route.id)?.hero).find(w => this._inWindow(w, minute));
            if (win) return { route, label: win.replace("-", "–") };
        }
        const over = r => r.historicalAverage > 0 ? (r.currentDuration - r.historicalAverage) / r.historicalAverage : 0;
        return { route: this.trafficData.reduce((a, b) => over(b) > over(a) ? b : a), label: "most delayed" };
    },

    _clock(date) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    },

    _arrival(r) {
        return this._clock(r.arrivalTime ? new Date(r.arrivalTime) : new Date(Date.now() + r.currentDuration * 60000));
    },

    _cc(r) {
        return ColorTheme.getRouteColorClass(r, this.config.thresholds);
    },

    _from(r) {
        return this._animate() ? this._prev.get(r.id) ?? 0 : r.currentDuration;
    },

    _numHtml(r, cls) {
        return `<span class="tg-num ${cls}" data-from="${this._from(r)}" data-to="${r.currentDuration}">${r.currentDuration}</span>`;
    },

    _deltaText(r) {
        if (this.config.display.showDelta === false || !r.historicalAverage) return "";
        const d = Math.round(r.currentDuration - r.historicalAverage);
        return d === 0 ? "±0" : (d > 0 ? "+" : "") + d;
    },

    _trendHtml(r) {
        if (this.config.display.showTrend === false || !r.trendDirection) return "";
        return `<span class="tg-trend ${r.trendDirection}">${{ up: "↑", down: "↓", stable: "→" }[r.trendDirection]}</span>`;
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

    _incidents(r) {
        if (!this.config.api?.incidents || !r.incidents?.length) return [];
        const severity = TrafficGlanceConfig.INCIDENT_SEVERITY;
        return [...r.incidents].sort((a, b) =>
            (severity[b.category] ?? 0) - (severity[a.category] ?? 0)
            || (b.magnitude ?? 0) - (a.magnitude ?? 0)
            || (b.delaySeconds ?? 0) - (a.delaySeconds ?? 0));
    },

    _glyph(inc) {
        return ColorTheme.incidentGlyph[inc.category] ?? ColorTheme.incidentGlyph.OTHER;
    },

    _renderHero(hero) {
        const el = this._hero;
        if (this._quotaExhausted) {
            el.className = "tg-hero tg-notice";
            const reset = this._nextReset ? this._clock(new Date(this._nextReset)) : "midnight UTC";
            el.innerHTML = `<div class="tg-hero-title">API quota reached</div><div class="tg-hero-sub">Live times resume ${reset}</div>`;
            return;
        }
        if (!hero) {
            el.className = "tg-hero tg-skeleton";
            const msg = this._fetchError ? "Traffic data unavailable — retrying..." : "Analyzing TomTom Traffic...";
            el.innerHTML = `<span class="tg-sk tg-sk-name"></span><span class="tg-sk tg-sk-num"></span><span class="tg-sk tg-sk-spark"></span><div class="tg-hero-sub">${msg}</div>`;
            return;
        }
        const r = hero.route, sorted = this._incidents(r), shown = sorted.slice(0, 3);
        const meta = [`arr ${this._arrival(r)}`, r.distanceKm ? `${r.distanceKm} km` : ""].filter(Boolean).join(" · ");
        const delta = this._deltaText(r);
        el.className = `tg-hero tg-${this._cc(r)}`;
        el.innerHTML = `<div class="tg-hero-head"><span class="tg-hero-name"></span><span class="tg-hero-why"></span></div>`
            + `<div class="tg-hero-main">${this._numHtml(r, "tg-hero-num")}<div class="tg-hero-meta">${delta ? `<span class="tg-delta">${delta} min</span> ` : ""}${this._trendHtml(r)}<small>${meta}</small></div></div>`
            + '<div class="tg-hero-spark"></div>'
            + (shown.length ? `<div class="tg-chips">${shown.map(i => `<span class="tg-chip"><i style="color:${ColorTheme.getIncidentColor(i.category, i.magnitude)}">${this._glyph(i)}</i>${this._incidentLabel(i)}</span>`).join("")}${sorted.length > shown.length ? `<span class="tg-chip">+${sorted.length - shown.length}</span>` : ""}</div>` : "");
        el.querySelector(".tg-hero-name").textContent = r.name;
        el.querySelector(".tg-hero-why").textContent = hero.label;
        this._heroSpark(r, el.querySelector(".tg-hero-spark"));
        this._countUp(el);
    },

    _heroSpark(r, host) {
        if (this.config.sparkline?.enabled === false || !r.sparklineData?.points?.length) return;
        const c = host.appendChild(document.createElement("canvas"));
        c.className = "sparkline-canvas";
        c.height = this.config.sparkline.height;
        setTimeout(() => {
            if (!c.isConnected) return;
            c.width = Math.max(60, Math.floor(host.clientWidth));
            const e = new SparklineEngine(c, r.sparklineData, this.config);
            if (!e.canvas) return;
            e.render();
            if (!e.nowPoint || !this._animate()) return;
            const ping = host.appendChild(document.createElement("span"));
            ping.className = "tg-nowping";
            ping.style.cssText = `left:${e.nowPoint.x}px;top:${e.nowPoint.y}px;background:${e.nowPoint.color}`;
        }, 50);
    },

    _renderBand() {
        const data = this.trafficData;
        if (!data.length) {
            const n = Math.max(1, this.config.routes.length);
            this._rows.innerHTML = Array.from({ length: n }, (_, i) =>
                `<div class="tg-row" style="--i:${i}"><span class="tg-sk tg-sk-cell"></span><span class="tg-sk tg-sk-cell"></span><span class="tg-strip"><span class="tg-sk tg-sk-strip"></span></span></div>`).join("");
            this._scale.innerHTML = "";
            return;
        }
        const max = Math.max(1, ...data.map(r => Math.max(r.currentDuration, r.historicalAverage || 0))) * 1.04;
        const f = v => (Math.max(0, v) / max).toFixed(4);
        const pos = v => `calc(6px + (100% - var(--tg-tail)) * ${f(v)})`;
        const wid = v => `calc((100% - var(--tg-tail)) * ${f(v)})`;
        this._rows.innerHTML = data.map((r, i) => {
            const now = r.currentDuration, prev = this._from(r);
            const ff = r.freeFlowDuration > 0 ? Math.min(r.freeFlowDuration, now) : null;
            const tail = [this._deltaText(r) + (this._trendHtml(r) ? " " + this._trendHtml(r) : ""), this._arrival(r)].filter(Boolean).join(" · ");
            const incs = this._incidents(r).map(inc => {
                const p = inc.position ?? 0.5, mins = Math.round((inc.delaySeconds ?? 0) / 60);
                return `<i class="tg-strip-inc" style="left:${pos(prev * p)};color:${ColorTheme.getIncidentColor(inc.category, inc.magnitude)}" data-l="${pos(now * p)}">${this._glyph(inc)}${mins > 0 ? "+" + mins : ""}</i>`;
            }).join("");
            return `<div class="tg-row tg-${this._cc(r)}${r.id === this._heroId ? " tg-is-hero" : ""}" style="--i:${i}">`
                + '<span class="tg-row-name"></span>'
                + `<span class="tg-row-num">${this._numHtml(r, "")}<small>m</small></span>`
                + '<span class="tg-strip">'
                + `<i class="tg-strip-line" style="width:${wid(prev)}" data-w="${wid(now)}"></i>`
                + (ff ? `<i class="tg-strip-ff" style="width:${wid(Math.min(ff, prev))}" data-w="${wid(ff)}"></i>` : "")
                + '<i class="tg-strip-start"></i>'
                + `<i class="tg-strip-end" style="left:${pos(prev)}" data-l="${pos(now)}"></i>`
                + (r.historicalAverage ? `<i class="tg-strip-usual" style="left:${pos(r.historicalAverage)}" data-u="usual ${r.historicalAverage}${r.usualSource === "history" ? " · learned" : ""}"></i>` : "")
                + incs
                + `<span class="tg-strip-tail" style="left:${pos(prev)}" data-l="${pos(now)}">${tail}</span>`
                + "</span></div>";
        }).join("");
        this._rows.querySelectorAll(".tg-row-name").forEach((el, i) => { el.textContent = data[i].name; });
        this._scale.innerHTML = `<span>0</span><span>${Math.round(max / 2)}</span><span>${Math.round(max)} min</span>`;
        this._countUp(this._rows);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            this._rows.querySelectorAll("[data-w]").forEach(e => { e.style.width = e.dataset.w; });
            this._rows.querySelectorAll("[data-l]").forEach(e => { e.style.left = e.dataset.l; });
        }));
    },

    _renderStamp() {
        if (this._quotaExhausted || !this.trafficData.length || !this._updatedAt) { this._stamp.textContent = ""; return; }
        this._stamp.textContent = this._fetchError
            ? `stale ${Math.max(1, Math.round((Date.now() - this._updatedAt) / 60000))}m`
            : `updated ${this._clock(new Date(this._updatedAt))}`;
    },

    _countUp(root) {
        if (!this._animate()) return;
        root.querySelectorAll(".tg-num").forEach(el => {
            const from = Number(el.dataset.from), to = Number(el.dataset.to);
            if (from === to) return;
            el.textContent = from;
            const t0 = performance.now();
            const step = t => {
                const k = Math.min(1, (t - t0) / 900);
                el.textContent = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
                if (k < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
    },

    _heroPad() {
        if (this._narrow || !this._hero.offsetWidth || this._quotaExhausted) return null;
        return [this._hero.offsetLeft + this._hero.offsetWidth + 19, 19];
    },

    _drawMap() {
        if (!this._mapReady || !this._mapEngine || !this.trafficData.length || this._narrow) return;
        this._mapEngine.draw(this.trafficData, { heroId: this._heroId, paddingTopLeft: this._heroPad() });
    },

    _initMap(attempt = 0) {
        if (this._mapReady) { this._initMapPending = false; return; }
        if (attempt > 10) {
            console.warn("[MMM-TrafficGlance] Map failed to initialize after 10 attempts");
            this._initMapPending = false;
            return;
        }
        this._initMapPending = true;
        const el = document.getElementById("traffic-map-container");
        if (!el || el.offsetParent === null) { setTimeout(() => this._initMap(attempt + 1), 1000); return; }
        if (this._mapEngine) { this._mapEngine.destroy(); this._mapEngine = null; }
        if (this.config.map.renderer === "svg") {
            this._mapEngine = new SvgMapRenderer("traffic-map-container", this.config, {
                requestBasemap: bbox => this.sendSocketNotification("BASEMAP_REQUEST", bbox)
            });
            if (this._basemap) this._mapEngine.setBasemap(this._basemap);
        } else {
            this._mapEngine = new MapRenderer("traffic-map-container", this.config);
        }
        this._mapReady = true;
        this._initMapPending = false;
        if (this.trafficData.length) { this._mapEngine.invalidateSize(); this._drawMap(); }
        else if (this._quotaExhausted) this._mapEngine.setView(this.config.map.center || [47.3, 19.1], this.config.map.zoom || 10);
        if (this._quotaExhausted) this._mapEngine.setFlowOverlay(true);
    }
});
