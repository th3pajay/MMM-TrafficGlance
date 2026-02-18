# MMM-TrafficGlance

Real-time traffic monitoring module for MagicMirror² with TomTom integration, historical trend analysis, and sparkline visualizations.

![MagicMirror](https://img.shields.io/badge/MagicMirror-v2.33.0-blue)
![Torrent](https://img.shields.io/badge/TrafficGlance-green)
![Module](https://img.shields.io/badge/Module-Display-orange)
![Version](https://img.shields.io/badge/Version-1.0.6-yellow)
![License](https://img.shields.io/badge/License-MIT-lightgrey)

<p align="center">
<img src="Media/MMM-TrafficGlance.png?raw=true" alt="In-use" width="256"/>
</p>
## Features

- Real-time traffic data via TomTom API
- Historical pattern analysis with sparkline charts
- Interactive map with color-coded traffic segments
- Incident detection and overlay
- Optimized for Raspberry Pi (WAL SQLite, conservative caching)

## Installation (Nested structure)

```bash
cd ~/MagicMirror/modules
git clone https://github.com/th3pajay/MMM-TrafficGlance.git temp_qb
mv temp_qb/MMM-TrafficGlance .
rm -rf temp_qb
cd MMM-TrafficGlance
npm install
```

Get a TomTom API key at https://developer.tomtom.com/

## Configuration

```javascript
{
    module: "MMM-TrafficGlance",
    position: "bottom_center",
    header: "Traffic Intelligence",
    config: {
        apiKey: "YOUR_TOMTOM_API_KEY_HERE",
        updateInterval: 300000,
        maxWidth: "350px",

        // Map display
        mapWidth: "100%",
        mapHeight: "220px",
        mapZoom: null,              // null = auto-fit to routes
        mapCenter: null,            // null = auto-fit; or [lat, lon]
        showMapScale: true,
        mapPadding: [20, 20],       // [vertical, horizontal] px when auto-fitting

        // TomTom routing API
        api: {
            timeout: 10000,         // request timeout (ms)
            routeType: "fastest",   // "fastest" | "shortest" | "eco" | "thrilling"
            travelMode: "car",      // "car" | "truck" | "taxi" | "bus" | "pedestrian" | "bicycle"
            traffic: true,          // use live traffic in routing
            avoidTolls: false,
            avoidHighways: false
        },

        // Alert threshold
        thresholds: {
            critical: 1.25          // delay factor for red alert (1.25 = 25% above free-flow)
        },

        // Database / history
        database: {
            retentionDays: 90,      // how many days of history to keep
            cleanupOnStart: true    // purge old records on module start
        },

        // Query timeouts (ms) — increase on slow Raspberry Pi hardware
        queryTimeouts: {
            historical: 10000,
            sparkline: 12000
        },

        // Sparkline charts
        sparkline: {
            enabled: true,
            width: 160,             // canvas width (px)
            height: 40,             // canvas height (px)
            xAxisMode: "frequency", // "frequency" (raw measurements) | "time" (clock-aligned)
            maxDataPoints: 50,      // max points rendered when xAxisMode="frequency"
            lookbackHours: 48,      // data window; auto-set to 720 in monthly view
            showBaseline: true,     // draw historical average line
            showBaselineLabel: true,// show "Avg: 34m" label on baseline
            showNowIndicator: true, // dot marking the latest measurement
            showNowLabel: true,     // "Now" text next to the dot
            showGrid: true,         // horizontal grid lines
            gridTicks: 4,           // number of horizontal grid divisions
            showYLabels: true,      // Y-axis value labels (e.g. "40m")
            useZScoreColors: true,  // per-segment coloring based on Z-score deviation
            showLegend: true,       // inline legend below sparkline
            colors: {
                critical: "#e91e63",
                warning: "#f39c12",
                good: "#2ecc71",
                neutral: "#4fc3f7",
                baseline: "#888888"
            }
        },

        routes: [
            {
                id: "morning-commute",
                name: "Work",
                origin: "47.5148,19.0777",
                destination: "47.2309,18.6081"
            },
            {
               id: "evening-route",
               name: "Home",
               origin: "47.2309,18.6081",
               destination: "47.5148,19.0777"
           }
        ]
    }
}
```

### Options Reference

**Top-level**

| Option | Default | Description |
|--------|---------|-------------|
| `apiKey` | **Required** | TomTom API key |
| `updateInterval` | `300000` | Refresh interval in ms (5 min minimum) |
| `maxWidth` | `"350px"` | Module max-width CSS value |

**Map display**

| Option | Default | Description |
|--------|---------|-------------|
| `mapWidth` | `"100%"` | Map container width (px or %) |
| `mapHeight` | `"220px"` | Map container height |
| `mapZoom` | `null` | Fixed zoom level 1–19, or `null` for auto-fit |
| `mapCenter` | `null` | Fixed `[lat, lon]`, or `null` for auto-fit |
| `showMapScale` | `true` | Show metric scale bar |
| `mapPadding` | `[20, 20]` | Auto-fit padding `[vertical, horizontal]` px |

**`api` — TomTom routing**

| Option | Default | Description |
|--------|---------|-------------|
| `timeout` | `10000` | HTTP request timeout (ms) |
| `routeType` | `"fastest"` | `"fastest"` \| `"shortest"` \| `"eco"` \| `"thrilling"` |
| `travelMode` | `"car"` | `"car"` \| `"truck"` \| `"taxi"` \| `"bus"` \| `"pedestrian"` \| `"bicycle"` |
| `traffic` | `true` | Include live traffic in route calculation |
| `avoidTolls` | `false` | Avoid toll roads |
| `avoidHighways` | `false` | Avoid motorways |

**`thresholds`**

| Option | Default | Description |
|--------|---------|-------------|
| `critical` | `1.25` | Delay factor that triggers red alert (1.25 = 25% above free-flow) |

**`database`**

| Option | Default | Description |
|--------|---------|-------------|
| `retentionDays` | `90` | Days of history to retain |
| `cleanupOnStart` | `true` | Purge expired records on startup |

**`queryTimeouts`**

| Option | Default | Description |
|--------|---------|-------------|
| `historical` | `10000` | Historical average query timeout (ms) |
| `sparkline` | `12000` | Sparkline data query timeout (ms) |

**`sparkline`**

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Show sparkline charts |
| `width` | `160` | Canvas width (px) |
| `height` | `40` | Canvas height (px) |
| `xAxisMode` | `"frequency"` | `"frequency"` (raw measurements) \| `"time"` (clock-aligned) |
| `maxDataPoints` | `50` | Max points when `xAxisMode="frequency"` |
| `lookbackHours` | `48` | History window in hours (auto-set to 720 in monthly view) |
| `showBaseline` | `true` | Draw historical average line |
| `showBaselineLabel` | `true` | Show "Avg: 34m" label on baseline |
| `showNowIndicator` | `true` | Dot at latest measurement |
| `showNowLabel` | `true` | "Now" label next to the dot |
| `showGrid` | `true` | Horizontal grid lines |
| `gridTicks` | `4` | Number of horizontal grid divisions |
| `showYLabels` | `true` | Y-axis value labels |
| `useZScoreColors` | `true` | Color segments by Z-score deviation |
| `showLegend` | `true` | Inline legend below sparkline |
| `colors.critical` | `"#e91e63"` | Color for severe delay |
| `colors.warning` | `"#f39c12"` | Color for moderate delay |
| `colors.good` | `"#2ecc71"` | Color for below-average travel time |
| `colors.neutral` | `"#4fc3f7"` | Color for normal conditions |
| `colors.baseline` | `"#888888"` | Historical average line color |

**`routes[]` fields**

| Field | Description |
|-------|-------------|
| `id` | Unique string identifier |
| `name` | Display name shown in the UI |
| `origin` | `"latitude,longitude"` |
| `destination` | `"latitude,longitude"` |

## Troubleshooting

**Query timeouts** — increase `queryTimeouts` values or run a checkpoint:
```bash
pm2 restart MagicMirror
# or manually:
sqlite3 traffic.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

**No historical trends** — the module needs ≥ 5 data points per day-of-week/time slot. Wait 2–3 days after first install.

**Database maintenance** runs automatically: daily cleanup (90-day retention), WAL checkpoint every 12 h, VACUUM every Sunday at 3 AM.

Check logs with `pm2 logs MagicMirror`.

## License

MIT

## Credits

- [MagicMirror²](https://magicmirror.builders/) by Michael Teeuw
- [TomTom Traffic API](https://developer.tomtom.com/)
- [Leaflet](https://leafletjs.com/) for map rendering
