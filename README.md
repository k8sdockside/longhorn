# Longhorn for K8s Dockside

A [K8s Dockside](https://github.com/k8sdockside/k8sdockside) plugin for
[Longhorn](https://longhorn.io), the distributed block storage that turns the
disks of your nodes into replicated volumes.

It answers the three questions you open Longhorn for — is anything degraded, is
any node or disk out, and am I running out of room — before you have opened a
single resource.

<!-- markdownlint-disable-next-line MD033 -->
<img src="src/assets/logo.svg" alt="" width="64" height="64" />

## What it shows

**Dashboard** — three rings in the order Longhorn's own dashboard puts them:
volumes by how safe their data is, nodes by whether they can take a replica,
disks by whether they have room. Under them, the cluster's storage as one bar —
what is written, what is held back, what is free, with a pin at what Longhorn
has *promised* to replicas — and a list of everything that needs attention,
worst first, each row opening the object it is about.

**Volume map** — every volume as a card coloured by its robustness, with the
claim and the workload it serves, how much of it has been written, and a pill
per replica in the mode the *engine* has it in: `RW` being read and written,
`WO` being copied into, `ERR` given up on. Anything rebuilding carries a live
progress bar. Search by volume, PVC, workload or node; filter by health or
namespace; order by health, name or size.

**Nodes & disks** — each node with every disk under it: used, reserved,
promised and free, the replicas on it, and what is wrong with it in a sentence.
A disk promised more room than it has says so. The buttons are the manifest's
actions — disable or enable scheduling, evict replicas — and the app asks
before running any of them.

**Data protection** — the backup target and whether it can be reached, the
recurring jobs meant to keep backups fresh, and the table the Longhorn UI makes
you piece together from three screens: every volume, when it was last backed
up, and — at the top — the ones with no backup at all.

**Panels** on PersistentVolumeClaims (the Longhorn volume behind the claim), on
Nodes (the Longhorn disks on that machine) and on Longhorn Volumes (every
replica with its node, disk, mode and rebuild).

It also gives every Longhorn resource a table of its own in the sidebar —
volumes, replicas, engines, snapshots, backups, recurring jobs, backing images,
instance managers, settings and the rest — plus the manager, CSI and instance
manager pods.

## What it reads, and what it changes

It reads Longhorn's custom resources, and Pods, Nodes, PersistentVolumeClaims,
PersistentVolumes, StorageClasses, Events and Namespaces. It never reads
Secrets: the app refuses that for every plugin, whatever a manifest says.

It can ask to change three things, and every one of them is shown to you in a
dialog the pages cannot reach or answer before anything happens:

| Action | On | What it does |
| --- | --- | --- |
| Disable / enable scheduling | Longhorn node | `spec.allowScheduling` |
| Evict replicas / cancel | Longhorn node | `spec.evictionRequested` |
| Take a snapshot | Longhorn volume | creates a `Snapshot` for it |

## Installing

In K8s Dockside: **Settings → Plugins → Available → Longhorn → Install**.

Or from the repository address, under **From a repository**:

```text
https://github.com/k8sdockside/longhorn.git
```

Needs K8s Dockside 0.1.1 or newer — the release that added plugin categories,
which this manifest names — and Longhorn in the cluster. Without Longhorn the
plugin says so and stays out of the way.

## Working on it

The pages are TypeScript in `src/`, bundled into `ui/` — which is what the app
serves, and what installing clones, so `ui/` is committed and must be in step
with `src/`.

```sh
npm install
npm run build     # src/ -> ui/
npm run watch     # rebuild on every change; reopen the tab to see it
npm run check     # typecheck, unit tests, and ui/ against a fresh build
```

To see your changes in the app without installing anything: **Settings →
Plugins → Watch another folder**, point it at this checkout, and press
**Reload** after each build.

To check the manifest the way the app does:

```sh
go run github.com/k8sdockside/k8sdockside/cmd/plugincheck@main .
```

### How it is laid out

| | |
| --- | --- |
| `plugin.json` | the manifest: views, cards, charts, panels, actions |
| `src/model/` | what Longhorn's resources mean — health, capacity, backups — with the tests |
| `src/ui/` | the pieces the pages are drawn from: rings, bars, pills, cards |
| `src/pages/` | one `.ts` and one `.html` per page |
| `src/styles/` | one stylesheet, written in the app's theme tokens |

Everything with real Longhorn knowledge in it lives in `src/model/` and is
tested without a cluster: that a detached volume is not judged by a robustness
left over from when it was attached, that the engine's `replicaModeMap` is what
a replica's colour comes from, and that a disk's four overlapping numbers are
not added into a bar that says 180%.

## Credit

Longhorn is a [CNCF](https://www.cncf.io) project. Its name and its mark are
its own and are used here only to name this plugin for it. This plugin is not
affiliated with the Longhorn project.

Apache 2.0 — see [LICENSE](LICENSE).
