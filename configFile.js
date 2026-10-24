"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { isDeepStrictEqual } = require("util");

const normalizer = require("./configNormalizer");

const CONFIG_PATH = path.resolve(__dirname, "../../config/config.js");
const UNPARSABLE = "Settings cannot be parsed, please check manually.";
const INCIDENT_CATEGORIES = normalizer.INCIDENT_CATEGORIES;
const LATLON_RE = /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/;
const HERO_RE = /^([01]?\d|2[0-3]):[0-5]\d-([01]?\d|2[0-3]):[0-5]\d$/;

const field = (p, section, label, type, extra = {}) => ({ path: p, section, label, type, ...extra });
const opt = (value, label) => ({ value, label });

const SCHEMA = [
    field("refreshMinutes", "General", "Refresh interval (minutes)", "number", { min: 1, max: 1440 }),
    field("monthlyQuota", "General", "Monthly API quota (0 = no pacing)", "number", { min: 0, max: 1000000, integer: true }),
    field("width", "General", "Max width (px, 0 = no limit)", "number", { min: 0, max: 3000, integer: true }),
    field("scale", "General", "Scale (1 = 100%)", "number", { min: 0.5, max: 3 }),

    field("map", "Map", "Map", "choice", {
        options: [opt("leaflet", "Leaflet (OpenStreetMap)"), opt("leaflet-fr", "Leaflet (OpenStreetMap France)"),
            opt("leaflet-tomtom", "Leaflet (TomTom night)"), opt("svg", "SVG (vector)"), opt(false, "Off")]
    }),
    field("mapHeight", "Map", "Map height (px)", "number", { min: 60, max: 2000, integer: true }),

    field("sparkline", "Display", "Sparkline", "choice", {
        options: [opt(true, "Straight"), opt("curved", "Curved"), opt("stepped", "Stepped"), opt(false, "Off")]
    }),
    field("incidents", "Display", "Incidents (none = off)", "incidents", { options: INCIDENT_CATEGORIES }),
    field("showDelta", "Display", "Show delta vs average", "boolean"),
    field("showTrend", "Display", "Show trend arrow", "boolean"),
    field("animations", "Display", "Animations", "boolean"),
    field("warnAt", "Display", "Yellow when slower than usual by (%)", "number", { min: 0, max: 100 }),
    field("criticalAt", "Display", "Red when slower than usual by (%)", "number", { min: 1, max: 400 }),

    field("routes", "Routes", "Routes", "routes")
];

const FIELDS = new Map(SCHEMA.map(f => [f.path, f]));

function getPath(obj, p) {
    return p.split(".").reduce((o, k) => (o !== null && typeof o === "object" ? o[k] : undefined), obj);
}

function setPathObj(obj, p, value) {
    const segs = p.split(".");
    const last = segs.pop();
    let o = obj;
    for (const k of segs) {
        if (o[k] === null || typeof o[k] !== "object") o[k] = {};
        o = o[k];
    }
    o[last] = value;
}

function buildMask(text) {
    const mask = new Uint8Array(text.length);
    let i = 0;
    while (i < text.length) {
        const c = text[i], n = text[i + 1];
        if (c === "/" && n === "/") {
            let j = i;
            while (j < text.length && text[j] !== "\n") j++;
            mask.fill(2, i, j);
            i = j;
        } else if (c === "/" && n === "*") {
            const e = text.indexOf("*/", i + 2);
            const j = e === -1 ? text.length : e + 2;
            mask.fill(2, i, j);
            i = j;
        } else if (c === '"' || c === "'" || c === "`") {
            let j = i + 1;
            while (j < text.length && text[j] !== c) { if (text[j] === "\\") j++; j++; }
            j = Math.min(j + 1, text.length);
            mask.fill(1, i, j);
            i = j;
        } else i++;
    }
    return mask;
}

function matchClose(text, mask, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (mask[i]) continue;
        const c = text[i];
        if (c === "{" || c === "[" || c === "(") depth++;
        else if (c === "}" || c === "]" || c === ")") { depth--; if (depth === 0) return i; }
    }
    return -1;
}

