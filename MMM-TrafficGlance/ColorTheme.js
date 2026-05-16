var ColorTheme = {
    traffic: {
        good: '#2ecc71',
        warning: '#f39c12',
        critical: '#c0392b',
        criticalAlt: '#e91e63',
        neutral: '#4fc3f7'
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

    getColorByZScore: function(zScore) {
        if (zScore < 0) return this.traffic.good;
        var absZ = Math.abs(zScore);
        if (absZ < 1) return this.traffic.good;
        if (absZ < 2) return this.traffic.warning;
        return this.traffic.criticalAlt;
    },

    getColorByPercentAboveHistorical: function(percentAbove) {
        if (percentAbove > 25) return this.traffic.critical;
        if (percentAbove >= 1) return this.traffic.warning;
        return this.traffic.good;
    },

    getColorByDelayFactor: function(delayFactor) {
        if (delayFactor >= 1.25) return this.traffic.critical;
        return this.traffic.good;
    },

    getRouteColorClass: function(route, criticalThreshold) {
        var threshold = criticalThreshold != null ? criticalThreshold : 1.25;
        if (route.historicalAverage != null && route.historicalAverage > 0) {
            var pct = ((route.currentDuration - route.historicalAverage) / route.historicalAverage) * 100;
            if (pct > 25) return 'red';
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

    getMapColors: function() {
        return {
            green: this.traffic.good,
            yellow: this.traffic.warning,
            red: this.traffic.criticalAlt
        };
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ColorTheme;
}

if (typeof window !== 'undefined') {
    window.ColorTheme = ColorTheme;
}
