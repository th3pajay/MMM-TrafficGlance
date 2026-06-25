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

        const vals = valid.map(p => p.value);
        const dmax = Math.max(...vals), dmin = Math.min(...vals);
        const pad = (dmax - dmin) * 0.15 || 1;
        const max = Math.max(dmax, baseline ?? dmax) + pad;
        const min = Math.min(dmin, baseline ?? dmin) - pad;
        const range = max - min;
        if (!isFinite(range) || range === 0) { this._degenerate(valid[0].value, baseline, true); return; }

        const step = this.w / (valid.length - 1);
        const toY = v => this.h - ((v - min) / range * this.h);
        const coords = valid.map((p, i) => ({ x: i * step, y: toY(p.value), z: p.zScore ?? 0 }));
        const baseY = baseline !== null ? toY(baseline) : null;

        if (baseY !== null && this.config?.sparkline?.showBaseline !== false) this._baseline(baseY, baseline);
        if (baseY !== null) this._deltaFill(coords, baseY);
        this._trace(coords, stdDev);
        if (this.config?.sparkline?.showNowIndicator !== false) this._node(coords[coords.length - 1]);
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

    _zColor(z) { const c = this._colors(), a = Math.abs(z); return a < 1 ? c.good : a < 2 ? c.warning : c.critical; }

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

    _deltaFill(coords, baseY) {
        if (coords.length < 2) return;
        const isAbove = coords[coords.length - 1].y < baseY;
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.moveTo(coords[0].x, baseY);
        coords.forEach(p => this.ctx.lineTo(p.x, p.y));
        this.ctx.lineTo(coords[coords.length - 1].x, baseY);
        this.ctx.closePath();
        this.ctx.fillStyle = ColorTheme.hexToRgba(this._colors(isAbove).line, 0.15);
        this.ctx.fill();
        this.ctx.restore();
    }

    _trace(coords, stdDev) {
        if (coords.length < 2) return;
        this.ctx.save();
        this.ctx.lineWidth = 1.5;
        this.ctx.lineJoin = "round";
        this.ctx.lineCap = "round";
        if (this.config?.sparkline?.useZScoreColors !== false && stdDev > 0) {
            for (let i = 1; i < coords.length; i++) {
                this.ctx.beginPath();
                this.ctx.strokeStyle = this._zColor((coords[i - 1].z + coords[i].z) / 2);
                this.ctx.moveTo(coords[i - 1].x, coords[i - 1].y);
                this.ctx.lineTo(coords[i].x, coords[i].y);
                this.ctx.stroke();
            }
        } else {
            const last = coords[coords.length - 1];
            this.ctx.strokeStyle = this._colors(last.y < this.h / 2).line;
            this.ctx.beginPath();
            coords.forEach((p, i) => i === 0 ? this.ctx.moveTo(p.x, p.y) : this.ctx.lineTo(p.x, p.y));
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
