// Built by scripts/build.mjs from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
  // src/model/longhorn.ts
  var VOLUMES = "crd:volumes.longhorn.io";
  var ENGINES = "crd:engines.longhorn.io";
  var REPLICAS = "crd:replicas.longhorn.io";
  function condition(list, type) {
    return (list ?? []).find((c) => (c.type ?? "").toLowerCase() === type.toLowerCase());
  }
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
  function percent(part, whole) {
    if (!(whole > 0)) return 0;
    return Math.max(0, Math.min(100, part / whole * 100));
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
    const rebuilds2 = view.engine?.status?.rebuildStatus ?? {};
    return view.replicas.map((replica) => {
      const name = replica.metadata.name;
      const failed = !!replica.spec?.failedAt;
      const mode = failed ? "ERR" : modes[name] ?? modeFromReplica(replica);
      const rebuild = rebuildPercent(rebuilds2[name]);
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
  function rebuilds(view) {
    const status = view.engine?.status?.rebuildStatus ?? {};
    return Object.entries(status).filter(([, rebuild]) => rebuild?.isRebuilding).map(([replica, rebuild]) => ({
      replica,
      percent: Math.max(0, Math.min(100, rebuild.progress ?? 0)),
      from: rebuild.fromReplica ?? ""
    })).sort((a, b) => a.percent - b.percent);
  }
  function healthyReplicas(view) {
    const views = replicaViews(view);
    return {
      ready: views.filter((r) => r.mode === "RW").length,
      wanted: view.volume.spec?.numberOfReplicas ?? views.length
    };
  }
  function attachment(volume) {
    const kube = volume.status?.kubernetesStatus;
    const workloads = (kube?.workloadsStatus ?? []).map((w) => w.workloadName ? `${w.workloadType ?? "Workload"}/${w.workloadName}` : w.podName ?? "").filter(Boolean);
    return {
      node: volume.status?.currentNodeID || volume.spec?.nodeID || "",
      workloads: [...new Set(workloads)],
      pvc: kube?.pvcName ? `${kube.namespace ?? "default"}/${kube.pvcName}` : ""
    };
  }
  function fullness(volume) {
    const size2 = bytes(volume.spec?.size);
    const used = bytes(volume.status?.actualSize);
    return { used, size: size2, fraction: size2 > 0 ? Math.min(1, used / size2) : 0 };
  }
  function schedulingProblem(volume) {
    const scheduled = condition(volume.status?.conditions, "Scheduled");
    if (!scheduled || scheduled.status === "True") return "";
    return scheduled.message || scheduled.reason || "Longhorn cannot place every replica";
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

  // src/ui/dom.ts
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value === void 0 || value === false) continue;
      if (name === "class") node.className = String(value);
      else if (name === "text") node.textContent = String(value);
      else node.setAttribute(name, String(value));
    }
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      node.append(child);
    }
    return node;
  }
  function button(label, onClick, attrs = {}) {
    const node = el("button", { type: "button", ...attrs }, label);
    node.addEventListener("click", onClick);
    return node;
  }
  function replace(parent, ...children) {
    parent.replaceChildren();
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      parent.append(child);
    }
  }
  function byId(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`the page has no #${id}`);
    return node;
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
  function stack(segments, whole, marker) {
    const bar = el("div", { class: "stack" });
    for (const segment of segments) {
      if (segment.bytes <= 0) continue;
      const width = percent(segment.bytes, whole);
      const piece = el("span", {
        class: `stack-part fill-${segment.tone || "none"}`,
        title: `${segment.label}: ${size(segment.bytes)}`
      });
      piece.style.width = `${width}%`;
      bar.append(piece);
    }
    if (marker && whole > 0 && marker.at > 0) {
      const pin = el("span", { class: "stack-marker", title: `${marker.label}: ${size(marker.at)}` });
      pin.style.left = `${percent(marker.at, whole)}%`;
      bar.append(pin);
    }
    return bar;
  }
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

  // src/pages/pvc.ts
  var REFRESH = 15e3;
  start("page", async () => {
    const host = byId("page");
    const failure = el("p", { class: "refresh-failure" });
    const stop = every(
      REFRESH,
      async () => {
        const claim = await k8sdockside.object();
        const pv = claim.spec?.volumeName ?? "";
        if (!pv) {
          replace(host, nothing(`${claim.metadata.name} is not bound to a volume yet.`));
          return;
        }
        const volumes = await k8sdockside.list({ kind: VOLUMES });
        const volume = volumes.find((candidate) => candidate.metadata.name === pv);
        if (!volume) {
          replace(host, nothing(`${pv} is not a Longhorn volume.`));
          return;
        }
        const [engines, replicas] = await Promise.all([
          k8sdockside.list({ kind: ENGINES }),
          k8sdockside.list({ kind: REPLICAS })
        ]);
        const view = compose(
          [volume],
          engines.filter((engine) => engine.spec?.volumeName === pv),
          replicas.filter((replica) => replica.spec?.volumeName === pv)
        )[0];
        const { word, tone } = health(volume);
        const where = attachment(volume);
        const { used, size: total } = fullness(volume);
        const { ready, wanted } = healthyReplicas(view);
        const problem = schedulingProblem(volume);
        replace(
          host,
          failure,
          el(
            "div",
            { class: "panel-head" },
            el("span", { class: `dot dot-${tone || "none"}` }),
            el("strong", {}, volume.metadata.name),
            pill(word, tone),
            el("span", { class: "spacer" }),
            button(
              "Open volume",
              () => void k8sdockside.open({
                kind: VOLUMES,
                namespace: volume.metadata.namespace ?? "",
                name: volume.metadata.name
              })
            ),
            button("Volume map", () => void k8sdockside.openView("volume-map"))
          ),
          problem ? el("p", { class: "card-problem" }, problem) : null,
          stack([{ label: "Written", bytes: used, tone: "info" }], total || 1),
          facts([
            ["Written", `${size(used)} of ${size(total)}`],
            ["Replicas", `${ready} of ${wanted} being read and written`],
            ["Attached to", where.node || "nothing"],
            ["Used by", where.workloads.join(", ") || "—"],
            ["Data locality", volume.spec?.dataLocality ?? "—"],
            ["Access mode", volume.spec?.accessMode ?? "—"]
          ]),
          el(
            "div",
            { class: "card-replicas" },
            ...replicaViews(view).map(
              (replica) => pill(replica.mode, replica.tone, `${replica.name}
on ${replica.node || "no node"}`)
            )
          ),
          ...rebuilds(view).map(
            (rebuild) => el(
              "div",
              { class: "card-rebuild" },
              el("span", { class: "card-label" }, "rebuilding"),
              progress(rebuild.percent),
              el("span", { class: "card-percent" }, `${rebuild.percent.toFixed(0)}%`)
            )
          )
        );
      },
      (err) => {
        failure.textContent = err instanceof Error ? err.message : String(err);
      }
    );
    addEventListener("pagehide", stop);
  });
})();
