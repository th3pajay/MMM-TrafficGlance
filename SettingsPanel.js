class SettingsPanel {
    static UNPARSABLE = "Settings cannot be parsed, please check manually.";
    static RESTART = "Settings saved. Please restart the module (pm2 restart MagicMirror) to apply them.";

    constructor({ onLoad, onSave }) {
        this.onLoad = onLoad;
        this.onSave = onSave;
        this.controls = [];
        this.root = null;

        this.button = SettingsPanel._el("button", "tg-settings-btn");
        this.button.type = "button";
        this.button.setAttribute("aria-label", "Settings");
        for (let i = 0; i < 3; i++) this.button.appendChild(SettingsPanel._el("span", "tg-settings-bar"));
        this.button.addEventListener("click", () => this.toggle());

        this.banner = SettingsPanel._el("div", "tg-settings-banner");
        this.banner.hidden = true;

        this.overlay = SettingsPanel._el("div", "tg-settings");
        this.overlay.hidden = true;
        const header = this.overlay.appendChild(SettingsPanel._el("div", "tg-settings-header"));
        header.appendChild(SettingsPanel._el("span", "tg-settings-title", "Traffic Glance settings"));
        const closeBtn = header.appendChild(SettingsPanel._el("button", "tg-settings-close", "×"));
        closeBtn.type = "button";
        closeBtn.addEventListener("click", () => this.close());
        this.body = this.overlay.appendChild(SettingsPanel._el("div", "tg-settings-body"));
        const footer = this.overlay.appendChild(SettingsPanel._el("div", "tg-settings-footer"));
        this.status = footer.appendChild(SettingsPanel._el("span", "tg-settings-status"));
        this.cancelBtn = footer.appendChild(SettingsPanel._el("button", "tg-settings-action", "Cancel"));
        this.cancelBtn.type = "button";
        this.cancelBtn.addEventListener("click", () => this.close());
        this.saveBtn = footer.appendChild(SettingsPanel._el("button", "tg-settings-action primary", "Save"));
        this.saveBtn.type = "button";
        this.saveBtn.hidden = true;
        this.saveBtn.addEventListener("click", () => this._save());
    }

    static _el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    attach(root) {
        this.root = root;
        root.prepend(this.banner);
        root.appendChild(this.button);
        root.appendChild(this.overlay);
        root.classList.toggle("settings-open", !this.overlay.hidden);
    }

    toggle() {
        if (this.overlay.hidden) this.open(); else this.close();
    }

    open() {
        this.banner.hidden = true;
        this.overlay.hidden = false;
        this.root?.classList.add("settings-open");
        this.body.replaceChildren(SettingsPanel._el("div", "tg-settings-note", "Loading settings..."));
        this.saveBtn.hidden = true;
        this.status.textContent = "";
        this.onLoad();
    }

    close() {
        this.overlay.hidden = true;
        this.root?.classList.remove("settings-open");
    }

    showData(result) {
        this.controls = [];
        this.status.textContent = "";
        if (!result?.ok) {
            this.saveBtn.hidden = true;
            this.body.replaceChildren(SettingsPanel._el("div", "tg-settings-note error", SettingsPanel.UNPARSABLE));
            return;
        }
        const sections = new Map();
        for (const f of result.schema) {
            if (!sections.has(f.section)) sections.set(f.section, []);
            sections.get(f.section).push(f);
        }
        const frag = document.createDocumentFragment();
        for (const [name, fields] of sections) {
            const card = frag.appendChild(SettingsPanel._el("section", "tg-settings-card"));
            card.appendChild(SettingsPanel._el("h3", "", name));
            for (const f of fields) {
                const control = this._control(f, result.values[f.path]);
                this.controls.push({ path: f.path, read: control.read, initial: JSON.stringify(control.read()) });
                const row = card.appendChild(SettingsPanel._el("div", `tg-settings-row ${f.type}`));
                row.appendChild(SettingsPanel._el("label", "", f.label));
                row.appendChild(control.node);
            }
        }
        this.body.replaceChildren(frag);
        this.saveBtn.hidden = false;
    }

    showSaved() {
        this.close();
        this.banner.textContent = SettingsPanel.RESTART;
        this.banner.hidden = false;
    }

    showError(result) {
        this.status.textContent = result?.error || "Save failed";
        this.status.classList.add("error");
    }

    _save() {
        const changes = {};
        for (const c of this.controls) {
            const value = c.read();
            if (JSON.stringify(value) !== c.initial) changes[c.path] = value;
        }
        this.status.classList.remove("error");
        if (!Object.keys(changes).length) { this.status.textContent = "No changes"; return; }
        this.status.textContent = "Saving...";
        this.onSave(changes);
    }

    static _input(type, value, attrs = {}) {
        const i = SettingsPanel._el("input");
        i.type = type;
        Object.entries(attrs).forEach(([k, v]) => { if (v !== undefined) i.setAttribute(k, v); });
        if (value !== undefined && value !== null) i.value = value;
        return i;
    }

    _control(f, value) {
        const num = (v, extra = {}) => SettingsPanel._input("number", v, { min: f.min, max: f.max, step: f.integer ? 1 : "any", ...extra });
        switch (f.type) {
            case "boolean": {
                const wrap = SettingsPanel._el("label", "tg-switch");
                const i = SettingsPanel._input("checkbox");
                i.checked = value === true;
                wrap.append(i, SettingsPanel._el("span", "tg-switch-track"));
                return { node: wrap, read: () => i.checked };
            }
            case "choice": {
                const s = SettingsPanel._el("select");
                f.options.forEach((o, i) => s.appendChild(new Option(o.label, String(i), false, o.value === value)));
                return { node: s, read: () => f.options[Number(s.value)].value };
            }
            case "number": {
                const i = num(value);
                return { node: i, read: () => Number(i.value) };
            }
            case "incidents": {
                const wrap = SettingsPanel._el("div", "tg-chips");
                const boxes = f.options.map(o => {
                    const chip = wrap.appendChild(SettingsPanel._el("label", "tg-chip"));
                    const i = SettingsPanel._input("checkbox");
                    i.checked = Array.isArray(value) && value.includes(o);
                    chip.append(i, document.createTextNode(o));
                    return { o, i };
                });
                return { node: wrap, read: () => boxes.filter(b => b.i.checked).map(b => b.o) };
            }
            case "routes":
                return this._routes(value);
            default:
                return { node: SettingsPanel._el("span"), read: () => value };
        }
    }

    _routes(value) {
        const wrap = SettingsPanel._el("div", "tg-routes");
        const rows = [];
        const addRow = (r, isNew) => {
            const row = wrap.insertBefore(SettingsPanel._el("div", "tg-route"), addBtn);
            const id = SettingsPanel._input("text", r.id, { placeholder: "id" });
            id.readOnly = !isNew;
            const name = SettingsPanel._input("text", r.name, { placeholder: "name" });
            const origin = SettingsPanel._input("text", r.origin, { placeholder: "origin lat,lon" });
            const destination = SettingsPanel._input("text", r.destination, { placeholder: "destination lat,lon" });
            const remove = SettingsPanel._el("button", "tg-settings-action", "Remove");
            remove.type = "button";
            const entry = { id, name, origin, destination, row };
            remove.addEventListener("click", () => { row.remove(); rows.splice(rows.indexOf(entry), 1); });
            row.append(id, name, origin, destination, remove);
            rows.push(entry);
        };
        const addBtn = SettingsPanel._el("button", "tg-settings-action", "Add route");
        addBtn.type = "button";
        wrap.appendChild(addBtn);
        addBtn.addEventListener("click", () => {
            let n = rows.length + 1;
            while (rows.some(r => r.id.value === `route-${n}`)) n++;
            addRow({ id: `route-${n}`, name: "", origin: "", destination: "" }, true);
        });
        (Array.isArray(value) ? value : []).forEach(r => addRow(r, false));
        return {
            node: wrap,
            read: () => rows.map(r => ({ id: r.id.value, name: r.name.value, origin: r.origin.value, destination: r.destination.value }))
        };
    }
}
