import { describe, expect, test } from 'vitest';
import type { Volume } from './longhorn.js';
import type { VolumeView } from './volume.js';
import { ALL, apply, counts, haystack, namespaces } from './filter.js';

const view = (name: string, over: Volume['status'] = {}, spec: Volume['spec'] = {}): VolumeView => ({
    volume: {
        metadata: { name, namespace: 'longhorn-system' },
        spec: { size: '1073741824', numberOfReplicas: 3, ...spec },
        status: { state: 'attached', robustness: 'healthy', ...over },
    },
    replicas: [],
});

const volumes = [
    view('pvc-1', {
        robustness: 'degraded',
        currentNodeID: 'node-b',
        kubernetesStatus: { namespace: 'apps', pvcName: 'data-postgres-0', workloadsStatus: [{ workloadName: 'postgres', workloadType: 'StatefulSet' }] },
    }),
    view('pvc-2', { state: 'detached', kubernetesStatus: { namespace: 'media', pvcName: 'plex-config' } }, { size: '5368709120' }),
    view('pvc-3', { robustness: 'faulted', kubernetesStatus: { namespace: 'apps', pvcName: 'redis-data' } }, { size: '2147483648' }),
];

describe('search', () => {
    test('a volume is found by the PVC and workload it serves, not only its name', () => {
        expect(apply(volumes, { ...ALL, text: 'postgres' }).map((v) => v.volume.metadata.name)).toEqual(['pvc-1']);
        expect(apply(volumes, { ...ALL, text: 'plex' }).map((v) => v.volume.metadata.name)).toEqual(['pvc-2']);
    });

    test('every word has to match, so typing more narrows', () => {
        expect(apply(volumes, { ...ALL, text: 'apps redis' }).map((v) => v.volume.metadata.name)).toEqual(['pvc-3']);
        expect(apply(volumes, { ...ALL, text: 'apps plex' })).toEqual([]);
    });

    test('case and stray spaces do not matter', () => {
        expect(apply(volumes, { ...ALL, text: '  POSTGRES  ' })).toHaveLength(1);
    });

    test('the node a volume is attached to is searchable', () => {
        expect(haystack(volumes[0]!)).toContain('node-b');
    });
});

describe('filters', () => {
    test('by health bucket', () => {
        expect(apply(volumes, { ...ALL, bucket: 'faulted' }).map((v) => v.volume.metadata.name)).toEqual(['pvc-3']);
        expect(apply(volumes, { ...ALL, bucket: 'detached' }).map((v) => v.volume.metadata.name)).toEqual(['pvc-2']);
    });

    test('by the namespace the volume is used from', () => {
        expect(apply(volumes, { ...ALL, namespace: 'apps' })).toHaveLength(2);
        expect(namespaces(volumes)).toEqual(['apps', 'media']);
    });
});

describe('order', () => {
    test('worst first is the default', () => {
        expect(apply(volumes, ALL).map((v) => v.volume.metadata.name)).toEqual(['pvc-3', 'pvc-1', 'pvc-2']);
    });

    test('largest first reads the size Longhorn wrote as a string', () => {
        expect(apply(volumes, { ...ALL, sort: 'size' }).map((v) => v.volume.metadata.name)).toEqual([
            'pvc-2',
            'pvc-3',
            'pvc-1',
        ]);
    });

    test('by name, A to Z', () => {
        expect(apply(volumes, { ...ALL, sort: 'name' }).map((v) => v.volume.metadata.name)).toEqual([
            'pvc-1',
            'pvc-2',
            'pvc-3',
        ]);
    });
});

describe('counts', () => {
    test('every bucket is reported, including the empty ones', () => {
        expect(counts(volumes)).toEqual([
            { bucket: 'faulted', count: 1 },
            { bucket: 'degraded', count: 1 },
            { bucket: 'in progress', count: 0 },
            { bucket: 'healthy', count: 0 },
            { bucket: 'detached', count: 1 },
        ]);
    });
});
