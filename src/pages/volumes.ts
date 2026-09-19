// The volume map: every volume as a card, coloured by how safe its data is.
//
// One card holds everything you would otherwise open four resources to learn:
// what the volume is for (the PVC and the workload), where it is attached, how
// much of it has been written, and a pill per replica in the mode the *engine*
// has it in -- RW being read and written, WO being copied into, ERR given up
// on. A replica being rebuilt carries its own progress bar, because "degraded"
// on its own does not tell you whether to wait or to go and look.

import { percent, size } from '../model/capacity.js';
import { ALL, apply, namespaces, SORTS, type Query, type Sort } from '../model/filter.js';
import { ENGINES, REPLICAS, VOLUMES, bytes, type Engine, type Replica, type Volume } from '../model/longhorn.js';
import {
    attachment,
    compose,
    fullness,
    health,
    HEALTH_BUCKETS,
    healthyReplicas,
    replicaViews,
    schedulingProblem,
    type HealthBucket,
    type ReplicaView,
    type VolumeView,
} from '../model/volume.js';
import { byId, el, replace } from '../ui/dom.js';
import { every, focused, since, start } from '../ui/page.js';
import { heading, nothing, pill, progress, stack } from '../ui/parts.js';

const REFRESH = 8_000;

let query: Query = { ...ALL };
let latest: VolumeView[] = [];
/** Set when the page was opened on one volume, from a search hit or the app. */
let single = '';

start('page', async (ctx) => {
    replace(byId('head'), heading('Volume map', `Every Longhorn volume in ${ctx.contextName}, worst first.`));

    single = focused().name;
    if (single) query = { ...query, text: single };
    else query = { ...query, ...(await remembered()) };

    const failure = el('p', { class: 'refresh-failure' });
    const grid = byId('grid');

    const stop = every(
        REFRESH,
        async () => {
            const [volumes, engines, replicas] = await Promise.all([
                k8sdockside.list<Volume>({ kind: VOLUMES }),
                k8sdockside.list<Engine>({ kind: ENGINES }),
                k8sdockside.list<Replica>({ kind: REPLICAS }),
            ]);
            failure.textContent = '';
            document.getElementById('first')?.remove();
            latest = compose(volumes, engines, replicas);
            // The toolbar is drawn once and left alone: redrawing it every
            // eight seconds would take the search box out from under whoever
            // is typing in it.
            if (!document.getElementById('shown')) drawToolbar(failure, ctx);
            drawGrid(grid);
            updateCount();
        },
        (err) => {
            failure.textContent = err instanceof Error ? err.message : String(err);
        },
    );
    addEventListener('pagehide', stop);
});

/** The filter the dashboard's ring asked for, or the one from last time. */
async function remembered(): Promise<Partial<Query>> {
    const store = k8sdockside.storage;
    if (!store) return {};
    try {
        const picked = await store.get<string>('map-bucket');
        if (picked) {
            await store.remove('map-bucket');
            if ((HEALTH_BUCKETS as readonly string[]).includes(picked)) return { bucket: picked as HealthBucket };
        }
        const sort = await store.get<Sort>('map-sort');
        return sort ? { sort } : {};
    } catch {
        return {};
    }
}

function remember(): void {
    void k8sdockside.storage?.set('map-sort', query.sort).catch(() => {});
}

function drawToolbar(failure: HTMLElement, ctx: K8sDockside.Context): void {
    const shown = apply(latest, query).length;

    const search = el('input', {
        type: 'search',
        placeholder: 'volume, PVC, workload, node…',
        'aria-label': 'Search volumes',
        value: query.text,
    }) as HTMLInputElement;
    search.addEventListener('input', () => {
        query = { ...query, text: search.value };
        redraw();
    });

    const bucket = select(
        'Health',
        [{ value: '', label: 'Any health' }, ...HEALTH_BUCKETS.map((b) => ({ value: b, label: b }))],
        query.bucket,
        (value) => {
            query = { ...query, bucket: value as HealthBucket | '' };
            redraw();
        },
    );

    const namespace = select(
        'Namespace',
        [{ value: '', label: 'Any namespace' }, ...namespaces(latest).map((ns) => ({ value: ns, label: ns }))],
        query.namespace,
        (value) => {
            query = { ...query, namespace: value };
            redraw();
        },
    );

    const sort = select(
        'Order',
        SORTS.map((s) => ({ value: s.id, label: s.label })),
        query.sort,
        (value) => {
            query = { ...query, sort: value as Sort };
            remember();
            redraw();
        },
    );

    replace(
        byId('toolbar'),
        el(
            'div',
            { class: 'bar' },
            search,
            bucket,
            namespace,
            sort,
            el('span', { class: 'spacer' }),
            el('span', { class: 'count', id: 'shown' }, countText(shown)),
        ),
        failure,
        ctx.write ? null : el('p', { class: 'note faint' }, 'This plugin may not change anything in this cluster.'),
    );
}

