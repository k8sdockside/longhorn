// What is wrong right now, worst first.
//
// The dashboard's rings say how many volumes are degraded; this says which
// ones, and why, in a sentence -- which is the thing you actually came to
// find out. Every entry carries the object it is about so the row can open it
// in the app.
//
// The order is severity, then the kind of thing: a faulted volume is above a
// node that is down, because data that cannot be read is worse news than a
// machine that is off. Within a severity the list keeps the order it was
// built in, which is alphabetical by name.

import type { BackupTarget } from './longhorn.js';
import { condition } from './longhorn.js';
import type { NodeView } from './capacity.js';
import { percent } from './capacity.js';
import type { Tone, VolumeView } from './volume.js';
import { health, healthyReplicas, rebuilds, schedulingProblem } from './volume.js';

export interface Issue {
    /** What to open when the row is clicked. */
    ref: { kind: string; namespace: string; name: string };
    title: string;
    detail: string;
    tone: Tone;
    /** 0 is worst. Only used for sorting. */
    rank: number;
}

/** When a disk is close enough to full to be worth saying so. */
export const NEARLY_FULL = 85;

export function issues(volumes: VolumeView[], nodes: NodeView[], targets: BackupTarget[]): Issue[] {
    const out: Issue[] = [];

    for (const view of volumes) {
        const volume = view.volume;
        const ref = { kind: 'crd:volumes.longhorn.io', namespace: volume.metadata.namespace ?? '', name: volume.metadata.name };
        const { word } = health(volume);
        const { ready, wanted } = healthyReplicas(view);

        if (word === 'faulted') {
            out.push({
                ref,
                title: volume.metadata.name,
                detail: 'faulted — no replica can be read; the volume is not serving data',
                tone: 'error',
                rank: 0,
            });
            continue;
        }
        if (word === 'degraded') {
            const running = rebuilds(view);
            const first = running[0];
            out.push({
                ref,
                title: volume.metadata.name,
                detail: first
                    ? `degraded — rebuilding a replica, ${first.percent.toFixed(0)}% done`
                    : `degraded — ${ready} of ${wanted} replicas are being read and written`,
                tone: 'warn',
                rank: 2,
            });
            continue;
        }

        const problem = schedulingProblem(volume);
        if (problem) {
            out.push({ ref, title: volume.metadata.name, detail: `cannot be scheduled — ${problem}`, tone: 'warn', rank: 3 });
        }
    }

    for (const node of nodes) {
        const ref = { kind: 'crd:nodes.longhorn.io', namespace: node.node.metadata.namespace ?? '', name: node.name };
        if (!node.ready) {
            out.push({ ref, title: node.name, detail: `down — ${node.problem}`, tone: 'error', rank: 1 });
            continue;
        }
        for (const disk of node.disks) {
            if (!disk.ready) {
                out.push({
                    ref,
                    title: `${node.name} · ${disk.name}`,
                    detail: disk.problem,
                    tone: 'error',
                    rank: 1,
                });
                continue;
            }
            const full = percent(disk.used, disk.maximum);
            if (disk.maximum > 0 && full >= NEARLY_FULL) {
                out.push({
                    ref,
                    title: `${node.name} · ${disk.name}`,
                    detail: `${full.toFixed(0)}% full — ${disk.path || 'the disk'} has little room left`,
                    tone: full >= 95 ? 'error' : 'warn',
                    rank: full >= 95 ? 1 : 4,
                });
            } else if (!disk.canSchedule && disk.allowScheduling) {
                out.push({
                    ref,
                    title: `${node.name} · ${disk.name}`,
                    detail: disk.problem,
                    tone: 'warn',
                    rank: 4,
                });
            }
        }
        if (node.evicting) {
            out.push({ ref, title: node.name, detail: 'replicas are being moved off this node', tone: 'warn', rank: 5 });
        }
    }

    for (const target of targets) {
        if (!target.spec?.backupTargetURL) continue;
        if (target.status?.available === false) {
            const cond = condition(target.status?.conditions, 'Unavailable');
            out.push({
                ref: {
                    kind: 'crd:backuptargets.longhorn.io',
                    namespace: target.metadata.namespace ?? '',
                    name: target.metadata.name,
                },
                title: `backup target ${target.metadata.name}`,
                detail: cond?.message || 'Longhorn cannot reach the backup target, so nothing is being backed up',
                tone: 'warn',
                rank: 3,
            });
        }
    }

    return out.sort((a, b) => a.rank - b.rank);
}
