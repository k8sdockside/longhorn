// Built by k8sdockside-plugin from src/ -- edit the TypeScript there, not this file.
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
  var HEALTH_BUCKETS = ["faulted", "degraded", "in progress", "healthy", "detached"];
  function bucketOf(volume) {
    const { word } = health(volume);
    if (word === "faulted") return "faulted";
    if (word === "degraded") return "degraded";
    if (word === "healthy") return "healthy";
    if (word === "detached") return "detached";
    return "in progress";
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

  // src/model/filter.ts
  var SORTS = [
    { id: "health", label: "Worst first" },
    { id: "name", label: "Name" },
    { id: "size", label: "Largest first" },
    { id: "used", label: "Most written" }
  ];
  var ALL = { text: "", bucket: "", namespace: "", sort: "health" };
  function haystack(view) {
    const volume = view.volume;
    const where = attachment(volume);
    const kube = volume.status?.kubernetesStatus;
    return [
      volume.metadata.name,
      kube?.pvcName ?? "",
      kube?.namespace ?? "",
      kube?.pvName ?? "",
      where.node,
      ...where.workloads,
      ...view.replicas.map((r) => r.spec?.nodeID ?? ""),
      volume.spec?.dataEngine ?? "",
      ...Object.keys(volume.metadata.labels ?? {})
    ].join(" ").toLowerCase();
  }
  function namespaces(views) {
    const found = /* @__PURE__ */ new Set();
    for (const view of views) {
      const ns = view.volume.status?.kubernetesStatus?.namespace;
      if (ns) found.add(ns);
    }
    return [...found].sort();
  }
  function rank(view) {
    return HEALTH_BUCKETS.indexOf(bucketOf(view.volume));
  }
  function apply(views, query2) {
    const words = query2.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out = views.filter((view) => {
      if (query2.bucket && bucketOf(view.volume) !== query2.bucket) return false;
      if (query2.namespace && (view.volume.status?.kubernetesStatus?.namespace ?? "") !== query2.namespace) return false;
      if (words.length === 0) return true;
      const hay = haystack(view);
      return words.every((word) => hay.includes(word));
    });
    const byName = (a, b) => a.volume.metadata.name.localeCompare(b.volume.metadata.name);
    switch (query2.sort) {
      case "name":
        return out.sort(byName);
      case "size":
        return out.sort((a, b) => bytes(b.volume.spec?.size) - bytes(a.volume.spec?.size) || byName(a, b));
      case "used":
        return out.sort(
          (a, b) => bytes(b.volume.status?.actualSize) - bytes(a.volume.status?.actualSize) || byName(a, b)
        );
      default:
        return out.sort((a, b) => rank(a) - rank(b) || byName(a, b));
    }
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
  function focused() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    return { namespace: params.get("namespace") ?? "", name: params.get("name") ?? "" };
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
  function nothing(message) {
    return el("p", { class: "empty" }, message);
  }
  function heading(title, note) {
    return el(
      "header",
      { class: "page-head" },
      el("img", { class: "mark", src: "logo.svg", alt: "", width: 26, height: 26 }),
      el("div", {}, el("h1", {}, title), note ? el("p", { class: "note" }, note) : null)
    );
  }

  // src/pages/volumes.ts
  var REFRESH = 8e3;
  var query = { ...ALL };
  var latest = [];
  var single = "";
  start("page", async (ctx) => {
    replace(byId("head"), heading("Volume map", `Every Longhorn volume in ${ctx.contextName}, worst first.`));
    single = focused().name;
    if (single) query = { ...query, text: single };
    else query = { ...query, ...await remembered() };
    const failure = el("p", { class: "refresh-failure" });
    const grid = byId("grid");
    const stop = every(
      REFRESH,
      async () => {
        const [volumes, engines, replicas] = await Promise.all([
          k8sdockside.list({ kind: VOLUMES }),
          k8sdockside.list({ kind: ENGINES }),
          k8sdockside.list({ kind: REPLICAS })
        ]);
        failure.textContent = "";
        document.getElementById("first")?.remove();
        latest = compose(volumes, engines, replicas);
        if (!document.getElementById("shown")) drawToolbar(failure, ctx);
        drawGrid(grid);
        updateCount();
      },
      (err) => {
        failure.textContent = err instanceof Error ? err.message : String(err);
      }
    );
    addEventListener("pagehide", stop);
  });
  async function remembered() {
    const store = k8sdockside.storage;
    if (!store) return {};
    try {
      const picked = await store.get("map-bucket");
      if (picked) {
        await store.remove("map-bucket");
        if (HEALTH_BUCKETS.includes(picked)) return { bucket: picked };
      }
      const sort = await store.get("map-sort");
      return sort ? { sort } : {};
    } catch {
      return {};
    }
  }
  function remember() {
    void k8sdockside.storage?.set("map-sort", query.sort).catch(() => {
    });
  }
  function drawToolbar(failure, ctx) {
    const shown = apply(latest, query).length;
    const search = el("input", {
      type: "search",
      placeholder: "volume, PVC, workload, node…",
      "aria-label": "Search volumes",
      value: query.text
    });
    search.addEventListener("input", () => {
      query = { ...query, text: search.value };
      redraw();
    });
    const bucket = select(
      "Health",
      [{ value: "", label: "Any health" }, ...HEALTH_BUCKETS.map((b) => ({ value: b, label: b }))],
      query.bucket,
      (value) => {
        query = { ...query, bucket: value };
        redraw();
      }
    );
    const namespace = select(
      "Namespace",
      [{ value: "", label: "Any namespace" }, ...namespaces(latest).map((ns) => ({ value: ns, label: ns }))],
      query.namespace,
      (value) => {
        query = { ...query, namespace: value };
        redraw();
      }
    );
    const sort = select(
      "Order",
      SORTS.map((s) => ({ value: s.id, label: s.label })),
      query.sort,
      (value) => {
        query = { ...query, sort: value };
        remember();
        redraw();
      }
    );
    replace(
      byId("toolbar"),
      el(
        "div",
        { class: "bar" },
        search,
        bucket,
        namespace,
        sort,
        el("span", { class: "spacer" }),
        el("span", { class: "count", id: "shown" }, countText(shown))
      ),
      failure,
      ctx.write ? null : el("p", { class: "note faint" }, "This plugin may not change anything in this cluster.")
    );
  }
  function redraw() {
    drawGrid(byId("grid"));
    updateCount();
  }
  function updateCount() {
    const shown = document.getElementById("shown");
    if (shown) shown.textContent = countText(apply(latest, query).length);
  }
  function countText(shown) {
    return shown === latest.length ? `${shown} volumes` : `${shown} of ${latest.length} volumes`;
  }
  function select(label, options, chosen, onPick) {
    const node = el("select", { "aria-label": label });
    for (const option of options) {
      const item = el("option", { value: option.value }, option.label);
      if (option.value === chosen) item.selected = true;
      node.append(item);
    }
    node.addEventListener("change", () => onPick(node.value));
    return node;
  }
  function drawGrid(host) {
    const shown = apply(latest, query);
    if (shown.length === 0) {
      replace(
        host,
        nothing(
          latest.length === 0 ? "Longhorn has no volumes in this cluster yet." : "No volume matches what you are looking for."
        )
      );
      return;
    }
    replace(host, ...shown.map(card));
  }
  function card(view) {
    const volume = view.volume;
    const { word, tone } = health(volume);
    const where = attachment(volume);
    const { used, size: total } = fullness(volume);
    const { ready, wanted } = healthyReplicas(view);
    const replicas = replicaViews(view);
    const problem = schedulingProblem(volume);
    const open = () => void k8sdockside.open({
      kind: VOLUMES,
      namespace: volume.metadata.namespace ?? "",
      name: volume.metadata.name
    });
    const name = el("button", { class: "card-name", title: volume.metadata.name }, volume.metadata.name);
    name.addEventListener("click", open);
    return el(
      "article",
      { class: `card tone-edge-${tone || "none"}` },
      el("header", { class: "card-head" }, el("span", { class: `dot dot-${tone || "none"}` }), name, pill(word, tone)),
      el(
        "p",
        { class: "card-for" },
        where.pvc ? el("span", { class: "card-pvc", title: "the claim this volume answers" }, where.pvc) : el("span", { class: "faint" }, "no claim"),
        where.workloads.length ? el("span", { class: "card-workload" }, where.workloads.join(", ")) : null
      ),
      el(
        "div",
        { class: "card-size" },
        stack([{ label: "Written", bytes: used, tone: "info" }], total || 1),
        el(
          "p",
          { class: "card-numbers" },
          el("span", {}, `${size(used)} of ${size(total)}`),
          el("span", { class: "faint" }, total > 0 ? `${percent(used, total).toFixed(0)}%` : "")
        )
      ),
      el(
        "div",
        { class: "card-replicas" },
        el("span", { class: "card-label" }, `${ready}/${wanted} replicas`),
        ...replicas.map(replicaPill)
      ),
      ...rebuildBars(view),
      problem ? el("p", { class: "card-problem" }, problem) : null,
      el(
        "p",
        { class: "card-foot" },
        el("span", { class: "faint" }, where.node ? `on ${where.node}` : "not attached"),
        el("span", { class: "faint" }, `${since(volume.metadata.creationTimestamp)} old`),
        bytes(volume.spec?.size) > 0 && volume.spec?.dataEngine ? el("span", { class: "faint" }, volume.spec.dataEngine) : null
      )
    );
  }
  function replicaPill(replica) {
    const node = replica.node || "no node";
    const detail = replica.rebuild === void 0 ? "" : ` · rebuilding ${replica.rebuild.toFixed(0)}%`;
    return pill(replica.mode, replica.tone, `${replica.name}
on ${node}${replica.disk ? `, disk ${replica.disk}` : ""}${detail}`);
  }
  function rebuildBars(view) {
    return replicaViews(view).filter((replica) => replica.rebuild !== void 0).map(
      (replica) => el(
        "div",
        { class: "card-rebuild" },
        el("span", { class: "card-label" }, `rebuilding on ${replica.node || "a node"}`),
        progress(replica.rebuild ?? 0),
        el("span", { class: "card-percent" }, `${(replica.rebuild ?? 0).toFixed(0)}%`)
      )
    );
  }
})();