/** The grid and the count, after the query has changed. */
function redraw(): void {
    drawGrid(byId('grid'));
    updateCount();
}

function updateCount(): void {
    const shown = document.getElementById('shown');
    if (shown) shown.textContent = countText(apply(latest, query).length);
}

function countText(shown: number): string {
    return shown === latest.length ? `${shown} volumes` : `${shown} of ${latest.length} volumes`;
}

function select(
    label: string,
    options: { value: string; label: string }[],
    chosen: string,
    onPick: (value: string) => void,
): HTMLElement {
    const node = el('select', { 'aria-label': label }) as HTMLSelectElement;
    for (const option of options) {
        const item = el('option', { value: option.value }, option.label) as HTMLOptionElement;
        if (option.value === chosen) item.selected = true;
        node.append(item);
    }
    node.addEventListener('change', () => onPick(node.value));
    return node;
}

function drawGrid(host: HTMLElement): void {
    const shown = apply(latest, query);
    if (shown.length === 0) {
        replace(
            host,
            nothing(
                latest.length === 0
                    ? 'Longhorn has no volumes in this cluster yet.'
                    : 'No volume matches what you are looking for.',
            ),
        );
        return;
    }
    replace(host, ...shown.map(card));
}

function card(view: VolumeView): HTMLElement {
    const volume = view.volume;
    const { word, tone } = health(volume);
    const where = attachment(volume);
    const { used, size: total } = fullness(volume);
    const { ready, wanted } = healthyReplicas(view);
    const replicas = replicaViews(view);
    const problem = schedulingProblem(volume);

    const open = () =>
        void k8sdockside.open({
            kind: VOLUMES,
            namespace: volume.metadata.namespace ?? '',
            name: volume.metadata.name,
        });

    const name = el('button', { class: 'card-name', title: volume.metadata.name }, volume.metadata.name);
    name.addEventListener('click', open);

    return el(
        'article',
        { class: `card tone-edge-${tone || 'none'}` },
        el('header', { class: 'card-head' }, el('span', { class: `dot dot-${tone || 'none'}` }), name, pill(word, tone)),
        el(
            'p',
            { class: 'card-for' },
            where.pvc ? el('span', { class: 'card-pvc', title: 'the claim this volume answers' }, where.pvc) : el('span', { class: 'faint' }, 'no claim'),
            where.workloads.length ? el('span', { class: 'card-workload' }, where.workloads.join(', ')) : null,
        ),
        el(
            'div',
            { class: 'card-size' },
            stack([{ label: 'Written', bytes: used, tone: 'info' }], total || 1),
            el(
                'p',
                { class: 'card-numbers' },
                el('span', {}, `${size(used)} of ${size(total)}`),
                el('span', { class: 'faint' }, total > 0 ? `${percent(used, total).toFixed(0)}%` : ''),
            ),
        ),
        el(
            'div',
            { class: 'card-replicas' },
            el('span', { class: 'card-label' }, `${ready}/${wanted} replicas`),
            ...replicas.map(replicaPill),
        ),
        ...rebuildBars(view),
        problem ? el('p', { class: 'card-problem' }, problem) : null,
        el(
            'p',
            { class: 'card-foot' },
            el('span', { class: 'faint' }, where.node ? `on ${where.node}` : 'not attached'),
            el('span', { class: 'faint' }, `${since(volume.metadata.creationTimestamp)} old`),
            bytes(volume.spec?.size) > 0 && volume.spec?.dataEngine ? el('span', { class: 'faint' }, volume.spec.dataEngine) : null,
        ),
    );
}

function replicaPill(replica: ReplicaView): HTMLElement {
    const node = replica.node || 'no node';
    const detail = replica.rebuild === undefined ? '' : ` · rebuilding ${replica.rebuild.toFixed(0)}%`;
    return pill(replica.mode, replica.tone, `${replica.name}\non ${node}${replica.disk ? `, disk ${replica.disk}` : ''}${detail}`);
}

function rebuildBars(view: VolumeView): HTMLElement[] {
    return replicaViews(view)
        .filter((replica) => replica.rebuild !== undefined)
        .map((replica) =>
            el(
                'div',
                { class: 'card-rebuild' },
                el('span', { class: 'card-label' }, `rebuilding on ${replica.node || 'a node'}`),
                progress(replica.rebuild ?? 0),
                el('span', { class: 'card-percent' }, `${(replica.rebuild ?? 0).toFixed(0)}%`),
            ),
        );
}