function locateModule(text) {
    const mask = buildMask(text);
    const re = /module\s*:\s*(["'])MMM-TrafficGlance\1/g;
    const hits = [];
    let m;
    while ((m = re.exec(text))) if (!mask[m.index]) hits.push(m.index);
    if (hits.length !== 1) return null;
    let depth = 0, start = -1;
    for (let i = hits[0]; i >= 0; i--) {
        if (mask[i]) continue;
        const c = text[i];
        if (c === "}" || c === "]") depth++;
        else if (c === "{" || c === "[") {
            if (depth === 0) { start = i; break; }
            depth--;
        }
    }
    if (start === -1 || text[start] !== "{") return null;
    const end = matchClose(text, mask, start);
    return end === -1 ? null : { start, end, mask };
}

function parseBlock(text) {
    const loc = locateModule(text);
    if (!loc) return null;
    try {
        const raw = vm.runInNewContext("(" + text.slice(loc.start, loc.end + 1) + ")", vm.createContext({}), { timeout: 100 });
        const block = JSON.parse(JSON.stringify(raw));
        return block && block.config && typeof block.config === "object" && !Array.isArray(block.config) ? block : null;
    } catch {
        return null;
    }
}

const isTrivia = (text, mask, i) => mask[i] === 2 || /\s/.test(text[i]);

function skipTrivia(text, mask, i, limit) {
    while (i < limit && isTrivia(text, mask, i)) i++;
    return i;
}

function listProps(text, mask, open, close) {
    const props = [];
    let i = open + 1;
    for (;;) {
        i = skipTrivia(text, mask, i, close);
        if (i >= close) return props;
        const keyStart = i;
        let key, keyEnd;
        if (mask[i] === 1) {
            keyEnd = i;
            while (keyEnd < close && mask[keyEnd] === 1) keyEnd++;
            key = text.slice(i + 1, keyEnd - 1);
        } else {
            const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(i, close));
            if (!m) return null;
            key = m[0];
            keyEnd = i + key.length;
        }
        const colon = skipTrivia(text, mask, keyEnd, close);
        if (text[colon] !== ":" || mask[colon]) return null;
        const valStart = skipTrivia(text, mask, colon + 1, close);
        let depth = 0, k = valStart;
        for (; k < close; k++) {
            if (mask[k]) continue;
            const c = text[k];
            if (c === "{" || c === "[" || c === "(") depth++;
            else if (c === "}" || c === "]" || c === ")") depth--;
            else if (c === "," && depth === 0) break;
        }
        let valEnd = k;
        while (valEnd > valStart && isTrivia(text, mask, valEnd - 1)) valEnd--;
        props.push({ key, keyStart, valStart, valEnd });
        i = k + 1;
    }
}

const keyText = k => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
const isPrimitive = x => x === null || typeof x !== "object";

function serialize(v, indent) {
    if (Array.isArray(v)) {
        if (v.every(isPrimitive)) return "[" + v.map(x => JSON.stringify(x)).join(", ") + "]";
        const inner = indent + "    ";
        return "[\n" + v.map(x => inner + serialize(x, inner)).join(",\n") + "\n" + indent + "]";
    }
    if (v !== null && typeof v === "object") {
        const keys = Object.keys(v);
        if (keys.length <= 3) return "{ " + keys.map(k => keyText(k) + ": " + serialize(v[k], indent)).join(", ") + " }";
        const inner = indent + "    ";
        return "{\n" + keys.map(k => inner + keyText(k) + ": " + serialize(v[k], inner)).join(",\n") + "\n" + indent + "}";
    }
    return JSON.stringify(v);
}

const lineIndent = (text, pos) => /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", pos - 1) + 1))[0];

function insertProp(text, mask, open, close, props, rest, value, eol, ser) {
    const parentIndent = lineIndent(text, open);
    const indent = props.length ? lineIndent(text, props[props.length - 1].keyStart) : parentIndent + "    ";
    let nested = value;
    for (let i = rest.length - 1; i > 0; i--) nested = { [rest[i]]: nested };
    const entry = keyText(rest[0]) + ": " + ser(nested, indent);
    if (!props.length) return text.slice(0, open + 1) + eol + indent + entry + text.slice(open + 1);

    const lastEnd = props[props.length - 1].valEnd;
    if (!text.slice(open, close).includes("\n")) return text.slice(0, lastEnd) + ", " + entry + text.slice(lastEnd);
    let comma = -1;
    for (let i = lastEnd; i < close; i++) if (!mask[i] && text[i] === ",") { comma = i; break; }
    let q = comma === -1 ? lastEnd : comma + 1;
    while (q < close && text[q] !== "\n" && text[q] !== "\r" && (mask[q] === 2 || text[q] === " " || text[q] === "\t")) q++;
    if (comma !== -1) return text.slice(0, q) + eol + indent + entry + "," + text.slice(q);
    return text.slice(0, lastEnd) + "," + text.slice(lastEnd, q) + eol + indent + entry + text.slice(q);
}

function setPath(text, segs, value) {
    const loc = locateModule(text);
    if (!loc) return null;
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const ser = (v, indent) => serialize(v, indent).replace(/\n/g, eol);
    const full = ["config", ...segs];
    let open = loc.start, close = loc.end;
    for (let d = 0; d < full.length; d++) {
        const props = listProps(text, loc.mask, open, close);
        if (!props) return null;
        const hit = props.find(p => p.key === full[d]);
        if (!hit) return insertProp(text, loc.mask, open, close, props, full.slice(d), value, eol, ser);
        if (d === full.length - 1) {
            return text.slice(0, hit.valStart) + ser(value, lineIndent(text, hit.keyStart)) + text.slice(hit.valEnd);
        }
        if (text[hit.valStart] !== "{" || text[hit.valEnd - 1] !== "}") return null;
        open = hit.valStart;
        close = hit.valEnd - 1;
    }
    return null;
}

const bad = f => ({ ok: false, error: `Invalid value for "${f.label}"` });

function heroValue(v) {
    if (v === undefined || v === null || v === "") return null;
    const list = (Array.isArray(v) ? v : String(v).split(",")).map(x => String(x).replace(/\s+/g, "")).filter(Boolean);
    if (!list.length) return null;
    if (!list.every(x => HERO_RE.test(x))) return undefined;
    return list.length === 1 ? list[0] : list;
}

function checkField(f, v) {
    switch (f.type) {
        case "boolean":
            return typeof v === "boolean" ? { ok: true, value: v } : bad(f);
        case "number":
            if (typeof v !== "number" || !Number.isFinite(v) || v < f.min || v > f.max || (f.integer && !Number.isInteger(v))) return bad(f);
            return { ok: true, value: v };
        case "choice":
            return f.options.some(o => o.value === v) ? { ok: true, value: v } : bad(f);
        case "incidents": {
            if (typeof v === "boolean") return { ok: true, value: v };
            if (!Array.isArray(v) || v.some(x => !f.options.includes(x)) || new Set(v).size !== v.length) return bad(f);
            if (!v.length) return { ok: true, value: false };
            return { ok: true, value: v.length === f.options.length ? true : f.options.filter(x => v.includes(x)) };
        }
        case "routes": {
            if (!Array.isArray(v) || !v.length) return bad(f);
            const ids = new Set();
            const out = [];
            for (const r of v) {
                if (r === null || typeof r !== "object") return bad(f);
                const id = typeof r.id === "string" ? r.id.trim() : "";
                const name = typeof r.name === "string" ? r.name.trim() : "";
                const origin = typeof r.origin === "string" ? r.origin.replace(/\s+/g, "") : "";
                const destination = typeof r.destination === "string" ? r.destination.replace(/\s+/g, "") : "";
                if (!id || !name || ids.has(id) || !LATLON_RE.test(origin) || !LATLON_RE.test(destination)) return bad(f);
                const hero = heroValue(r.hero);
                if (hero === undefined) return bad(f);
                ids.add(id);
                out.push(hero ? { id, name, origin, destination, hero } : { id, name, origin, destination });
            }
            return { ok: true, value: out };
        }
        default:
            return bad(f);
    }
}

function validate(changes) {
    if (changes === null || typeof changes !== "object" || Array.isArray(changes)) return { ok: false, error: "Invalid settings payload" };
    const clean = {};
    for (const [p, v] of Object.entries(changes)) {
        const f = FIELDS.get(p);
        if (!f) return { ok: false, error: `Unknown setting: ${p}` };
        const r = checkField(f, v);
        if (!r.ok) return r;
        clean[p] = r.value;
    }
    return { ok: true, clean };
}

function load(configPath) {
    let text;
    try { text = fs.readFileSync(configPath, "utf8"); } catch { return { ok: false, error: UNPARSABLE }; }
    const block = parseBlock(text);
    if (!block) return { ok: false, error: UNPARSABLE };
    const effective = normalizer.normalize(block.config);
    const simple = normalizer.toSimple(effective);
    const values = { ...simple, routes: effective.routes };
    if (simple.incidents === true) values.incidents = INCIDENT_CATEGORIES.slice();
    else if (simple.incidents === false) values.incidents = [];
    return { ok: true, schema: SCHEMA, values };
}

function save(configPath, changes) {
    const checked = validate(changes);
    if (!checked.ok) return checked;
    let text;
    try { text = fs.readFileSync(configPath, "utf8"); } catch { return { ok: false, error: "Config file cannot be read" }; }
    const block = parseBlock(text);
    if (!block) return { ok: false, error: UNPARSABLE };

    const expected = JSON.parse(JSON.stringify(block.config));
    let next = text;
    for (const [p, v] of Object.entries(checked.clean)) {
        const current = getPath(block.config, p);
        if (isDeepStrictEqual(current, v)) continue;
        if (p !== "routes" && current !== null && typeof current === "object") {
            return { ok: false, error: `"${FIELDS.get(p).label}" uses the legacy nested format, please edit config.js manually` };
        }
        next = setPath(next, p.split("."), v);
        if (next === null) return { ok: false, error: `Cannot update "${FIELDS.get(p).label}" safely, please edit manually` };
        setPathObj(expected, p, v);
    }
    if (next === text) return { ok: true, changed: false };

    const after = parseBlock(next);
    if (!after || !isDeepStrictEqual(after.config, expected)) {
        return { ok: false, error: "Verification failed, config.js left unchanged" };
    }
    try {
        fs.copyFileSync(configPath, configPath + ".bak");
        const tmp = configPath + ".tmp";
        fs.writeFileSync(tmp, next);
        fs.renameSync(tmp, configPath);
    } catch (e) {
        return { ok: false, error: `Cannot write config.js: ${e.message}` };
    }
    return { ok: true, changed: true };
}

module.exports = { CONFIG_PATH, UNPARSABLE, SCHEMA, load, save, validate, parseBlock, setPath };
