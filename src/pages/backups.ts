// Data protection: the backup target, what is on it, and what is not.
//
// The question this page exists to answer is the one the Longhorn UI makes you
// piece together from three screens: which volumes are *not* backed up. So the
// table is built from the volumes rather than from the backups, and a volume
// with no BackupVolume at all is a row at the top rather than an absence
// nobody notices.

import { size } from '../model/capacity.js';
import {
    BACKUPS,
    BACKUP_TARGETS,
    BACKUP_VOLUMES,
    RECURRING_JOBS,
    VOLUMES,
    bytes,
    condition,
    type Backup,
    type BackupTarget,
    type BackupVolume,
    type RecurringJob,
    type Volume,
} from '../model/longhorn.js';
import { freshnessTone, protection, protectionCounts, type Protection } from '../model/protect.js';
import { byId, el, replace } from '../ui/dom.js';
import { every, maybeList, since, start } from '../ui/page.js';
import { block, facts, heading, nothing, pill, ring, stat, type Slice } from '../ui/parts.js';

const REFRESH = 20_000;

start('page', async (ctx) => {
    replace(byId('head'), heading('Data protection', `Backups and recurring jobs in ${ctx.contextName}.`));

    const body = byId('body');
    const failure = el('p', { class: 'refresh-failure' });

    const stop = every(
        REFRESH,
        async () => {
            const [volumes, targets, backupVolumes, backups, jobs] = await Promise.all([
                k8sdockside.list<Volume>({ kind: VOLUMES }),
                maybeList<BackupTarget>({ kind: BACKUP_TARGETS }),
                maybeList<BackupVolume>({ kind: BACKUP_VOLUMES }),
                maybeList<Backup>({ kind: BACKUPS }),
                maybeList<RecurringJob>({ kind: RECURRING_JOBS }),
            ]);
            failure.textContent = '';
            document.getElementById('first')?.remove();
            const covered = protection(volumes, backupVolumes);
            replace(
                body,
                failure,
                summary(covered, backups),
                ...targetBlocks(targets),
                jobsBlock(jobs),
                coverBlock(covered),
                runningBlock(backups),
            );
        },
        (err) => {
            failure.textContent = err instanceof Error ? err.message : String(err);
        },
    );
    addEventListener('pagehide', stop);
});

function summary(covered: Protection[], backups: Backup[]): HTMLElement {
    const slices: Slice[] = protectionCounts(covered).map(({ bucket, count }) => ({
        label: bucket === 'never' ? 'never backed up' : bucket,
        count,
        tone: freshnessTone(bucket),
    }));
    const stored = covered.reduce((n, p) => n + p.stored, 0);
    const running = backups.filter((b) => ['InProgress', 'Pending', 'New'].includes(b.status?.state ?? '')).length;

    return el(
        'div',
        { class: 'rings' },
        ring('Backup cover', slices, { unit: 'volumes' }),
        el(
            'div',
            { class: 'stats stats-column' },
            stat('Backups', String(backups.length), running ? `${running} running now` : 'none running'),
            stat('Stored', size(stored), 'as Longhorn counts it on the target'),
            stat(
                'Unprotected',
                String(covered.filter((p) => p.freshness === 'never').length),
                'volumes with no backup at all',
                covered.some((p) => p.freshness === 'never') ? 'warn' : '',
            ),
        ),
    );
}

function targetBlocks(targets: BackupTarget[]): HTMLElement[] {
    if (targets.length === 0) {
        return [
            block(
                'Backup target',
                'Longhorn has no backup target in this cluster, so nothing is being backed up.',
                nothing('Set one under Longhorn’s settings: an S3 bucket or an NFS share.'),
            ),
        ];
    }
    return targets.map((target) => {
        const url = target.spec?.backupTargetURL ?? '';
        const available = target.status?.available === true;
        const unavailable = condition(target.status?.conditions, 'Unavailable');
        return block(
            `Backup target · ${target.metadata.name}`,
            '',
            facts([
                ['Address', el('span', { class: 'mono' }, url || 'not configured')],
                [
                    'Reachable',
                    url
                        ? pill(available ? 'yes' : 'no', available ? 'ok' : 'error', unavailable?.message ?? '')
                        : pill('not configured', ''),
                ],
                ['Last synced', since(target.status?.lastSyncedAt)],
                ['Polled every', target.spec?.pollInterval ?? '—'],
                ['Credentials', target.spec?.credentialSecret || 'none'],
            ]),
            unavailable && unavailable.status === 'True' && unavailable.message
                ? el('p', { class: 'card-problem' }, unavailable.message)
                : null,
        );
    });
}

