# MMM-TrafficGlance

Real-time traffic for MagicMirror² with TomTom routing, historical sparklines and a live route map.

![MagicMirror](https://img.shields.io/badge/MagicMirror-v2.33.0-blue)
![Version](https://img.shields.io/badge/Version-1.2.01-yellow)
![License](https://img.shields.io/badge/License-MIT-lightgrey)
![Node](https://img.shields.io/badge/Node-%3E%3D22.5-green)

<p align="center">
<img src="Media/MMM-TrafficGlance.gif?raw=true" alt="In-use" width="256"/>
</p>

<details open>
<summary><h2>Quick start</h2></summary>

**Requirements**

- MagicMirror² v2.x
- Node.js 22.5 or newer (built-in `node:sqlite`; on 22.5 to 22.10 add `--experimental-sqlite` to the start command)
- A TomTom API key from [developer.tomtom.com](https://developer.tomtom.com/)

**Install** (no `npm install` needed)

```bash
cd ~/MagicMirror/modules
git clone https://github.com/th3pajay/MMM-TrafficGlance.git
```

**Configure**

```javascript
{
    module: "MMM-TrafficGlance",
    position: "bottom_center",
    config: {
        apiKey: "YOUR_TOMTOM_API_KEY",
        routes: [
            { id: "to-work", name: "Work", origin: "48.8584,2.2945", destination: "48.8606,2.3376", hero: "06:30-09:30" },
            { id: "to-home", name: "Home", origin: "48.8606,2.3376", destination: "48.8584,2.2945" }
        ]
    }
}
```

Only `apiKey` and `routes` are required. Configs from earlier versions (nested `display`, `map`, `api`, `thresholds`, `sparkline`) keep working; where both styles set the same option, the flat option wins.

</details>

<details>
<summary><h2>Options</h2></summary>

**Routes**

| Field | Description |
|-------|-------------|
| `id`, `name` | Unique id and display name |
| `origin`, `destination` | `"lat,lon"` |
| `hero` | Optional time window(s) when this route is the hero card, e.g. `"06:30-09:30"` or `["06:30-09:30", "16:00-18:30"]`. No match: the most delayed route |

**Display**

| Option | Default | Description |
|--------|---------|-------------|
| `map` | `"leaflet"` | `"leaflet"`, `"leaflet-fr"`, `"leaflet-tomtom"`, `"svg"` (experimental) or `false` |
| `mapHeight` | `312` | Map height in px |
| `width` | `0` | Max module width in px. The map is hidden below 320 px |
| `scale` | `1` | Size multiplier, 0.5 to 3 |
| `sparkline` | `true` | `true`, `"curved"`, `"stepped"`, `false` |
| `incidents` | `true` | `true`, `false`, or a list of `JAM`, `ROAD_WORK`, `ROAD_CLOSURE`, `OTHER` |
| `showDelta`, `showTrend`, `animations` | `true` | Toggle delta vs usual, trend arrow, motion |
| `warnAt` / `criticalAt` | `10` / `25` | % slower than usual for yellow / red |

**Refresh and quota**

| Option | Default | Description |
|--------|---------|-------------|
| `refreshMinutes` | `5` | Minimum interval; slows automatically to fit the quota |
| `monthlyQuota` | `20000` | Your TomTom calls per month, `0` disables pacing. When exhausted, traffic tiles show until midnight UTC |

**Settings popup.** The hamburger button next to the strip scale edits these options and saves them back into `config.js` (`config.js.bak` is written first). Restart MagicMirror afterwards. If the module entry can't be parsed, nothing is edited.

</details>

<details>
<summary><h2>Advanced</h2></summary>

Put these inside `advanced`, e.g. `advanced: { api: { travelMode: "truck" }, map: { zoom: 12 } }`. It is applied last.

| Option | Default | Description |
|--------|---------|-------------|
| `api.timeout` | `10000` | HTTP timeout (ms) |
| `api.routeType` | `"fastest"` | `"fastest"`, `"shortest"`, `"eco"`, `"thrilling"` |
| `api.travelMode` | `"car"` | `"car"`, `"truck"`, `"taxi"`, `"bus"`, `"pedestrian"`, `"bicycle"` |
| `api.traffic` | `true` | Include live traffic |
| `api.avoid` | `[]` | `"tollRoads"`, `"motorways"`, `"ferries"`, `"unpavedRoads"`, `"carpools"`, `"alreadyUsedRoads"` |
| `map.width` | `"100%"` | Container width |
| `map.zoom` | `null` | Fixed zoom 1-19, or auto-fit |
| `map.center` | `null` | Fixed `[lat, lon]`, or auto-fit |
| `map.padding` | `[20, 20]` | Auto-fit padding `[vertical, horizontal]` px |
| `map.showScale` | `true` | Distance scale bar |
| `map.zoomControlSize` | `26` | +/- button size px |
| `sparkline.width` / `sparkline.height` | `192` / `48` | Minimum canvas size in px; the chart expands to fill the row |
| `sparkline.lookbackHours` | `48` | History window |
| `sparkline.maxDataPoints` | `50` | Max points rendered |
| `sparkline.show*` (`Baseline`, `BaselineLabel`, `NowIndicator`, `NowLabel`, `XAxisLabels`), `useZScoreColors` | `true` | Individual elements |
| `sparkline.colors` | `{}` | `{ critical, warning, good, baseline }` hex colours |

</details>

<details>
<summary><h2>Help</h2></summary>

| Symptom | What to do |
|---------|------------|
| No data / retrying | Check API key and network, then `pm2 restart MagicMirror` |
| No map | Module narrower than 320 px, or `map: false` |
| Sparklines empty | History builds over a few polls; full baseline takes hours |

Logs: `pm2 logs MagicMirror`

</details>

## License

MIT. Credits: [MagicMirror²](https://magicmirror.builders/), [TomTom Traffic API](https://developer.tomtom.com/), [Leaflet](https://leafletjs.com/).
