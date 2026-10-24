class SvgMapRenderer {
    static NS = "http://www.w3.org/2000/svg";
    static KINDS = ["water", "river", "tertiary", "secondary", "primary", "motorway"];
    static MAX_ZOOM_IN = 16;
    static BASEMAP_PAD = 0.25;

    constructor(containerId, config, hooks = {}) {
        this.config = config;
        this.hooks = hooks;
        this.container = document.getElementById(containerId);
        this._routes = [];
        this._base = null;
        this._requestedKey = null;
        this._userView = false;
        this._drag = null;
        this.home = null;
        this.view = null;
        this._build();
    }

    static project(lat, lon) {
        return [lon, -(180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
    }

    static _el(name, attrs = {}, parent = null) {
        const el = document.createElementNS(SvgMapRenderer.NS, name);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        if (parent) parent.appendChild(el);
        return el;
    }

    _build() {
        const zcs = this.config.map && this.config.map.zoomControlSize;
        if (typeof zcs === "number" && zcs > 0) this.container.style.setProperty("--tg-zoom-size", zcs + "px");
        this.root = document.createElement("div");
        this.root.className = "tg-svg-map";
        this.svg = SvgMapRenderer._el("svg", { class: "tg-svg", preserveAspectRatio: "xMidYMid slice" }, this.root);
        this.baseGroup = SvgMapRenderer._el("g", { class: "tg-base" }, this.svg);
        this.routeGroup = SvgMapRenderer._el("g", { class: "tg-routes" }, this.svg);
        this.incidentGroup = SvgMapRenderer._el("g", { class: "tg-incidents" }, this.svg);
        this.markerGroup = SvgMapRenderer._el("g", { class: "tg-markers" }, this.svg);

        const zoom = document.createElement("div");
        zoom.className = "tg-svg-zoom";
        [["+", 0.7], ["−", 1 / 0.7]].forEach(([label, factor]) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = label;
            b.addEventListener("click", () => this._zoomBy(factor, 0.5, 0.5));
            zoom.appendChild(b);
        });
        this.root.appendChild(zoom);

        const attr = document.createElement("div");
        attr.className = "tg-svg-attribution";
        attr.textContent = "© OpenStreetMap contributors";
        this.root.appendChild(attr);

        if (this.config.map.showScale !== false) {
            this.scale = document.createElement("div");
            this.scale.className = "tg-svg-scale";
            this.scaleLabel = document.createElement("span");
            this.scale.appendChild(this.scaleLabel);
            this.root.appendChild(this.scale);
        }

        this._onPointerDown = e => {
            if (e.button !== 0 || !this.view) return;
            this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY, view: { ...this.view }, rect: this.svg.getBoundingClientRect() };
            this.svg.setPointerCapture(e.pointerId);
            this.svg.classList.add("tg-dragging");
        };
        this._onPointerMove = e => {
            const d = this._drag;
            if (!d || d.id !== e.pointerId) return;
            const r = d.rect;
            if (!r.width || !r.height) return;
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            if (!this._userView && Math.abs(dx) + Math.abs(dy) < 3) return;
            this._userView = true;
            this.view = { x: d.view.x - (dx / r.width) * d.view.w, y: d.view.y - (dy / r.height) * d.view.h, w: d.view.w, h: d.view.h };
            this._scheduleApply();
        };
        this._onPointerUp = e => {
            if (!this._drag || this._drag.id !== e.pointerId) return;
            this._drag = null;
            this.svg.classList.remove("tg-dragging");
        };
        this._onReset = () => {
            if (!this.home) return;
            this._userView = false;
            this.view = { ...this.home };
            this._applyView();
        };
        this.svg.addEventListener("pointerdown", this._onPointerDown);
        this.svg.addEventListener("pointermove", this._onPointerMove);
        this.svg.addEventListener("pointerup", this._onPointerUp);
        this.svg.addEventListener("pointercancel", this._onPointerUp);
        this.svg.addEventListener("dblclick", this._onReset);

        this._onWheel = e => {
            e.preventDefault();
            const r = this.svg.getBoundingClientRect();
            if (!r.width || !r.height) return;
            this._zoomBy(e.deltaY < 0 ? 0.8 : 1.25, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        };
        this.svg.addEventListener("wheel", this._onWheel, { passive: false });
        this.container.appendChild(this.root);
    }

    _size() {
        return [this.container.clientWidth || 300, this.container.clientHeight || 220];
    }

    _applyView() {
        if (!this.view) return;
        const { x, y, w, h } = this.view;
        this.svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
        this._updateScale();
    }

    _scheduleApply() {
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => {
            this._raf = 0;
            this._applyView();
        });
    }

    _updateScale() {
        if (!this.scale || !this.view) return;
        const width = this.svg.clientWidth || this._size()[0];
        const latRad = 2 * Math.atan(Math.exp(-((this.view.y + this.view.h / 2) * Math.PI) / 180)) - Math.PI / 2;
        const metersPerPx = (this.view.w * 111320 * Math.cos(latRad)) / width;
        if (!(metersPerPx > 0)) return;
        const target = metersPerPx * 100;
        const pow = Math.pow(10, Math.floor(Math.log10(target)));
        const nice = [5, 2, 1].map(m => m * pow).find(v => v <= target) ?? pow;
        this.scale.style.width = Math.max(nice / metersPerPx, 10) + "px";
        this.scaleLabel.textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
    }

    _zoomBy(factor, fx, fy) {
        if (!this.home || !this.view) return;
        const w = Math.min(this.home.w, Math.max(this.home.w / SvgMapRenderer.MAX_ZOOM_IN, this.view.w * factor));
        const h = w * (this.home.h / this.home.w);
        const wx = this.view.x + fx * this.view.w;
        const wy = this.view.y + fy * this.view.h;
        this.view = { x: wx - fx * w, y: wy - fy * h, w, h };
        if (w >= this.home.w) {
            this._userView = false;
            this.view = { ...this.home };
        } else {
            this._userView = true;
        }
        this._scheduleApply();
    }

    _fit(points) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of points) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        const [cw, ch] = this._size();
        const [padY, padX] = this.config.map.padding || [20, 20];
        const [extraX, extraY] = this._padTopLeft ? [Math.max(this._padTopLeft[0] - padX, 0), Math.max(this._padTopLeft[1] - padY, 0)] : [0, 0];
        const bw = Math.max(maxX - minX, 1e-5), bh = Math.max(maxY - minY, 1e-5);
        const availW = Math.max(cw - 2 * padX - extraX, 10), availH = Math.max(ch - 2 * padY - extraY, 10);
        const scale = Math.max(bw / availW, bh / availH);
        const w = cw * scale, h = ch * scale;
        this.home = { x: (minX + maxX) / 2 - (extraX / 2) * scale - w / 2, y: (minY + maxY) / 2 - (extraY / 2) * scale - h / 2, w, h };
        if (!this._userView || !this.view) this.view = { ...this.home };
        this._applyView();
    }

    _pathD(points, close = false, projected = false) {
        let d = "";
        for (let i = 0; i < points.length; i++) {
            const [x, y] = projected ? points[i] : SvgMapRenderer.project(points[i][0], points[i][1]);
            d += (i ? "L" : "M") + x.toFixed(4) + " " + y.toFixed(4);
        }
        return close ? d + "Z" : d;
    }

    _requestBasemapFor(latLngs) {
        if (!this.hooks.requestBasemap || !latLngs.length) return;
        let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
        for (const [lat, lon] of latLngs) {
            if (lat < s) s = lat;
            if (lat > n) n = lat;
            if (lon < w) w = lon;
            if (lon > e) e = lon;
        }
        const padLat = Math.max((n - s) * SvgMapRenderer.BASEMAP_PAD, 0.02);
        const padLon = Math.max((e - w) * SvgMapRenderer.BASEMAP_PAD, 0.02);
        const bbox = [s - padLat, w - padLon, n + padLat, e + padLon];
        const b = this._base && this._base.bbox;
        const covered = b && bbox[0] >= b[0] && bbox[1] >= b[1] && bbox[2] <= b[2] && bbox[3] <= b[3];
        if (covered) return;
        const key = bbox.map(v => v.toFixed(3)).join(",");
        if (key === this._requestedKey) return;
        this._requestedKey = key;
        this.hooks.requestBasemap(bbox);
    }

    setBasemap(data) {
        if (!this.baseGroup || !data || !Array.isArray(data.features)) return;
        this._base = data;
        this.baseGroup.textContent = "";
        const byKind = new Map(SvgMapRenderer.KINDS.map(k => [k, []]));
        for (const f of data.features) {
            if (!byKind.has(f.k)) continue;
            const closed = f.k === "water" && f.p.length > 3
                && f.p[0][0] === f.p[f.p.length - 1][0] && f.p[0][1] === f.p[f.p.length - 1][1];
            byKind.get(f.k).push(this._pathD(f.p, closed));
        }
        for (const [kind, ds] of byKind) {
            if (!ds.length) continue;
            SvgMapRenderer._el("path", { class: `tg-base-${kind}`, d: ds.join(""), "vector-effect": "non-scaling-stroke" }, this.baseGroup);
        }
    }

    setFlowOverlay() {}

    invalidateSize() {
        if (this._lastPoints) this._fit(this._lastPoints);
    }

    setView() {}

    destroy() {
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = 0;
        if (this.svg) {
            this.svg.removeEventListener("wheel", this._onWheel);
            this.svg.removeEventListener("pointerdown", this._onPointerDown);
            this.svg.removeEventListener("pointermove", this._onPointerMove);
            this.svg.removeEventListener("pointerup", this._onPointerUp);
            this.svg.removeEventListener("pointercancel", this._onPointerUp);
            this.svg.removeEventListener("dblclick", this._onReset);
        }
        this.root?.remove();
        this.root = this.svg = this.scale = this.scaleLabel = this.baseGroup = this.routeGroup = this.incidentGroup = this.markerGroup = null;
        this._routes = this._base = this._lastPoints = null;
    }

    _line(parent, xy, color, width, extra = {}) {
        return SvgMapRenderer._el("path", {
            d: this._pathD(xy, false, true), fill: "none", stroke: color, "stroke-width": width,
            "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke", ...extra
        }, parent);
    }

    draw(trafficData, opts = {}) {
        if (!this.svg || !trafficData?.length) return;
        this._padTopLeft = opts.paddingTopLeft ?? null;
        this.routeGroup.textContent = "";
        this.incidentGroup.textContent = "";
        this.markerGroup.textContent = "";
        const showMarkers = this.config.map.showIncidentMarkers !== false;
        const allLatLngs = [];
        const allXY = [];
        const seen = new Map(this._routes.map(r => [r.id, r]));
        this._routes = [];

        trafficData.forEach(route => {
            let latLngs, xy;
            if (route.polyline) {
                latLngs = new Array(route.polyline.length);
                xy = new Array(route.polyline.length);
                for (let i = 0; i < route.polyline.length; i++) {
                    const p = route.polyline[i];
                    latLngs[i] = [p.latitude, p.longitude];
                    xy[i] = SvgMapRenderer.project(p.latitude, p.longitude);
                }
            } else {
                const prev = seen.get(route.id);
                if (!prev) return;
                ({ latLngs, xy } = prev);
            }
            if (!latLngs.length) return;
            this._routes.push({ id: route.id, latLngs, xy });
            for (let i = 0; i < latLngs.length; i++) {
                allLatLngs.push(latLngs[i]);
                allXY.push(xy[i]);
            }
            this._line(this.routeGroup, xy, ColorTheme.getRouteColor(route, this.config.thresholds), 6, { opacity: 0.9 });

            (route.incidents ?? []).forEach(inc => {
                const seg = xy.slice(inc.startPointIndex, inc.endPointIndex + 1);
                if (seg.length < 2) return;
                const color = ColorTheme.getIncidentColor(inc.category, inc.magnitude);
                const dash = inc.category === "ROAD_CLOSURE" ? "2 8" : inc.category === "ROAD_WORK" ? "10 6" : null;
                this._line(this.incidentGroup, seg, color, 7, dash ? { "stroke-dasharray": dash } : {});
                if (!showMarkers) return;
                const [x, y] = seg[Math.floor(seg.length / 2)];
                const d = `M${x.toFixed(4)} ${y.toFixed(4)}h0.00001`;
                const marker = { fill: "none", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" };
                SvgMapRenderer._el("path", { ...marker, d, stroke: "#fff", "stroke-width": 17 }, this.markerGroup);
                const dot = SvgMapRenderer._el("path", { ...marker, d, stroke: color, "stroke-width": 13 }, this.markerGroup);
                SvgMapRenderer._el("title", {}, dot).textContent = SvgMapRenderer._incidentLabel(inc);
            });
        });

        if (!allLatLngs.length) return;
        this._lastPoints = allXY;
        this._fit(this._lastPoints);
        this._requestBasemapFor(allLatLngs);
    }

    static _incidentLabel(inc) {
        const mins = Math.round((inc.delaySeconds ?? 0) / 60);
        const suffix = mins > 0 ? ` +${mins}m` : "";
        switch (inc.category) {
            case "ROAD_CLOSURE": return "Closure";
            case "JAM": return `Jam${suffix}`;
            case "ROAD_WORK": return `Roadwork${suffix}`;
            default: return `Delay${suffix}`;
        }
    }
}
