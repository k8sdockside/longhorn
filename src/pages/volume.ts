// The panel on a Longhorn Volume: its replicas, one row each, and the engine.
//
// A Volume's YAML says how many replicas it wants; it does not say where they
// are or which of them the engine is actually reading. That lives on the
// Engine and on the Replicas, which is three more resources to open by hand --
// so the panel opens them, and puts the answer in one table: the node, the
// disk, the mode, and a bar for anything being copied.

import { size } from '../model/capacity.js';
import { ENGINES, REPLICAS, bytes, type Engine, type Replica, type Volume } from '../model/longhorn.js';
import { compose, health, healthyReplicas, replicaViews, type ReplicaView } from '../model/volume.js';
import { byId, el, replace } from '../ui/dom.js';
import { every, since, start } from '../ui/page.js';
import { facts, nothing, pill, progress } from '../ui/parts.js';

const REFRESH = 8_000;

start('page', async () => {
    const host = byId('page');
    const failure = el('p', { class: 'refresh-failure' });

    const stop = every(
        REFRESH,
        async () => {
            const volume = await k8sdockside.object<Volume>();
            const name = volume.metadata.name;
            const [engines, replicas] = await Promise.all([
                k8sdockside.list<Engine>({ kind: ENGINES }),
                k8sdockside.list<Replica>({ kind: REPLICAS }),
            ]);
            const view = compose(
                [volume],
                engines.filter((engine) => engine.spec?.volumeName === name),
                replicas.filter((replica) => replica.spec?.volumeName === name),
            )[0]!;

            const { word, tone } = health(volume);
            const { ready, wanted } = healthyReplicas(view);
            const rows = replicaViews(view);

            replace(
                host,
                failure,
                el(
                    'div',
                    { class: 'panel-head' },
                    el('span', { class: `dot dot-${tone || 'none'}` }),
                    el('strong', {}, `${ready} of ${wanted} replicas`),
                    pill(word, tone),
                    el('span', { class: 'spacer' }),
                    el('span', { class: 'faint' }, view.engine?.status?.endpoint ?? ''),
                ),
                rows.length === 0
                    ? nothing('This volume has no replicas. Longhorn could not place any, or they are being deleted.')
                    : el(
                          'table',
                          {},
                          el(
                              'thead',
                              {},
                              el(
                                  'tr',
                                  {},
                                  el('th', {}, 'Replica'),
                                  el('th', {}, 'Node'),
                                  el('th', {}, 'Disk'),
                                  el('th', {}, 'Mode'),
                                  el('th', {}, 'State'),
                                  el('th', {}, ''),
                              ),
                          ),
                          el('tbody', {}, ...rows.map((replica) => replicaRow(replica, name))),
                      ),
                view.engine
                    ? facts([
                          ['Engine', view.engine.metadata.name],
                          ['State', view.engine.status?.currentState ?? '—'],
                          ['Image', view.engine.status?.currentImage ?? '—'],
                          ['On node', view.engine.spec?.nodeID ?? '—'],
                      ])
                    : el('p', { class: 'note faint' }, 'No engine is running for this volume, which is normal while it is detached.'),
            );

        },
        (err) => {
            failure.textContent = err instanceof Error ? err.message : String(err);
        },
    );
    addEventListener('pagehide', stop);
});

/** One replica, as a row that opens it. */
function replicaRow(replica: ReplicaView, volume: string): HTMLElement {
    const row = el(
        'tr',
        { class: 'clickable' },
        el('td', { class: 'mono' }, shorten(replica.name, volume)),
        el('td', {}, replica.node || '—'),
        el('td', { class: 'mono faint', title: replica.replica.spec?.diskPath ?? '' }, replica.disk || '—'),
        el('td', {}, pill(replica.mode, replica.tone)),
        el(
            'td',
            { class: 'faint' },
            replica.failed ? `failed ${since(replica.replica.spec?.failedAt)} ago` : (replica.replica.status?.currentState ?? '—'),
        ),
        el(
            'td',
            {},
            replica.rebuild === undefined
                ? el('span', { class: 'faint' }, size(bytes(replica.replica.spec?.volumeSize)))
                : progress(replica.rebuild),
        ),
    );
    row.addEventListener('click', () =>
        void k8sdockside.open({
            kind: REPLICAS,
            namespace: replica.replica.metadata.namespace ?? '',
            name: replica.name,
        }),
    );
    return row;
}

/** `pvc-abc-r-1f2e3d` under the volume `pvc-abc` reads as `r-1f2e3d`. */
function shorten(replica: string, volume: string): string {
    return replica.startsWith(`${volume}-`) ? replica.slice(volume.length + 1) : replica;
}
