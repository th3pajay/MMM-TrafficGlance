class MapRenderer {
    static CARTO = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    constructor(containerId, config) {
        this.config = config;
        this._layers = new Map();
        this.map = L.map(containerId, {
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            scrollWheelZoom: false,
            touchZoom: false
        });
        this.routeLayer = L.layerGroup().addTo(this.map);
        this.initTiles();
    }

    initTiles() {
        this.switchTileLayer(false);
        if (this.config.showMapScale !== false)
            L.control.scale({ position: 'bottomright', metric: true, imperial: false }).addTo(this.map);
    }

    switchTileLayer(useTomTom) {
        this.tileLayer && this.map.removeLayer(this.tileLayer);
        const url = useTomTom
            ? `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${this.config.apiKey}`
            : MapRenderer.CARTO;
        this.tileLayer = L.tileLayer(url, { maxZoom: 19 }).addTo(this.map);
    }

    destroy() {
        this._layers?.clear();
        this.map?.remove();
        this.map = this.tileLayer = this.routeLayer = this._layers = null;
    }

    draw(trafficData) {
        if (!this.map || !trafficData?.length) return;
        const allPoints = [], seen = new Set();

        trafficData.forEach(route => {
            seen.add(route.id);
            const color = ColorTheme.getRouteColor(route, this.config.thresholds?.critical);
            const latLngs = route.polyline
                ? route.polyline.map(p => [p.latitude, p.longitude])
                : this._layers.get(route.id)?.latLngs ?? [];
            if (!latLngs.length) return;
            allPoints.push(...latLngs);

            const existing = this._layers.get(route.id);
            if (existing) {
                existing.line.setLatLngs(latLngs).setStyle({ color });
                existing.bottlenecks.forEach(b => this.routeLayer.removeLayer(b));
            } else {
                const line = L.polyline(latLngs, { color, weight: 5, opacity: 0.9, lineJoin: 'round', lineCap: 'round' }).addTo(this.routeLayer);
                this._layers.set(route.id, { line, latLngs, bottlenecks: [] });
            }

            const entry = this._layers.get(route.id);
            entry.latLngs = latLngs;
            entry.bottlenecks = (route.bottlenecks ?? []).map(s => {
                const seg = latLngs.slice(s.startPointIndex, s.endPointIndex + 1);
                return L.polyline(seg, {
                    color: s.magnitude === 4 ? ColorTheme.traffic.critical : '#e74c3c',
                    weight: 7, opacity: 1, lineCap: 'round'
                }).addTo(this.routeLayer);
            });
        });

        for (const [id, entry] of this._layers) {
            if (!seen.has(id)) {
                this.routeLayer.removeLayer(entry.line);
                entry.bottlenecks.forEach(b => this.routeLayer.removeLayer(b));
                this._layers.delete(id);
            }
        }

        if (allPoints.length) this.map.fitBounds(L.latLngBounds(allPoints), { padding: this.config.mapPadding || [15, 15] });
    }
}
