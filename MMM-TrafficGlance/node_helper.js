const NodeHelper = require("node_helper");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const ErrorHandler = require("./shared/ErrorHandler");
const StatsUtil = require("./shared/StatsUtil");

module.exports = NodeHelper.create({
    intervalId: null,
    midnightMonitorId: null,
    dbInitialized: false,

    start: function() {
        this.quotaState = {
            nonTileQuotaExhausted: false,
            lastQuotaHitTime: null,
            nextMidnightUTC: null
        };
        this.errorHandler = new ErrorHandler();
        this.sparklineCache = new Map();
        this.polylineCache = new Map();
        this._fetchInProgress = false;
    },

    handleQuotaExhaustion: function() {
        this.quotaState.nonTileQuotaExhausted = true;
        this.quotaState.lastQuotaHitTime = Date.now();
        const now = new Date();
        const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
        this.quotaState.nextMidnightUTC = midnight.getTime();
        console.warn(`[TrafficGlance] Quota exceeded. Resuming at: ${midnight.toISOString()}`);
        this.sendSocketNotification("QUOTA_EXHAUSTED", { nextResetTime: midnight.getTime(), useTomTomTiles: true });
        this.startMidnightMonitor();
    },

    startMidnightMonitor: function() {
        if (this.midnightMonitorId) clearInterval(this.midnightMonitorId);
        this.midnightMonitorId = setInterval(() => {
            if (this.quotaState.nonTileQuotaExhausted && Date.now() >= this.quotaState.nextMidnightUTC) {
                this.quotaState.nonTileQuotaExhausted = false;
                this.stopMidnightMonitor();
                this.sendSocketNotification("QUOTA_RESTORED", {});
                this.updateTraffic();
            }
        }, 60000);
    },

    stopMidnightMonitor: function() {
        if (this.midnightMonitorId) {
            clearInterval(this.midnightMonitorId);
            this.midnightMonitorId = null;
        }
    },

    initDatabase: function() {
        const dbPath = path.join(__dirname, 'traffic.db');
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) return console.error('[TrafficGlance] DB connection failed:', err.message);
            this.db.serialize(() => {
                this.db.run('PRAGMA journal_mode=WAL');
                this.db.run('PRAGMA synchronous=NORMAL');
                this.db.run('PRAGMA temp_store=MEMORY');
                this.db.run('PRAGMA busy_timeout=5000');
                this.db.run(`CREATE TABLE IF NOT EXISTS traffic_history (
                    id INTEGER PRIMARY KEY,
                    route_id TEXT NOT NULL,
                    profile TEXT DEFAULT 'default',
                    travel_time INTEGER NOT NULL,
                    timestamp INTEGER NOT NULL,
                    minute_of_day INTEGER NOT NULL,
                    day_of_week INTEGER NOT NULL,
                    date_key TEXT
                )`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_query_optimization ON traffic_history (route_id, day_of_week, minute_of_day, timestamp)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_sparkline_optimization ON traffic_history (route_id, day_of_week, minute_of_day, date_key)`);
                this.stmtInsert = this.db.prepare(`INSERT INTO traffic_history (route_id, profile, travel_time, timestamp, minute_of_day, day_of_week, date_key) VALUES (?, ?, ?, ?, ?, ?, date(?, 'unixepoch', 'localtime'))`);
                this.dbInitialized = true;
                console.log('[TrafficGlance] Persistence layer optimized and ready.');

                if (this.config?.database?.cleanupOnStart !== false) {
                    this.cleanupOldData();
                }
            });
        });
    },

    cleanupOldData: function() {
        if (!this.dbInitialized) return;
        const retentionDays = this.config?.database?.retentionDays || 90;
        const cutoffTime = Math.floor(Date.now() / 1000) - (retentionDays * 86400);
        this.db.run('DELETE FROM traffic_history WHERE timestamp < ?', [cutoffTime], function(err) {
            if (err) {
                console.error('[TrafficGlance] Cleanup error:', err.message);
            } else if (this.changes > 0) {
                console.log(`[TrafficGlance] Cleaned up ${this.changes} old records`);
            }
        });
    },

    storeTrafficHistory: function(routeId, travelTimeSeconds) {
        return new Promise((resolve) => {
            if (!this.dbInitialized) return resolve();
            const now = new Date();
            const timestamp = Math.floor(now.getTime() / 1000);
            const minuteOfDay = now.getHours() * 60 + now.getMinutes();
            const dayOfWeek = now.getDay();
            this.stmtInsert.run([routeId, 'default', travelTimeSeconds, timestamp, minuteOfDay, dayOfWeek, timestamp], () => resolve());
        });
    },

    querySparklineDataPromise: function(routeId) {
        return new Promise((resolve) => {
            if (!this.dbInitialized) return resolve({ points: [], baseline: null, stdDev: null, stats: null });
            if (this.config?.sparkline?.enabled === false) return resolve({ points: [], baseline: null, stdDev: null, stats: null });

            const xAxisMode = this.config?.sparkline?.xAxisMode || 'frequency';

            if (xAxisMode === 'frequency') {
                return this.querySparklineDataRaw(routeId).then(resolve);
            }

            // Legacy time-based mode
            const intervalMinutes = this.config?.sparkline?.intervalMinutes || 15;
            const intervalSeconds = intervalMinutes * 60;

            // Get lookback hours with backward compatibility
            const lookbackHours = this.config?.sparkline?.lookbackHours ||
                                  (this.config?.sparkline?.lookbackDays * 24) ||
                                  48;

            const numIntervals = Math.floor((lookbackHours * 60) / intervalMinutes);

            // Cache key includes lookback
            const cacheKey = `${routeId}_time_${intervalMinutes}_${lookbackHours}_${Math.floor(Date.now() / (intervalSeconds * 1000))}`;
            if (this.sparklineCache.has(cacheKey)) {
                return resolve(this.sparklineCache.get(cacheKey));
            }

            const now = Math.floor(Date.now() / 1000);
            const cutoff = now - (lookbackHours * 3600);

            const sql = `
                SELECT
                    CAST((? - timestamp) / ? AS INTEGER) as intervals_ago,
                    AVG(travel_time) as avg_time,
                    COUNT(*) as samples
                FROM traffic_history
                WHERE route_id = ? AND timestamp >= ?
                GROUP BY intervals_ago
                ORDER BY intervals_ago DESC
            `;

            this.db.all(sql, [now, intervalSeconds, routeId, cutoff], (err, rows) => {
                if (err) {
                    console.error('[TrafficGlance] Sparkline query error:', err.message);
                    return resolve({ points: [], baseline: null, stdDev: null, stats: null, sparklineError: true });
                }

                const intervalMap = new Map((rows || []).map(r => [r.intervals_ago, r.avg_time]));
                const points = [];

                for (let i = numIntervals - 1; i >= 0; i--) {
                    const value = intervalMap.has(i) ? Math.round(intervalMap.get(i) / 60) : null;
                    const intervalDate = new Date((now - i * intervalSeconds) * 1000);
                    const label = intervalMinutes >= 60
                        ? intervalDate.getHours().toString().padStart(2, '0')
                        : `${intervalDate.getHours().toString().padStart(2, '0')}:${intervalDate.getMinutes().toString().padStart(2, '0')}`;
                    points.push({ intervalsAgo: i, label, value });
                }

                const values = points.map(p => p.value).filter(v => v !== null);
                const baseline = values.length > 0 ? Math.round(StatsUtil.calculateMean(values)) : null;

                let stdDev = null;
                let stats = null;
                if (values.length > 1 && baseline !== null) {
                    stdDev = StatsUtil.assignZScoresToPoints(points, baseline);
                    stats = { min: Math.min(...values), max: Math.max(...values), count: values.length };
                }

                const result = { points, baseline, stdDev, stats };
                this.sparklineCache.set(cacheKey, result);
                resolve(result);
            });
        });
    },

    querySparklineDataRaw: function(routeId) {
        return new Promise((resolve) => {
            const maxPoints = this.config?.sparkline?.maxDataPoints || 50;

            // Get lookback hours with backward compatibility
            const lookbackHours = this.config?.sparkline?.lookbackHours ||
                                  (this.config?.sparkline?.lookbackDays * 24) ||
                                  48;

            // Calculate cutoff timestamp
            const now = Math.floor(Date.now() / 1000);
            const cutoff = now - (lookbackHours * 3600);

            // Cache key includes lookback
            const cacheKey = `${routeId}_freq_${maxPoints}_${lookbackHours}_${Math.floor(Date.now() / 60000)}`;
            if (this.sparklineCache.has(cacheKey)) {
                return resolve(this.sparklineCache.get(cacheKey));
            }

            // SQL now filters by timestamp
            const sql = `
                SELECT travel_time, timestamp
                FROM traffic_history
                WHERE route_id = ? AND timestamp >= ?
                ORDER BY timestamp DESC
                LIMIT ?
            `;

            this.db.all(sql, [routeId, cutoff, maxPoints], (err, rows) => {
                if (err) {
                    console.error('[TrafficGlance] Sparkline raw query error:', err.message);
                    return resolve({ points: [], baseline: null, stdDev: null, stats: null, sparklineError: true });
                }

                if (!rows || rows.length === 0) {
                    return resolve({ points: [], baseline: null, stdDev: null, stats: null });
                }

                const sortedRows = rows.reverse();
                const values = sortedRows.map(r => Math.round(r.travel_time / 60));
                const baseline = values.length > 0 ? Math.round(StatsUtil.calculateMean(values)) : null;
                const points = sortedRows.map((row, i) => ({ timestamp: row.timestamp, value: values[i], zScore: 0 }));
                const stdDev = values.length > 1 && baseline !== null
                    ? StatsUtil.assignZScoresToPoints(points, baseline)
                    : null;

                const stats = values.length > 0 ? {
                    min: Math.min(...values),
                    max: Math.max(...values),
                    count: values.length
                } : null;

                const result = { points, baseline, stdDev, stats };
                this.sparklineCache.set(cacheKey, result);
                resolve(result);
            });
        });
    },

    fetchSingleRoute: async function(route) {
        const origin = String(route.origin).replace(/\s+/g, "");
        const destination = String(route.destination).replace(/\s+/g, "");
        const url = `https://api.tomtom.com/routing/1/calculateRoute/${origin}:${destination}/json`;

        const apiConfig = this.config.api || {};
        const avoid = [];
        if (apiConfig.avoidTolls) avoid.push("tollRoads");
        if (apiConfig.avoidHighways) avoid.push("motorways");

        const params = {
            key: this.config.apiKey,
            traffic: apiConfig.traffic !== false,
            departAt: "now",
            routeType: apiConfig.routeType || "fastest",
            computeTravelTimeFor: "all",
            routeRepresentation: "polyline",
            sectionType: "traffic",
            travelMode: apiConfig.travelMode || "car"
        };

        if (avoid.length > 0) {
            params.avoid = avoid.join(",");
        }

        const response = await axios.get(url, {
            params,
            timeout: apiConfig.timeout || 10000
        });

        if (!response.data?.routes?.[0]) return null;

        const r = response.data.routes[0];
        const s = r.summary;
        const live = Math.round(s.travelTimeInSeconds / 60);
        const hist = Math.round(s.historicTrafficTravelTimeInSeconds / 60);

        const bottlenecks = (r.sections || [])
            .filter(sec => sec.sectionType === "traffic" && sec.delayInSeconds > 30)
            .map(sec => ({
                startPointIndex: sec.startPointIndex,
                endPointIndex: sec.endPointIndex,
                magnitude: sec.magnitudeOfDelay
            }));

        const routeUpdate = {
            id: route.id,
            name: route.name,
            currentDuration: live,
            historicalAverage: hist,
            delayFactor: s.travelTimeInSeconds / s.noTrafficTravelTimeInSeconds,
            bottlenecks: bottlenecks,
            trendDirection: live > hist ? "up" : (live < hist ? "down" : "stable")
        };

        // Only include polyline if not cached (reduces payload on subsequent updates)
        const newPolyline = r.legs[0].points;
        if (!this.polylineCache.has(route.id)) {
            routeUpdate.polyline = newPolyline;
            this.polylineCache.set(route.id, newPolyline);
        } else {
            // Use cached polyline
            routeUpdate.polyline = this.polylineCache.get(route.id);
        }

        await this.storeTrafficHistory(route.id, s.travelTimeInSeconds);
        routeUpdate.sparklineData = await this.querySparklineDataPromise(route.id);

        return routeUpdate;
    },

    fetchWithRetry: async function(route) {
        while (true) {
            try {
                const data = await this.fetchSingleRoute(route);
                this.errorHandler.resetRetries(`route:${route.name}`);
                return { data };
            } catch (error) {
                const result = this.errorHandler.handleError(`route:${route.name}`, error);
                if (result.action === 'quota_exhausted') throw { quotaError: true };
                if (result.action !== 'retry') return { data: null, category: result.category };
                await new Promise(r => setTimeout(r, result.backoffMs));
            }
        }
    },

    updateTraffic: async function() {
        if (!this.config || this.quotaState.nonTileQuotaExhausted) return;
        if (this._fetchInProgress) return;
        this._fetchInProgress = true;

        try {
            const fetchResults = await Promise.all(
                this.config.routes.map(route => this.fetchWithRetry(route))
            );
            const successfulRoutes = fetchResults.filter(r => r.data !== null).map(r => r.data);
            const errorCategory = fetchResults.find(r => r.category)?.category || null;
            console.log(`[TrafficGlance] fetch complete — ${successfulRoutes.length}/${this.config.routes.length} routes OK, errorCategory: ${errorCategory}`);

            if (successfulRoutes.length === 0 && this.config.routes.length > 0) {
                this.sendSocketNotification("FETCH_ERROR", { category: errorCategory });
            } else {
                this.sendSocketNotification("TRAFFIC_UPDATE", successfulRoutes);
            }
        } catch (error) {
            if (error.quotaError) {
                this.handleQuotaExhaustion();
            } else {
                console.error('[TrafficGlance] updateTraffic failed unexpectedly:', error);
                this.sendSocketNotification("FETCH_ERROR", { category: 'unknown' });
            }
        } finally {
            this._fetchInProgress = false;
        }
    },

    socketNotificationReceived: function(notification, payload) {
        if (notification === "RENDER_ERROR") {
            console.error(`[TrafficGlance] Frontend render error: ${payload.message} (${payload.context})`);
            return;
        }
        if (notification === "CONFIG") {
            this.config = payload;
            console.log(`[TrafficGlance] CONFIG received — routes: ${this.config?.routes?.length ?? 'none'}, apiKey present: ${!!this.config?.apiKey}`);

            // Validate lookback hours with performance safeguards
            const lookbackHours = this.config?.sparkline?.lookbackHours ||
                                  (this.config?.sparkline?.lookbackDays * 24);

            if (lookbackHours) {
                // Validate positive number
                if (typeof lookbackHours !== 'number' || lookbackHours <= 0) {
                    console.warn(`[TrafficGlance] Invalid lookbackHours: ${lookbackHours}. Using default 48h.`);
                    this.config.sparkline.lookbackHours = 48;
                }
                // Warn on large values (performance concern for Pi)
                else if (lookbackHours > 168) {
                    console.warn(`[TrafficGlance] Large lookbackHours (${lookbackHours}h) may impact Raspberry Pi performance. Consider reducing to < 7 days (168h).`);
                }
                // Cap at maximum 30 days to prevent excessive queries
                if (lookbackHours > 720) {
                    console.warn(`[TrafficGlance] lookbackHours capped at 720h (30 days). Requested: ${lookbackHours}h.`);
                    this.config.sparkline.lookbackHours = 720;
                }
            }

            if (!this.dbInitialized) this.initDatabase();
            this.updateTraffic();
            if (this.intervalId) clearInterval(this.intervalId);
            this.intervalId = setInterval(() => this.updateTraffic(), this.config.updateInterval);
        }
    }
});