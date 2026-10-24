(function (root) {
    "use strict";

    const INCIDENT_CATEGORIES = ["JAM", "ROAD_WORK", "ROAD_CLOSURE", "OTHER"];
    const MAP_PRESETS = {
        leaflet: { renderer: "leaflet", tileProvider: "osm" },
        "leaflet-fr": { renderer: "leaflet", tileProvider: "osmfr" },
        "leaflet-tomtom": { renderer: "leaflet", tileProvider: "tomtom" },
        svg: { renderer: "svg" }
    };
    const LINE_STYLES = ["curved", "stepped"];
    const PX_RE = /^(\d+(?:\.\d+)?)px$/;

    const defaults = () => ({
        apiKey: undefined,
        routes: [],
        updateInterval: 300000,
        maxWidth: null,
        scale: 1,
        thresholds: { warning: 10, critical: 1.25 },
        display: { showDelta: true, showTrend: true, showMap: true, animations: true },
        map: {
            width: "100%", height: "312px", zoom: null, center: null, padding: [20, 20],
            renderer: "leaflet", tileProvider: "osm", zoomControlSize: 26, showScale: true, showIncidentMarkers: true
        },
        api: {
            adaptivePacing: true, monthlyQuota: 20000, timeout: 10000, routeType: "fastest", travelMode: "car",
            traffic: true, avoid: [], incidents: true, incidentCategories: null
        },
        sparkline: {
            enabled: true, width: 192, height: 48, showBaseline: true, showNowIndicator: true, showNowLabel: true,
            maxDataPoints: 50, lookbackHours: 48, showBaselineLabel: true, useZScoreColors: true,
            showXAxisLabels: true, showIncidents: true, lineStyle: "linear"
        }
    });

    const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
    const isNum = v => typeof v === "number" && Number.isFinite(v);

    function deepMerge(target, source) {
        if (!isObj(source)) return target;
        for (const [k, v] of Object.entries(source)) {
            if (isObj(v) && isObj(target[k])) deepMerge(target[k], v);
            else target[k] = Array.isArray(v) ? v.slice() : isObj(v) ? deepMerge({}, v) : v;
        }
        return target;
    }

    function applyLegacy(cfg, raw) {
        if (isNum(raw.updateInterval)) cfg.updateInterval = raw.updateInterval;
        if (typeof raw.maxWidth === "string" || raw.maxWidth === null) cfg.maxWidth = raw.maxWidth;
        for (const key of ["thresholds", "display", "api"]) deepMerge(cfg[key], raw[key]);
        if (isObj(raw.map)) deepMerge(cfg.map, raw.map);
        if (isObj(raw.sparkline)) deepMerge(cfg.sparkline, raw.sparkline);
    }

    function setIncidents(cfg, value) {
        const cats = Array.isArray(value) ? value.filter(c => INCIDENT_CATEGORIES.includes(c)) : null;
        const on = Array.isArray(value) ? cats.length > 0 : value === true;
        cfg.api.incidents = on;
        cfg.api.incidentCategories = on && cats && cats.length < INCIDENT_CATEGORIES.length ? cats : null;
        cfg.map.showIncidentMarkers = on;
        cfg.sparkline.showIncidents = on;
    }

    function applySimple(cfg, raw) {
        if (isNum(raw.refreshMinutes) && raw.refreshMinutes > 0) cfg.updateInterval = Math.round(raw.refreshMinutes * 60000);
        if (isNum(raw.monthlyQuota)) {
            cfg.api.adaptivePacing = raw.monthlyQuota > 0;
            if (raw.monthlyQuota > 0) cfg.api.monthlyQuota = raw.monthlyQuota;
        }
        if (isNum(raw.width)) cfg.maxWidth = raw.width > 0 ? raw.width + "px" : null;
        if (isNum(raw.scale) && raw.scale > 0) cfg.scale = Math.min(3, Math.max(0.5, raw.scale));
        if (raw.map === false) cfg.display.showMap = false;
        else if (typeof raw.map === "string" && MAP_PRESETS[raw.map]) {
            cfg.display.showMap = true;
            Object.assign(cfg.map, MAP_PRESETS[raw.map]);
        }
        if (isNum(raw.mapHeight) && raw.mapHeight > 0) cfg.map.height = raw.mapHeight + "px";
        if (typeof raw.sparkline === "boolean") cfg.sparkline.enabled = raw.sparkline;
        else if (raw.sparkline === "linear" || LINE_STYLES.includes(raw.sparkline)) {
            cfg.sparkline.enabled = true;
            cfg.sparkline.lineStyle = raw.sparkline;
        }
        if (typeof raw.incidents === "boolean" || Array.isArray(raw.incidents)) setIncidents(cfg, raw.incidents);
        if (typeof raw.showDelta === "boolean") cfg.display.showDelta = raw.showDelta;
        if (typeof raw.showTrend === "boolean") cfg.display.showTrend = raw.showTrend;
        if (typeof raw.animations === "boolean") cfg.display.animations = raw.animations;
        if (isNum(raw.warnAt)) cfg.thresholds.warning = raw.warnAt;
        if (isNum(raw.criticalAt)) cfg.thresholds.critical = 1 + raw.criticalAt / 100;
    }

    function normalize(raw) {
        const src = isObj(raw) ? raw : {};
        const cfg = defaults();
        cfg.apiKey = src.apiKey;
        cfg.routes = Array.isArray(src.routes) ? src.routes : [];
        applyLegacy(cfg, src);
        applySimple(cfg, src);
        deepMerge(cfg, src.advanced);
        return cfg;
    }

    function px(v, fallback) {
        const m = typeof v === "string" ? PX_RE.exec(v) : null;
        return m ? Math.round(Number(m[1])) : fallback;
    }

    function toSimple(cfg) {
        const m = cfg.map, a = cfg.api, s = cfg.sparkline;
        let map = "leaflet";
        if (cfg.display.showMap === false) map = false;
        else if (m.renderer === "svg") map = "svg";
        else if (m.tileProvider === "osmfr") map = "leaflet-fr";
        else if (m.tileProvider === "tomtom") map = "leaflet-tomtom";
        return {
            refreshMinutes: Math.round((cfg.updateInterval / 60000) * 100) / 100,
            monthlyQuota: a.adaptivePacing === false ? 0 : a.monthlyQuota,
            width: px(cfg.maxWidth, 0),
            scale: cfg.scale,
            map,
            mapHeight: px(m.height, 312),
            sparkline: s.enabled === false ? false : LINE_STYLES.includes(s.lineStyle) ? s.lineStyle : true,
            incidents: a.incidents ? (Array.isArray(a.incidentCategories) && a.incidentCategories.length ? a.incidentCategories : true) : false,
            showDelta: cfg.display.showDelta !== false,
            showTrend: cfg.display.showTrend !== false,
            animations: cfg.display.animations !== false,
            warnAt: cfg.thresholds.warning,
            criticalAt: Math.round((cfg.thresholds.critical - 1) * 100)
        };
    }

    const api = { normalize, toSimple, INCIDENT_CATEGORIES };
    root.TrafficGlanceConfig = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
