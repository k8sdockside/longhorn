// Nodes and their disks: where the replicas actually are, and what is left.
//
// The bar under each disk is the one thing here worth being careful about.
// Longhorn reports four numbers per disk and they overlap (see
// model/capacity.ts), so the bar is drawn from the two that do not -- what is
// on the filesystem and what the operator holds back -- and what Longhorn has
// *promised* is a pin over it. A disk whose pin sits past the end of the bar
// is over-committed: the replicas on it are allowed to grow into space that
// is not there.
//
// The buttons are the plugin's own manifest actions, and the app asks before
// running any of them. Which one is offered is decided from the node's spec
// rather than by asking the app, so a page with twenty nodes makes no extra
// calls at all.

import { nodeView, percent, size, type DiskView, type NodeView } from '../model/capacity.js';
import { NODES, type LonghornNode } from '../model/longhorn.js';
import { byId, button, el, replace } from '../ui/dom.js';
import { every, start } from '../ui/page.js';
import { heading, nothing, pill, stack, stackLegend } from '../ui/parts.js';

const REFRESH = 10_000;

start('page', async (ctx) => {
    replace(byId('head'), heading('Nodes & disks', `Where Longhorn keeps replicas in ${ctx.contextName}.`));

    const body = byId('body');
    const failure = el('p', { class: 'refresh-failure' });

    const stop = every(
        REFRESH,
        async () => {
            const nodes = await k8sdockside.list<LonghornNode>({ kind: NODES });
            failure.textContent = '';
            document.getElementById('first')?.remove();
            const views = nodes.map(nodeView).sort((a, b) => a.name.localeCompare(b.name));
            replace(body, failure, ...(views.length ? views.map((view) => nodeCard(view, ctx)) : [nothing('Longhorn reports no nodes in this cluster.')]));
        },
        (err) => {
            failure.textContent = err instanceof Error ? err.message : String(err);
        },
    );
    addEventListener('pagehide', stop);
});

function nodeCard(view: NodeView, ctx: K8sDockside.Context): HTMLElement {
    const ref = { kind: NODES, namespace: view.node.metadata.namespace ?? '', name: view.name };
    const name = el('button', { class: 'card-name' }, view.name);
    name.addEventListener('click', () => void k8sdockside.open(ref));

    const total = view.total;
    const free = Math.max(0, total.maximum - total.used - total.reserved);
    const segments = [
        { label: 'Used', bytes: total.used, tone: 'info' as const },
        { label: 'Reserved', bytes: total.reserved, tone: '' as const },
        { label: 'Free', bytes: free, tone: 'ok' as const },
    ];

    return el(
        'section',
        { class: `block node-card tone-edge-${view.tone || 'none'}` },
        el(
            'header',
            { class: 'card-head' },
            el('span', { class: `dot dot-${view.tone || 'none'}` }),
            name,
            pill(view.word, view.tone),
            view.zone ? pill(view.zone, '', 'the zone Longhorn places replicas by') : null,
            el('span', { class: 'spacer' }),
            el('span', { class: 'faint' }, `${view.replicas} replica${view.replicas === 1 ? '' : 's'} · ${view.disks.length} disk${view.disks.length === 1 ? '' : 's'}`),
        ),
        view.problem ? el('p', { class: 'card-problem' }, view.problem) : null,
        total.maximum > 0 ? stack(segments, total.maximum, { at: total.reserved + total.scheduled, label: 'Scheduled' }) : null,
        total.maximum > 0
            ? stackLegend(segments, [{ label: 'Scheduled', bytes: total.scheduled, tone: 'warn' }])
            : nothing('No disk on this node has reported its size.'),
        ...view.disks.map(diskRow),
        ...(ctx.write ? [actions(view, ref)] : []),
    );
}

function diskRow(disk: DiskView): HTMLElement {
    const free = Math.max(0, disk.maximum - disk.used - disk.reserved);
    const segments = [
        { label: 'Used', bytes: disk.used, tone: 'info' as const },
        { label: 'Reserved', bytes: disk.reserved, tone: '' as const },
        { label: 'Free', bytes: free, tone: 'ok' as const },
    ];
    const over = disk.maximum > 0 && disk.reserved + disk.scheduled > disk.maximum;

    return el(
        'div',
        { class: 'disk' },
        el(
            'div',
            { class: 'disk-head' },
            el('span', { class: `dot dot-${disk.tone || 'none'}` }),
            el('span', { class: 'disk-name' }, disk.name),
            el('span', { class: 'disk-path mono' }, disk.path || '—'),
            disk.status.diskType ? pill(disk.status.diskType, '', 'the disk type Longhorn treats this as') : null,
            el('span', { class: 'spacer' }),
            el('span', { class: 'faint' }, `${disk.replicas} replica${disk.replicas === 1 ? '' : 's'}`),
        ),
        disk.maximum > 0 ? stack(segments, disk.maximum, { at: disk.reserved + disk.scheduled, label: 'Scheduled' }) : null,
        el(
            'p',
            { class: 'disk-numbers' },
            el('span', {}, `${size(disk.used)} used of ${size(disk.maximum)}`),
            el('span', { class: 'faint' }, `${size(disk.scheduled)} promised`),
            el('span', { class: 'faint' }, `${size(disk.schedulable)} still schedulable`),
            disk.maximum > 0 ? el('span', { class: 'faint' }, `${percent(disk.used, disk.maximum).toFixed(0)}% full`) : null,
        ),
        over
            ? el('p', { class: 'card-problem' }, 'over-committed: the replicas here are promised more room than the disk has')
            : null,
        disk.problem ? el('p', { class: 'card-problem' }, disk.problem) : null,
    );
}

/**
 * The manifest's actions on this node, the ones that make sense for the state
 * it is in. Running one asks the user first, in a dialog this page cannot
 * reach or answer.
 */
function actions(view: NodeView, ref: { kind: string; namespace: string; name: string }): HTMLElement {
    const run = (id: string) => () => {
        void k8sdockside.run(id, { namespace: ref.namespace, name: ref.name }).catch(() => {});
    };
    const row = el('div', { class: 'card-actions' });

    if (view.allowScheduling) {
        row.append(button('Disable scheduling', run('disable-scheduling')));
    } else {
        row.append(button('Enable scheduling', run('enable-scheduling')));
        if (view.node.spec?.evictionRequested !== true) row.append(button('Evict replicas', run('request-eviction')));
    }
    if (view.node.spec?.evictionRequested === true) row.append(button('Cancel eviction', run('cancel-eviction')));

    row.append(
        button('Open node', () => void k8sdockside.open({ kind: 'nodes', name: view.name })),
        button('Edit YAML', () => void k8sdockside.edit(ref)),
    );
    return row;
}
