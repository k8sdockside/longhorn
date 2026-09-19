// The dashboard: the three questions you open Longhorn for.
//
//   Is anything degraded?      the volume ring
//   Is any node or disk out?   the node and disk rings
//   Am I running out of room?  the storage bar
//
// Longhorn's own dashboard answers them in that order and so does this one.
// Underneath is the list the rings cannot give you: which volume, which disk,
// and why, in a sentence, with a row that opens the object in the app.

import { issues } from '../model/attention.js';
import { capacityOf, nodeView, percent, size, type DiskView, type NodeView } from '../model/capacity.js';
import { counts } from '../model/filter.js';
import { BACKUP_TARGETS, ENGINES, NODES, REPLICAS, VOLUMES, type BackupTarget, type Engine, type LonghornNode, type Replica, type Volume } from '../model/longhorn.js';
import { bucketTone, compose, rebuilds, type VolumeView } from '../model/volume.js';
import { byId, button, el, replace } from '../ui/dom.js';
import { every, maybeList, start } from '../ui/page.js';
import { block, heading, nothing, ring, stack, stackLegend, stat, type Slice } from '../ui/parts.js';

const REFRESH = 10_000;

start('page', async (ctx) => {
    replace(
        byId('head'),
        heading('Longhorn', `Distributed block storage in ${ctx.contextName}.`),
    );

    // Whether Longhorn is in this cluster at all is the app's own question to
    // answer -- `summary()` is the generated overview's data -- and it is
    // worth answering before drawing a dashboard of zeroes.
    const summary = await k8sdockside.summary();
    const missing = summary.requirements.filter((req) => !req.optional && !req.served);
    if (summary.checked && missing.length > 0) {
        document.getElementById('first')?.remove();
        replace(
            byId('body'),
            block(
                'Longhorn is not installed here',
                `${ctx.contextName} does not serve ${missing.map((m) => m.label || m.kind).join(', ')}. The plugin stays out of the way until it does.`,
                el(
                    'p',
                    { class: 'links' },
                    button('How to install Longhorn', () => void k8sdockside.openUrl('https://longhorn.io/docs/latest/deploy/install/')),
                ),
            ),
        );
        return;
    }

    const body = byId('body');
    const failure = el('p', { class: 'refresh-failure' });

    const stop = every(
        REFRESH,
        async () => {
            const [volumes, engines, replicas, nodes, targets] = await Promise.all([
                k8sdockside.list<Volume>({ kind: VOLUMES }),
                k8sdockside.list<Engine>({ kind: ENGINES }),
                k8sdockside.list<Replica>({ kind: REPLICAS }),
                k8sdockside.list<LonghornNode>({ kind: NODES }),
                maybeList<BackupTarget>({ kind: BACKUP_TARGETS }),
            ]);
            failure.textContent = '';
            document.getElementById('first')?.remove();
            draw(body, compose(volumes, engines, replicas), nodes.map(nodeView), targets, failure);
        },
        (err) => {
            failure.textContent = err instanceof Error ? err.message : String(err);
        },
    );
    addEventListener('pagehide', stop);
});

function draw(host: HTMLElement, volumes: VolumeView[], nodes: NodeView[], targets: BackupTarget[], failure: HTMLElement): void {
    const disks = nodes.flatMap((node) => node.disks);
    const storage = capacityOf(disks);
    const attached = volumes.filter((v) => (v.volume.status?.state ?? '') === 'attached').length;
    const rebuilding = volumes.reduce((n, v) => n + rebuilds(v).length, 0);
    const problems = issues(volumes, nodes, targets);

    replace(
        host,
        failure,
        el(
            'div',
            { class: 'stats' },
            stat('Volumes', String(volumes.length), `${attached} attached`),
            stat(
                'Storage used',
                size(storage.used),
                storage.maximum > 0 ? `${percent(storage.used, storage.maximum).toFixed(0)}% of ${size(storage.maximum)}` : 'no disks yet',
                storage.maximum > 0 && percent(storage.used, storage.maximum) >= 85 ? 'warn' : '',
            ),
            stat('Nodes', String(nodes.length), `${nodes.filter((n) => n.ready).length} ready`, nodes.some((n) => !n.ready) ? 'error' : ''),
            stat('Replicas', String(nodes.reduce((n, node) => n + node.replicas, 0)), `on ${disks.length} disk${disks.length === 1 ? '' : 's'}`),
            stat('Rebuilding', String(rebuilding), rebuilding ? 'copying data now' : 'nothing is rebuilding', rebuilding ? 'warn' : ''),
        ),
        el(
            'div',
            { class: 'rings' },
            ring('Volumes', volumeSlices(volumes), { onPick: (label) => void openVolumeMap(label), unit: 'volumes' }),
            ring('Nodes', nodeSlices(nodes), { onPick: () => void k8sdockside.openView('node-map'), unit: 'nodes' }),
            ring('Disks', diskSlices(disks), { onPick: () => void k8sdockside.openView('node-map'), unit: 'disks' }),
        ),
        storageBlock(storage.maximum, storage),
        attentionBlock(problems),
    );
}

