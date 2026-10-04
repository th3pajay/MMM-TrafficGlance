# MMM-TrafficGlance

Real-time traffic monitoring module for MagicMirror² with TomTom integration, historical sparkline analysis, and a live route map.

![MagicMirror](https://img.shields.io/badge/MagicMirror-v2.33.0-blue)
![Version](https://img.shields.io/badge/Version-1.1.35-yellow)
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
        maxWidth: null,

        display: {
            showDelta: true,
            showTrend: true,
            showMap: true
        },

        map: {
            width: "100%",
            height: "220px",
            zoom: null,            // null = auto-fit to routes
            center: null,          // null = auto-fit; or [lat, lon]
            padding: [20, 20],
            tileProvider: "osm",   // "osm" | "osmfr" | "tomtom"
            zoomControlSize: 22,   // px; size of the +/- zoom buttons
            showScale: true,
            showIncidentMarkers: true
        },

        api: {
            timeout: 10000,         // request timeout (ms)
            routeType: "fastest",   // "fastest" | "shortest" | "eco" | "thrilling"
            travelMode: "car",      // "car" | "truck" | "taxi" | "bus" | "pedestrian" | "bicycle"
            traffic: true,
            avoid: [],              // "tollRoads" | "motorways" | "ferries" | "unpavedRoads" | "carpools" | "alreadyUsedRoads"
            incidents: false,      // set true to detect jam/roadwork/closure incidents
            incidentCategories: null // e.g. ["ROAD_CLOSURE","ROAD_WORK"]; null = show all
        },

        thresholds: {
            warning: 1,             // percent above historical average where yellow starts
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
                origin: "48.8584,2.2945",
                destination: "48.8606,2.3376"
            },
            {
                id: "home",
                name: "Home",
                origin: "48.8606,2.3376",
                destination: "48.8584,2.2945"
            }
        ]
    }
}
```

## Settings page

The small hamburger button at the bottom-left of the module opens a settings popup with every option except `apiKey`. Values are read from this module's entry in `config/config.js` and saved back to it in place, so comments and formatting are kept (a changed `routes` list is rewritten as a whole). The previous file is copied to `config.js.bak` first. After saving, restart MagicMirror (e.g. `pm2 restart MagicMirror`) to apply the changes.

If the module's entry in `config.js` can't be parsed (for example it uses variables or functions), the popup shows `Settings cannot be parsed, please check manually.` and nothing is edited.

## Options Reference

**Top-level**

| Option | Default | Description |
|--------|---------|-------------|
| `apiKey` | **required** | TomTom API key |
| `updateInterval` | `300000` | Refresh interval (ms) |
| `maxWidth` | `null` | Maximum module width (CSS value, e.g. `"350px"`), or `null` for no limit |

**`display`**

| Option | Default | Description |
|--------|---------|-------------|
| `showDelta` | `true` | Show the difference vs historical average (e.g. `+2m`) |
| `showTrend` | `true` | Show the up/down/stable trend arrow |
| `showMap` | `true` | Show the route map |

**`map`**

| Option | Default | Description |
|--------|---------|-------------|
| `width` | `"100%"` | Map container width |
| `height` | `"220px"` | Map container height |
| `zoom` | `null` | Fixed zoom 1–19, or `null` for auto-fit |
| `center` | `null` | Fixed `[lat, lon]`, or `null` for auto-fit |
| `padding` | `[20, 20]` | Auto-fit padding `[vertical, horizontal]` px |
| `showScale` | `true` | Show the distance scale bar |
| `showIncidentMarkers` | `true` | Circle markers with tooltips at each incident location (requires `api.incidents`) |
| `zoomControlSize` | `22` | Pixel size of the map's +/- zoom buttons (Leaflet default is 30) |
| `tileProvider` | `"osm"` | Base map tiles: `"osm"` (OpenStreetMap standard), `"osmfr"` (OpenStreetMap France HOT), or `"tomtom"` (TomTom night style, uses your `apiKey`) |

**`api`**

| Option | Default | Description |
|--------|---------|-------------|
| `timeout` | `10000` | HTTP request timeout (ms) |
| `routeType` | `"fastest"` | `"fastest"` \| `"shortest"` \| `"eco"` \| `"thrilling"` |
| `travelMode` | `"car"` | `"car"` \| `"truck"` \| `"taxi"` \| `"bus"` \| `"pedestrian"` \| `"bicycle"` |
| `traffic` | `true` | Include live traffic in routing |
| `avoid` | `[]` | Road types to avoid: `"tollRoads"`, `"motorways"`, `"ferries"`, `"unpavedRoads"`, `"carpools"`, `"alreadyUsedRoads"` |
| `incidents` | `false` | Detect and render jam/roadwork/closure incidents on routes |
| `incidentCategories` | `null` | Only applies when `incidents` is `true`; filter to these categories, e.g. `["ROAD_CLOSURE","ROAD_WORK"]`; `null` shows all (`JAM`, `ROAD_WORK`, `ROAD_CLOSURE`, `OTHER`) |

**`thresholds`**

| Option | Default | Description |
|--------|---------|-------------|
| `warning` | `1` | Percent above historical average where yellow starts |
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
| `showIncidents` | `true` | Incident shape markers along the sparkline (requires `api.incidents`) |
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
