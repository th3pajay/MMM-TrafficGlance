# MMM-TrafficGlance

Real-time traffic for MagicMirror² with TomTom routing, historical sparklines and a live route map.

![MagicMirror](https://img.shields.io/badge/MagicMirror-v2.33.0-blue)
![Version](https://img.shields.io/badge/Version-1.1.36-yellow)
![License](https://img.shields.io/badge/License-MIT-lightgrey)
![Node](https://img.shields.io/badge/Node-%3E%3D22.5-green)

<p align="center">
<img src="Media/MMM-TrafficGlance.png?raw=true" alt="In-use" width="256"/>
</p>

**Contents**

1. [Overview](#overview)
2. [Requirements](#requirements)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Routes](#routes)
6. [Map](#map)
7. [Sparklines and incidents](#sparklines-and-incidents)
8. [Thresholds and colours](#thresholds-and-colours)
9. [Refresh and quota](#refresh-and-quota)
10. [Settings popup](#settings-popup)
11. [Advanced](#advanced)
12. [Troubleshooting](#troubleshooting)

## Overview

TrafficGlance polls the TomTom Routing API for each route you define, stores results in a local SQLite database, and compares the current time with the historical average for the same period. The result is a travel time, a delta, a trend arrow, a sparkline and an optional map.

Incident categories (jam, roadwork, closure) feed route detection, map markers and sparkline markers together. When the monthly quota is exhausted the module falls back to the TomTom traffic tile layer.

## Requirements

- MagicMirror² v2.x
- Node.js 22.5 or newer (uses built-in `node:sqlite`)
- A TomTom API key from [developer.tomtom.com](https://developer.tomtom.com/)

> Node 22.5 to 22.10: add `--experimental-sqlite` to the start command. Node 22.11+ and 23+ need no flag.

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/th3pajay/MMM-TrafficGlance.git
```

There is no `npm install` step. The module has no dependencies.

## Configuration

```javascript
{
    module: "MMM-TrafficGlance",
    position: "bottom_center",
    header: "Traffic",
    config: {
        apiKey: "YOUR_TOMTOM_API_KEY",
        routes: [
            { id: "to-work", name: "Work", origin: "48.8584,2.2945", destination: "48.8606,2.3376" },
            { id: "to-home", name: "Home", origin: "48.8606,2.3376", destination: "48.8584,2.2945" }
        ],

        refreshMinutes: 5,
        monthlyQuota: 20000,
        width: 350,

        map: "leaflet",
        mapHeight: 220,
        sparkline: true,
        incidents: true,

        showDelta: true,
        showTrend: true,
        warnAt: 10,
        criticalAt: 25
    }
}
```

Only `apiKey` and `routes` are required. Configs written for earlier versions (nested `display`, `map`, `api`, `thresholds`, `sparkline`, `updateInterval`, `maxWidth`) keep working; where both styles set the same option, the flat option wins.

## Routes

`routes` is a list. Each entry:

| Field | Description |
|-------|-------------|
| `id` | Unique string identifier |
| `name` | Display name |
| `origin` | `"latitude,longitude"` |
| `destination` | `"latitude,longitude"` |

Other top-level options: `apiKey` (required, TomTom key) and `width` (max module width in px, default `0` for no limit).

## Map

| Option | Default | Description |
|--------|---------|-------------|
| `map` | `"leaflet"` | Map style, see below. `false` for no map |
| `mapHeight` | `220` | Height in px |

| `map` value | Source |
|-------------|--------|
| `"leaflet"` | OpenStreetMap tiles |
| `"leaflet-fr"` | OpenStreetMap France HOT |
| `"leaflet-tomtom"` | TomTom night style (uses `apiKey`) |
| `"svg"` | Experimental vector basemap from OpenStreetMap Overpass, cached in `basemap_cache.json`. Wheel/button zoom, drag to pan, double-click reset, scale bar |

Fine control (`map.zoom`, `map.center`, `map.padding`, `map.showScale`, `map.zoomControlSize`, `map.width`) lives under [Advanced](#advanced).

## Sparklines and incidents

| Option | Default | Description |
|--------|---------|-------------|
| `sparkline` | `true` | `true` (straight), `"curved"`, `"stepped"`, `false` |
| `incidents` | `true` | `true` all categories, `false` none, or a list such as `["ROAD_CLOSURE", "ROAD_WORK"]`. Categories: `JAM`, `ROAD_WORK`, `ROAD_CLOSURE`, `OTHER` |
| `showDelta` | `true` | Difference vs historical average, e.g. `+2m` |
| `showTrend` | `true` | Up, down or stable arrow |

## Thresholds and colours

| Option | Default | Description |
|--------|---------|-------------|
| `warnAt` | `10` | % slower than average where the route turns yellow |
| `criticalAt` | `25` | % slower than average where the route turns red |

Custom sparkline colours go in `advanced.sparkline.colors`.

## Refresh and quota

| Option | Default | Description |
|--------|---------|-------------|
| `refreshMinutes` | `5` | Minimum refresh interval. Polling slows automatically to fit `monthlyQuota` |
| `monthlyQuota` | `20000` | Your TomTom Routing calls per month. Polling is spread over the UTC month so quota can't run out early. `0` turns pacing off |

If quota is exhausted anyway, the module switches to the TomTom traffic tile overlay and resumes at midnight UTC.

## Settings popup

The hamburger button at the bottom-left of the module opens a popup with every option except `apiKey` and `advanced`. Values are read from this module's entry in `config/config.js` and saved back in place, so comments and formatting survive (a changed `routes` list is rewritten as a whole). The previous file is copied to `config.js.bak` first. Restart MagicMirror afterwards, e.g. `pm2 restart MagicMirror`.

If the entry can't be parsed (variables or functions), the popup shows `Settings cannot be parsed, please check manually.` and edits nothing. Options in legacy nested form (e.g. `map: { ... }`) can't be changed from the popup; convert them to flat form first.

## Advanced

Put these inside `advanced`, e.g. `advanced: { api: { travelMode: "truck" }, map: { zoom: 12 } }`. It is applied last.

**API**

| Option | Default | Description |
|--------|---------|-------------|
| `api.timeout` | `10000` | HTTP timeout (ms) |
| `api.routeType` | `"fastest"` | `"fastest"`, `"shortest"`, `"eco"`, `"thrilling"` |
| `api.travelMode` | `"car"` | `"car"`, `"truck"`, `"taxi"`, `"bus"`, `"pedestrian"`, `"bicycle"` |
| `api.traffic` | `true` | Include live traffic |
| `api.avoid` | `[]` | `"tollRoads"`, `"motorways"`, `"ferries"`, `"unpavedRoads"`, `"carpools"`, `"alreadyUsedRoads"` |

**Map**

| Option | Default | Description |
|--------|---------|-------------|
| `map.width` | `"100%"` | Container width |
| `map.zoom` | `null` | Fixed zoom 1-19, or auto-fit |
| `map.center` | `null` | Fixed `[lat, lon]`, or auto-fit |
| `map.padding` | `[20, 20]` | Auto-fit padding `[vertical, horizontal]` px |
| `map.showScale` | `true` | Distance scale bar |
| `map.zoomControlSize` | `22` | +/- button size px |

**Sparkline**

| Option | Default | Description |
|--------|---------|-------------|
| `sparkline.width` / `sparkline.height` | `160` / `40` | Canvas size px |
| `sparkline.lookbackHours` | `48` | History window |
| `sparkline.maxDataPoints` | `50` | Max points rendered |
| `sparkline.showBaseline`, `showBaselineLabel`, `showNowIndicator`, `showNowLabel`, `showXAxisLabels`, `useZScoreColors` | `true` | Individual elements |
| `sparkline.colors` | `{}` | `{ critical, warning, good, baseline }` hex colours |

## Troubleshooting

| Symptom | What to do |
|---------|------------|
| No data / retrying | Check API key and network, then `pm2 restart MagicMirror` |
| Quota exhausted | Automatic fallback to traffic tiles, resumes at midnight UTC |
| Sparklines empty | History builds over time. They appear after a few polls, full baseline takes hours |

Logs: `pm2 logs MagicMirror`

## License

MIT. Credits: [MagicMirror²](https://magicmirror.builders/) by Michael Teeuw, [TomTom Traffic API](https://developer.tomtom.com/), [Leaflet](https://leafletjs.com/).