function volumeSlices(volumes: VolumeView[]): Slice[] {
    return counts(volumes).map(({ bucket, count }) => ({ label: bucket, count, tone: bucketTone(bucket) }));
}

function nodeSlices(nodes: NodeView[]): Slice[] {
    const tally = (word: string) => nodes.filter((node) => node.word === word).length;
    return [
        { label: 'down', count: tally('down'), tone: 'error' },
        { label: 'evicting', count: tally('evicting'), tone: 'warn' },
        { label: 'unschedulable', count: tally('unschedulable'), tone: 'warn' },
        { label: 'disabled', count: tally('disabled'), tone: '' },
        { label: 'schedulable', count: tally('schedulable'), tone: 'ok' },
    ];
}

function diskSlices(disks: DiskView[]): Slice[] {
    const tally = (test: (disk: DiskView) => boolean) => disks.filter(test).length;
    return [
        { label: 'not ready', count: tally((d) => !d.ready), tone: 'error' },
        { label: 'no room', count: tally((d) => d.ready && d.allowScheduling && !d.canSchedule), tone: 'warn' },
        { label: 'disabled', count: tally((d) => d.ready && !d.allowScheduling), tone: '' },
        { label: 'schedulable', count: tally((d) => d.ready && d.allowScheduling && d.canSchedule), tone: 'ok' },
    ];
}

/**
 * The cluster's disks as one bar.
 *
 * `used` and `reserved` do not overlap, and what is left is what Longhorn may
 * still schedule onto; the pin over the bar is what it has already promised,
 * which is the number that decides whether the next volume gets a replica.
 */
function storageBlock(total: number, storage: ReturnType<typeof capacityOf>): HTMLElement {
    if (total <= 0) {
        return block('Storage', 'No disk has reported its size yet.', nothing('Nothing to measure.'));
    }
    const free = Math.max(0, total - storage.used - storage.reserved);
    const segments = [
        { label: 'Used', bytes: storage.used, tone: 'info' as const },
        { label: 'Reserved', bytes: storage.reserved, tone: '' as const },
        { label: 'Free', bytes: free, tone: 'ok' as const },
    ];
    return block(
        'Storage',
        `${size(storage.used)} written of ${size(total)} across every disk Longhorn knows about. Longhorn has promised ${size(storage.scheduled)} to replicas, whether or not they have written it yet.`,
        stack(segments, total, { at: storage.reserved + storage.scheduled, label: 'Scheduled' }),
        stackLegend(segments, [{ label: 'Scheduled', bytes: storage.scheduled, tone: 'warn' }]),
    );
}

function attentionBlock(problems: ReturnType<typeof issues>): HTMLElement {
    if (problems.length === 0) {
        return block('Needs attention', '', nothing('Nothing is degraded, faulted, evicting or out of room.'));
    }
    const list = el('ul', { class: 'issues' });
    for (const issue of problems.slice(0, 20)) {
        const row = el(
            'li',
            { class: 'issue' },
            el('span', { class: `dot dot-${issue.tone || 'none'}` }),
            el('span', { class: 'issue-title' }, issue.title),
            el('span', { class: 'issue-detail' }, issue.detail),
        );
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        const open = () => void k8sdockside.open(issue.ref);
        row.addEventListener('click', open);
        row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                open();
            }
        });
        list.append(row);
    }
    return block(
        'Needs attention',
        problems.length > 20 ? `The worst 20 of ${problems.length}. Each row opens the object.` : 'Each row opens the object.',
        list,
    );
}

/** A ring slice is also a filter: open the map already narrowed to it. */
async function openVolumeMap(bucket: string): Promise<void> {
    await k8sdockside.storage?.set('map-bucket', bucket);
    await k8sdockside.openView('volume-map');
}
