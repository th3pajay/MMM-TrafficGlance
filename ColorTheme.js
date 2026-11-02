var ColorTheme = {
    traffic: {
        good: '#2ecc71',
        warning: '#f5a623',
        critical: '#ff4d6d',
        jam: '#ff6b6b',
        roadwork: '#f5a623',
        closure: '#b57bff',
        accident: '#ff3b5c',
        hazard: '#4dc3ff'
    },

    ui: {
        baseline: '#888888',
        textSecondary: '#aaaaaa'
    },

    hexToRgba: function(hex, alpha) {
        hex = hex.replace('#', '');
        var r = parseInt(hex.slice(0, 2), 16);
        var g = parseInt(hex.slice(2, 4), 16);
        var b = parseInt(hex.slice(4, 6), 16);
        return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
    },

    getRouteColorClass: function(route, thresholds) {
        var threshold = thresholds && thresholds.critical != null ? thresholds.critical : 1.25;
        var warningPct = thresholds && thresholds.warning != null ? thresholds.warning : 1;
        if (route.historicalAverage != null && route.historicalAverage > 0) {
            var pct = ((route.currentDuration - route.historicalAverage) / route.historicalAverage) * 100;
            var criticalPct = (threshold - 1) * 100;
            if (pct > criticalPct) return 'red';
            if (pct >= warningPct) return 'yellow';
            return 'green';
        }
        if (route.delayFactor != null && route.delayFactor >= threshold) return 'red';
        return 'green';
    },

    getRouteColor: function(route, thresholds) {
        var cls = this.getRouteColorClass(route, thresholds);
        return { green: this.traffic.good, yellow: this.traffic.warning, red: this.traffic.critical }[cls];
    },

    getIncidentColor: function(category, magnitude) {
        var key = this.incidentColorKey[category];
        if (key) return this.traffic[key];
        return magnitude === 4 ? this.traffic.critical : this.traffic.jam;
    },

    incidentColorKey: {
        ROAD_CLOSURE: 'closure', LANE_CLOSED: 'closure', ACCIDENT: 'accident',
        ROAD_WORK: 'roadwork', BROKEN_DOWN_VEHICLE: 'roadwork',
        DANGEROUS_CONDITIONS: 'hazard', FLOODING: 'hazard', ICE: 'hazard', FOG: 'hazard', RAIN: 'hazard', WIND: 'hazard'
    },

    incidentGlyph: {
        JAM: '▼', ROAD_WORK: '◆', ROAD_CLOSURE: '■', LANE_CLOSED: '▌', ACCIDENT: '✖', BROKEN_DOWN_VEHICLE: '◐',
        DANGEROUS_CONDITIONS: '▲', FLOODING: '▲', ICE: '▲', FOG: '▲', RAIN: '▲', WIND: '▲', OTHER: '●'
    },

    incidentName: {
        ROAD_CLOSURE: 'Road closed', ACCIDENT: 'Accident', LANE_CLOSED: 'Lane closed', BROKEN_DOWN_VEHICLE: 'Broken-down vehicle',
        DANGEROUS_CONDITIONS: 'Dangerous conditions', FLOODING: 'Flooding', ICE: 'Ice', FOG: 'Fog', RAIN: 'Rain', WIND: 'Wind',
        JAM: 'Jam', ROAD_WORK: 'Roadworks', OTHER: 'Delay'
    },

    incidentDash: { ROAD_CLOSURE: '2, 8', LANE_CLOSED: '2, 8', ROAD_WORK: '10, 6', BROKEN_DOWN_VEHICLE: '10, 6' },

    incidentLabel: function(inc) {
        var name = this.incidentName[inc.category] || this.incidentName.OTHER;
        var mins = Math.round((inc.delaySeconds || 0) / 60);
        var timed = inc.category !== 'ROAD_CLOSURE' && inc.category !== 'LANE_CLOSED';
        return name + (inc.count > 1 ? ' ×' + inc.count : '') + (timed && mins > 0 ? ' +' + mins + 'm' : '');
    }
};
