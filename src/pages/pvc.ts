// The panel on a PersistentVolumeClaim: the Longhorn volume behind it.
//
// A PVC tells you almost nothing about the storage under it -- a name, a size
// and a phase -- and the thing you actually want to know when you open one is
// whether its data is still on three nodes. That is one resource away, so this
// panel goes and gets it.
//
// The claim is matched to the volume by `spec.volumeName`: Longhorn names its
// Volume resource after the PV, which is the name the claim is bound to. A
// claim bound to something else, or bound to nothing yet, says so and stops.

import { size } from '../model/capacity.js';
import { ENGINES, REPLICAS, VOLUMES, type Engine, type Replica, type Volume } from '../model/longhorn.js';
import {
    attachment,
    compose,
    fullness,
    health,
    healthyReplicas,
    rebuilds,
    replicaViews,
    schedulingProblem,
} from '../model/volume.js';
import { byId, button, el, replace } from '../ui/dom.js';
import { every, start } from '../ui/page.js';
import { facts, nothing, pill, progress, stack } from '../ui/parts.js';

interface Claim extends K8sDockside.KubeObject {
    spec?: { volumeName?: string; storageClassName?: string; resources?: { requests?: { storage?: string } } };
    status?: { phase?: string };
}

const REFRESH = 15_000;

start('page', async () => {
    const host = byId('page');
    const failure = el('p', { class: 'refresh-failure' });

    const stop = every(
        REFRESH,
        async () => {
            const claim = await k8sdockside.object<Claim>();
            const pv = claim.spec?.volumeName ?? '';
            if (!pv) {
                replace(host, nothing(`${claim.metadata.name} is not bound to a volume yet.`));
                return;
            }

            const volumes = await k8sdockside.list<Volume>({ kind: VOLUMES });
            const volume = volumes.find((candidate) => candidate.metadata.name === pv);
            if (!volume) {
                replace(host, nothing(`${pv} is not a Longhorn volume.`));
                return;
            }

            const [engines, replicas] = await Promise.all([
                k8sdockside.list<Engine>({ kind: ENGINES }),
                k8sdockside.list<Replica>({ kind: REPLICAS }),
            ]);
            const view = compose(
                [volume],
                engines.filter((engine) => engine.spec?.volumeName === pv),
                replicas.filter((replica) => replica.spec?.volumeName === pv),
            )[0]!;

            const { word, tone } = health(volume);
            const where = attachment(volume);
            const { used, size: total } = fullness(volume);
            const { ready, wanted } = healthyReplicas(view);
            const problem = schedulingProblem(volume);

            replace(
                host,
                failure,
                el(
                    'div',
                    { class: 'panel-head' },
                    el('span', { class: `dot dot-${tone || 'none'}` }),
                    el('strong', {}, volume.metadata.name),
                    pill(word, tone),
                    el('span', { class: 'spacer' }),
                    button('Open volume', () =>
                        void k8sdockside.open({
                            kind: VOLUMES,
                            namespace: volume.metadata.namespace ?? '',
                            name: volume.metadata.name,
                        }),
                    ),
                    button('Volume map', () => void k8sdockside.openView('volume-map')),
                ),
                problem ? el('p', { class: 'card-problem' }, problem) : null,
                stack([{ label: 'Written', bytes: used, tone: 'info' }], total || 1),
                facts([
                    ['Written', `${size(used)} of ${size(total)}`],
                    ['Replicas', `${ready} of ${wanted} being read and written`],
                    ['Attached to', where.node || 'nothing'],
                    ['Used by', where.workloads.join(', ') || '—'],
                    ['Data locality', volume.spec?.dataLocality ?? '—'],
                    ['Access mode', volume.spec?.accessMode ?? '—'],
                ]),
                el(
                    'div',
                    { class: 'card-replicas' },
                    ...replicaViews(view).map((replica) =>
                        pill(replica.mode, replica.tone, `${replica.name}\non ${replica.node || 'no node'}`),
                    ),
                ),
                ...rebuilds(view).map((rebuild) =>
                    el(
                        'div',
                        { class: 'card-rebuild' },
                        el('span', { class: 'card-label' }, 'rebuilding'),
                        progress(rebuild.percent),
                        el('span', { class: 'card-percent' }, `${rebuild.percent.toFixed(0)}%`),
                    ),
                ),
            );
        },
        (err) => {
            failure.textContent = err instanceof Error ? err.message : String(err);
        },
    );
    addEventListener('pagehide', stop);
});
