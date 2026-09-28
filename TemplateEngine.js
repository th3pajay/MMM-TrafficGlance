class SparklineEngine {
    constructor(canvasId, data, config) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext("2d");
        this.config = config;
        this.data = data || { points: [], baseline: null, stdDev: null };
        this.w = this.canvas.width;
        this.h = this.canvas.height;
    }

    render() {
        if (!this.canvas) return;
        const { points, baseline, stdDev } = this.data;
        this.ctx.clearRect(0, 0, this.w, this.h);
        const valid = (points || []).filter(p => p.value !== null);
        if (!valid.length) { this._empty(); return; }
        if (valid.length === 1) { this._degenerate(valid[0].value, baseline, false); return; }

        const showAxis = this.config?.sparkline?.showXAxisLabels !== false;
        const axisMargin = showAxis ? 12 : 0;
        const chartH = this.h - axisMargin;

        const vals = valid.map(p => p.value);
        const dmax = Math.max(...vals), dmin = Math.min(...vals);
        const pad = (dmax - dmin) * 0.15 || 1;
        const max = Math.max(dmax, baseline ?? dmax) + pad;
        const min = Math.min(dmin, baseline ?? dmin) - pad;
        const range = max - min;
        if (!isFinite(range) || range === 0) { this._degenerate(valid[0].value, baseline, true); return; }

        const step = this.w / (valid.length - 1);
        const toY = v => chartH - ((v - min) / range * chartH);
        const coords = valid.map((p, i) => ({ x: i * step, y: toY(p.value), z: p.zScore ?? 0, t: p.timestamp }));
        const baseY = baseline !== null ? toY(baseline) : null;

        if (baseY !== null && this.config?.sparkline?.showBaseline !== false) this._baseline(baseY, baseline);
        if (baseY !== null) this._deltaFill(coords, baseY);
        this._trace(coords, stdDev);
        if (this.config?.sparkline?.showNowIndicator !== false) this._node(coords[coords.length - 1]);
        if (showAxis) this._xAxisLabels(coords);
        if (this.config?.sparkline?.showIncidents !== false && this.data.incidents?.length) this._incidentMarkers(coords, this.data.incidents);
    }

    _incidentMarkers(coords, incidents) {
        this.ctx.save();
        incidents.forEach(inc => {
            const pt = coords[inc.pointIndex];
            if (!pt) return;
            this.ctx.fillStyle = ColorTheme.getIncidentColor(inc.category, inc.magnitude);
            this._drawIncidentShape(inc.category, pt.x, 5);
        });
        this.ctx.restore();
    }

    _drawIncidentShape(category, x, y) {
        this.ctx.beginPath();
        switch (category) {
            case "ROAD_WORK":
                this.ctx.moveTo(x, y - 4);
                this.ctx.lineTo(x + 3, y - 1);
                this.ctx.lineTo(x, y + 2);
                this.ctx.lineTo(x - 3, y - 1);
                this.ctx.closePath();
                break;
            case "ROAD_CLOSURE":
                this.ctx.rect(x - 3, y - 4, 6, 6);
                break;
            case "JAM":
                this.ctx.moveTo(x - 3, y - 4);
                this.ctx.lineTo(x + 3, y - 4);
                this.ctx.lineTo(x, y + 2);
                this.ctx.closePath();
                break;
            default:
                this.ctx.arc(x, y - 1, 2.5, 0, Math.PI * 2);
                break;
        }
        this.ctx.fill();
    }

    _xAxisLabels(coords) {
        const n = coords.length;
        const count = Math.max(2, Math.min(4, Math.floor(this.w / 60)));
        const idxs = new Set([0, n - 1]);
        for (let k = 1; k < count - 1; k++) idxs.add(Math.round(k * (n - 1) / (count - 1)));
        const sorted = [...idxs].sort((a, b) => a - b);
        this.ctx.save();
        this.ctx.font = "8px sans-serif";
        this.ctx.fillStyle = ColorTheme.ui.textSecondary;
        this.ctx.globalAlpha = 0.7;
        const y = this.h - 2;
        sorted.forEach((i, k) => {
            const pt = coords[i];
            const d = new Date(pt.t * 1000);
            const label = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
            this.ctx.textAlign = k === 0 ? "left" : k === sorted.length - 1 ? "right" : "center";
            this.ctx.fillText(label, pt.x, y);
        });
        this.ctx.restore();
    }

    _colors(isAbove = false) {
        const cfg = this.config?.sparkline?.colors || {};
        return {
            good: cfg.good || ColorTheme.traffic.good,
            warning: cfg.warning || ColorTheme.traffic.warning,
            critical: cfg.critical || ColorTheme.traffic.criticalAlt,
            baseline: cfg.baseline || ColorTheme.ui.baseline,
            line: isAbove ? (cfg.critical || ColorTheme.traffic.criticalAlt) : (cfg.good || ColorTheme.traffic.good)
        };
    }

    _zColor(z) { const c = this._colors(); return z < 1 ? c.good : z < 2 ? c.warning : c.critical; }

    _baseline(baseY, value) {
        const c = this._colors();
        this.ctx.save();
        this.ctx.setLineDash([3, 3]);
        this.ctx.strokeStyle = c.baseline;
        this.ctx.globalAlpha = 0.6;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(0, baseY); this.ctx.lineTo(this.w, baseY);
        this.ctx.stroke();
        if (this.config?.sparkline?.showBaselineLabel !== false && this.w >= 80) {
            this.ctx.font = "bold 8px sans-serif";
            this.ctx.fillStyle = c.baseline;
            this.ctx.globalAlpha = 0.8;
            this.ctx.textAlign = "left";
            this.ctx.fillText(`Avg: ${Math.round(value)}m`, 2, baseY > 12 ? baseY - 3 : baseY + 10);
        }
        this.ctx.restore();
    }

    _lineStyle() {
        const style = this.config?.sparkline?.lineStyle;
        return style === "curved" || style === "stepped" ? style : "linear";
    }

    _drawSegment(p0, p1, style) {
        if (style === "stepped") {
            this.ctx.lineTo(p1.x, p0.y);
            this.ctx.lineTo(p1.x, p1.y);
        } else {
            this.ctx.lineTo(p1.x, p1.y);
        }
    }

    _tracePath(coords, style) {
        const n = coords.length;
        if (style === "curved") {
            for (let i = 1; i < n - 1; i++) {
                const xc = (coords[i].x + coords[i + 1].x) / 2, yc = (coords[i].y + coords[i + 1].y) / 2;
                this.ctx.quadraticCurveTo(coords[i].x, coords[i].y, xc, yc);
            }
            if (n > 1) this.ctx.quadraticCurveTo(coords[n - 2].x, coords[n - 2].y, coords[n - 1].x, coords[n - 1].y);
        } else {
            for (let i = 1; i < n; i++) this._drawSegment(coords[i - 1], coords[i], style);
        }
    }

    _traceCurvedColored(coords) {
        const n = coords.length;
        let prev = coords[0];
        for (let i = 1; i < n - 1; i++) {
            const end = { x: (coords[i].x + coords[i + 1].x) / 2, y: (coords[i].y + coords[i + 1].y) / 2 };
            this.ctx.beginPath();
            this.ctx.strokeStyle = this._zColor((coords[i - 1].z + coords[i].z) / 2);
            this.ctx.moveTo(prev.x, prev.y);
            this.ctx.quadraticCurveTo(coords[i].x, coords[i].y, end.x, end.y);
            this.ctx.stroke();
            prev = end;
        }
        this.ctx.beginPath();
        this.ctx.strokeStyle = this._zColor((coords[n - 2].z + coords[n - 1].z) / 2);
        this.ctx.moveTo(prev.x, prev.y);
        this.ctx.quadraticCurveTo(coords[n - 2].x, coords[n - 2].y, coords[n - 1].x, coords[n - 1].y);
        this.ctx.stroke();
    }

    _deltaFill(coords, baseY) {
        if (coords.length < 2) return;
        const isAbove = coords[coords.length - 1].y < baseY;
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.moveTo(coords[0].x, baseY);
        this.ctx.lineTo(coords[0].x, coords[0].y);
        this._tracePath(coords, this._lineStyle());
        this.ctx.lineTo(coords[coords.length - 1].x, baseY);
        this.ctx.closePath();
        this.ctx.fillStyle = ColorTheme.hexToRgba(this._colors(isAbove).line, 0.15);
        this.ctx.fill();
        this.ctx.restore();
    }

    _trace(coords, stdDev) {
        if (coords.length < 2) return;
        const style = this._lineStyle();
        this.ctx.save();
        this.ctx.lineWidth = 1.5;
        this.ctx.lineJoin = "round";
        this.ctx.lineCap = "round";
        if (this.config?.sparkline?.useZScoreColors !== false && stdDev > 0) {
            if (style === "curved") {
                this._traceCurvedColored(coords);
            } else {
                for (let i = 1; i < coords.length; i++) {
                    this.ctx.beginPath();
                    this.ctx.strokeStyle = this._zColor((coords[i - 1].z + coords[i].z) / 2);
                    this.ctx.moveTo(coords[i - 1].x, coords[i - 1].y);
                    this._drawSegment(coords[i - 1], coords[i], style);
                    this.ctx.stroke();
                }
            }
        } else {
            const last = coords[coords.length - 1];
            this.ctx.strokeStyle = this._colors(last.y < this.h / 2).line;
            this.ctx.beginPath();
            this.ctx.moveTo(coords[0].x, coords[0].y);
            this._tracePath(coords, style);
            this.ctx.stroke();
        }
        this.ctx.restore();
    }

    _node(pt) {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
        this.ctx.fillStyle = "rgba(0,0,0,0.3)";
        this.ctx.fill();
        this.ctx.beginPath();
        this.ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
        this.ctx.fillStyle = this._zColor(pt.z);
        this.ctx.fill();
        if (this.config?.sparkline?.showNowLabel !== false && this.w >= 80) {
            this.ctx.font = "bold 8px sans-serif";
            this.ctx.fillStyle = this._zColor(pt.z);
            this.ctx.textAlign = "right";
            this.ctx.fillText("NOW", pt.x - 2, pt.y > 12 ? pt.y - 6 : pt.y + 12);
        }
        this.ctx.restore();
    }

    _empty() {
        this.ctx.save();
        this.ctx.setLineDash([4, 4]);
        this.ctx.strokeStyle = "#666";
        this.ctx.globalAlpha = 0.4;
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.h / 2); this.ctx.lineTo(this.w, this.h / 2);
        this.ctx.stroke();
        this.ctx.restore();
    }

    _degenerate(value, baseline, drawLine) {
        const c = this._colors(baseline !== null && value > baseline);
        if (baseline !== null) this._baseline(this.h / 2, baseline);
        this.ctx.lineWidth = 1.5;
        if (drawLine) {
            this.ctx.beginPath(); this.ctx.strokeStyle = c.line;
            this.ctx.moveTo(0, this.h / 2); this.ctx.lineTo(this.w, this.h / 2); this.ctx.stroke();
        }
        this.ctx.beginPath();
        this.ctx.arc(drawLine ? this.w - 4 : this.w / 2, this.h / 2, drawLine ? 3 : 4, 0, Math.PI * 2);
        this.ctx.fillStyle = c.line; this.ctx.fill();
    }
}
