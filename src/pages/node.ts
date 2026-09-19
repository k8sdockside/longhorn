// The panel on a Kubernetes Node: the disks Longhorn keeps there.
//
// Longhorn's Node resource has the same name as the Kubernetes one, which is
// the whole join. What it adds is what the Kubernetes Node cannot tell you:
// which paths Longhorn is using, how much of each it has promised away, and
// how many replicas are sitting on them right now.

import { nodeView, percent, size, type DiskView } from '../model/capacity.js';
import { NODES, type LonghornNode } from '../model/longhorn.js';
import { byId, button, el, replace } from '../ui/dom.js';
import { every, start } from '../ui/page.js';
import { facts, nothing, pill, stack } from '../ui/parts.js';

const REFRESH = 15_000;

start('page', async () => {
    const host = byId('page');
    const failure = el('p', { class: 'refresh-failure' });

    const stop = every(
        REFRESH,
        async () => {
            const kubeNode = await k8sdockside.object();
            const nodes = await k8sdockside.list<LonghornNode>({ kind: NODES });
            const found = nodes.find((node) => node.metadata.name === kubeNode.metadata.name);
            if (!found) {
                replace(host, nothing(`Longhorn does not manage storage on ${kubeNode.metadata.name}.`));
                return;
            }

            const view = nodeView(found);
            const total = view.total;
            const free = Math.max(0, total.maximum - total.used - total.reserved);

            replace(
                host,
                failure,
                el(
                    'div',
                    { class: 'panel-head' },
                    el('span', { class: `dot dot-${view.tone || 'none'}` }),
                    el('strong', {}, view.name),
                    pill(view.word, view.tone),
                    view.zone ? pill(view.zone, '') : null,
                    el('span', { class: 'spacer' }),
                    button('Longhorn node', () =>
                        void k8sdockside.open({
                            kind: NODES,
                            namespace: found.metadata.namespace ?? '',
                            name: view.name,
                        }),
                    ),
                    button('Nodes & disks', () => void k8sdockside.openView('node-map')),
                ),
                view.problem ? el('p', { class: 'card-problem' }, view.problem) : null,
                total.maximum > 0
                    ? stack(
                          [
                              { label: 'Used', bytes: total.used, tone: 'info' },
                              { label: 'Reserved', bytes: total.reserved, tone: '' },
                              { label: 'Free', bytes: free, tone: 'ok' },
                          ],
                          total.maximum,
                          { at: total.reserved + total.scheduled, label: 'Scheduled' },
                      )
                    : null,
                facts([
                    ['Storage', total.maximum > 0 ? `${size(total.used)} used of ${size(total.maximum)}` : 'no disk has reported'],
                    ['Promised', size(total.scheduled)],
                    ['Replicas', `${view.replicas} on ${view.disks.length} disk${view.disks.length === 1 ? '' : 's'}`],
                    ['Scheduling', view.allowScheduling ? 'allowed' : 'switched off'],
                ]),
                ...view.disks.map(diskLine),
            );
        },
        (err) => {
            failure.textContent = err instanceof Error ? err.message : String(err);
        },
    );
    addEventListener('pagehide', stop);
});

function diskLine(disk: DiskView): HTMLElement {
    return el(
        'div',
        { class: 'disk disk-compact' },
        el(
            'div',
            { class: 'disk-head' },
            el('span', { class: `dot dot-${disk.tone || 'none'}` }),
            el('span', { class: 'disk-name' }, disk.name),
            el('span', { class: 'disk-path mono' }, disk.path || '—'),
            el('span', { class: 'spacer' }),
            el(
                'span',
                { class: 'faint' },
                disk.maximum > 0
                    ? `${percent(disk.used, disk.maximum).toFixed(0)}% full · ${disk.replicas} replica${disk.replicas === 1 ? '' : 's'}`
                    : `${disk.replicas} replica${disk.replicas === 1 ? '' : 's'}`,
            ),
        ),
        disk.maximum > 0
            ? stack(
                  [
                      { label: 'Used', bytes: disk.used, tone: 'info' },
                      { label: 'Reserved', bytes: disk.reserved, tone: '' },
                      { label: 'Free', bytes: Math.max(0, disk.maximum - disk.used - disk.reserved), tone: 'ok' },
                  ],
                  disk.maximum,
                  { at: disk.reserved + disk.scheduled, label: 'Scheduled' },
              )
            : null,
        disk.problem ? el('p', { class: 'card-problem' }, disk.problem) : null,
    );
}
