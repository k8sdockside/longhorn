// Disks, nodes, and how much room is left.
//
// Longhorn divides a disk four ways, and its dashboard draws them in this
// order:
//
//   used        what is on the filesystem now, Longhorn's replicas and
//               anything else sharing the disk: maximum - available
//   scheduled   promised to replicas that live here, whether or not those
//               replicas have written that much yet -- `storageScheduled`
//   reserved    held back from Longhorn by the operator, for the OS and for
//               whatever else the disk is for -- `spec.storageReserved`
//   free        what is left for Longhorn to schedule onto
//
// They overlap: a replica that has written half of what it was promised is in
// both `used` and `scheduled`. So the bar is drawn from the two that do not --
// used and reserved -- with what Longhorn may still schedule as the rest, and
// the promise shown as a marker over it. Getting this wrong is how a dashboard
// ends up saying a disk is 180% full.

import type { DiskSpec, DiskStatus, LonghornNode } from './longhorn.js';
import { conditionTrue } from './longhorn.js';
import type { Tone } from './volume.js';

export interface DiskView {
    name: string;
    path: string;
    spec: DiskSpec;
    status: DiskStatus;
    /** Bytes the filesystem holds in total. */
    maximum: number;
    /** Bytes free on the filesystem. */
    available: number;
    /** Bytes in use on the filesystem, Longhorn's and everyone else's. */
    used: number;
    /** Bytes promised to the replicas on this disk. */
    scheduled: number;
    /** Bytes the operator holds back from Longhorn. */
    reserved: number;
    /** What Longhorn may still promise: maximum - reserved - scheduled, never below zero. */
    schedulable: number;
    replicas: number;
    ready: boolean;
    canSchedule: boolean;
    allowScheduling: boolean;
    evicting: boolean;
    tone: Tone;
    /** Why it is not schedulable, when it is not. */
    problem: string;
}

/** Every disk on a node, in a stable order. */
export function disks(node: LonghornNode): DiskView[] {
    const specs = node.spec?.disks ?? {};
    const statuses = node.status?.diskStatus ?? {};
    const names = [...new Set([...Object.keys(specs), ...Object.keys(statuses)])].sort();
    return names.map((name) => diskView(name, specs[name] ?? {}, statuses[name] ?? {}));
}

function diskView(name: string, spec: DiskSpec, status: DiskStatus): DiskView {
    const maximum = status.storageMaximum ?? 0;
    const available = status.storageAvailable ?? 0;
    const scheduled = status.storageScheduled ?? 0;
    const reserved = spec.storageReserved ?? 0;
    const used = Math.max(0, maximum - available);
    const ready = conditionTrue(status.conditions, 'Ready');
    const canSchedule = conditionTrue(status.conditions, 'Schedulable');
    const allowScheduling = spec.allowScheduling !== false;
    const evicting = spec.evictionRequested === true;

    return {
        name,
        path: spec.path ?? '',
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
        problem: diskProblem(status, ready, canSchedule, allowScheduling, evicting),
    };
}

function diskTone(ready: boolean, canSchedule: boolean, allow: boolean, evicting: boolean): Tone {
    if (!ready) return 'error';
    if (evicting) return 'warn';
    if (!allow) return '';
    return canSchedule ? 'ok' : 'warn';
}

function diskProblem(status: DiskStatus, ready: boolean, canSchedule: boolean, allow: boolean, evicting: boolean): string {
    if (!ready) {
        const cond = (status.conditions ?? []).find((c) => c.type === 'Ready');
        return cond?.message || cond?.reason || 'the disk is not ready';
    }
    if (evicting) return 'replicas are being moved off this disk';
    if (!allow) return 'scheduling is switched off for this disk';
    if (!canSchedule) {
        const cond = (status.conditions ?? []).find((c) => c.type === 'Schedulable');
        return cond?.message || cond?.reason || 'the disk has no room for another replica';
    }
    return '';
}

export interface NodeView {
    node: LonghornNode;
    name: string;
    disks: DiskView[];
    ready: boolean;
    schedulable: boolean;
    allowScheduling: boolean;
    evicting: boolean;
    zone: string;
    tone: Tone;
    word: string;
    problem: string;
    /** The node's disks, added up. */
    total: Capacity;
    replicas: number;
}

export interface Capacity {
    maximum: number;
    used: number;
    scheduled: number;
    reserved: number;
    available: number;
    schedulable: number;
}

export const NO_CAPACITY: Capacity = {
    maximum: 0,
    used: 0,
    scheduled: 0,
    reserved: 0,
    available: 0,
    schedulable: 0,
};

export function add(a: Capacity, b: Capacity): Capacity {
    return {
        maximum: a.maximum + b.maximum,
        used: a.used + b.used,
        scheduled: a.scheduled + b.scheduled,
        reserved: a.reserved + b.reserved,
        available: a.available + b.available,
        schedulable: a.schedulable + b.schedulable,
    };
}

export function capacityOf(list: DiskView[]): Capacity {
    return list.reduce(
        (total, disk) =>
            add(total, {
                maximum: disk.maximum,
                used: disk.used,
                scheduled: disk.scheduled,
                reserved: disk.reserved,
                available: disk.available,
                schedulable: disk.schedulable,
            }),
        NO_CAPACITY,
    );
}

export function nodeView(node: LonghornNode): NodeView {
    const list = disks(node);
    const ready = conditionTrue(node.status?.conditions, 'Ready');
    const schedulable = conditionTrue(node.status?.conditions, 'Schedulable');
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
        zone: node.status?.zone ?? '',
        tone: nodeTone(ready, schedulable, allowScheduling, evicting),
        word: nodeWord(ready, schedulable, allowScheduling, evicting),
        problem: nodeProblem(node, ready),
        total: capacityOf(list),
        replicas: list.reduce((n, disk) => n + disk.replicas, 0),
    };
}

function nodeTone(ready: boolean, schedulable: boolean, allow: boolean, evicting: boolean): Tone {
    if (!ready) return 'error';
    if (evicting) return 'warn';
    if (!allow) return '';
    return schedulable ? 'ok' : 'warn';
}

function nodeWord(ready: boolean, schedulable: boolean, allow: boolean, evicting: boolean): string {
    if (!ready) return 'down';
    if (evicting) return 'evicting';
    if (!allow) return 'disabled';
    return schedulable ? 'schedulable' : 'unschedulable';
}

function nodeProblem(node: LonghornNode, ready: boolean): string {
    if (!ready) {
        const cond = (node.status?.conditions ?? []).find((c) => c.type === 'Ready');
        return cond?.message || cond?.reason || 'the Longhorn manager on this node is not reporting';
    }
    const mount = (node.status?.conditions ?? []).find((c) => c.type === 'MountPropagation');
    if (mount && mount.status === 'False') return mount.message || 'mount propagation is not available on this node';
    return '';
}

/** Bytes in the shorthand Longhorn uses: 1.5 Gi, 940 Mi, 12 Ti. */
export function size(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '0';
    const units = ['B', 'Ki', 'Mi', 'Gi', 'Ti', 'Pi'];
    let n = value;
    let unit = 0;
    while (n >= 1024 && unit < units.length - 1) {
        n /= 1024;
        unit++;
    }
    const digits = n >= 100 || unit === 0 ? 0 : n >= 10 ? 1 : 2;
    return `${n.toFixed(digits)} ${units[unit]}`;
}

/** A fraction as a whole percent, safe when the denominator is zero. */
export function percent(part: number, whole: number): number {
    if (!(whole > 0)) return 0;
    return Math.max(0, Math.min(100, (part / whole) * 100));
}