function jobsBlock(jobs: RecurringJob[]): HTMLElement {
    if (jobs.length === 0) {
        return block(
            'Recurring jobs',
            'Nothing is scheduled: every snapshot and backup in this cluster is being taken by hand.',
            nothing('A recurring job is what keeps the ages in the table below small.'),
        );
    }
    const rows = jobs
        .slice()
        .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
        .map((job) =>
            el(
                'tr',
                {},
                el('td', {}, el('strong', {}, job.metadata.name)),
                el('td', {}, pill(job.spec?.task ?? 'snapshot', job.spec?.task?.startsWith('backup') ? 'info' : '')),
                el('td', { class: 'mono' }, job.spec?.cron ?? '—'),
                el('td', {}, `keeps ${job.spec?.retain ?? 0}`),
                el('td', {}, (job.spec?.groups ?? []).join(', ') || 'by label'),
                el('td', { class: 'faint' }, `${job.status?.executionCount ?? 0} runs`),
            ),
        );
    return block(
        'Recurring jobs',
        'A job runs against the volumes in its groups, or the ones labelled for it.',
        el(
            'table',
            {},
            el(
                'thead',
                {},
                el(
                    'tr',
                    {},
                    el('th', {}, 'Job'),
                    el('th', {}, 'Task'),
                    el('th', {}, 'Schedule'),
                    el('th', {}, 'Retention'),
                    el('th', {}, 'Applies to'),
                    el('th', {}, ''),
                ),
            ),
            el('tbody', {}, ...rows),
        ),
    );
}

function coverBlock(covered: Protection[]): HTMLElement {
    if (covered.length === 0) {
        return block('Volumes', '', nothing('There are no volumes to protect.'));
    }
    const rows = covered.map((entry) => {
        const row = el(
            'tr',
            { class: 'clickable' },
            el(
                'td',
                {},
                el('span', { class: `dot dot-${freshnessTone(entry.freshness) || 'none'}` }),
                el('strong', {}, entry.volume),
            ),
            el('td', {}, entry.freshness === 'never' ? el('span', { class: 'tone-warn' }, 'never backed up') : el('span', {}, `${since(entry.lastBackupAt)} ago`)),
            el('td', { class: 'mono faint' }, entry.lastBackupName || '—'),
            el('td', {}, entry.stored > 0 ? size(entry.stored) : '—'),
            el('td', {}, size(entry.size)),
        );
        if (entry.backupVolume) {
            row.addEventListener('click', () =>
                void k8sdockside.open({ kind: BACKUP_VOLUMES, namespace: entry.namespace, name: entry.backupVolume }),
            );
        } else {
            row.addEventListener('click', () =>
                void k8sdockside.open({ kind: VOLUMES, namespace: entry.namespace, name: entry.volume }),
            );
        }
        return row;
    });

    return block(
        'Every volume, and when it was last backed up',
        'Worst first. A row opens the backup, or the volume when there is no backup to open.',
        el(
            'table',
            {},
            el(
                'thead',
                {},
                el(
                    'tr',
                    {},
                    el('th', {}, 'Volume'),
                    el('th', {}, 'Last backup'),
                    el('th', {}, 'Name'),
                    el('th', {}, 'Stored'),
                    el('th', {}, 'Volume size'),
                ),
            ),
            el('tbody', {}, ...rows),
        ),
    );
}

/** What is being copied to the target right now, if anything is. */
function runningBlock(backups: Backup[]): HTMLElement | null {
    const running = backups
        .filter((backup) => ['InProgress', 'Pending', 'New'].includes(backup.status?.state ?? ''))
        .sort((a, b) => (b.status?.progress ?? 0) - (a.status?.progress ?? 0));
    const failed = backups.filter((backup) => (backup.status?.state ?? '') === 'Error');
    if (running.length === 0 && failed.length === 0) return null;

    const rows = [...running, ...failed].map((backup) =>
        el(
            'tr',
            {},
            el('td', {}, el('strong', {}, backup.status?.volumeName || backup.metadata.name)),
            el('td', {}, pill(backup.status?.state ?? '—', (backup.status?.state ?? '') === 'Error' ? 'error' : 'warn')),
            el('td', {}, `${(backup.status?.progress ?? 0).toFixed(0)}%`),
            el('td', {}, size(bytes(backup.status?.size))),
            el('td', { class: 'faint' }, backup.status?.error || since(backup.status?.snapshotCreatedAt)),
        ),
    );
    return block(
        'Backups in flight',
        'What is being copied to the target now, and what failed on the way.',
        el('table', {}, el('tbody', {}, ...rows)),
    );
}
