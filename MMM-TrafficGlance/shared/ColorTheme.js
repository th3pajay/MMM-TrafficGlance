/**
 * ColorTheme - Centralized color palette
 *
 * Single source of truth for all traffic visualization colors
 * Used across frontend (TemplateEngine, MapRenderer) and backend (node_helper)
 */

const ColorTheme = {
    // Traffic status colors (semantic)
    traffic: {
        good: '#2ecc71',        // Green - normal conditions
        warning: '#f39c12',     // Orange/Yellow - caution
        critical: '#c0392b',    // Dark red - severe delay
        criticalAlt: '#e91e63', // Bright red/pink - alternative critical color
        neutral: '#4fc3f7'      // Blue - neutral/unknown
    },

    // UI colors
    ui: {
        baseline: '#888888',              // Gray - baseline/average indicator
        textPrimary: '#ffffff',           // White text
        textSecondary: '#aaaaaa',         // Light gray text
        backgroundDark: '#1a1a2e',        // Dark background
        border: 'rgba(255, 255, 255, 0.1)' // Light border
    },

    // Helper method to convert hex to rgba
    hexToRgba(hex, alpha) {
        // Remove # if present
        hex = hex.replace('#', '');

        // Parse hex values
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);

        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    },

    // Get color based on Z-score (for sparklines)
    getColorByZScore(zScore) {
        const absZ = Math.abs(zScore);

        // Only color deviations above the baseline (positive Z-scores)
        if (zScore < 0) {
            return this.traffic.good;  // Green for below average
        }

        if (absZ < 1) return this.traffic.good;      // Green: within 1 std dev
        if (absZ < 2) return this.traffic.warning;   // Yellow: 1-2 std dev
        return this.traffic.criticalAlt;              // Red: >2 std dev
    },

    // Get color based on percentage above historical average
    getColorByPercentAboveHistorical(percentAbove) {
        if (percentAbove > 25) {
            return this.traffic.critical;    // Red: >25% above
        } else if (percentAbove >= 1) {
            return this.traffic.warning;     // Yellow: 1-25% above
        } else {
            return this.traffic.good;        // Green: <=0% (on time or better)
        }
    },

    // Get color based on delay factor
    getColorByDelayFactor(delayFactor) {
        if (delayFactor >= 1.25) {
            return this.traffic.critical;    // Red: 25%+ delay
        } else {
            return this.traffic.good;        // Green: normal
        }
    },

    // Get route color (combined logic for maps)
    getRouteColor(route) {
        // Prefer historical comparison if available
        if (route.historicalAverage !== null &&
            route.historicalAverage !== undefined &&
            route.historicalAverage > 0) {
            const percentAbove = ((route.currentDuration - route.historicalAverage) / route.historicalAverage) * 100;
            return this.getColorByPercentAboveHistorical(percentAbove);
        }

        // Fallback to delay factor
        if (route.delayFactor !== null && route.delayFactor !== undefined) {
            return this.getColorByDelayFactor(route.delayFactor);
        }

        // Default to good
        return this.traffic.good;
    },

    // Legacy compatibility: aliases for old code
    get critical() { return this.traffic.criticalAlt; },
    get warning() { return this.traffic.warning; },
    get good() { return this.traffic.good; },
    get neutral() { return this.traffic.neutral; },
    get baseline() { return this.ui.baseline; },

    // Map renderer legacy format
    getMapColors() {
        return {
            green: this.traffic.good,
            yellow: this.traffic.warning,
            red: this.traffic.criticalAlt
        };
    }
};

// Export for Node.js (backend)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ColorTheme;
}

// Export for browser (frontend) - attach to window
if (typeof window !== 'undefined') {
    window.ColorTheme = ColorTheme;
}
