"use strict";

const { INCIDENT_SEVERITY } = require("./configNormalizer");

const CATEGORY_BY_ICON = {
    1: "ACCIDENT", 2: "FOG", 3: "DANGEROUS_CONDITIONS", 4: "RAIN", 5: "ICE", 6: "JAM", 7: "LANE_CLOSED",
    8: "ROAD_CLOSURE", 9: "ROAD_WORK", 10: "WIND", 11: "FLOODING", 14: "BROKEN_DOWN_VEHICLE"
};
const FIELDS = "{incidents{geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,delay,from,to,roadNumbers,events{description,code,iconCategory}}}}";
const MAX_BOX_KM2 = 9000;
const BOX_PAD_KM = 0.5;
const MATCH_METERS = 60;
const MIN_DELAY_SEC = 30;
const MAX_EXTRA = 6;
const MERGE_POSITION = 0.04;
const MAX_SAMPLE = 40;
const GENERIC = new Set(["JAM", "OTHER"]);
const KM_PER_DEG = 111.32;

function cumulativeDistance(polyline) {
    const out = [0];
    for (let i = 1; i < polyline.length; i++) {
        const a = polyline[i - 1], b = polyline[i];
        const dx = (b.longitude - a.longitude) * Math.cos((a.latitude + b.latitude) * Math.PI / 360);
        out.push(out[i - 1] + Math.hypot(dx, b.latitude - a.latitude));
    }
    return out;
}

function boundsOf(points) {
    const b = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
    for (const p of points) {
        if (p.longitude < b.minLon) b.minLon = p.longitude;
        if (p.longitude > b.maxLon) b.maxLon = p.longitude;
        if (p.latitude < b.minLat) b.minLat = p.latitude;
        if (p.latitude > b.maxLat) b.maxLat = p.latitude;
    }
    return b;
}

function padded(b) {
    const dLat = BOX_PAD_KM / KM_PER_DEG;
    const dLon = BOX_PAD_KM / (KM_PER_DEG * Math.max(0.1, Math.cos(((b.minLat + b.maxLat) / 2) * Math.PI / 180)));
    return { minLon: b.minLon - dLon, minLat: b.minLat - dLat, maxLon: b.maxLon + dLon, maxLat: b.maxLat + dLat };
}

function areaKm2(b) {
    const midLat = (b.minLat + b.maxLat) / 2;
    return (b.maxLat - b.minLat) * KM_PER_DEG * (b.maxLon - b.minLon) * KM_PER_DEG * Math.cos(midLat * Math.PI / 180);
}

function union(a, b) {
    return {
        minLon: Math.min(a.minLon, b.minLon), minLat: Math.min(a.minLat, b.minLat),
        maxLon: Math.max(a.maxLon, b.maxLon), maxLat: Math.max(a.maxLat, b.maxLat)
    };
}

function boxesFor(polylines) {
    let boxes = polylines.filter(p => p?.length).map(p => padded(boundsOf(p)));
    for (let merged = true; merged && boxes.length > 1;) {
        merged = false;
        for (let i = 0; i < boxes.length && !merged; i++) {
            for (let j = i + 1; j < boxes.length && !merged; j++) {
                const u = union(boxes[i], boxes[j]);
                if (areaKm2(u) > MAX_BOX_KM2) continue;
                boxes = boxes.filter((_, k) => k !== i && k !== j).concat(u);
                merged = true;
            }
        }
    }
    return boxes.map(b => [b.minLon, b.minLat, b.maxLon, b.maxLat].map(v => v.toFixed(5)).join(","));
}

function requestUrl(key, bbox) {
    const params = new URLSearchParams({ key, bbox, fields: FIELDS, language: "en-GB", timeValidityFilter: "present" });
    return `https://api.tomtom.com/traffic/services/5/incidentDetails?${params}`;
}

function parse(json) {
    const out = [];
    for (const f of json?.incidents ?? []) {
        const p = f.properties ?? {};
        const g = f.geometry ?? {};
        const raw = g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : [];
        const coords = raw.filter(c => Array.isArray(c) && c.length >= 2).map(([longitude, latitude]) => ({ latitude, longitude }));
        if (!coords.length) continue;
        const step = Math.max(1, Math.ceil(coords.length / MAX_SAMPLE));
        out.push({
            category: CATEGORY_BY_ICON[p.iconCategory] ?? "OTHER",
            magnitude: p.magnitudeOfDelay ?? 0,
            delaySeconds: p.delay ?? 0,
            description: p.events?.[0]?.description ?? null,
            roads: Array.isArray(p.roadNumbers) ? p.roadNumbers.join(", ") : null,
            coords: coords.filter((_, i) => i % step === 0 || i === coords.length - 1)
        });
    }
    return out;
}

