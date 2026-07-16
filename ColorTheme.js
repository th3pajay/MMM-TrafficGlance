var ColorTheme = {
    traffic: {
        good: '#2ecc71',
        warning: '#f39c12',
        critical: '#c0392b',
        criticalAlt: '#e91e63',
        neutral: '#4fc3f7',
        roadwork: '#f39c12',
        closure: '#9b59b6'
    },

    ui: {
        baseline: '#888888',
        textPrimary: '#ffffff',
        textSecondary: '#aaaaaa',
        backgroundDark: '#1a1a2e',
        border: 'rgba(255, 255, 255, 0.1)'
    },

    hexToRgba: function(hex, alpha) {
        hex = hex.replace('#', '');
        var r = parseInt(hex.slice(0, 2), 16);
        var g = parseInt(hex.slice(2, 4), 16);
        var b = parseInt(hex.slice(4, 6), 16);
        return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
    },

    getRouteColorClass: function(route, criticalThreshold) {
        var threshold = criticalThreshold != null ? criticalThreshold : 1.25;
        if (route.historicalAverage != null && route.historicalAverage > 0) {
            var pct = ((route.currentDuration - route.historicalAverage) / route.historicalAverage) * 100;
            var criticalPct = (threshold - 1) * 100;
            if (pct > criticalPct) return 'red';
            if (pct >= 1) return 'yellow';
            return 'green';
        }
        if (route.delayFactor != null && route.delayFactor >= threshold) return 'red';
        return 'green';
    },

    getRouteColor: function(route, criticalThreshold) {
        var cls = this.getRouteColorClass(route, criticalThreshold);
        return { green: this.traffic.good, yellow: this.traffic.warning, red: this.traffic.criticalAlt }[cls];
    },

    getIncidentColor: function(category, magnitude) {
        if (category === 'ROAD_CLOSURE') return this.traffic.closure;
        if (category === 'ROAD_WORK') return this.traffic.roadwork;
        return magnitude === 4 ? this.traffic.critical : '#e74c3c';
    },

};
