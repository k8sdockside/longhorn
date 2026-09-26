// Built by k8sdockside-plugin from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
  // src/model/longhorn.ts
  var NODES = "crd:nodes.longhorn.io";
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
  function button(label, onClick, attrs = {}) {
    const node = el("button", { type: "button", ...attrs }, label);
    node.addEventListener("click", onClick);
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

  // src/pages/node.ts
  var REFRESH = 15e3;
  start("page", async () => {
    const host = byId("page");
    const failure = el("p", { class: "refresh-failure" });
    const stop = every(
      REFRESH,
      async () => {
        const kubeNode = await k8sdockside.object();
        const nodes = await k8sdockside.list({ kind: NODES });
        const found = nodes.find((node) => node.metadata.name === kubeNode.metadata.name);
        if (!found) {
          replace(host, nothing(`Longhorn does not manage storage on ${kubeNode.metadata.name}.`));
          return;
        }
        const view = nodeView(found);
        const total = view.total;
        const free = Math.max(0, total.maximum - total.used - total.reserved);
        replace(
          host,
          failure,
          el(
            "div",
            { class: "panel-head" },
            el("span", { class: `dot dot-${view.tone || "none"}` }),
            el("strong", {}, view.name),
            pill(view.word, view.tone),
            view.zone ? pill(view.zone, "") : null,
            el("span", { class: "spacer" }),
            button(
              "Longhorn node",
              () => void k8sdockside.open({
                kind: NODES,
                namespace: found.metadata.namespace ?? "",
                name: view.name
              })
            ),
            button("Nodes & disks", () => void k8sdockside.openView("node-map"))
          ),
          view.problem ? el("p", { class: "card-problem" }, view.problem) : null,
          total.maximum > 0 ? stack(
            [
              { label: "Used", bytes: total.used, tone: "info" },
              { label: "Reserved", bytes: total.reserved, tone: "" },
              { label: "Free", bytes: free, tone: "ok" }
            ],
            total.maximum,
            { at: total.reserved + total.scheduled, label: "Scheduled" }
          ) : null,
          facts([
            ["Storage", total.maximum > 0 ? `${size(total.used)} used of ${size(total.maximum)}` : "no disk has reported"],
            ["Promised", size(total.scheduled)],
            ["Replicas", `${view.replicas} on ${view.disks.length} disk${view.disks.length === 1 ? "" : "s"}`],
            ["Scheduling", view.allowScheduling ? "allowed" : "switched off"]
          ]),
          ...view.disks.map(diskLine)
        );
      },
      (err) => {
        failure.textContent = err instanceof Error ? err.message : String(err);
      }
    );
    addEventListener("pagehide", stop);
  });
  function diskLine(disk) {
    return el(
      "div",
      { class: "disk disk-compact" },
      el(
        "div",
        { class: "disk-head" },
        el("span", { class: `dot dot-${disk.tone || "none"}` }),
        el("span", { class: "disk-name" }, disk.name),
        el("span", { class: "disk-path mono" }, disk.path || "—"),
        el("span", { class: "spacer" }),
        el(
          "span",
          { class: "faint" },
          disk.maximum > 0 ? `${percent(disk.used, disk.maximum).toFixed(0)}% full · ${disk.replicas} replica${disk.replicas === 1 ? "" : "s"}` : `${disk.replicas} replica${disk.replicas === 1 ? "" : "s"}`
        )
      ),
      disk.maximum > 0 ? stack(
        [
          { label: "Used", bytes: disk.used, tone: "info" },
          { label: "Reserved", bytes: disk.reserved, tone: "" },
          { label: "Free", bytes: Math.max(0, disk.maximum - disk.used - disk.reserved), tone: "ok" }
        ],
        disk.maximum,
        { at: disk.reserved + disk.scheduled, label: "Scheduled" }
      ) : null,
      disk.problem ? el("p", { class: "card-problem" }, disk.problem) : null
    );
  }
})();
