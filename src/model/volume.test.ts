import { describe, expect, test } from 'vitest';
import type { Engine, Replica, Volume } from './longhorn.js';
import { bytes } from './longhorn.js';
import {
    attachment,
    bucketOf,
    fullness,
    health,
    healthyReplicas,
    rebuilds,
    replicaViews,
    schedulingProblem,
    type VolumeView,
} from './volume.js';

const volume = (spec: Volume['spec'] = {}, status: Volume['status'] = {}): Volume => ({
    metadata: { name: 'pvc-abc', namespace: 'longhorn-system' },
    spec: { size: '10737418240', numberOfReplicas: 3, ...spec },
    status: { state: 'attached', robustness: 'healthy', ...status },
});

const replica = (name: string, node: string, over: Replica['spec'] = {}): Replica => ({
    metadata: { name, namespace: 'longhorn-system' },
    spec: { volumeName: 'pvc-abc', nodeID: node, diskID: 'disk-1', ...over },
    status: { currentState: 'running' },
});

const view = (over: Partial<VolumeView> = {}): VolumeView => ({
    volume: volume(),
    replicas: [replica('pvc-abc-r-1', 'node-a'), replica('pvc-abc-r-2', 'node-b'), replica('pvc-abc-r-3', 'node-c')],
    ...over,
});

describe('health', () => {
    test('an attached volume is coloured by its robustness', () => {
        expect(health(volume())).toEqual({ word: 'healthy', tone: 'ok' });
        expect(health(volume({}, { robustness: 'degraded' }))).toEqual({ word: 'degraded', tone: 'warn' });
        expect(health(volume({}, { robustness: 'faulted' }))).toEqual({ word: 'faulted', tone: 'error' });
    });

    test('a detached volume is not judged by a robustness left over from last time', () => {
        // This is the one that matters: Longhorn leaves `robustness` alone when
        // a volume detaches, so reading it would paint an idle volume red.
        expect(health(volume({}, { state: 'detached', robustness: 'faulted' }))).toEqual({
            word: 'detached',
            tone: '',
        });
    });

    test('the states in between are amber, not green', () => {
        expect(health(volume({}, { state: 'attaching' })).tone).toBe('warn');
        expect(health(volume({}, { state: 'creating' })).tone).toBe('warn');
    });

    test('a volume being deleted says so, whatever its status still claims', () => {
        const deleting: Volume = { ...volume(), metadata: { name: 'v', deletionTimestamp: '2026-01-01T00:00:00Z' } };
        expect(health(deleting)).toEqual({ word: 'deleting', tone: 'warn' });
    });
});

describe('buckets', () => {
    test('every state lands in one of the dashboard rings', () => {
        expect(bucketOf(volume())).toBe('healthy');
        expect(bucketOf(volume({}, { robustness: 'degraded' }))).toBe('degraded');
        expect(bucketOf(volume({}, { robustness: 'faulted' }))).toBe('faulted');
        expect(bucketOf(volume({}, { state: 'detached' }))).toBe('detached');
        expect(bucketOf(volume({}, { state: 'attaching' }))).toBe('in progress');
    });
});

