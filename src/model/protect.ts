// How well protected the data is: which volumes have a recent backup, which
// have an old one, and which have none at all.
//
// Longhorn keeps one BackupVolume per volume that has ever been backed up, so
// the interesting set is the difference: a volume with no BackupVolume has
// never been backed up, which is the thing worth saying out loud. Up to
// Longhorn 1.6 the BackupVolume was named after the volume; from 1.7, with a
// backup target per volume, the name carries a suffix and the volume's name is
// in the spec or the status instead. Both are read, oldest form last.

import type { BackupVolume, Volume } from './longhorn.js';
import { bytes } from './longhorn.js';
import type { Tone } from './volume.js';

export type Freshness = 'recent' | 'stale' | 'old' | 'never';

export const DAY = 24 * 60 * 60 * 1000;
/** A backup from the last day is recent; from the last week, stale; older, old. */
export const RECENT = DAY;
export const STALE = 7 * DAY;

export interface Protection {
    volume: string;
    /** The BackupVolume this came from, for opening it. */
    backupVolume: string;
    namespace: string;
    lastBackupName: string;
    lastBackupAt: string;
    freshness: Freshness;
    /** Bytes the backups occupy, as Longhorn reports them. */
    stored: number;
    size: number;
}

export function freshness(lastBackupAt: string | undefined, now = Date.now()): Freshness {
    if (!lastBackupAt) return 'never';
    const then = Date.parse(lastBackupAt);
    if (Number.isNaN(then)) return 'never';
    const age = Math.max(0, now - then);
    if (age <= RECENT) return 'recent';
    if (age <= STALE) return 'stale';
    return 'old';
}

export function freshnessTone(value: Freshness): Tone {
    switch (value) {
        case 'recent':
            return 'ok';
        case 'stale':
            return 'warn';
        case 'old':
            return 'error';
        default:
            return '';
    }
}

/** The volume a BackupVolume is about, however this Longhorn writes it. */
export function volumeOf(backup: BackupVolume): string {
    return backup.status?.volumeName || backup.spec?.volumeName || backup.metadata.name;
}

/**
 * Every volume, with the backup that covers it -- including the volumes no
 * backup covers, which is the point of the list.
 */
export function protection(volumes: Volume[], backups: BackupVolume[], now = Date.now()): Protection[] {
    const byVolume = new Map<string, BackupVolume>();
    for (const backup of backups) {
        const name = volumeOf(backup);
        const current = byVolume.get(name);
        // Keep the one with the newest backup: a volume may have more than one
        // backup target, and it is the freshest copy that matters.
        if (!current || (backup.status?.lastBackupAt ?? '') > (current.status?.lastBackupAt ?? '')) {
            byVolume.set(name, backup);
        }
    }

    const out = volumes.map((volume) => {
        const backup = byVolume.get(volume.metadata.name);
        const lastBackupAt = backup?.status?.lastBackupAt ?? '';
        return {
            volume: volume.metadata.name,
            backupVolume: backup?.metadata.name ?? '',
            namespace: backup?.metadata.namespace ?? volume.metadata.namespace ?? '',
            lastBackupName: backup?.status?.lastBackupName ?? '',
            lastBackupAt,
            freshness: freshness(lastBackupAt || undefined, now),
            stored: bytes(backup?.status?.dataStored),
            size: bytes(backup?.status?.size ?? volume.spec?.size),
        };
    });

    const order: Freshness[] = ['never', 'old', 'stale', 'recent'];
    return out.sort(
        (a, b) => order.indexOf(a.freshness) - order.indexOf(b.freshness) || a.volume.localeCompare(b.volume),
    );
}

/** How many volumes fall in each bucket, worst first. */
export function protectionCounts(list: Protection[]): { bucket: Freshness; count: number }[] {
    const order: Freshness[] = ['never', 'old', 'stale', 'recent'];
    return order.map((bucket) => ({ bucket, count: list.filter((p) => p.freshness === bucket).length }));
}
