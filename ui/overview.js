// Built by scripts/build.mjs from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
  // src/model/longhorn.ts
  var VOLUMES = "crd:volumes.longhorn.io";
  var ENGINES = "crd:engines.longhorn.io";
  var REPLICAS = "crd:replicas.longhorn.io";
  var NODES = "crd:nodes.longhorn.io";
  var BACKUP_TARGETS = "crd:backuptargets.longhorn.io";
  function condition(list, type) {
    return (list ?? []).find((c) => (c.type ?? "").toLowerCase() === type.toLowerCase());
  }
  function conditionTrue(list, type) {
    return (condition(list, type)?.status ?? "") === "True";
  }

  // src/model/capacity.ts
  function disks(node) {
    const specs = node.spec?.disks ?? {};
    const statuses = node.status?.diskStatus ?? {};
    const names = [.../* @__PURE__ */ new Set([...Object.keys(specs), ...Object.keys(statuses)])].sort();
    return names.map((name) => diskView(name, specs[name] ?? {}, statuses[name] ?? {}));
  }
  function diskView(name, spec, status) {
    const maximum = status.storageMaximum ?? 0;
    const available = status.storageAvailable ?? 0;
    const scheduled = status.storageScheduled ?? 0;
    const reserved = spec.storageReserved ?? 0;
    const used = Math.max(0, maximum - available);
    const ready = conditionTrue(status.conditions, "Ready");
    const canSchedule = conditionTrue(status.conditions, "Schedulable");
    const allowScheduling = spec.allowScheduling !== false;
    const evicting = spec.evictionRequested === true;
    return {
      name,
      path: spec.path ?? "",
      spec,
      status,
      maximum,
      available,
      used,
      scheduled,
      reserved,
      schedulable: Math.max(0, maximum - reserved - scheduled),
      replicas: Object.keys(status.scheduledReplica ?? {}).length,
      ready,
      canSchedule,
      allowScheduling,
      evicting,
      tone: diskTone(ready, canSchedule, allowScheduling, evicting),
      problem: diskProblem(status, ready, canSchedule, allowScheduling, evicting)
    };
  }
  function diskTone(ready, canSchedule, allow, evicting) {
    if (!ready) return "error";
    if (evicting) return "warn";
    if (!allow) return "";
    return canSchedule ? "ok" : "warn";
  }
  function diskProblem(status, ready, canSchedule, allow, evicting) {
    if (!ready) {
      const cond = (status.conditions ?? []).find((c) => c.type === "Ready");
      return cond?.message || cond?.reason || "the disk is not ready";
    }
    if (evicting) return "replicas are being moved off this disk";
    if (!allow) return "scheduling is switched off for this disk";
    if (!canSchedule) {
      const cond = (status.conditions ?? []).find((c) => c.type === "Schedulable");
      return cond?.message || cond?.reason || "the disk has no room for another replica";
    }
    return "";
  }
  var NO_CAPACITY = {
    maximum: 0,
    used: 0,
    scheduled: 0,
    reserved: 0,
    available: 0,
    schedulable: 0
  };
  function add(a, b) {
    return {
      maximum: a.maximum + b.maximum,
      used: a.used + b.used,
      scheduled: a.scheduled + b.scheduled,
      reserved: a.reserved + b.reserved,
      available: a.available + b.available,
      schedulable: a.schedulable + b.schedulable
    };
  }
  function capacityOf(list) {
    return list.reduce(
      (total, disk) => add(total, {
        maximum: disk.maximum,
        used: disk.used,
        scheduled: disk.scheduled,
        reserved: disk.reserved,
        available: disk.available,
        schedulable: disk.schedulable
      }),
      NO_CAPACITY
    );
  }
  function nodeView(node) {
    const list = disks(node);
    const ready = conditionTrue(node.status?.conditions, "Ready");
    const schedulable = conditionTrue(node.status?.conditions, "Schedulable");
    const allowScheduling = node.spec?.allowScheduling !== false;
    const evicting = node.spec?.evictionRequested === true || node.status?.autoEvicting === true;
    return {
      node,
      name: node.metadata.name,
      disks: list,
      ready,
      schedulable,
      allowScheduling,
      evicting,
      zone: node.status?.zone ?? "",
      tone: nodeTone(ready, schedulable, allowScheduling, evicting),
      word: nodeWord(ready, schedulable, allowScheduling, evicting),
      problem: nodeProblem(node, ready),
      total: capacityOf(list),
      replicas: list.reduce((n, disk) => n + disk.replicas, 0)
    };
  }
  function nodeTone(ready, schedulable, allow, evicting) {
    if (!ready) return "error";
    if (evicting) return "warn";
    if (!allow) return "";
    return schedulable ? "ok" : "warn";
  }
  function nodeWord(ready, schedulable, allow, evicting) {
    if (!ready) return "down";
    if (evicting) return "evicting";
    if (!allow) return "disabled";
    return schedulable ? "schedulable" : "unschedulable";
  }
  function nodeProblem(node, ready) {
    if (!ready) {
      const cond = (node.status?.conditions ?? []).find((c) => c.type === "Ready");
      return cond?.message || cond?.reason || "the Longhorn manager on this node is not reporting";
    }
    const mount = (node.status?.conditions ?? []).find((c) => c.type === "MountPropagation");
    if (mount && mount.status === "False") return mount.message || "mount propagation is not available on this node";
    return "";
  }
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
  function bucketTone(bucket) {
    switch (bucket) {
      case "faulted":
        return "error";
      case "degraded":
        return "warn";
      case "in progress":
        return "info";
      case "healthy":
        return "ok";
      default:
        return "";
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
    const progress = status.progress ?? 0;
    return Math.max(0, Math.min(100, progress));
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

  // src/model/attention.ts
  var NEARLY_FULL = 85;
  function issues(volumes, nodes, targets) {
    const out = [];
    for (const view of volumes) {
      const volume = view.volume;
      const ref = { kind: "crd:volumes.longhorn.io", namespace: volume.metadata.namespace ?? "", name: volume.metadata.name };
      const { word } = health(volume);
      const { ready, wanted } = healthyReplicas(view);
      if (word === "faulted") {
        out.push({
          ref,
          title: volume.metadata.name,
          detail: "faulted — no replica can be read; the volume is not serving data",
          tone: "error",
          rank: 0
        });
        continue;
      }
      if (word === "degraded") {
        const running = rebuilds(view);
        const first = running[0];
        out.push({
          ref,
          title: volume.metadata.name,
          detail: first ? `degraded — rebuilding a replica, ${first.percent.toFixed(0)}% done` : `degraded — ${ready} of ${wanted} replicas are being read and written`,
          tone: "warn",
          rank: 2
        });
        continue;
      }
      const problem = schedulingProblem(volume);
      if (problem) {
        out.push({ ref, title: volume.metadata.name, detail: `cannot be scheduled — ${problem}`, tone: "warn", rank: 3 });
      }
    }
    for (const node of nodes) {
      const ref = { kind: "crd:nodes.longhorn.io", namespace: node.node.metadata.namespace ?? "", name: node.name };
      if (!node.ready) {
        out.push({ ref, title: node.name, detail: `down — ${node.problem}`, tone: "error", rank: 1 });
        continue;
      }
      for (const disk of node.disks) {
        if (!disk.ready) {
          out.push({
            ref,
            title: `${node.name} · ${disk.name}`,
            detail: disk.problem,
            tone: "error",
            rank: 1
          });
          continue;
        }
        const full = percent(disk.used, disk.maximum);
        if (disk.maximum > 0 && full >= NEARLY_FULL) {
          out.push({
            ref,
            title: `${node.name} · ${disk.name}`,
            detail: `${full.toFixed(0)}% full — ${disk.path || "the disk"} has little room left`,
            tone: full >= 95 ? "error" : "warn",
            rank: full >= 95 ? 1 : 4
          });
        } else if (!disk.canSchedule && disk.allowScheduling) {
          out.push({
            ref,
            title: `${node.name} · ${disk.name}`,
            detail: disk.problem,
            tone: "warn",
            rank: 4
          });
        }
      }
      if (node.evicting) {
        out.push({ ref, title: node.name, detail: "replicas are being moved off this node", tone: "warn", rank: 5 });
      }
    }
    for (const target of targets) {
      if (!target.spec?.backupTargetURL) continue;
      if (target.status?.available === false) {
        const cond = condition(target.status?.conditions, "Unavailable");
        out.push({
          ref: {
            kind: "crd:backuptargets.longhorn.io",
            namespace: target.metadata.namespace ?? "",
            name: target.metadata.name
          },
          title: `backup target ${target.metadata.name}`,
          detail: cond?.message || "Longhorn cannot reach the backup target, so nothing is being backed up",
          tone: "warn",
          rank: 3
        });
      }
    }
    return out.sort((a, b) => a.rank - b.rank);
  }

  // src/model/filter.ts
  function counts(views) {
    const tally = new Map(HEALTH_BUCKETS.map((b) => [b, 0]));
    for (const view of views) {
      const bucket = bucketOf(view.volume);
      tally.set(bucket, (tally.get(bucket) ?? 0) + 1);
    }
    return HEALTH_BUCKETS.map((bucket) => ({ bucket, count: tally.get(bucket) ?? 0 }));
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
  async function maybeList(query) {
    try {
      return await k8sdockside.list(query);
    } catch {
      return [];
    }
  }

  // src/ui/parts.ts
  function svgEl(tag, attrs = {}, ...children) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    for (const child of children) node.append(child);
    return node;
  }
  function ring(title, slices, options = {}) {
    const total = slices.reduce((n, s) => n + s.count, 0);
    const R = 54;
    const C = 2 * Math.PI * R;
    const drawing = svgEl("svg", { viewBox: "0 0 140 140", class: "ring-svg", "aria-hidden": "true" });
    drawing.append(svgEl("circle", { cx: 70, cy: 70, r: R, class: "ring-track", fill: "none", "stroke-width": 16 }));
    let offset = 0;
    for (const slice of slices) {
      if (slice.count <= 0) continue;
      const fraction = total > 0 ? slice.count / total : 0;
      drawing.append(
        svgEl("circle", {
          cx: 70,
          cy: 70,
          r: R,
          fill: "none",
          "stroke-width": 16,
          "stroke-linecap": "butt",
          class: `ring-arc arc-${slice.tone || "none"}`,
          "stroke-dasharray": `${(fraction * C).toFixed(2)} ${C.toFixed(2)}`,
          "stroke-dashoffset": `${(-offset * C).toFixed(2)}`,
          transform: "rotate(-90 70 70)"
        })
      );
      offset += fraction;
    }
    const legend = el("ul", { class: "legend" });
    for (const slice of slices) {
      const row = el(
        "li",
        // `zero`, not `empty`: the page's own .empty is the big "nothing
        // here" paragraph, and sharing the name pads every row of the legend.
        { class: slice.count === 0 ? "legend-row zero" : "legend-row" },
        el("span", { class: `dot dot-${slice.tone || "none"}` }),
        el("span", { class: "legend-label" }, slice.label),
        el("span", { class: "legend-count" }, String(slice.count))
      );
      if (options.onPick && slice.count > 0) {
        row.classList.add("pick");
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        const pick = () => options.onPick?.(slice.label);
        row.addEventListener("click", pick);
        row.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            pick();
          }
        });
      }
      legend.append(row);
    }
    return el(
      "section",
      { class: "ring-card" },
      el("h2", {}, title),
      el(
        "div",
        { class: "ring-body" },
        el(
          "div",
          { class: "ring-holder" },
          drawing,
          el(
            "div",
            { class: "ring-centre" },
            el("span", { class: "ring-total" }, String(total)),
            el("span", { class: "ring-unit" }, options.unit ?? "")
          )
        ),
        legend
      )
    );
  }
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
  function stackLegend(segments, extra = []) {
    const list = el("ul", { class: "stack-legend" });
    for (const segment of [...segments, ...extra]) {
      list.append(
        el(
          "li",
          {},
          el("span", { class: `dot dot-${segment.tone || "none"}` }),
          el("span", { class: "stack-name" }, segment.label),
          el("span", { class: "stack-size" }, size(segment.bytes))
        )
      );
    }
    return list;
  }
  function stat(label, value, note = "", tone = "") {
    return el(
      "div",
      { class: "stat" },
      el("div", { class: `stat-value tone-${tone || "none"}` }, value),
      el("div", { class: "stat-label" }, label),
      note ? el("div", { class: "stat-note" }, note) : null
    );
  }
  function block(title, note, ...children) {
    return el(
      "section",
      { class: "block" },
      el("h2", {}, title),
      note ? el("p", { class: "note" }, note) : null,
      ...children.filter((c) => c !== null)
    );
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

  // src/pages/overview.ts
  var REFRESH = 1e4;
  start("page", async (ctx) => {
    replace(
      byId("head"),
      heading("Longhorn", `Distributed block storage in ${ctx.contextName}.`)
    );
    const summary = await k8sdockside.summary();
    const missing = summary.requirements.filter((req) => !req.optional && !req.served);
    if (summary.checked && missing.length > 0) {
      document.getElementById("first")?.remove();
      replace(
        byId("body"),
        block(
          "Longhorn is not installed here",
          `${ctx.contextName} does not serve ${missing.map((m) => m.label || m.kind).join(", ")}. The plugin stays out of the way until it does.`,
          el(
            "p",
            { class: "links" },
            button("How to install Longhorn", () => void k8sdockside.openUrl("https://longhorn.io/docs/latest/deploy/install/"))
          )
        )
      );
      return;
    }
    const body = byId("body");
    const failure = el("p", { class: "refresh-failure" });
    const stop = every(
      REFRESH,
      async () => {
        const [volumes, engines, replicas, nodes, targets] = await Promise.all([
          k8sdockside.list({ kind: VOLUMES }),
          k8sdockside.list({ kind: ENGINES }),
          k8sdockside.list({ kind: REPLICAS }),
          k8sdockside.list({ kind: NODES }),
          maybeList({ kind: BACKUP_TARGETS })
        ]);
        failure.textContent = "";
        document.getElementById("first")?.remove();
        draw(body, compose(volumes, engines, replicas), nodes.map(nodeView), targets, failure);
      },
      (err) => {
        failure.textContent = err instanceof Error ? err.message : String(err);
      }
    );
    addEventListener("pagehide", stop);
  });
  function draw(host, volumes, nodes, targets, failure) {
    const disks2 = nodes.flatMap((node) => node.disks);
    const storage = capacityOf(disks2);
    const attached = volumes.filter((v) => (v.volume.status?.state ?? "") === "attached").length;
    const rebuilding = volumes.reduce((n, v) => n + rebuilds(v).length, 0);
    const problems = issues(volumes, nodes, targets);
    replace(
      host,
      failure,
      el(
        "div",
        { class: "stats" },
        stat("Volumes", String(volumes.length), `${attached} attached`),
        stat(
          "Storage used",
          size(storage.used),
          storage.maximum > 0 ? `${percent(storage.used, storage.maximum).toFixed(0)}% of ${size(storage.maximum)}` : "no disks yet",
          storage.maximum > 0 && percent(storage.used, storage.maximum) >= 85 ? "warn" : ""
        ),
        stat("Nodes", String(nodes.length), `${nodes.filter((n) => n.ready).length} ready`, nodes.some((n) => !n.ready) ? "error" : ""),
        stat("Replicas", String(nodes.reduce((n, node) => n + node.replicas, 0)), `on ${disks2.length} disk${disks2.length === 1 ? "" : "s"}`),
        stat("Rebuilding", String(rebuilding), rebuilding ? "copying data now" : "nothing is rebuilding", rebuilding ? "warn" : "")
      ),
      el(
        "div",
        { class: "rings" },
        ring("Volumes", volumeSlices(volumes), { onPick: (label) => void openVolumeMap(label), unit: "volumes" }),
        ring("Nodes", nodeSlices(nodes), { onPick: () => void k8sdockside.openView("node-map"), unit: "nodes" }),
        ring("Disks", diskSlices(disks2), { onPick: () => void k8sdockside.openView("node-map"), unit: "disks" })
      ),
      storageBlock(storage.maximum, storage),
      attentionBlock(problems)
    );
  }
  function volumeSlices(volumes) {
    return counts(volumes).map(({ bucket, count }) => ({ label: bucket, count, tone: bucketTone(bucket) }));
  }
  function nodeSlices(nodes) {
    const tally = (word) => nodes.filter((node) => node.word === word).length;
    return [
      { label: "down", count: tally("down"), tone: "error" },
      { label: "evicting", count: tally("evicting"), tone: "warn" },
      { label: "unschedulable", count: tally("unschedulable"), tone: "warn" },
      { label: "disabled", count: tally("disabled"), tone: "" },
      { label: "schedulable", count: tally("schedulable"), tone: "ok" }
    ];
  }
  function diskSlices(disks2) {
    const tally = (test) => disks2.filter(test).length;
    return [
      { label: "not ready", count: tally((d) => !d.ready), tone: "error" },
      { label: "no room", count: tally((d) => d.ready && d.allowScheduling && !d.canSchedule), tone: "warn" },
      { label: "disabled", count: tally((d) => d.ready && !d.allowScheduling), tone: "" },
      { label: "schedulable", count: tally((d) => d.ready && d.allowScheduling && d.canSchedule), tone: "ok" }
    ];
  }
  function storageBlock(total, storage) {
    if (total <= 0) {
      return block("Storage", "No disk has reported its size yet.", nothing("Nothing to measure."));
    }
    const free = Math.max(0, total - storage.used - storage.reserved);
    const segments = [
      { label: "Used", bytes: storage.used, tone: "info" },
      { label: "Reserved", bytes: storage.reserved, tone: "" },
      { label: "Free", bytes: free, tone: "ok" }
    ];
    return block(
      "Storage",
      `${size(storage.used)} written of ${size(total)} across every disk Longhorn knows about. Longhorn has promised ${size(storage.scheduled)} to replicas, whether or not they have written it yet.`,
      stack(segments, total, { at: storage.reserved + storage.scheduled, label: "Scheduled" }),
      stackLegend(segments, [{ label: "Scheduled", bytes: storage.scheduled, tone: "warn" }])
    );
  }
  function attentionBlock(problems) {
    if (problems.length === 0) {
      return block("Needs attention", "", nothing("Nothing is degraded, faulted, evicting or out of room."));
    }
    const list = el("ul", { class: "issues" });
    for (const issue of problems.slice(0, 20)) {
      const row = el(
        "li",
        { class: "issue" },
        el("span", { class: `dot dot-${issue.tone || "none"}` }),
        el("span", { class: "issue-title" }, issue.title),
        el("span", { class: "issue-detail" }, issue.detail)
      );
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      const open = () => void k8sdockside.open(issue.ref);
      row.addEventListener("click", open);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
      list.append(row);
    }
    return block(
      "Needs attention",
      problems.length > 20 ? `The worst 20 of ${problems.length}. Each row opens the object.` : "Each row opens the object.",
      list
    );
  }
  async function openVolumeMap(bucket) {
    await k8sdockside.storage?.set("map-bucket", bucket);
    await k8sdockside.openView("volume-map");
  }
})();
