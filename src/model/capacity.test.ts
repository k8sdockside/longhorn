import { describe, expect, test } from 'vitest';
import type { LonghornNode } from './longhorn.js';
import { capacityOf, disks, nodeView, percent, size } from './capacity.js';

const GI = 1024 * 1024 * 1024;

const node = (over: Partial<LonghornNode> = {}): LonghornNode => ({
    metadata: { name: 'node-a', namespace: 'longhorn-system' },
    spec: {
        allowScheduling: true,
        disks: { 'default-disk': { path: '/var/lib/longhorn', allowScheduling: true, storageReserved: 30 * GI } },
    },
    status: {
        conditions: [
            { type: 'Ready', status: 'True' },
            { type: 'Schedulable', status: 'True' },
        ],
        diskStatus: {
            'default-disk': {
                conditions: [
                    { type: 'Ready', status: 'True' },
                    { type: 'Schedulable', status: 'True' },
                ],
                storageMaximum: 100 * GI,
                storageAvailable: 70 * GI,
                storageScheduled: 40 * GI,
                scheduledReplica: { 'pvc-a-r-1': 20 * GI, 'pvc-b-r-1': 20 * GI },
            },
        },
    },
    ...over,
});

describe('disks', () => {
    test('used is what the filesystem holds, not what Longhorn promised', () => {
        const disk = disks(node())[0]!;
        expect(disk.used).toBe(30 * GI);
        expect(disk.scheduled).toBe(40 * GI);
        expect(disk.reserved).toBe(30 * GI);
        // 100 total, 30 reserved, 40 promised away: 30 left to promise.
        expect(disk.schedulable).toBe(30 * GI);
        expect(disk.replicas).toBe(2);
    });

    test('over-promised disks report nothing left rather than a negative', () => {
        const tight = node({
            spec: { disks: { d: { path: '/d', storageReserved: 80 * GI } } },
            status: {
                conditions: [{ type: 'Ready', status: 'True' }],
                diskStatus: { d: { storageMaximum: 100 * GI, storageAvailable: 10 * GI, storageScheduled: 50 * GI } },
            },
        });
        expect(disks(tight)[0]!.schedulable).toBe(0);
    });

    test('a disk with no status yet is drawn as empty, not as NaN', () => {
        const fresh = node({ spec: { disks: { d: { path: '/d' } } }, status: {} });
        const disk = disks(fresh)[0]!;
        expect([disk.maximum, disk.used, disk.scheduled, disk.schedulable]).toEqual([0, 0, 0, 0]);
    });

    test('a disk the node has forgotten is still listed from its status', () => {
        const orphan = node({
            spec: { disks: {} },
            status: { conditions: [], diskStatus: { 'old-disk': { storageMaximum: GI } } },
        });
        expect(disks(orphan).map((d) => d.name)).toEqual(['old-disk']);
    });

    test('why a disk cannot take a replica', () => {
        const off = node({
            spec: { disks: { d: { path: '/d', allowScheduling: false } } },
            status: { diskStatus: { d: { conditions: [{ type: 'Ready', status: 'True' }] } } },
        });
        expect(disks(off)[0]!.problem).toBe('scheduling is switched off for this disk');

        const broken = node({
            spec: { disks: { d: { path: '/d' } } },
            status: {
                diskStatus: {
                    d: { conditions: [{ type: 'Ready', status: 'False', message: 'the path is not a mount point' }] },
                },
            },
        });
        expect(disks(broken)[0]!.tone).toBe('error');
        expect(disks(broken)[0]!.problem).toBe('the path is not a mount point');
    });
});

describe('nodes', () => {
    test('a healthy node is schedulable and green', () => {
        const view = nodeView(node());
        expect([view.word, view.tone]).toEqual(['schedulable', 'ok']);
        expect(view.total.maximum).toBe(100 * GI);
        expect(view.replicas).toBe(2);
    });

    test('a node whose manager is not reporting is down, and says why', () => {
        const down = node({
            status: {
                conditions: [{ type: 'Ready', status: 'False', message: 'the manager pod is not running' }],
                diskStatus: {},
            },
        });
        const view = nodeView(down);
        expect([view.word, view.tone]).toEqual(['down', 'error']);
        expect(view.problem).toBe('the manager pod is not running');
    });

    test('scheduling switched off is neither an error nor healthy', () => {
        const off = node({ spec: { allowScheduling: false, disks: {} } });
        expect(nodeView(off).word).toBe('disabled');
        expect(nodeView(off).tone).toBe('');
    });

    test('a node being drained says so before it says anything else', () => {
        const draining = node({ spec: { allowScheduling: false, evictionRequested: true, disks: {} } });
        expect(nodeView(draining).word).toBe('evicting');
    });

    test('capacity adds up across disks', () => {
        const two = node({
            spec: { disks: { a: { path: '/a' }, b: { path: '/b' } } },
            status: {
                diskStatus: {
                    a: { storageMaximum: 10 * GI, storageAvailable: 4 * GI, storageScheduled: 5 * GI },
                    b: { storageMaximum: 20 * GI, storageAvailable: 20 * GI, storageScheduled: 0 },
                },
            },
        });
        const total = capacityOf(disks(two));
        expect(total.maximum).toBe(30 * GI);
        expect(total.used).toBe(6 * GI);
        expect(total.scheduled).toBe(5 * GI);
    });
});

describe('writing numbers down', () => {
    test('sizes read the way Longhorn writes them', () => {
        expect(size(0)).toBe('0');
        expect(size(512)).toBe('512 B');
        expect(size(1536)).toBe('1.50 Ki');
        expect(size(10 * GI)).toBe('10.0 Gi');
        expect(size(200 * GI)).toBe('200 Gi');
    });

    test('percentages of nothing are nothing, not NaN', () => {
        expect(percent(5, 0)).toBe(0);
        expect(percent(5, 10)).toBe(50);
        expect(percent(15, 10)).toBe(100);
    });
});
