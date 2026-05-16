class SparklineEngine {
    constructor(canvasId, data, config) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.config = config;
        this.data = this.normalizeData(data);
        this.w = this.canvas.width;
        this.h = this.canvas.height;
    }

    normalizeData(data) {
        return data || { points: [], baseline: null, stdDev: null, stats: null };
    }

    // Interpolate an array of values using a validity mask (null = gap).
    // Extends edges and linearly fills gaps between valid points.
    interpolateArray(source, validity) {
        const result = [...source];
        let firstValid = validity.findIndex(v => v !== null);
        let lastValid = validity.length - 1;
        while (lastValid >= 0 && validity[lastValid] === null) lastValid--;
        if (firstValid === -1 || lastValid === -1) return result;

        for (let i = 0; i < firstValid; i++) result[i] = source[firstValid];
        for (let i = lastValid + 1; i < source.length; i++) result[i] = source[lastValid];

        let prevValid = firstValid;
        for (let i = firstValid + 1; i <= lastValid; i++) {
            if (validity[i] !== null) {
                if (i - prevValid > 1) {
                    const startVal = source[prevValid];
                    const endVal = source[i];
                    const gap = i - prevValid;
                    for (let j = prevValid + 1; j < i; j++) {
                        result[j] = startVal + (endVal - startVal) * ((j - prevValid) / gap);
                    }
                }
                prevValid = i;
            }
        }
        return result;
    }

    render() {
        if (!this.canvas || !this.ctx) return;

        const { points, baseline, stdDev, stats } = this.data;
        this.ctx.clearRect(0, 0, this.w, this.h);

        // Enable smoother line rendering
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';

        if (!points || points.length === 0) {
            this.renderEmptyState();
            return;
        }

        // Check if we have any valid data
        const validValues = points.map(p => p.value).filter(v => v !== null);
        if (validValues.length === 0) {
            this.renderEmptyState();
            return;
        }

        if (validValues.length === 1) {
            this.renderSinglePoint(validValues[0], baseline);
            return;
        }

        const validity = points.map(p => p.value);
        const interpolatedValues = this.interpolateArray(points.map(p => p.value), validity);
        const interpolatedZScores = this.interpolateArray(
            points.map(p => p.zScore !== undefined ? p.zScore : 0),
            validity
        );

        const values = interpolatedValues;

        const dataMax = Math.max(...validValues);
        const dataMin = Math.min(...validValues);
        const padding = (dataMax - dataMin) * 0.15 || 1;
        const max = Math.max(dataMax, baseline || dataMax) + padding;
        const min = Math.min(dataMin, baseline || dataMin) - padding;
        const range = max - min;

        if (range === 0 || !isFinite(range)) {
            this.renderFlatLine(validValues[0], baseline);
            return;
        }

        // Calculate left margin for Y-axis labels
        const showYLabels = this.config?.sparkline?.showYLabels !== false;
        const leftMargin = showYLabels ? 28 : 0;
        const drawWidth = this.w - leftMargin;

        const step = drawWidth / (values.length - 1);
        const coords = values.map((v, i) => ({
            x: leftMargin + i * step,
            y: this.h - ((v - min) / range * this.h)
        }));

        const current = values[values.length - 1];
        const baselineY = baseline !== null ? this.h - ((baseline - min) / range * this.h) : null;
        const isAboveBaseline = baseline !== null && current > baseline;

        const colors = this.getColors(isAboveBaseline);

        // Draw Y-grid if enabled
        if (this.config?.sparkline?.showGrid !== false) {
            this.drawYGrid(min, max, range, leftMargin);
        }

        // Draw baseline with optional label
        if (baseline !== null && this.config?.sparkline?.showBaseline !== false) {
            const showBaselineLabel = this.config?.sparkline?.showBaselineLabel !== false;
            this.drawBaseline(baselineY, colors.baseline, baseline, showBaselineLabel, leftMargin);
        }

        // Draw delta fill (area between line and baseline)
        this.drawDeltaFill(coords, baselineY, colors.fill);

        // Draw gradient fill below sparkline (if enabled)
        if (this.config?.sparkline?.showGradientFill !== false) {
            this.drawGradientFill(coords, isAboveBaseline);
        }

        // Draw trace with Z-score colors if enabled
        const useZScoreColors = this.config?.sparkline?.useZScoreColors !== false;
        if (useZScoreColors && stdDev && stdDev > 0) {
            this.drawTraceWithZColors(coords, interpolatedZScores);
        } else {
            this.drawTrace(coords, colors.line);
        }

        // Draw terminal node (NOW indicator)
        if (this.config?.sparkline?.showNowIndicator !== false) {
            const lastZScore = interpolatedZScores[interpolatedZScores.length - 1];
            const nodeColor = useZScoreColors && stdDev && stdDev > 0
                ? this.getSegmentColor(lastZScore)
                : colors.now;
            this.drawTerminalNode(coords[coords.length - 1], isAboveBaseline, { now: nodeColor });
        }
    }

    buildColors() {
        return {
            critical: ColorTheme.traffic.criticalAlt,
            warning: ColorTheme.traffic.warning,
            good: ColorTheme.traffic.good,
            neutral: ColorTheme.traffic.neutral,
            baseline: ColorTheme.ui.baseline,
            ...(this.config?.sparkline?.colors || {})
        };
    }

    getColors(isAboveBaseline) {
        const colors = this.buildColors();
        const lineColor = isAboveBaseline ? colors.critical : colors.good;
        return {
            line: lineColor,
            fill: ColorTheme.hexToRgba(lineColor, 0.15),
            baseline: colors.baseline,
            now: lineColor
        };
    }

    getSegmentColor(zScore) {
        const colors = this.buildColors();
        if (zScore < 0) return colors.good;
        const absZ = Math.abs(zScore);
        if (absZ < 1) return colors.good;
        if (absZ < 2) return colors.warning;
        return colors.critical;
    }

    drawYGrid(min, max, range, leftMargin = 0) {
        const numTicks = this.config?.sparkline?.gridTicks || 4;
        const step = range / numTicks;
        const showYLabels = this.config?.sparkline?.showYLabels !== false;

        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(255,255,255,0.15)';  // Increased from 0.1 to 0.15 for better contrast
        this.ctx.lineWidth = 0.5;

        for (let i = 0; i <= numTicks; i++) {
            const value = min + (step * i);
            const y = this.h - ((value - min) / range * this.h);

            // Draw horizontal grid line
            this.ctx.beginPath();
            this.ctx.moveTo(leftMargin, y);
            this.ctx.lineTo(this.w, y);
            this.ctx.stroke();

            // Draw tick label on left edge
            if (showYLabels && leftMargin > 0) {
                this.ctx.fillStyle = 'rgba(255,255,255,0.5)';
                this.ctx.font = '7px sans-serif';
                this.ctx.textAlign = 'right';
                this.ctx.fillText(Math.round(value) + 'm', leftMargin - 3, y + 2);
            }
        }
        this.ctx.restore();
    }

    drawBaseline(y, color, value, showLabel = true, leftMargin = 0) {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.setLineDash([3, 3]);
        this.ctx.strokeStyle = color;
        this.ctx.globalAlpha = 0.6;
        this.ctx.lineWidth = 1;
        this.ctx.moveTo(leftMargin, y);
        this.ctx.lineTo(this.w, y);
        this.ctx.stroke();
        this.ctx.restore();

        // Draw baseline label
        if (showLabel && value !== null && this.w >= 80) {
            this.ctx.save();
            this.ctx.font = 'bold 8px sans-serif';
            this.ctx.fillStyle = color;
            this.ctx.globalAlpha = 0.8;
            this.ctx.textAlign = 'left';
            const labelX = leftMargin + 2;
            const labelY = y > 12 ? y - 3 : y + 10;
            this.ctx.fillText(`Avg: ${Math.round(value)}m`, labelX, labelY);
            this.ctx.restore();
        }
    }

    drawDeltaFill(coords, baselineY, color) {
        if (baselineY === null || coords.length < 2) return;

        this.ctx.beginPath();
        this.ctx.moveTo(coords[0].x, baselineY);
        coords.forEach(pt => this.ctx.lineTo(pt.x, pt.y));
        this.ctx.lineTo(coords[coords.length - 1].x, baselineY);
        this.ctx.closePath();
        this.ctx.fillStyle = color;
        this.ctx.fill();
    }

    drawGradientFill(coords, isAboveBaseline) {
        if (coords.length < 2) return;

        this.ctx.save();
        const gradient = this.ctx.createLinearGradient(0, 0, 0, this.h);
        const colors = this.buildColors();
        const baseHex = isAboveBaseline ? colors.critical : colors.good;
        gradient.addColorStop(0, ColorTheme.hexToRgba(baseHex, 0.15));
        gradient.addColorStop(1, ColorTheme.hexToRgba(baseHex, 0));
        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.moveTo(coords[0].x, coords[0].y);
        for (let i = 1; i < coords.length; i++) {
            this.ctx.lineTo(coords[i].x, coords[i].y);
        }
        const lastPoint = coords[coords.length - 1];
        this.ctx.lineTo(lastPoint.x, this.h);
        this.ctx.lineTo(coords[0].x, this.h);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.restore();
    }

    drawTrace(coords, color) {
        this.ctx.beginPath();
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeStyle = color;
        this.ctx.lineJoin = 'round';
        this.ctx.lineCap = 'round';
        coords.forEach((pt, i) => {
            if (i === 0) this.ctx.moveTo(pt.x, pt.y);
            else this.ctx.lineTo(pt.x, pt.y);
        });
        this.ctx.stroke();
    }

    drawTraceWithZColors(coords, zScores) {
        if (coords.length < 2) return;

        this.ctx.lineWidth = 1.5;
        this.ctx.lineJoin = 'round';
        this.ctx.lineCap = 'round';

        for (let i = 1; i < coords.length; i++) {
            // Use average Z-score of segment endpoints for color
            const avgZ = (zScores[i - 1] + zScores[i]) / 2;
            const color = this.getSegmentColor(avgZ);

            this.ctx.beginPath();
            this.ctx.strokeStyle = color;
            this.ctx.moveTo(coords[i - 1].x, coords[i - 1].y);
            this.ctx.lineTo(coords[i].x, coords[i].y);
            this.ctx.stroke();
        }
    }

    drawTerminalNode(lastPoint, isAboveBaseline, colors) {
        const x = lastPoint.x;
        const y = lastPoint.y;
        const r = 3;

        // Shadow/glow
        this.ctx.beginPath();
        this.ctx.arc(x, y, r + 2, 0, Math.PI * 2);
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        this.ctx.fill();

        // Node
        this.ctx.beginPath();
        this.ctx.arc(x, y, r, 0, Math.PI * 2);
        this.ctx.fillStyle = colors.now;
        this.ctx.fill();

        // NOW label
        if (this.config?.sparkline?.showNowLabel !== false && this.w >= 80) {
            this.ctx.font = 'bold 8px sans-serif';
            this.ctx.fillStyle = colors.now;
            this.ctx.textAlign = 'right';
            const labelY = y > 12 ? y - 6 : y + 12;
            this.ctx.fillText('NOW', x - 2, labelY);
        }
    }

    renderEmptyState() {
        this.ctx.save();
        this.ctx.setLineDash([4, 4]);
        this.ctx.strokeStyle = '#666';
        this.ctx.globalAlpha = 0.4;
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.h / 2);
        this.ctx.lineTo(this.w, this.h / 2);
        this.ctx.stroke();
        this.ctx.restore();
    }

    renderSinglePoint(value, baseline) {
        const y = this.h / 2;
        const isAbove = baseline !== null && value > baseline;
        const colors = this.getColors(isAbove);

        if (baseline !== null) {
            this.drawBaseline(this.h / 2, colors.baseline, baseline, false);
        }

        this.ctx.beginPath();
        this.ctx.arc(this.w / 2, y, 4, 0, Math.PI * 2);
        this.ctx.fillStyle = colors.now;
        this.ctx.fill();
    }

    renderFlatLine(value, baseline) {
        const isAbove = baseline !== null && value > baseline;
        const colors = this.getColors(isAbove);

        if (baseline !== null) {
            this.drawBaseline(this.h / 2, colors.baseline, baseline, false);
        }

        this.ctx.beginPath();
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeStyle = colors.line;
        this.ctx.moveTo(0, this.h / 2);
        this.ctx.lineTo(this.w, this.h / 2);
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.arc(this.w - 4, this.h / 2, 3, 0, Math.PI * 2);
        this.ctx.fillStyle = colors.now;
        this.ctx.fill();
    }
}