function pointGrid(polyline, bounds) {
    const cosLat = Math.max(0.1, Math.cos(((bounds.minLat + bounds.maxLat) / 2) * Math.PI / 180));
    const lim = MATCH_METERS / 1000 / KM_PER_DEG;
    const cellLat = lim * 2, cellLon = cellLat / cosLat;
    const cells = new Map();
    const cellOf = (lat, lon) => [Math.floor(lat / cellLat), Math.floor(lon / cellLon)];
    polyline.forEach((p, i) => {
        const [y, x] = cellOf(p.latitude, p.longitude);
        const key = y * 1e6 + x;
        const list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);
    });
    return { cells, cellOf, cosLat, limSq: lim * lim };
}

function indicesNear(polyline, grid, coords) {
    let min = -1, max = -1;
    for (const c of coords) {
        const [y, x] = grid.cellOf(c.latitude, c.longitude);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const list = grid.cells.get((y + dy) * 1e6 + x + dx);
                if (!list) continue;
                for (const i of list) {
                    const px = (polyline[i].longitude - c.longitude) * grid.cosLat;
                    const py = polyline[i].latitude - c.latitude;
                    if (px * px + py * py > grid.limSq) continue;
                    if (min < 0 || i < min) min = i;
                    if (i > max) max = i;
                }
            }
        }
    }
    return min < 0 ? null : { min, max };
}

function enrich(polyline, incidents, details, allowed) {
    if (!polyline?.length || !details?.length) return incidents;
    const grid = pointGrid(polyline, boundsOf(polyline));
    const along = cumulativeDistance(polyline);
    const total = along[along.length - 1] || 0;
    const positionOf = (a, b) => total > 0 ? ((along[a] ?? 0) + (along[b] ?? along[a] ?? 0)) / 2 / total : 0;
    const rank = c => INCIDENT_SEVERITY[c] ?? 0;
    const near = [];
    for (const d of details) {
        const span = indicesNear(polyline, grid, d.coords);
        if (span) near.push({ ...d, span });
    }

    const used = new Set();
    const result = incidents.map(inc => {
        let best = null;
        near.forEach((d, k) => {
            if (d.span.max < inc.startPointIndex - 2 || d.span.min > inc.endPointIndex + 2) return;
            if (GENERIC.has(d.category)) used.add(k);
            if (d.category === "OTHER") return;
            if (!best || rank(d.category) > rank(best.d.category)) best = { d, k };
        });
        if (!best) return inc;
        used.add(best.k);
        const specific = !GENERIC.has(best.d.category) && (!allowed || allowed.includes(best.d.category));
        return {
            ...inc,
            category: specific ? best.d.category : inc.category,
            description: best.d.description, roads: best.d.roads, detail: true
        };
    });

    const groups = [];
    near
        .filter((d, k) => !used.has(k) && (!GENERIC.has(d.category) || d.delaySeconds > MIN_DELAY_SEC))
        .filter(d => !allowed || allowed.includes(d.category))
        .sort((a, b) => a.span.min - b.span.min)
        .forEach(d => {
            const pos = positionOf(d.span.min, d.span.max);
            const g = groups.find(x => x.category === d.category
                && (Math.abs(x.pos - pos) < MERGE_POSITION || (d.span.min <= x.span.max && d.span.max >= x.span.min)));
            if (!g) {
                groups.push({ ...d, span: { ...d.span }, pos, count: 1 });
                return;
            }
            g.span.min = Math.min(g.span.min, d.span.min);
            g.span.max = Math.max(g.span.max, d.span.max);
            g.delaySeconds = Math.max(g.delaySeconds, d.delaySeconds);
            g.magnitude = Math.max(g.magnitude, d.magnitude);
            g.pos = positionOf(g.span.min, g.span.max);
            g.count++;
        });
    const extra = groups
        .sort((a, b) => rank(b.category) - rank(a.category) || b.delaySeconds - a.delaySeconds)
        .slice(0, MAX_EXTRA)
        .map(d => {
            const start = d.span.min, end = Math.min(polyline.length - 1, Math.max(d.span.max, d.span.min + 1));
            return {
                startPointIndex: start, endPointIndex: end, magnitude: d.magnitude, category: d.category,
                delaySeconds: d.delaySeconds, position: positionOf(start, end), count: d.count,
                description: d.description, roads: d.roads, detail: true
            };
        });
    return result.concat(extra);
}

module.exports = { boxesFor, requestUrl, parse, enrich, cumulativeDistance, CATEGORY_BY_ICON, FIELDS };
