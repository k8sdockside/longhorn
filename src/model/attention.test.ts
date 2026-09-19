import { describe, expect, test } from 'vitest';
import type { BackupTarget, LonghornNode, Volume } from './longhorn.js';
import { nodeView } from './capacity.js';
import type { VolumeView } from './volume.js';
import { issues } from './attention.js';

const GI = 1024 * 1024 * 1024;

const volume = (name: string, status: Volume['status'] = {}): VolumeView => ({
    volume: {
        metadata: { name, namespace: 'longhorn-system' },
        spec: { size: '1073741824', numberOfReplicas: 3 },
        status: { state: 'attached', robustness: 'healthy', ...status },
    },
    replicas: [],
});

const node = (name: string, over: Partial<LonghornNode> = {}): LonghornNode => ({
    metadata: { name, namespace: 'longhorn-system' },
    spec: { allowScheduling: true, disks: { d: { path: '/d' } } },
    status: {
        conditions: [
            { type: 'Ready', status: 'True' },
            { type: 'Schedulable', status: 'True' },
        ],
        diskStatus: {
            d: {
                conditions: [
                    { type: 'Ready', status: 'True' },
                    { type: 'Schedulable', status: 'True' },
                ],
                storageMaximum: 100 * GI,
                storageAvailable: 60 * GI,
                storageScheduled: 20 * GI,
            },
        },
    },
    ...over,
});

describe('what needs attention', () => {
    test('a cluster with nothing wrong has nothing to say', () => {
        expect(issues([volume('pvc-1')], [nodeView(node('node-a'))], [])).toEqual([]);
    });

    test('faulted volumes come before nodes that are down, which come before degraded ones', () => {
        const down = node('node-b', {
            status: { conditions: [{ type: 'Ready', status: 'False', message: 'no manager' }], diskStatus: {} },
        });
        const list = issues(
            [volume('pvc-degraded', { robustness: 'degraded' }), volume('pvc-faulted', { robustness: 'faulted' })],
            [nodeView(node('node-a')), nodeView(down)],
            [],
        );
        expect(list.map((i) => i.title)).toEqual(['pvc-faulted', 'node-b', 'pvc-degraded']);
        expect(list[0]!.tone).toBe('error');
    });

    test('a degraded volume says how far the rebuild has got', () => {
        const rebuilding: VolumeView = {
            ...volume('pvc-1', { robustness: 'degraded' }),
            engine: {
                metadata: { name: 'e' },
                status: { rebuildStatus: { 'pvc-1-r-2': { isRebuilding: true, progress: 42 } } },
            },
        };
        expect(issues([rebuilding], [], [])[0]!.detail).toBe('degraded — rebuilding a replica, 42% done');
    });

    test('a nearly full disk is reported once it is worth acting on', () => {
        const full = node('node-c', {
            status: {
                conditions: [{ type: 'Ready', status: 'True' }],
                diskStatus: {
                    d: {
                        conditions: [{ type: 'Ready', status: 'True' }],
                        storageMaximum: 100 * GI,
                        storageAvailable: 4 * GI,
                    },
                },
            },
        });
        const list = issues([], [nodeView(full)], []);
        expect(list[0]!.title).toBe('node-c · d');
        expect(list[0]!.detail).toContain('96% full');
        expect(list[0]!.tone).toBe('error');
    });

    test('a backup target that cannot be reached is worth knowing about', () => {
        const target: BackupTarget = {
            metadata: { name: 'default', namespace: 'longhorn-system' },
            spec: { backupTargetURL: 's3://backups@eu-north-1/' },
            status: { available: false, conditions: [{ type: 'Unavailable', status: 'True', message: 'no credentials' }] },
        };
        expect(issues([], [], [target])[0]!.detail).toBe('no credentials');
    });

    test('a backup target nobody configured is not a problem', () => {
        const unset: BackupTarget = { metadata: { name: 'default' }, spec: { backupTargetURL: '' }, status: { available: false } };
        expect(issues([], [], [unset])).toEqual([]);
    });

    test('an unschedulable volume explains itself', () => {
        const stuck = volume('pvc-stuck', {
            state: 'detached',
            conditions: [{ type: 'Scheduled', status: 'False', message: 'no disk has room for a third replica' }],
        });
        expect(issues([stuck], [], [])[0]!.detail).toBe('cannot be scheduled — no disk has room for a third replica');
    });
});
