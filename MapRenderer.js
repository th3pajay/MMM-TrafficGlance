class MapRenderer {
    static IDLE_HOME_MS = 60000;
    static OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    static PROVIDERS = {
        osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, className: 'tg-osm-dark', attribution: MapRenderer.OSM_ATTRIBUTION },
        osmfr: { url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', maxZoom: 19, className: 'tg-osm-dark', attribution: MapRenderer.OSM_ATTRIBUTION },
        tomtom: { url: 'https://api.tomtom.com/map/1/tile/basic/night/{z}/{x}/{y}.png?key={key}', maxZoom: 22, hiDpi: true, attribution: '&copy; <a href="https://www.tomtom.com">TomTom</a>' }
    };
    static FLOW_URL = 'https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key={key}';
    static FLOW_MAX_ZOOM = 19;

    static density(scale, dpr = globalThis.devicePixelRatio) {
        const s = scale > 0 && isFinite(scale) ? scale : 1;
        const d = dpr > 0 && isFinite(dpr) ? dpr : 1;
        return s * d;
    }

    static tileGrid(density, hiDpi = false, maxZoom = 19) {
        const r = density > 0 && isFinite(density) ? density : 1;
        const retina = hiDpi && r > 1;
        const raw = Math.round(Math.log2(retina ? r / 2 : r));
        const offset = Math.max(-2, Math.min(2, retina ? Math.max(0, raw) : r > 1 ? Math.max(1, raw) : raw)) || 0;
        return {
            retina,
            tileSize: 256 / 2 ** offset,
            zoomOffset: offset,
            minNativeZoom: Math.max(0, -offset),
            maxNativeZoom: maxZoom - offset
        };
    }

    static tileBleed(density) {
        const r = density > 0 && isFinite(density) ? density : 1;
        return Math.max(1, Math.ceil(1 / (r * Math.SQRT1_2)));
    }

    _tileLayer(url, { hiDpi, maxZoom, ...opts }) {
        const density = MapRenderer.density(this.config.scale);
        const { retina, ...grid } = MapRenderer.tileGrid(density, hiDpi, maxZoom);
        const bleed = MapRenderer.tileBleed(density);
        const layer = L.tileLayer(retina ? `${url}&tileSize=512` : url, {
            ...opts,
            ...grid,
            maxZoom,
            key: this.config.apiKey ?? "",
            updateWhenZooming: false,
            updateWhenIdle: true,
            referrerPolicy: 'strict-origin-when-cross-origin'
        });
        const size = grid.tileSize + bleed + "px";
        layer.on("tileloadstart", ({ tile }) => {
            tile.decoding = "async";
            tile.style.width = size;
            tile.style.height = size;
        });
        return layer;
    }

    constructor(containerId, config) {
        this.config = config;
        this._layers = new Map();
        this.map = L.map(containerId, {
            zoomControl: false,
            attributionControl: true,
            dragging: true,
            scrollWheelZoom: true,
            touchZoom: false,
            zoomSnap: 0.25,
            fadeAnimation: config.display?.animations !== false
        });
        this._buildZoom();
        this.map.on("dragstart", () => this._touched());
        this.map.getContainer().addEventListener("wheel", () => this._touched(), { passive: true });
        this.routeLayer = L.layerGroup().addTo(this.map);
        const { url, ...tileOptions } = MapRenderer.PROVIDERS[this.config.map?.tileProvider] ?? MapRenderer.PROVIDERS.osm;
        this.tileLayer = this._tileLayer(url, tileOptions).addTo(this.map);
        this.flowLayer = null;
        if (this.config.map.showScale !== false)
            L.control.scale({ position: 'bottomright', metric: true, imperial: false }).addTo(this.map);
    }

    setFlowOverlay(enabled) {
        if (enabled && !this.flowLayer) {
            this.flowLayer = this._tileLayer(MapRenderer.FLOW_URL, { hiDpi: true, maxZoom: MapRenderer.FLOW_MAX_ZOOM, opacity: 0.7 }).addTo(this.map);
        } else if (!enabled && this.flowLayer) {
            this.map.removeLayer(this.flowLayer);
            this.flowLayer = null;
        }
    }

    invalidateSize() {
        this.map?.invalidateSize();
    }

    setView(center, zoom) {
        if (!this.map) return;
        this._homeZoom = zoom;
        this.map.setView(center, zoom);
        this._updateZoom();
    }

    static zoomPill(onStep) {
        const el = document.createElement("div");
        el.className = "tg-zoom-pill";
        el.innerHTML = '<button type="button" data-z="-1" aria-label="Zoom out">\u2212</button>'
            + '<span class="tg-zlevel"></span>'
            + '<button type="button" data-z="1" aria-label="Zoom in">+</button>';
        el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => onStep(Number(b.dataset.z))));
        ["pointerdown", "click", "dblclick", "wheel"].forEach(evt => el.addEventListener(evt, e => e.stopPropagation()));
        const label = el.querySelector(".tg-zlevel");
        return {
            el,
            set(ratio) {
                const r = ratio > 0 && isFinite(ratio) ? ratio : 1;
                const text = `${Number(r.toFixed(r < 10 ? 2 : 0))}\u00d7`;
                if (label.textContent !== text) label.textContent = text;
            }
        };
    }

    _buildZoom() {
        this._zoom = MapRenderer.zoomPill(delta => this.zoomBy(delta));
        this.map.getContainer().appendChild(this._zoom.el);
        this.map.on("zoomend", () => this._updateZoom());
        this._updateZoom();
    }

    _updateZoom() {
        this._zoom?.set(this.getZoom());
    }

    getZoom() {
        if (!this.map) return null;
        return this._homeZoom == null ? 1 : 2 ** (this.map.getZoom() - this._homeZoom);
    }

    zoomBy(delta) {
        if (!this.map) return;
        this._touched();
        this.map.setZoom(this.map.getZoom() + delta);
    }

    _touched() {
        this._lastTouch = Date.now();
        clearTimeout(this._homeTimer);
        this._homeTimer = setTimeout(() => this._fitHome(), MapRenderer.IDLE_HOME_MS);
    }

    _fitHome() {
        if (!this.map || !this._home) return;
        this._lastTouch = 0;
        const { bounds, pad, opts } = this._home;
        this.map.fitBounds(bounds, opts.paddingTopLeft
            ? { paddingTopLeft: opts.paddingTopLeft, paddingBottomRight: pad }
            : { padding: pad });
        this._updateZoom();
    }

    destroy() {
        clearTimeout(this._homeTimer);
        this._layers?.clear();
        this._zoom?.el.remove();
        this._zoom = null;
        this.map?.remove();
        this.map = this.tileLayer = this.flowLayer = this.routeLayer = this._layers = this._bounds = this._drawnData = null;
    }

    static _incidentLabel(inc) {
        return ColorTheme.incidentLabel(inc);
    }

    static _esc(text) {
        return String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }

    draw(trafficData, opts = {}) {
        if (!this.map || !trafficData?.length) return;
        if (trafficData !== this._drawnData || opts.heroId !== this._drawnHero) {
            this._bounds = this._buildRoutes(trafficData, opts.heroId);
            this._drawnData = trafficData;
            this._drawnHero = opts.heroId;
        }
        this._fit(opts);
    }

    _buildRoutes(trafficData, heroId) {
        this.routeLayer.clearLayers();
        const bounds = L.latLngBounds([]), origins = new Map(), next = new Map();
        const animate = this.config.display?.animations !== false;
        const markers = this.config.map.showIncidentMarkers !== false;
        const base = { lineJoin: 'round', lineCap: 'round', interactive: false };

        trafficData.forEach(route => {
            const latLngs = route.polyline
                ? route.polyline.map(p => [p.latitude, p.longitude])
                : this._layers.get(route.id) ?? [];
            if (!latLngs.length) return;
            next.set(route.id, latLngs);
            bounds.extend(latLngs);
            origins.set(latLngs[0].join(","), latLngs[0]);

            const cls = ColorTheme.getRouteColorClass(route, this.config.thresholds);
            const color = ColorTheme.getRouteColor(route, this.config.thresholds);
            const hero = route.id === heroId;
            L.polyline(latLngs, { ...base, color: '#000', weight: hero ? 12 : 10, opacity: 0.75 }).addTo(this.routeLayer);
            L.polyline(latLngs, { ...base, color, weight: hero ? 7 : 5, opacity: 0.95 }).addTo(this.routeLayer);

            const pins = [];
            (route.incidents ?? []).forEach(s => {
                const seg = latLngs.slice(s.startPointIndex, s.endPointIndex + 1);
                if (!seg.length) return;
                const incColor = ColorTheme.getIncidentColor(s.category, s.magnitude);
                if (seg.length > 1) L.polyline(seg, {
                    ...base, color: incColor, weight: hero ? 8 : 6, opacity: 1,
                    dashArray: ColorTheme.incidentDash[s.category] ?? null
                }).addTo(this.routeLayer);
                if (markers) pins.push([seg[Math.floor(seg.length / 2)], incColor, s]);
            });

            if (animate) L.polyline(latLngs, { ...base, color: '#fff', weight: 2, dashArray: '2 12', className: `tg-flow tg-flow-${cls}` }).addTo(this.routeLayer);

            pins.forEach(([pt, incColor, s]) => {
                L.marker(pt, {
                    keyboard: false,
                    icon: L.divIcon({ className: '', iconSize: [12, 12], iconAnchor: [6, 6], html: `<span class="tg-inc" style="background:${incColor}"></span>` })
                }).bindTooltip(MapRenderer._incidentLabel(s), { direction: 'top' }).addTo(this.routeLayer);
            });

            L.marker(latLngs[latLngs.length - 1], {
                interactive: false, keyboard: false, zIndexOffset: hero ? 1000 : 0,
                icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="tg-badge tg-${cls}">${MapRenderer._esc(route.name)} ${route.currentDuration}′</span>` })
            }).addTo(this.routeLayer);
        });

        for (const pt of origins.values()) {
            L.marker(pt, { interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [10, 10], iconAnchor: [5, 5], html: '<span class="tg-home"></span>' }) }).addTo(this.routeLayer);
        }
        this._layers = next;
        return bounds;
    }

    _fit(opts) {
        const bounds = this._bounds;
        if (!bounds?.isValid()) return;
        const pad = this.config.map.padding || [20, 20];
        this._homeZoom = this.map.getBoundsZoom(bounds, false, L.point(opts.paddingTopLeft ?? pad).add(L.point(pad)));
        this._home = { bounds, pad, opts };
        if (this._lastTouch && Date.now() - this._lastTouch < MapRenderer.IDLE_HOME_MS) {
            this._updateZoom();
            return;
        }
        this._fitHome();
    }
}
