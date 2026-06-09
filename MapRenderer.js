class MapRenderer {
    constructor(containerId, config) {
        this.config = config;
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
        this.tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19
        }).addTo(this.map);
        if (this.config.showMapScale !== false) {
            L.control.scale({ position: 'bottomright', metric: true, imperial: false }).addTo(this.map);
        }
    }

    switchTileLayer(useTomTomTiles) {
        if (this.tileLayer) {
            this.map.removeLayer(this.tileLayer);
        }

        const url = useTomTomTiles
            ? `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${this.config.apiKey}`
            : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

        this.tileLayer = L.tileLayer(url, { maxZoom: 19 }).addTo(this.map);
    }

    destroy() {
        if (this.routeLayer) {
            this.routeLayer.clearLayers();
            this.map.removeLayer(this.routeLayer);
            this.routeLayer = null;
        }
        if (this.tileLayer) {
            this.map.removeLayer(this.tileLayer);
            this.tileLayer = null;
        }
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
    }

    draw(trafficData) {
        if (!this.map || !trafficData || trafficData.length === 0) return;

        this.routeLayer.clearLayers();
        let allPoints = [];

        trafficData.forEach(route => {
            if (!route.polyline) return;

            const latLngs = route.polyline.map(p => [p.latitude, p.longitude]);
            allPoints.push(...latLngs);

            const routeColor = ColorTheme.getRouteColor(route, this.config.thresholds?.critical);

            L.polyline(latLngs, {
                color: routeColor,
                weight: 5,
                opacity: 0.9,
                lineJoin: 'round',
                lineCap: 'round'
            }).addTo(this.routeLayer);

            if (route.bottlenecks && route.bottlenecks.length > 0) {
                route.bottlenecks.forEach(section => {
                    const segment = latLngs.slice(section.startPointIndex, section.endPointIndex + 1);
                    const bottleneckColor = section.magnitude === 4 ? '#c0392b' : '#e74c3c';

                    L.polyline(segment, {
                        color: bottleneckColor,
                        weight: 7,
                        opacity: 1.0,
                        lineCap: 'round'
                    }).addTo(this.routeLayer);
                });
            }
        });

        if (allPoints.length > 0) {
            const bounds = L.latLngBounds(allPoints);
            this.map.fitBounds(bounds, { padding: this.config.mapPadding || [15, 15] });
        }

        setTimeout(() => {
            this.map.invalidateSize();
        }, 100);
    }
}
