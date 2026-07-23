# MMM-TrafficGlance

Real-time traffic monitoring module for MagicMirror² with TomTom integration, historical sparkline analysis, and a live route map.

![MagicMirror](https://img.shields.io/badge/MagicMirror-v2.33.0-blue)
![Version](https://img.shields.io/badge/Version-1.1.26-yellow)
![License](https://img.shields.io/badge/License-MIT-lightgrey)
![Node](https://img.shields.io/badge/Node-%3E%3D22.5-green)

<p align="center">
<img src="Media/MMM-TrafficGlance.png?raw=true" alt="In-use" width="256"/>
</p>

## Features

- Real-time travel times via TomTom Routing API
- Sparkline charts with Z-score color coding (green → yellow → red)
- Leaflet map with color-coded route polylines and categorized incident overlay (jam, roadwork, closure)
- SQLite history via Node built-in `node:sqlite` — no npm dependencies
- Quota-exhaustion fallback to TomTom traffic tile layer

## Requirements

- MagicMirror² v2.x
- Node.js ≥ 22.5 (uses `node:sqlite` built-in)
- TomTom API key — [developer.tomtom.com](https://developer.tomtom.com/)

> **Node 22.5–22.10 only:** add `--experimental-sqlite` to your MagicMirror start command.
> Node 22.11+ and 23+ require no flag.

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/th3pajay/MMM-TrafficGlance.git
```

No `npm install` — zero dependencies.

## Configuration

```javascript
{
    module: "MMM-TrafficGlance",
    position: "bottom_center",
    header: "Traffic",
    config: {
        apiKey: "YOUR_TOMTOM_API_KEY",
        updateInterval: 300000,

        mapHeight: "220px",
        mapZoom: null,        // null = auto-fit to routes
        mapCenter: null,      // null = auto-fit; or [lat, lon]
        mapPadding: [20, 20],

        api: {
            timeout: 10000,         // request timeout (ms)
            routeType: "fastest",   // "fastest" | "shortest" | "eco" | "thrilling"
            travelMode: "car",      // "car" | "truck" | "taxi" | "bus" | "pedestrian" | "bicycle"
            traffic: true,
            avoidTolls: false,
            avoidHighways: false,
            incidents: false,      // set true to detect jam/roadwork/closure incidents
            incidentCategories: null // e.g. ["ROAD_CLOSURE","ROAD_WORK"]; null = show all
        },

        thresholds: {
            critical: 1.25          // delay factor for red alert (1.25 = 25% above free-flow)
        },

        sparkline: {
            enabled: true,
            width: 160,
            height: 52,             // 40 chart + 12 for x-axis labels
            lookbackHours: 48,      // history window
            maxDataPoints: 50
        },

        routes: [
            {
                id: "commute",
                name: "Work",
                origin: "47.5148,19.0777",
                destination: "47.2309,18.6081"
            },
            {
                id: "home",
                name: "Home",
                origin: "47.2309,18.6081",
                destination: "47.5148,19.0777"
            }
        ]
    }
}
```

## Options Reference

**Top-level**

| Option | Default | Description |
|--------|---------|-------------|
| `apiKey` | **required** | TomTom API key |
| `updateInterval` | `300000` | Refresh interval (ms) |
| `mapWidth` | `"100%"` | Map container width |
| `mapHeight` | `"220px"` | Map container height |
| `mapZoom` | `null` | Fixed zoom 1–19, or `null` for auto-fit |
| `mapCenter` | `null` | Fixed `[lat, lon]`, or `null` for auto-fit |
| `mapPadding` | `[20, 20]` | Auto-fit padding `[vertical, horizontal]` px |

**`api`**

| Option | Default | Description |
|--------|---------|-------------|
| `timeout` | `10000` | HTTP request timeout (ms) |
| `routeType` | `"fastest"` | `"fastest"` \| `"shortest"` \| `"eco"` \| `"thrilling"` |
| `travelMode` | `"car"` | `"car"` \| `"truck"` \| `"taxi"` \| `"bus"` \| `"pedestrian"` \| `"bicycle"` |
| `traffic` | `true` | Include live traffic in routing |
| `avoidTolls` | `false` | Avoid toll roads |
| `avoidHighways` | `false` | Avoid motorways |
| `incidents` | `false` | Detect and render jam/roadwork/closure incidents on routes |
| `incidentCategories` | `null` | Only applies when `incidents` is `true`; filter to these categories, e.g. `["ROAD_CLOSURE","ROAD_WORK"]`; `null` shows all (`JAM`, `ROAD_WORK`, `ROAD_CLOSURE`, `OTHER`) |

**`thresholds`**

| Option | Default | Description |
|--------|---------|-------------|
| `critical` | `1.25` | Delay factor that triggers red (1.25 = 25% above free-flow) |

**`sparkline`**

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Show sparkline charts |
| `width` | `160` | Canvas width (px) |
| `height` | `40` | Canvas height (px) |
| `lookbackHours` | `48` | History window in hours |
| `maxDataPoints` | `50` | Max data points rendered |
| `showBaseline` | `true` | Draw historical average line |
| `showBaselineLabel` | `true` | Show "Avg: 34m" label |
| `showNowIndicator` | `true` | Dot at latest measurement |
| `showNowLabel` | `true` | "NOW" label next to the dot |
| `useZScoreColors` | `true` | Color segments by Z-score deviation |
| `showXAxisLabels` | `true` | Show `HH:mm` time labels under the sparkline (reserves 12px of the canvas height) |
| `lineStyle` | `"linear"` | Line shape: `"linear"` (straight segments), `"curved"` (smooth curve), `"stepped"` (blocky step line) |
| `colors` | `{}` | Override sparkline colors, e.g. `{ critical, warning, good, baseline }`; falls back to `ColorTheme.traffic` colors when unset |

**`routes[]`**

| Field | Description |
|-------|-------------|
| `id` | Unique string identifier |
| `name` | Display name |
| `origin` | `"latitude,longitude"` |
| `destination` | `"latitude,longitude"` |

## Troubleshooting

**No data / retrying** — check your TomTom API key and network. Restart with:
```bash
pm2 restart MagicMirror
```

**Quota exhausted** — module switches to TomTom traffic tile overlay automatically and resumes at midnight UTC.

**Sparklines empty** — the history DB builds over time. Sparklines appear after the first few poll cycles; full baseline takes several hours.

Check logs with `pm2 logs MagicMirror`.

## License

MIT

## Credits

- [MagicMirror²](https://magicmirror.builders/) by Michael Teeuw
- [TomTom Traffic API](https://developer.tomtom.com/)
- [Leaflet](https://leafletjs.com/) for map rendering
