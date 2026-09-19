// What a volume is doing, in the words Longhorn's own UI uses.
//
// This is the part with real Longhorn knowledge in it, kept apart from the
// pages so it can be tested without a cluster:
//
//   * robustness is the word that decides a volume's colour -- healthy,
//     degraded, faulted -- but it means nothing while the volume is detached,
//     because there is no engine to judge it;
//   * a replica's own `status.currentState` is not the whole truth either.
//     The engine is the one that knows whether it is being read from (RW),
//     copied into (WO) or given up on (ERR), and that is what the Longhorn UI
//     shows. A replica with `spec.failedAt` set is dead whatever it says.

import type { Engine, RebuildStatus, Replica, ReplicaMode, Volume } from './longhorn.js';
import { bytes, condition } from './longhorn.js';

export type Tone = 'ok' | 'warn' | 'error' | 'info' | '';

/** A volume as the pages draw it: the CR, its engine, and its replicas. */
export interface VolumeView {
    volume: Volume;
    engine?: Engine;
    replicas: Replica[];
}

/** The name a volume's CR has -- the same name as its PV. */
export function volumeName(volume: Volume): string {
    return volume.metadata.name;
}

/**
 * The word a volume is coloured by.
 *
 * A detached volume has no engine, so Longhorn leaves `robustness` at whatever
 * it was last -- reading it then would paint an idle volume red for a fault it
 * no longer has. Detached is its own state, not a degree of health.
 */
export function health(volume: Volume): { word: string; tone: Tone } {
    const state = (volume.status?.state ?? '').toLowerCase();
    const robustness = (volume.status?.robustness ?? '').toLowerCase();

    if (volume.metadata.deletionTimestamp || state === 'deleting') return { word: 'deleting', tone: 'warn' };
    if (state === 'creating') return { word: 'creating', tone: 'warn' };
    if (state === 'attaching' || state === 'detaching') return { word: state, tone: 'warn' };
    if (state === 'detached') return { word: 'detached', tone: '' };
    if (state !== 'attached') return { word: state || 'unknown', tone: 'warn' };

    switch (robustness) {
        case 'healthy':
            return { word: 'healthy', tone: 'ok' };
        case 'degraded':
            return { word: 'degraded', tone: 'warn' };
        case 'faulted':
            return { word: 'faulted', tone: 'error' };
        default:
            return { word: robustness || 'unknown', tone: 'warn' };
    }
}

/**
 * The buckets the dashboard ring is divided into, in the order Longhorn's own
 * dashboard puts them: the ones that need you first.
 */
export const HEALTH_BUCKETS = ['faulted', 'degraded', 'in progress', 'healthy', 'detached'] as const;
export type HealthBucket = (typeof HEALTH_BUCKETS)[number];

export function bucketOf(volume: Volume): HealthBucket {
    const { word } = health(volume);
    if (word === 'faulted') return 'faulted';
    if (word === 'degraded') return 'degraded';
    if (word === 'healthy') return 'healthy';
    if (word === 'detached') return 'detached';
    return 'in progress';
}

export function bucketTone(bucket: HealthBucket): Tone {
    switch (bucket) {
        case 'faulted':
            return 'error';
        case 'degraded':
            return 'warn';
        case 'in progress':
            return 'info';
        case 'healthy':
            return 'ok';
        default:
            return '';
    }
}

/** How a replica stands, taking the engine's word over the replica's own. */
export interface ReplicaView {
    replica: Replica;
    name: string;
    node: string;
    disk: string;
    mode: ReplicaMode;
    tone: Tone;
    /** Percent, only while it is being copied into. */
    rebuild?: number;
    failed: boolean;
}

export function replicaViews(view: VolumeView): ReplicaView[] {
    const modes = view.engine?.status?.replicaModeMap ?? {};
    const rebuilds = view.engine?.status?.rebuildStatus ?? {};
    return view.replicas
        .map((replica) => {
            const name = replica.metadata.name;
            const failed = !!replica.spec?.failedAt;
            const mode = failed ? 'ERR' : (modes[name] ?? modeFromReplica(replica));
            const rebuild = rebuildPercent(rebuilds[name]);
            return {
                replica,
                name,
                node: replica.spec?.nodeID ?? '',
                disk: replica.spec?.diskID ?? '',
                mode,
                tone: modeTone(mode),
                ...(rebuild === undefined ? {} : { rebuild }),
                failed,
            };
        })
        .sort((a, b) => a.node.localeCompare(b.node) || a.name.localeCompare(b.name));
}

