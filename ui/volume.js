// Built by k8sdockside-plugin from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
  // src/model/longhorn.ts
  var ENGINES = "crd:engines.longhorn.io";
  var REPLICAS = "crd:replicas.longhorn.io";
  function bytes(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (!value) return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  // src/model/capacity.ts
  function size(value) {
    if (!Number.isFinite(value) || value <= 0) return "0";
    const units = ["B", "Ki", "Mi", "Gi", "Ti", "Pi"];
    let n = value;
    let unit = 0;
    while (n >= 1024 && unit < units.length - 1) {
      n /= 1024;
      unit++;
    }
    const digits = n >= 100 || unit === 0 ? 0 : n >= 10 ? 1 : 2;
    return `${n.toFixed(digits)} ${units[unit]}`;
  }

  // src/model/volume.ts
  function health(volume) {
    const state = (volume.status?.state ?? "").toLowerCase();
    const robustness = (volume.status?.robustness ?? "").toLowerCase();
    if (volume.metadata.deletionTimestamp || state === "deleting") return { word: "deleting", tone: "warn" };
    if (state === "creating") return { word: "creating", tone: "warn" };
    if (state === "attaching" || state === "detaching") return { word: state, tone: "warn" };
    if (state === "detached") return { word: "detached", tone: "" };
    if (state !== "attached") return { word: state || "unknown", tone: "warn" };
    switch (robustness) {
      case "healthy":
        return { word: "healthy", tone: "ok" };
      case "degraded":
        return { word: "degraded", tone: "warn" };
      case "faulted":
        return { word: "faulted", tone: "error" };
      default:
        return { word: robustness || "unknown", tone: "warn" };
    }
  }
  function replicaViews(view) {
    const modes = view.engine?.status?.replicaModeMap ?? {};
    const rebuilds = view.engine?.status?.rebuildStatus ?? {};
    return view.replicas.map((replica) => {
      const name = replica.metadata.name;
      const failed = !!replica.spec?.failedAt;
      const mode = failed ? "ERR" : modes[name] ?? modeFromReplica(replica);
      const rebuild = rebuildPercent(rebuilds[name]);
      return {
        replica,
        name,
        node: replica.spec?.nodeID ?? "",
        disk: replica.spec?.diskID ?? "",
        mode,
        tone: modeTone(mode),
        ...rebuild === void 0 ? {} : { rebuild },
        failed
      };
    }).sort((a, b) => a.node.localeCompare(b.node) || a.name.localeCompare(b.name));
  }
  function modeFromReplica(replica) {
    const state = (replica.status?.currentState ?? "").toLowerCase();
    if (state === "error") return "ERR";
    if (state === "running") return "RW";
    return state || "stopped";
  }
  function modeTone(mode) {
    switch (mode) {
      case "RW":
        return "ok";
      case "WO":
        return "warn";
      case "ERR":
        return "error";
      default:
        return "";
    }
  }
  function rebuildPercent(status) {
    if (!status || !status.isRebuilding) return void 0;
    const progress2 = status.progress ?? 0;
    return Math.max(0, Math.min(100, progress2));
  }
  function healthyReplicas(view) {
    const views = replicaViews(view);
    return {
      ready: views.filter((r) => r.mode === "RW").length,
      wanted: view.volume.spec?.numberOfReplicas ?? views.length
    };
  }
  function compose(volumes, engines, replicas) {
    const engineOf = /* @__PURE__ */ new Map();
    for (const engine of engines) {
      const name = engine.spec?.volumeName ?? "";
      if (!name) continue;
      const current = engineOf.get(name);
      if (!current || engine.spec?.active === true) engineOf.set(name, engine);
    }
    const replicasOf = /* @__PURE__ */ new Map();
    for (const replica of replicas) {
      const name = replica.spec?.volumeName ?? "";
      if (!name) continue;
      const list = replicasOf.get(name);
      if (list) list.push(replica);
      else replicasOf.set(name, [replica]);
    }
    return volumes.map((volume) => {
      const engine = engineOf.get(volume.metadata.name);
      return {
        volume,
        ...engine ? { engine } : {},
        replicas: replicasOf.get(volume.metadata.name) ?? []
      };
    });
  }

  // node_modules/@k8sdockside/plugin-sdk/dom.js
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value === void 0 || value === false) continue;
      if (name === "class") node.className = String(value);
      else if (name === "text") node.textContent = String(value);
      else node.setAttribute(name, String(value));
    }
    append(node, children);
    return node;
  }
  function replace(parent, ...children) {
    parent.replaceChildren();
    append(parent, children);
  }
  function byId(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`the page has no #${id}`);
    return node;
  }
  function append(parent, children) {
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      parent.append(child);
    }
  }

  // src/ui/page.ts
  function fail(host, err) {
    const message = err instanceof Error ? err.message : String(err);
    replace(
      host,
      el("div", { class: "failure" }, el("strong", {}, "That did not work. "), el("span", {}, message))
    );
  }
  function start(hostId, body) {
    const run = async () => {
      const host = document.getElementById(hostId);
      try {
        const ctx = await k8sdockside.ready();
        await body(ctx);
      } catch (err) {
        if (host) fail(host, err);
      }
    };
    void run();
  }
  function since(timestamp, now = Date.now()) {
    if (!timestamp) return "—";
    const then = Date.parse(timestamp);
    if (Number.isNaN(then)) return "—";
    const seconds = Math.max(0, Math.round((now - then) / 1e3));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }
  function every(ms, body, onError) {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        await body();
      } catch (err) {
        onError(err);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), ms);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  // src/ui/parts.ts
  function progress(value, tone = "warn") {
    const bar = el("div", { class: "progress", role: "progressbar", "aria-valuenow": Math.round(value) });
    const fill = el("span", { class: `progress-fill fill-${tone || "none"}` });
    fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    bar.append(fill);
    return bar;
  }
  function pill(text, tone = "", title = "") {
    return el("span", { class: `pill pill-${tone || "none"}`, ...title ? { title } : {} }, text);
  }
  function facts(pairs) {
    const list = el("dl", { class: "facts" });
    for (const [term, value] of pairs) {
      list.append(el("dt", {}, term), el("dd", {}, typeof value === "string" ? value || "—" : value));
    }
    return list;
  }
  function nothing(message) {
    return el("p", { class: "empty" }, message);
  }

  // src/pages/volume.ts
  var REFRESH = 8e3;
  start("page", async () => {
    const host = byId("page");
    const failure = el("p", { class: "refresh-failure" });
    const stop = every(
      REFRESH,
      async () => {
        const volume = await k8sdockside.object();
        const name = volume.metadata.name;
        const [engines, replicas] = await Promise.all([
          k8sdockside.list({ kind: ENGINES }),
          k8sdockside.list({ kind: REPLICAS })
        ]);
        const view = compose(
          [volume],
          engines.filter((engine) => engine.spec?.volumeName === name),
          replicas.filter((replica) => replica.spec?.volumeName === name)
        )[0];
        const { word, tone } = health(volume);
        const { ready, wanted } = healthyReplicas(view);
        const rows = replicaViews(view);
        replace(
          host,
          failure,
          el(
            "div",
            { class: "panel-head" },
            el("span", { class: `dot dot-${tone || "none"}` }),
            el("strong", {}, `${ready} of ${wanted} replicas`),
            pill(word, tone),
            el("span", { class: "spacer" }),
            el("span", { class: "faint" }, view.engine?.status?.endpoint ?? "")
          ),
          rows.length === 0 ? nothing("This volume has no replicas. Longhorn could not place any, or they are being deleted.") : el(
            "table",
            {},
            el(
              "thead",
              {},
              el(
                "tr",
                {},
                el("th", {}, "Replica"),
                el("th", {}, "Node"),
                el("th", {}, "Disk"),
                el("th", {}, "Mode"),
                el("th", {}, "State"),
                el("th", {}, "")
              )
            ),
            el("tbody", {}, ...rows.map((replica) => replicaRow(replica, name)))
          ),
          view.engine ? facts([
            ["Engine", view.engine.metadata.name],
            ["State", view.engine.status?.currentState ?? "—"],
            ["Image", view.engine.status?.currentImage ?? "—"],
            ["On node", view.engine.spec?.nodeID ?? "—"]
          ]) : el("p", { class: "note faint" }, "No engine is running for this volume, which is normal while it is detached.")
        );
      },
      (err) => {
        failure.textContent = err instanceof Error ? err.message : String(err);
      }
    );
    addEventListener("pagehide", stop);
  });
  function replicaRow(replica, volume) {
    const row = el(
      "tr",
      { class: "clickable" },
      el("td", { class: "mono" }, shorten(replica.name, volume)),
      el("td", {}, replica.node || "—"),
      el("td", { class: "mono faint", title: replica.replica.spec?.diskPath ?? "" }, replica.disk || "—"),
      el("td", {}, pill(replica.mode, replica.tone)),
      el(
        "td",
        { class: "faint" },
        replica.failed ? `failed ${since(replica.replica.spec?.failedAt)} ago` : replica.replica.status?.currentState ?? "—"
      ),
      el(
        "td",
        {},
        replica.rebuild === void 0 ? el("span", { class: "faint" }, size(bytes(replica.replica.spec?.volumeSize))) : progress(replica.rebuild)
      )
    );
    row.addEventListener(
      "click",
      () => void k8sdockside.open({
        kind: REPLICAS,
        namespace: replica.replica.metadata.namespace ?? "",
        name: replica.name
      })
    );
    return row;
  }
  function shorten(replica, volume) {
    return replica.startsWith(`${volume}-`) ? replica.slice(volume.length + 1) : replica;
  }
})();
