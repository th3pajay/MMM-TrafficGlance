Module.register("MMM-TrafficGlance", {
    defaults: {
        updateInterval: 300000,
        thresholds: { critical: 1.25 },

        mapWidth: "100%",
        mapHeight: "220px",
        mapZoom: null,
        mapCenter: null,
        showMapScale: true,
        mapPadding: [20, 20],

        api: {
            timeout: 10000,
            routeType: "fastest",
            travelMode: "car",
            traffic: true,
            avoidTolls: false,
            avoidHighways: false
        },

        database: {
            retentionDays: 90,
            cleanupOnStart: true
        },

        sparkline: {
            enabled: true,
            width: 160,              // increased from 120 for labels/grid
            height: 40,              // increased from 24 for labels/grid
            showBaseline: true,
            showNowIndicator: true,
            showNowLabel: true,
            colors: {
                critical: "#e91e63",
                warning: "#f39c12",
                good: "#2ecc71",
                neutral: "#4fc3f7",
                baseline: "#888888"
            },
            // New enhanced sparkline options
            xAxisMode: "frequency",      // "frequency" (raw measurements) | "time" (legacy)
            maxDataPoints: 50,           // max points when xAxisMode="frequency"
            lookbackHours: 48,           // configurable lookback window (default 48h = 2 days)
            showBaselineLabel: true,     // show "Avg: 34m" label
            showGrid: true,              // horizontal grid lines
            gridTicks: 4,                // number of grid divisions
            showYLabels: true,           // Y-axis value labels (e.g., "40m" marks)
            useZScoreColors: true,       // per-segment Z-score coloring
            showLegend: true             // inline legend below sparkline
        },

    },

    getStyles: () => ["MMM-TrafficGlance.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"],
    getScripts: () => ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "ColorTheme.js", "MapStateMachine.js", "MapRenderer.js", "TemplateEngine.js"],

    start: function() {
        this.trafficData = [];
        this.mapEngine = null;
        this.configErrors = null;
        this.persistentWrapper = null;  // Cache DOM root to prevent recreation
        this.mapState = new MapStateMachine();
        this.sparklineTimeouts = new Map();
        this.quotaExhausted = false;
        this.nextResetTime = null;
        this.fetchError = null;
        this.sendSocketNotification("CONFIG", this.config);
    },

    socketNotificationReceived: function(notification, payload) {
        if (notification === "TRAFFIC_UPDATE") {
            this.fetchError = null;
            this.trafficData = payload;

            // If map already initialized, update data directly without DOM recreation
            if (this.mapState.isReady() && this.mapEngine && this.persistentWrapper) {
                this.updateRouteContainer();
                this.mapEngine.draw(this.trafficData);
            } else {
                // First load or map not ready: use full DOM update
                if (this.updateTimeout) clearTimeout(this.updateTimeout);
                this.updateTimeout = setTimeout(() => {
                    this.updateDom(500);
                }, 200);
            }
        }
        else if (notification === "QUOTA_EXHAUSTED") {
            console.warn('[TrafficGlance] Quota exhausted, switching to tile-only mode');
            this.quotaExhausted = true;
            this.nextResetTime = payload.nextResetTime;

            // Switch map to TomTom traffic tiles if map already exists
            if (this.mapEngine) {
                this.mapEngine.switchTileLayer(true);
            }

            // Force DOM update to show warning banner and initialize map with traffic tiles
            this.persistentWrapper = null;
            this.mapState.reset();
            this.updateDom();
        }
        else if (notification === "QUOTA_RESTORED") {
            console.log('[TrafficGlance] Quota restored, resuming normal mode');
            this.quotaExhausted = false;

            if (this.mapEngine) {
                this.mapEngine.switchTileLayer(false);
            }

            this.persistentWrapper = null;
            this.mapState.reset();
            this.updateDom();
        }
        else if (notification === "TILE_ONLY_MODE") {
            // Just show map with tiles, no route data updates
            console.log('[TrafficGlance] Tile-only mode active');
        }
        else if (notification === "FETCH_ERROR") {
            this.fetchError = payload.category;
            if (this.trafficData.length === 0) this.updateDom();
        }
        else if (notification === "CONFIG_ERROR") {
            this.configErrors = payload.errors;
            this.updateDom(500);
        }
    },

    getDom: function() {
        // If persistent wrapper exists, update route data and return it
        if (this.persistentWrapper) {
            this.updateRouteContainer();
            return this.persistentWrapper;
        }

        // First call: create full DOM structure
        const wrapper = document.createElement("div");
        wrapper.className = "traffic-root";

        // Display configuration errors
        if (this.configErrors && this.configErrors.length > 0) {
            const errorDiv = document.createElement("div");
            errorDiv.className = "config-error";
            errorDiv.innerHTML = "<strong>Configuration Error:</strong>";

            const errorList = document.createElement("ul");
            this.configErrors.forEach(error => {
                const li = document.createElement("li");
                li.textContent = error;
                errorList.appendChild(li);
            });

            errorDiv.appendChild(errorList);
            wrapper.appendChild(errorDiv);
            return wrapper;
        }

        // Show quota warning banner if exhausted
        if (this.quotaExhausted) {
            const warning = document.createElement("div");
            warning.className = "quota-warning";
            const resetDate = new Date(this.nextResetTime).toLocaleString();
            warning.innerHTML = `⚠️ API quota exceeded - showing traffic tiles only<br>
                                <small>Resets at midnight UTC (${resetDate})</small>`;
            wrapper.appendChild(warning);
        }

        if (this.trafficData.length === 0 && !this.quotaExhausted) {
            const loadingDiv = document.createElement("div");
            loadingDiv.className = "loading";
            if (this.fetchError === 'network') {
                loadingDiv.textContent = "Network unavailable — retrying...";
            } else if (this.fetchError) {
                loadingDiv.textContent = "Traffic data unavailable — retrying...";
            } else {
                loadingDiv.textContent = "Analyzing TomTom Traffic...";
            }
            wrapper.appendChild(loadingDiv);
            return wrapper;
        }

        // Only show route details if NOT in quota exhausted mode
        if (!this.quotaExhausted && this.trafficData.length > 0) {
            const routeContainer = document.createElement("div");
            routeContainer.className = "route-container";

            this.trafficData.forEach(route => {
                try {
                    routeContainer.appendChild(this.renderRouteRow(route));
                } catch (e) {
                    this.sendSocketNotification("RENDER_ERROR", { message: e.message, context: `route:${route.id}` });
                }
            });

            wrapper.appendChild(routeContainer);
        }

        const mapDiv = document.createElement("div");
        mapDiv.id = "traffic-map-container";
        mapDiv.style.height = this.config.mapHeight;
        mapDiv.style.width = this.config.mapWidth;
        wrapper.appendChild(mapDiv);

        // Cache the wrapper for future updates
        this.persistentWrapper = wrapper;

        // Initialize map when DOM is ready
        this.scheduleMapInit();

        return wrapper;
    },

    renderRouteRow: function(route) {
        const routeDiv = document.createElement("div");
        routeDiv.className = "route-row";

        // Header with name and metrics
        const header = document.createElement("div");
        header.className = "route-header";

        const nameSpan = document.createElement("span");
        nameSpan.className = "route-name";
        nameSpan.textContent = route.name;

        const metricsDiv = document.createElement("div");
        metricsDiv.className = "route-metrics";

        const hasSparklineData = route.sparklineData &&
            (Array.isArray(route.sparklineData) ? route.sparklineData.length > 0 : route.sparklineData.points?.length > 0);

        if (this.config.sparkline?.enabled !== false && hasSparklineData) {
            const sparklineContainer = document.createElement("div");
            sparklineContainer.className = "sparkline-container";

            const canvas = document.createElement("canvas");
            canvas.className = "sparkline-canvas";
            canvas.id = `sparkline-${route.id}`;
            canvas.width = this.config.sparkline?.width || 160;
            canvas.height = this.config.sparkline?.height || 40;
            sparklineContainer.appendChild(canvas);

            // Add legend if enabled
            if (this.config.sparkline?.showLegend !== false) {
                const legend = document.createElement("div");
                legend.className = "sparkline-legend";
                legend.innerHTML = `
                    <span class="legend-item good"><span class="legend-dot"></span>Clear</span>
                    <span class="legend-item warning"><span class="legend-dot"></span>Caution</span>
                    <span class="legend-item critical"><span class="legend-dot"></span>Severe</span>
                `;
                sparklineContainer.appendChild(legend);
            }

            metricsDiv.appendChild(sparklineContainer);

            if (this.sparklineTimeouts.has(route.id)) {
                clearTimeout(this.sparklineTimeouts.get(route.id));
            }
            const tid = setTimeout(() => {
                this.sparklineTimeouts.delete(route.id);
                const engine = new SparklineEngine(`sparkline-${route.id}`, route.sparklineData, this.config);
                if (engine.canvas) engine.render();
            }, 100);
            this.sparklineTimeouts.set(route.id, tid);
        }

        // Trend arrow (if historical data available)
        if (route.trendDirection) {
            const arrow = document.createElement("span");
            arrow.className = `trend-arrow ${route.trendDirection}`;
            arrow.textContent = route.trendDirection === 'up' ? '↑' :
                               route.trendDirection === 'down' ? '↓' : '→';
            metricsDiv.appendChild(arrow);
        }

        header.appendChild(nameSpan);
        header.appendChild(metricsDiv);
        routeDiv.appendChild(header);

        // Time display with historical average comparison
        const colorClass = ColorTheme.getRouteColorClass(route, this.config.thresholds?.critical);

        const timeDiv = document.createElement("div");
        timeDiv.className = `route-time ${colorClass}`;

        const bigNum = document.createElement("span");
        bigNum.className = "big-num";
        bigNum.textContent = route.currentDuration;

        const unit = document.createElement("span");
        unit.className = "unit";
        unit.textContent = "mins";

        timeDiv.appendChild(bigNum);
        timeDiv.appendChild(unit);
        routeDiv.appendChild(timeDiv);

        return routeDiv;
    },

    updateRouteContainer: function() {
        if (!this.persistentWrapper) return;

        const routeContainer = this.persistentWrapper.querySelector('.route-container');
        if (!routeContainer) return;

        // Clear existing routes
        routeContainer.innerHTML = '';

        // Rebuild route rows with current data
        this.trafficData.forEach(route => {
            try {
                routeContainer.appendChild(this.renderRouteRow(route));
            } catch (e) {
                this.sendSocketNotification("RENDER_ERROR", { message: e.message, context: `route:${route.id}` });
            }
        });
    },

    scheduleMapInit: function() {
        if (this.mapState.isReady() || this.mapState.isInProgress()) return;
        if (this.mapInitTimeout) clearTimeout(this.mapInitTimeout);

        const currentGeneration = this.mapState.scheduleInit();
        if (currentGeneration === null) return;

        this.mapInitTimeout = setTimeout(() => {
            requestAnimationFrame(() => {
                if (!this.mapState.beginInit(currentGeneration)) return;

                const container = document.getElementById("traffic-map-container");
                if (container && container.offsetParent !== null) {
                    this.initMap();
                } else {
                    this.mapState.cancel();
                    this.scheduleMapInit();
                }
            });
        }, 100);
    },

    initMap: function() {
        try {
            const container = document.getElementById("traffic-map-container");
            if (!container || container.offsetParent === null) {
                this.mapState.cancel();
                return;
            }

            if (this.mapEngine) {
                this.mapEngine.destroy();
                this.mapEngine = null;
            }

            this.config.useTomTomTrafficTiles = this.quotaExhausted;

            if (this.trafficData.length > 0 || this.quotaExhausted) {
                this.mapEngine = new MapRenderer("traffic-map-container", this.config);

                if (this.trafficData.length > 0) {
                    this.mapEngine.draw(this.trafficData);
                } else if (this.quotaExhausted) {
                    let defaultCenter = this.config.mapCenter;
                    let defaultZoom = this.config.mapZoom || 10;

                    if (!defaultCenter && this.config.routes && this.config.routes.length > 0) {
                        try {
                            const firstRoute = this.config.routes[0];
                            const coords = firstRoute.origin.split(',');
                            if (coords.length === 2) {
                                defaultCenter = [parseFloat(coords[0]), parseFloat(coords[1])];
                            }
                        } catch (e) {
                            console.warn('[TrafficGlance] Could not parse route origin for default map center');
                        }
                    }

                    if (!defaultCenter) {
                        defaultCenter = [47.3, 19.1];
                    }

                    this.mapEngine.map.setView(defaultCenter, defaultZoom);
                }

                this.mapState.markReady();
            } else {
                this.mapState.cancel();
            }
        } catch (e) {
            this.mapState.markError(e.message);
            console.error('[TrafficGlance] Map init failed:', e.message);
            setTimeout(() => this.scheduleMapInit(), 30000);
        }
    },

    suspend: function() {
        if (this.mapInitTimeout) {
            clearTimeout(this.mapInitTimeout);
            this.mapInitTimeout = null;
        }
        if (this.mapEngine) {
            this.mapEngine.destroy();
            this.mapEngine = null;
        }
        this.mapState.reset();
    },

    resume: function() {
        if (this.trafficData.length > 0 && !this.mapState.isReady()) {
            this.scheduleMapInit();
        }
    }
});