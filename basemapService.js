"use strict";

const fs = require("fs");
const path = require("path");

const CACHE_PATH = path.resolve(__dirname, "basemap_cache.json");
const OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];
const MAX_ENTRIES = 12;
const WIDE_SPAN_DEG = 1.5;
const MAX_SPAN_DEG = 4;
const MAX_FEATURES = 1500;
const GRID_DEG = 0.05;

const ROADS_ALL = "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|tertiary";
const ROADS_WIDE = "motorway|trunk|primary";

function normalizeBbox(bbox) {
    if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some(v => typeof v !== "number" || !Number.isFinite(v))) return null;
    const [s, w, n, e] = bbox;
    if (s < -85 || n > 85 || w < -180 || e > 180 || s >= n || w >= e) return null;
    if (n - s > MAX_SPAN_DEG || e - w > MAX_SPAN_DEG) return null;
    return [
        Math.floor(s / GRID_DEG + 1e-9) * GRID_DEG,
        Math.floor(w / GRID_DEG + 1e-9) * GRID_DEG,
        Math.ceil(n / GRID_DEG - 1e-9) * GRID_DEG,
        Math.ceil(e / GRID_DEG - 1e-9) * GRID_DEG
    ].map(v => Number(v.toFixed(2)));
}

function keyOf(bbox) {
    return bbox.join(",");
}

function buildQuery(bbox) {
    const [s, w, n, e] = bbox;
    const wide = n - s > WIDE_SPAN_DEG || e - w > WIDE_SPAN_DEG;
    const box = `${s},${w},${n},${e}`;
    return `[out:json][timeout:25];(`
        + `way["highway"~"^(${wide ? ROADS_WIDE : ROADS_ALL})$"](${box});`
        + `way["natural"="water"](${box});`
        + `way["waterway"="river"](${box});`
        + `);out geom;`;
}

function classify(tags = {}) {
    if (tags.natural === "water") return "water";
    if (tags.waterway === "river") return "river";
    const h = String(tags.highway ?? "").replace("_link", "");
    if (h === "motorway" || h === "trunk") return "motorway";
    if (h === "primary") return "primary";
    if (h === "secondary") return "secondary";
    if (h === "tertiary") return "tertiary";
    return null;
}

function decimate(points, minStep) {
    if (points.length <= 2) return points;
    const out = [points[0]];
    let last = points[0];
    for (let i = 1; i < points.length - 1; i++) {
        const p = points[i];
        if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= minStep) { out.push(p); last = p; }
    }
    out.push(points[points.length - 1]);
    return out;
}

function toFeatures(elements, bbox) {
    const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
    const minStep = span / 500;
    const features = [];
    for (const el of elements ?? []) {
        if (el.type !== "way" || !Array.isArray(el.geometry)) continue;
        const kind = classify(el.tags);
        if (!kind) continue;
        const pts = decimate(el.geometry.map(g => [Number(g.lat.toFixed(5)), Number(g.lon.toFixed(5))]), minStep);
        if (pts.length < 2) continue;
        features.push({ k: kind, p: pts });
    }
    const order = { motorway: 0, primary: 1, water: 2, river: 3, secondary: 4, tertiary: 5 };
    features.sort((a, b) => order[a.k] - order[b.k]);
    return features.slice(0, MAX_FEATURES);
}

const memo = new Map();

function readCache(file = CACHE_PATH) {
    try {
        const st = fs.statSync(file);
        const hit = memo.get(file);
        if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.data;
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        const data = parsed && typeof parsed === "object" ? parsed : {};
        memo.set(file, { mtimeMs: st.mtimeMs, size: st.size, data });
        return data;
    } catch { return {}; }
}

function writeCache(cache, file = CACHE_PATH) {
    const keys = Object.keys(cache);
    if (keys.length > MAX_ENTRIES) {
        keys.sort((a, b) => cache[a].fetched - cache[b].fetched)
            .slice(0, keys.length - MAX_ENTRIES)
            .forEach(k => delete cache[k]);
    }
    try {
        fs.writeFileSync(file, JSON.stringify(cache));
        const st = fs.statSync(file);
        memo.set(file, { mtimeMs: st.mtimeMs, size: st.size, data: cache });
    } catch (e) {
        memo.delete(file);
        console.warn("[MMM-TrafficGlance] basemap cache write failed:", e.message);
    }
}

const inflight = new Map();

async function getBasemap(rawBbox, { fetchImpl = fetch, cacheFile = CACHE_PATH } = {}) {
    const bbox = normalizeBbox(rawBbox);
    if (!bbox) throw new Error("invalid bbox");
    const key = keyOf(bbox);
    const cache = readCache(cacheFile);
    if (cache[key]) return { key, bbox, features: cache[key].features, cached: true };
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
        const body = new URLSearchParams({ data: buildQuery(bbox) });
        let json = null;
        let lastError = null;
        for (const url of OVERPASS_URLS) {
            try {
                const res = await fetchImpl(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "MMM-TrafficGlance" },
                    body,
                    signal: AbortSignal.timeout(30000)
                });
                if (!res.ok) throw new Error(`overpass ${res.status}`);
                json = await res.json();
                break;
            } catch (e) {
                lastError = e;
            }
        }
        if (!json) throw lastError;
        const features = toFeatures(json.elements, bbox);
        const fresh = readCache(cacheFile);
        fresh[key] = { fetched: Date.now(), features };
        writeCache(fresh, cacheFile);
        return { key, bbox, features, cached: false };
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
}

module.exports = { getBasemap, normalizeBbox, buildQuery, toFeatures, classify, decimate, keyOf };
