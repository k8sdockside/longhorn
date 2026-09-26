// Built by k8sdockside-plugin from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
  // src/model/longhorn.ts
  var VOLUMES = "crd:volumes.longhorn.io";
  var BACKUP_TARGETS = "crd:backuptargets.longhorn.io";
  var BACKUP_VOLUMES = "crd:backupvolumes.longhorn.io";
  var BACKUPS = "crd:backups.longhorn.io";
  var RECURRING_JOBS = "crd:recurringjobs.longhorn.io";
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

  // src/model/protect.ts
  var DAY = 24 * 60 * 60 * 1e3;
  var RECENT = DAY;
  var STALE = 7 * DAY;
  function freshness(lastBackupAt, now = Date.now()) {
    if (!lastBackupAt) return "never";
    const then = Date.parse(lastBackupAt);
    if (Number.isNaN(then)) return "never";
    const age = Math.max(0, now - then);
    if (age <= RECENT) return "recent";
    if (age <= STALE) return "stale";
    return "old";
  }
  function freshnessTone(value) {
    switch (value) {
      case "recent":
        return "ok";
      case "stale":
        return "warn";
      case "old":
        return "error";
      default:
        return "";
    }
  }
  function volumeOf(backup) {
    return backup.status?.volumeName || backup.spec?.volumeName || backup.metadata.name;
  }
  function protection(volumes, backups, now = Date.now()) {
    const byVolume = /* @__PURE__ */ new Map();
    for (const backup of backups) {
      const name = volumeOf(backup);
      const current = byVolume.get(name);
      if (!current || (backup.status?.lastBackupAt ?? "") > (current.status?.lastBackupAt ?? "")) {
        byVolume.set(name, backup);
      }
    }
    const out = volumes.map((volume) => {
      const backup = byVolume.get(volume.metadata.name);
      const lastBackupAt = backup?.status?.lastBackupAt ?? "";
      return {
        volume: volume.metadata.name,
        backupVolume: backup?.metadata.name ?? "",
        namespace: backup?.metadata.namespace ?? volume.metadata.namespace ?? "",
        lastBackupName: backup?.status?.lastBackupName ?? "",
        lastBackupAt,
        freshness: freshness(lastBackupAt || void 0, now),
        stored: bytes(backup?.status?.dataStored),
        size: bytes(backup?.status?.size ?? volume.spec?.size)
      };
    });
    const order = ["never", "old", "stale", "recent"];
    return out.sort(
      (a, b) => order.indexOf(a.freshness) - order.indexOf(b.freshness) || a.volume.localeCompare(b.volume)
    );
  }
  function protectionCounts(list) {
    const order = ["never", "old", "stale", "recent"];
    return order.map((bucket) => ({ bucket, count: list.filter((p) => p.freshness === bucket).length }));
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
  function pill(text, tone = "", title = "") {
    return el("span", { class: `pill pill-${tone || "none"}`, ...title ? { title } : {} }, text);
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
  function heading(title, note) {
    return el(
      "header",
      { class: "page-head" },
      el("img", { class: "mark", src: "logo.svg", alt: "", width: 26, height: 26 }),
      el("div", {}, el("h1", {}, title), note ? el("p", { class: "note" }, note) : null)
    );
  }

  // src/pages/backups.ts
  var REFRESH = 2e4;
  start("page", async (ctx) => {
    replace(byId("head"), heading("Data protection", `Backups and recurring jobs in ${ctx.contextName}.`));
    const body = byId("body");
    const failure = el("p", { class: "refresh-failure" });
    const stop = every(
      REFRESH,
      async () => {
        const [volumes, targets, backupVolumes, backups, jobs] = await Promise.all([
          k8sdockside.list({ kind: VOLUMES }),
          maybeList({ kind: BACKUP_TARGETS }),
          maybeList({ kind: BACKUP_VOLUMES }),
          maybeList({ kind: BACKUPS }),
          maybeList({ kind: RECURRING_JOBS })
        ]);
        failure.textContent = "";
        document.getElementById("first")?.remove();
        const covered = protection(volumes, backupVolumes);
        replace(
          body,
          failure,
          summary(covered, backups),
          ...targetBlocks(targets),
          jobsBlock(jobs),
          coverBlock(covered),
          runningBlock(backups)
        );
      },
      (err) => {
        failure.textContent = err instanceof Error ? err.message : String(err);
      }
    );
    addEventListener("pagehide", stop);
  });
  function summary(covered, backups) {
    const slices = protectionCounts(covered).map(({ bucket, count }) => ({
      label: bucket === "never" ? "never backed up" : bucket,
      count,
      tone: freshnessTone(bucket)
    }));
    const stored = covered.reduce((n, p) => n + p.stored, 0);
    const running = backups.filter((b) => ["InProgress", "Pending", "New"].includes(b.status?.state ?? "")).length;
    return el(
      "div",
      { class: "rings" },
      ring("Backup cover", slices, { unit: "volumes" }),
      el(
        "div",
        { class: "stats stats-column" },
        stat("Backups", String(backups.length), running ? `${running} running now` : "none running"),
        stat("Stored", size(stored), "as Longhorn counts it on the target"),
        stat(
          "Unprotected",
          String(covered.filter((p) => p.freshness === "never").length),
          "volumes with no backup at all",
          covered.some((p) => p.freshness === "never") ? "warn" : ""
        )
      )
    );
  }
  function targetBlocks(targets) {
    if (targets.length === 0) {
      return [
        block(
          "Backup target",
          "Longhorn has no backup target in this cluster, so nothing is being backed up.",
          nothing("Set one under Longhorn’s settings: an S3 bucket or an NFS share.")
        )
      ];
    }
    return targets.map((target) => {
      const url = target.spec?.backupTargetURL ?? "";
      const available = target.status?.available === true;
      const unavailable = condition(target.status?.conditions, "Unavailable");
      return block(
        `Backup target · ${target.metadata.name}`,
        "",
        facts([
          ["Address", el("span", { class: "mono" }, url || "not configured")],
          [
            "Reachable",
            url ? pill(available ? "yes" : "no", available ? "ok" : "error", unavailable?.message ?? "") : pill("not configured", "")
          ],
          ["Last synced", since(target.status?.lastSyncedAt)],
          ["Polled every", target.spec?.pollInterval ?? "—"],
          ["Credentials", target.spec?.credentialSecret || "none"]
        ]),
        unavailable && unavailable.status === "True" && unavailable.message ? el("p", { class: "card-problem" }, unavailable.message) : null
      );
    });
  }
  function jobsBlock(jobs) {
    if (jobs.length === 0) {
      return block(
        "Recurring jobs",
        "Nothing is scheduled: every snapshot and backup in this cluster is being taken by hand.",
        nothing("A recurring job is what keeps the ages in the table below small.")
      );
    }
    const rows = jobs.slice().sort((a, b) => a.metadata.name.localeCompare(b.metadata.name)).map(
      (job) => el(
        "tr",
        {},
        el("td", {}, el("strong", {}, job.metadata.name)),
        el("td", {}, pill(job.spec?.task ?? "snapshot", job.spec?.task?.startsWith("backup") ? "info" : "")),
        el("td", { class: "mono" }, job.spec?.cron ?? "—"),
        el("td", {}, `keeps ${job.spec?.retain ?? 0}`),
        el("td", {}, (job.spec?.groups ?? []).join(", ") || "by label"),
        el("td", { class: "faint" }, `${job.status?.executionCount ?? 0} runs`)
      )
    );
    return block(
      "Recurring jobs",
      "A job runs against the volumes in its groups, or the ones labelled for it.",
      el(
        "table",
        {},
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            el("th", {}, "Job"),
            el("th", {}, "Task"),
            el("th", {}, "Schedule"),
            el("th", {}, "Retention"),
            el("th", {}, "Applies to"),
            el("th", {}, "")
          )
        ),
        el("tbody", {}, ...rows)
      )
    );
  }
  function coverBlock(covered) {
    if (covered.length === 0) {
      return block("Volumes", "", nothing("There are no volumes to protect."));
    }
    const rows = covered.map((entry) => {
      const row = el(
        "tr",
        { class: "clickable" },
        el(
          "td",
          {},
          el("span", { class: `dot dot-${freshnessTone(entry.freshness) || "none"}` }),
          el("strong", {}, entry.volume)
        ),
        el("td", {}, entry.freshness === "never" ? el("span", { class: "tone-warn" }, "never backed up") : el("span", {}, `${since(entry.lastBackupAt)} ago`)),
        el("td", { class: "mono faint" }, entry.lastBackupName || "—"),
        el("td", {}, entry.stored > 0 ? size(entry.stored) : "—"),
        el("td", {}, size(entry.size))
      );
      if (entry.backupVolume) {
        row.addEventListener(
          "click",
          () => void k8sdockside.open({ kind: BACKUP_VOLUMES, namespace: entry.namespace, name: entry.backupVolume })
        );
      } else {
        row.addEventListener(
          "click",
          () => void k8sdockside.open({ kind: VOLUMES, namespace: entry.namespace, name: entry.volume })
        );
      }
      return row;
    });
    return block(
      "Every volume, and when it was last backed up",
      "Worst first. A row opens the backup, or the volume when there is no backup to open.",
      el(
        "table",
        {},
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            el("th", {}, "Volume"),
            el("th", {}, "Last backup"),
            el("th", {}, "Name"),
            el("th", {}, "Stored"),
            el("th", {}, "Volume size")
          )
        ),
        el("tbody", {}, ...rows)
      )
    );
  }
  function runningBlock(backups) {
    const running = backups.filter((backup) => ["InProgress", "Pending", "New"].includes(backup.status?.state ?? "")).sort((a, b) => (b.status?.progress ?? 0) - (a.status?.progress ?? 0));
    const failed = backups.filter((backup) => (backup.status?.state ?? "") === "Error");
    if (running.length === 0 && failed.length === 0) return null;
    const rows = [...running, ...failed].map(
      (backup) => el(
        "tr",
        {},
        el("td", {}, el("strong", {}, backup.status?.volumeName || backup.metadata.name)),
        el("td", {}, pill(backup.status?.state ?? "—", (backup.status?.state ?? "") === "Error" ? "error" : "warn")),
        el("td", {}, `${(backup.status?.progress ?? 0).toFixed(0)}%`),
        el("td", {}, size(bytes(backup.status?.size))),
        el("td", { class: "faint" }, backup.status?.error || since(backup.status?.snapshotCreatedAt))
      )
    );
    return block(
      "Backups in flight",
      "What is being copied to the target now, and what failed on the way.",
      el("table", {}, el("tbody", {}, ...rows))
    );
  }
})();