/** What to say about a replica the engine has not mentioned: its own state. */
function modeFromReplica(replica: Replica): ReplicaMode {
    const state = (replica.status?.currentState ?? '').toLowerCase();
    if (state === 'error') return 'ERR';
    if (state === 'running') return 'RW';
    return state || 'stopped';
}

export function modeTone(mode: ReplicaMode): Tone {
    switch (mode) {
        case 'RW':
            return 'ok';
        case 'WO':
            return 'warn';
        case 'ERR':
            return 'error';
        default:
            return '';
    }
}

function rebuildPercent(status: RebuildStatus | undefined): number | undefined {
    if (!status || !status.isRebuilding) return undefined;
    const progress = status.progress ?? 0;
    return Math.max(0, Math.min(100, progress));
}

/** Every rebuild running on a volume right now, worst-started first. */
export function rebuilds(view: VolumeView): { replica: string; percent: number; from: string }[] {
    const status = view.engine?.status?.rebuildStatus ?? {};
    return Object.entries(status)
        .filter(([, rebuild]) => rebuild?.isRebuilding)
        .map(([replica, rebuild]) => ({
            replica,
            percent: Math.max(0, Math.min(100, rebuild.progress ?? 0)),
            from: rebuild.fromReplica ?? '',
        }))
        .sort((a, b) => a.percent - b.percent);
}

/** "2 of 3" -- how many replicas the engine is actually reading and writing. */
export function healthyReplicas(view: VolumeView): { ready: number; wanted: number } {
    const views = replicaViews(view);
    return {
        ready: views.filter((r) => r.mode === 'RW').length,
        wanted: view.volume.spec?.numberOfReplicas ?? views.length,
    };
}

/** Where a volume is attached, and to what -- the workload, not just the node. */
export function attachment(volume: Volume): { node: string; workloads: string[]; pvc: string } {
    const kube = volume.status?.kubernetesStatus;
    const workloads = (kube?.workloadsStatus ?? [])
        .map((w) => (w.workloadName ? `${w.workloadType ?? 'Workload'}/${w.workloadName}` : (w.podName ?? '')))
        .filter(Boolean);
    return {
        node: volume.status?.currentNodeID || volume.spec?.nodeID || '',
        workloads: [...new Set(workloads)],
        pvc: kube?.pvcName ? `${kube.namespace ?? 'default'}/${kube.pvcName}` : '',
    };
}

/** How full a volume is: what has been written against what was asked for. */
export function fullness(volume: Volume): { used: number; size: number; fraction: number } {
    const size = bytes(volume.spec?.size);
    const used = bytes(volume.status?.actualSize);
    return { used, size, fraction: size > 0 ? Math.min(1, used / size) : 0 };
}

/** Why Longhorn cannot schedule a volume's replicas, when it cannot. */
export function schedulingProblem(volume: Volume): string {
    const scheduled = condition(volume.status?.conditions, 'Scheduled');
    if (!scheduled || scheduled.status === 'True') return '';
    return scheduled.message || scheduled.reason || 'Longhorn cannot place every replica';
}

/**
 * The volumes, their engines and their replicas, joined into what the pages
 * draw.
 *
 * Longhorn relates them by name in `spec.volumeName` rather than by owner
 * reference, and during a live migration a volume has two engines -- so the
 * active one is the one to believe. Everything is matched in one pass because
 * a cluster with four hundred volumes has twelve hundred replicas, and doing
 * it with a `find` per volume is the difference between a page that draws and
 * one that hangs.
 */
export function compose(volumes: Volume[], engines: Engine[], replicas: Replica[]): VolumeView[] {
    const engineOf = new Map<string, Engine>();
    for (const engine of engines) {
        const name = engine.spec?.volumeName ?? '';
        if (!name) continue;
        const current = engineOf.get(name);
        if (!current || engine.spec?.active === true) engineOf.set(name, engine);
    }

    const replicasOf = new Map<string, Replica[]>();
    for (const replica of replicas) {
        const name = replica.spec?.volumeName ?? '';
        if (!name) continue;
        const list = replicasOf.get(name);
        if (list) list.push(replica);
        else replicasOf.set(name, [replica]);
    }

    return volumes.map((volume) => {
        const engine = engineOf.get(volume.metadata.name);
        return {
            volume,
            ...(engine ? { engine } : {}),
            replicas: replicasOf.get(volume.metadata.name) ?? [],
        };
    });
}
