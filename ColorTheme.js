var ColorTheme = {
    traffic: {
        good: '#2ecc71',
        warning: '#f5a623',
        critical: '#ff4d6d',
        jam: '#ff6b6b',
        roadwork: '#f5a623',
        closure: '#b57bff'
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
        if (category === 'ROAD_CLOSURE') return this.traffic.closure;
        if (category === 'ROAD_WORK') return this.traffic.roadwork;
        return magnitude === 4 ? this.traffic.critical : this.traffic.jam;
    },

    incidentGlyph: { JAM: '▼', ROAD_WORK: '◆', ROAD_CLOSURE: '■', OTHER: '●' }
};