describe('replicas', () => {
    test('the engine decides the mode, not the replica', () => {
        const engine: Engine = {
            metadata: { name: 'e' },
            status: { replicaModeMap: { 'pvc-abc-r-1': 'RW', 'pvc-abc-r-2': 'WO', 'pvc-abc-r-3': 'ERR' } },
        };
        const modes = replicaViews(view({ engine })).map((r) => [r.name, r.mode, r.tone]);
        expect(modes).toEqual([
            ['pvc-abc-r-1', 'RW', 'ok'],
            ['pvc-abc-r-2', 'WO', 'warn'],
            ['pvc-abc-r-3', 'ERR', 'error'],
        ]);
    });

    test('a failed replica is failed whatever the engine says about it', () => {
        const engine: Engine = { metadata: { name: 'e' }, status: { replicaModeMap: { 'pvc-abc-r-1': 'RW' } } };
        const failed = view({
            engine,
            replicas: [replica('pvc-abc-r-1', 'node-a', { failedAt: '2026-01-01T00:00:00Z' })],
        });
        expect(replicaViews(failed)[0]?.mode).toBe('ERR');
    });

    test('with no engine at all a replica falls back to its own state', () => {
        const detached = view({ replicas: [replica('pvc-abc-r-1', 'node-a')] });
        expect(replicaViews(detached)[0]?.mode).toBe('RW');
    });

    test('only the replicas the engine reads and writes count as ready', () => {
        const engine: Engine = {
            metadata: { name: 'e' },
            status: { replicaModeMap: { 'pvc-abc-r-1': 'RW', 'pvc-abc-r-2': 'WO', 'pvc-abc-r-3': 'RW' } },
        };
        expect(healthyReplicas(view({ engine }))).toEqual({ ready: 2, wanted: 3 });
    });

    test('rebuilds are listed least finished first, and only while they run', () => {
        const engine: Engine = {
            metadata: { name: 'e' },
            status: {
                rebuildStatus: {
                    'pvc-abc-r-2': { isRebuilding: true, progress: 70 },
                    'pvc-abc-r-3': { isRebuilding: true, progress: 12 },
                    'pvc-abc-r-1': { isRebuilding: false, progress: 100 },
                },
            },
        };
        expect(rebuilds(view({ engine })).map((r) => [r.replica, r.percent])).toEqual([
            ['pvc-abc-r-3', 12],
            ['pvc-abc-r-2', 70],
        ]);
    });

    test('a progress outside 0-100 is not drawn outside the bar', () => {
        const engine: Engine = {
            metadata: { name: 'e' },
            status: { rebuildStatus: { 'pvc-abc-r-1': { isRebuilding: true, progress: 140 } } },
        };
        expect(rebuilds(view({ engine }))[0]?.percent).toBe(100);
    });
});

describe('what a volume is for', () => {
    test('the workload, the PVC and the node it is attached to', () => {
        const attached = volume(
            {},
            {
                currentNodeID: 'node-a',
                kubernetesStatus: {
                    namespace: 'apps',
                    pvcName: 'data-postgres-0',
                    workloadsStatus: [
                        { podName: 'postgres-0', workloadName: 'postgres', workloadType: 'StatefulSet' },
                        { podName: 'postgres-0', workloadName: 'postgres', workloadType: 'StatefulSet' },
                    ],
                },
            },
        );
        expect(attachment(attached)).toEqual({
            node: 'node-a',
            workloads: ['StatefulSet/postgres'],
            pvc: 'apps/data-postgres-0',
        });
    });

    test('a volume nothing uses has no workload and no PVC', () => {
        expect(attachment(volume({}, { state: 'detached' }))).toEqual({ node: '', workloads: [], pvc: '' });
    });
});

describe('sizes', () => {
    test('Longhorn writes byte counts as strings', () => {
        expect(bytes('10737418240')).toBe(10737418240);
        expect(bytes(undefined)).toBe(0);
        expect(bytes('')).toBe(0);
        expect(bytes('not a number')).toBe(0);
    });

    test('fullness never divides by a size Longhorn has not reported', () => {
        expect(fullness(volume({}, { actualSize: '5368709120' })).fraction).toBeCloseTo(0.5);
        expect(fullness(volume({ size: '0' })).fraction).toBe(0);
    });

    test('a volume written past its size still draws inside the bar', () => {
        expect(fullness(volume({ size: '100' }, { actualSize: '180' })).fraction).toBe(1);
    });
});

describe('scheduling', () => {
    test('an unscheduled volume says why, in Longhorn own words when it has any', () => {
        const stuck = volume(
            {},
            {
                state: 'detached',
                conditions: [{ type: 'Scheduled', status: 'False', reason: 'ReplicaSchedulingFailure', message: 'no disk has room' }],
            },
        );
        expect(schedulingProblem(stuck)).toBe('no disk has room');
    });

    test('a scheduled volume has no problem to report', () => {
        expect(schedulingProblem(volume({}, { conditions: [{ type: 'Scheduled', status: 'True' }] }))).toBe('');
        expect(schedulingProblem(volume())).toBe('');
    });
});
