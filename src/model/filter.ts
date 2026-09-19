// Narrowing and ordering the volume map.
//
// A cluster with four hundred volumes is the normal case, not the exceptional
// one, so the map is only useful with a search box over it. The rules are the
// ones a person means rather than the ones a machine would:
//
//   * the search matches the volume's name, the PVC and namespace behind it,
//     the workload using it and the node it is attached to -- everything the
//     card shows, so what you can read you can search for;
//   * "size" sorts biggest first, because you are looking for the big ones;
//   * "health" sorts worst first, which is the order the dashboard uses;
//   * name sorts A to Z, which is the only one that ever ties.

import { bytes } from './longhorn.js';
import { attachment, bucketOf, HEALTH_BUCKETS, type HealthBucket, type VolumeView } from './volume.js';

export type Sort = 'health' | 'name' | 'size' | 'used';

export const SORTS: { id: Sort; label: string }[] = [
    { id: 'health', label: 'Worst first' },
    { id: 'name', label: 'Name' },
    { id: 'size', label: 'Largest first' },
    { id: 'used', label: 'Most written' },
];

export interface Query {
    text: string;
    /** A bucket from HEALTH_BUCKETS, or '' for all of them. */
    bucket: HealthBucket | '';
    namespace: string;
    sort: Sort;
}

export const ALL: Query = { text: '', bucket: '', namespace: '', sort: 'health' };

/** Everything about a volume a search should be able to find it by. */
export function haystack(view: VolumeView): string {
    const volume = view.volume;
    const where = attachment(volume);
    const kube = volume.status?.kubernetesStatus;
    return [
        volume.metadata.name,
        kube?.pvcName ?? '',
        kube?.namespace ?? '',
        kube?.pvName ?? '',
        where.node,
        ...where.workloads,
        ...view.replicas.map((r) => r.spec?.nodeID ?? ''),
        volume.spec?.dataEngine ?? '',
        ...Object.keys(volume.metadata.labels ?? {}),
    ]
        .join(' ')
        .toLowerCase();
}

/** The namespaces volumes are used from, for the namespace picker. */
export function namespaces(views: VolumeView[]): string[] {
    const found = new Set<string>();
    for (const view of views) {
        const ns = view.volume.status?.kubernetesStatus?.namespace;
        if (ns) found.add(ns);
    }
    return [...found].sort();
}

/** How many volumes fall in each health bucket, in the dashboard's order. */
export function counts(views: VolumeView[]): { bucket: HealthBucket; count: number }[] {
    const tally = new Map<HealthBucket, number>(HEALTH_BUCKETS.map((b) => [b, 0]));
    for (const view of views) {
        const bucket = bucketOf(view.volume);
        tally.set(bucket, (tally.get(bucket) ?? 0) + 1);
    }
    return HEALTH_BUCKETS.map((bucket) => ({ bucket, count: tally.get(bucket) ?? 0 }));
}

/** Where a bucket comes in "worst first". */
function rank(view: VolumeView): number {
    return HEALTH_BUCKETS.indexOf(bucketOf(view.volume));
}

export function apply(views: VolumeView[], query: Query): VolumeView[] {
    const words = query.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out = views.filter((view) => {
        if (query.bucket && bucketOf(view.volume) !== query.bucket) return false;
        if (query.namespace && (view.volume.status?.kubernetesStatus?.namespace ?? '') !== query.namespace) return false;
        if (words.length === 0) return true;
        const hay = haystack(view);
        // Every word has to match something, so typing more narrows.
        return words.every((word) => hay.includes(word));
    });

    const byName = (a: VolumeView, b: VolumeView) => a.volume.metadata.name.localeCompare(b.volume.metadata.name);
    switch (query.sort) {
        case 'name':
            return out.sort(byName);
        case 'size':
            return out.sort((a, b) => bytes(b.volume.spec?.size) - bytes(a.volume.spec?.size) || byName(a, b));
        case 'used':
            return out.sort(
                (a, b) => bytes(b.volume.status?.actualSize) - bytes(a.volume.status?.actualSize) || byName(a, b),
            );
        default:
            return out.sort((a, b) => rank(a) - rank(b) || byName(a, b));
    }
}
