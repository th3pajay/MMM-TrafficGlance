/**
 * StatsUtil - Shared statistical calculations
 *
 * Provides centralized statistical functions to avoid code duplication
 * across node_helper.js and TemplateEngine.js
 */

var StatsUtil = {
    /**
     * Calculate Z-scores for a set of values relative to a baseline
     *
     * @param {number[]} values - Array of numeric values
     * @param {number|null} baseline - Baseline value (typically the mean)
     * @returns {Object} { stdDev: number|null, zScores: number[] }
     */
    calculateZScores(values, baseline) {
        // Handle edge cases
        if (!values || values.length < 2) {
            return { stdDev: null, zScores: values ? values.map(() => 0) : [] };
        }

        if (baseline === null || baseline === undefined) {
            return { stdDev: null, zScores: values.map(() => 0) };
        }

        // Calculate variance
        const variance = values.reduce((sum, v) => {
            return sum + Math.pow(v - baseline, 2);
        }, 0) / values.length;

        // Calculate standard deviation
        const stdDev = Math.sqrt(variance);

        // Calculate Z-scores
        const zScores = values.map(v => {
            if (v === null || v === undefined) return 0;
            if (stdDev === 0) return 0;
            return (v - baseline) / stdDev;
        });

        return { stdDev, zScores };
    },

    /**
     * Calculate mean (average) of values
     *
     * @param {number[]} values - Array of numeric values
     * @returns {number|null} Mean value or null if empty
     */
    calculateMean(values) {
        if (!values || values.length === 0) return null;

        const validValues = values.filter(v => v !== null && v !== undefined && !isNaN(v));
        if (validValues.length === 0) return null;

        const sum = validValues.reduce((a, b) => a + b, 0);
        return sum / validValues.length;
    },

    /**
     * Calculate basic statistics for a dataset
     *
     * @param {number[]} values - Array of numeric values
     * @returns {Object} { min, max, mean, count, stdDev }
     */
    calculateStats(values) {
        if (!values || values.length === 0) {
            return { min: null, max: null, mean: null, count: 0, stdDev: null };
        }

        const validValues = values.filter(v => v !== null && v !== undefined && !isNaN(v));
        if (validValues.length === 0) {
            return { min: null, max: null, mean: null, count: 0, stdDev: null };
        }

        const min = Math.min(...validValues);
        const max = Math.max(...validValues);
        const mean = this.calculateMean(validValues);
        const count = validValues.length;

        let stdDev = null;
        if (validValues.length > 1 && mean !== null) {
            const variance = validValues.reduce((sum, v) => {
                return sum + Math.pow(v - mean, 2);
            }, 0) / validValues.length;
            stdDev = Math.sqrt(variance);
        }

        return { min, max, mean, count, stdDev };
    },

    /**
     * Assign Z-scores to an array of point objects
     * Modifies the points array in place by adding zScore property
     *
     * @param {Object[]} points - Array of point objects with 'value' property
     * @param {number|null} baseline - Baseline value for Z-score calculation
     * @returns {number|null} Standard deviation
     */
    assignZScoresToPoints(points, baseline) {
        if (!points || points.length === 0) return null;

        const values = points.map(p => p.value).filter(v => v !== null && v !== undefined);
        const { stdDev, zScores } = this.calculateZScores(values, baseline);

        // Assign Z-scores to points (handling null values)
        let zScoreIndex = 0;
        points.forEach(p => {
            if (p.value !== null && p.value !== undefined) {
                p.zScore = zScores[zScoreIndex];
                zScoreIndex++;
            } else {
                p.zScore = 0;
            }
        });

        return stdDev;
    }
};

// Export for Node.js (backend)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StatsUtil;
}

// Export for browser (frontend) - attach to window
if (typeof window !== 'undefined') {
    window.StatsUtil = StatsUtil;
}
