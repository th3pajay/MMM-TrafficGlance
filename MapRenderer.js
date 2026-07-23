class MapRenderer {
    static CARTO = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    constructor(containerId, config) {
        this.config = config;
        this._layers = new Map();
        this.map = L.map(containerId, {
            zoomControl: true,
            attributionControl: false,
            dragging: false,
            scrollWheelZoom: true,
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
                existing.incidents.forEach(b => this.routeLayer.removeLayer(b));
                existing.markers.forEach(m => this.routeLayer.removeLayer(m));
            } else {
                const line = L.polyline(latLngs, { color, weight: 5, opacity: 0.9, lineJoin: 'round', lineCap: 'round' }).addTo(this.routeLayer);
                this._layers.set(route.id, { line, latLngs, incidents: [], markers: [] });
            }

            const entry = this._layers.get(route.id);
            entry.latLngs = latLngs;
            entry.incidents = (route.incidents ?? []).map(s => {
                const seg = latLngs.slice(s.startPointIndex, s.endPointIndex + 1);
                const closure = s.category === 'ROAD_CLOSURE';
                return L.polyline(seg, {
                    color: ColorTheme.getIncidentColor(s.category, s.magnitude),
                    weight: 7, opacity: 1, lineCap: 'round',
                    dashArray: closure ? '2, 8' : s.category === 'ROAD_WORK' ? '10, 6' : null
                }).addTo(this.routeLayer);
            });
            entry.markers = this.config.showMapIncidentMarkers === false ? [] : (route.incidents ?? []).map(s => {
                const seg = latLngs.slice(s.startPointIndex, s.endPointIndex + 1);
                const pt = seg[Math.floor(seg.length / 2)] ?? seg[0];
                if (!pt) return null;
                return L.circleMarker(pt, {
                    radius: 6, color: '#fff', weight: 1,
                    fillColor: ColorTheme.getIncidentColor(s.category, s.magnitude), fillOpacity: 0.95
                }).bindTooltip(MapRenderer._incidentLabel(s), { direction: 'top' }).addTo(this.routeLayer);
            }).filter(Boolean);
        });

        for (const [id, entry] of this._layers) {
            if (!seen.has(id)) {
                this.routeLayer.removeLayer(entry.line);
                entry.incidents.forEach(b => this.routeLayer.removeLayer(b));
                entry.markers.forEach(m => this.routeLayer.removeLayer(m));
                this._layers.delete(id);
            }
        }

        if (allPoints.length) this.map.fitBounds(L.latLngBounds(allPoints), { padding: this.config.mapPadding || [20, 20] });
    }
}
