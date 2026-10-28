class MapRenderer {
    static OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    static PROVIDERS = {
        osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, className: 'tg-osm-dark', attribution: MapRenderer.OSM_ATTRIBUTION },
        osmfr: { url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', maxZoom: 19, className: 'tg-osm-dark', attribution: MapRenderer.OSM_ATTRIBUTION },
        tomtom: { url: 'https://api.tomtom.com/map/1/tile/basic/night/{z}/{x}/{y}.png?key={key}', maxZoom: 22, attribution: '&copy; <a href="https://www.tomtom.com">TomTom</a>' }
    };

    constructor(containerId, config) {
        this.config = config;
        this._layers = new Map();
        this.map = L.map(containerId, {
            zoomControl: false,
            attributionControl: true,
            dragging: false,
            scrollWheelZoom: true,
            touchZoom: false,
            zoomSnap: 0.25
        });
        this._buildZoom();
        this.routeLayer = L.layerGroup().addTo(this.map);
        const { url, ...tileOptions } = MapRenderer.PROVIDERS[this.config.map?.tileProvider] ?? MapRenderer.PROVIDERS.osm;
        this.tileLayer = L.tileLayer(url, {
            ...tileOptions,
            key: this.config.apiKey,
            referrerPolicy: 'strict-origin-when-cross-origin'
        }).addTo(this.map);
        this.flowLayer = null;
        if (this.config.map.showScale !== false)
            L.control.scale({ position: 'bottomright', metric: true, imperial: false }).addTo(this.map);
    }

    setFlowOverlay(enabled) {
        if (enabled && !this.flowLayer) {
            this.flowLayer = L.tileLayer(
                `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${this.config.apiKey}`,
                { maxZoom: 19, opacity: 0.7 }
            ).addTo(this.map);
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
        this.map.setZoom(this.map.getZoom() + delta);
    }

    destroy() {
        this._layers?.clear();
        this._zoom?.el.remove();
        this._zoom = null;
        this.map?.remove();
        this.map = this.tileLayer = this.flowLayer = this.routeLayer = this._layers = null;
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

    static _esc(text) {
        return String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }

    draw(trafficData, opts = {}) {
        if (!this.map || !trafficData?.length) return;
        this.routeLayer.clearLayers();
        const allPoints = [], origins = new Map(), next = new Map();
        const animate = this.config.display?.animations !== false;
        const base = { lineJoin: 'round', lineCap: 'round', interactive: false };

        trafficData.forEach(route => {
            const latLngs = route.polyline
                ? route.polyline.map(p => [p.latitude, p.longitude])
                : this._layers.get(route.id) ?? [];
            if (!latLngs.length) return;
            next.set(route.id, latLngs);
            allPoints.push(...latLngs);
            origins.set(latLngs[0].join(","), latLngs[0]);

            const cls = ColorTheme.getRouteColorClass(route, this.config.thresholds);
            const color = ColorTheme.getRouteColor(route, this.config.thresholds);
            const hero = route.id === opts.heroId;
            L.polyline(latLngs, { ...base, color: '#000', weight: hero ? 12 : 10, opacity: 0.75 }).addTo(this.routeLayer);
            L.polyline(latLngs, { ...base, color, weight: hero ? 7 : 5, opacity: 0.95 }).addTo(this.routeLayer);

            (route.incidents ?? []).forEach(s => {
                const seg = latLngs.slice(s.startPointIndex, s.endPointIndex + 1);
                if (seg.length < 2) return;
                L.polyline(seg, {
                    ...base, color: ColorTheme.getIncidentColor(s.category, s.magnitude), weight: hero ? 8 : 6, opacity: 1,
                    dashArray: s.category === 'ROAD_CLOSURE' ? '2, 8' : s.category === 'ROAD_WORK' ? '10, 6' : null
                }).addTo(this.routeLayer);
            });

            if (animate) L.polyline(latLngs, { ...base, color: '#fff', weight: 2, dashArray: '2 12', className: `tg-flow tg-flow-${cls}` }).addTo(this.routeLayer);

            if (this.config.map.showIncidentMarkers !== false) (route.incidents ?? []).forEach(s => {
                const seg = latLngs.slice(s.startPointIndex, s.endPointIndex + 1);
                const pt = seg[Math.floor(seg.length / 2)] ?? seg[0];
                if (!pt) return;
                L.marker(pt, {
                    keyboard: false,
                    icon: L.divIcon({ className: '', iconSize: [12, 12], iconAnchor: [6, 6], html: `<span class="tg-inc" style="background:${ColorTheme.getIncidentColor(s.category, s.magnitude)}"></span>` })
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

        if (!allPoints.length) return;
        const pad = this.config.map.padding || [20, 20];
        const bounds = L.latLngBounds(allPoints);
        this._homeZoom = this.map.getBoundsZoom(bounds, false, L.point(opts.paddingTopLeft ?? pad).add(L.point(pad)));
        this.map.fitBounds(bounds, opts.paddingTopLeft
            ? { paddingTopLeft: opts.paddingTopLeft, paddingBottomRight: pad }
            : { padding: pad });
        this._updateZoom();
    }
}
