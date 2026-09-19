import { describe, expect, test } from 'vitest';
import type { BackupVolume, Volume } from './longhorn.js';
import { DAY, freshness, protection, protectionCounts, volumeOf } from './protect.js';

const NOW = Date.parse('2026-09-19T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const volume = (name: string): Volume => ({
    metadata: { name, namespace: 'longhorn-system' },
    spec: { size: '1073741824' },
    status: { state: 'attached', robustness: 'healthy' },
});

const backupVolume = (name: string, lastBackupAt: string, over: BackupVolume['status'] = {}): BackupVolume => ({
    metadata: { name, namespace: 'longhorn-system' },
    status: { lastBackupAt, lastBackupName: `${name}-b1`, size: '1073741824', dataStored: '536870912', ...over },
});

describe('freshness', () => {
    test('a backup from the last day is recent, the last week stale, older old', () => {
        expect(freshness(ago(2 * 60 * 60 * 1000), NOW)).toBe('recent');
        expect(freshness(ago(3 * DAY), NOW)).toBe('stale');
        expect(freshness(ago(30 * DAY), NOW)).toBe('old');
    });

    test('no backup at all is its own answer, and so is a timestamp that makes no sense', () => {
        expect(freshness(undefined, NOW)).toBe('never');
        expect(freshness('', NOW)).toBe('never');
        expect(freshness('whenever', NOW)).toBe('never');
    });
});

describe('protection', () => {
    test('a volume with no backup is listed, and listed first', () => {
        const list = protection([volume('pvc-1'), volume('pvc-2')], [backupVolume('pvc-2', ago(60 * 1000))], NOW);
        expect(list.map((p) => [p.volume, p.freshness])).toEqual([
            ['pvc-1', 'never'],
            ['pvc-2', 'recent'],
        ]);
    });

    test('the worst are first, so the list is the to-do list', () => {
        const list = protection(
            [volume('a'), volume('b'), volume('c'), volume('d')],
            [
                backupVolume('a', ago(10 * 60 * 1000)),
                backupVolume('b', ago(40 * DAY)),
                backupVolume('c', ago(3 * DAY)),
            ],
            NOW,
        );
        expect(list.map((p) => p.volume)).toEqual(['d', 'b', 'c', 'a']);
    });

    test('Longhorn 1.7 names the BackupVolume after the target, and says the volume in its status', () => {
        const suffixed: BackupVolume = {
            metadata: { name: 'pvc-1-6dd2f1', namespace: 'longhorn-system' },
            status: { volumeName: 'pvc-1', lastBackupAt: ago(60 * 1000) },
        };
        expect(volumeOf(suffixed)).toBe('pvc-1');
        const list = protection([volume('pvc-1')], [suffixed], NOW);
        expect(list[0]!.freshness).toBe('recent');
        expect(list[0]!.backupVolume).toBe('pvc-1-6dd2f1');
    });

    test('with two targets the freshest copy is the one that counts', () => {
        const old: BackupVolume = {
            metadata: { name: 'pvc-1-old' },
            status: { volumeName: 'pvc-1', lastBackupAt: ago(30 * DAY) },
        };
        const fresh: BackupVolume = {
            metadata: { name: 'pvc-1-new' },
            status: { volumeName: 'pvc-1', lastBackupAt: ago(60 * 1000) },
        };
        expect(protection([volume('pvc-1')], [old, fresh], NOW)[0]!.freshness).toBe('recent');
        expect(protection([volume('pvc-1')], [fresh, old], NOW)[0]!.freshness).toBe('recent');
    });

    test('a backup for a volume that no longer exists is not invented into the list', () => {
        expect(protection([], [backupVolume('gone', ago(DAY))], NOW)).toEqual([]);
    });

    test('the counts cover every bucket', () => {
        const list = protection([volume('a'), volume('b')], [backupVolume('a', ago(60 * 1000))], NOW);
        expect(protectionCounts(list)).toEqual([
            { bucket: 'never', count: 1 },
            { bucket: 'old', count: 0 },
            { bucket: 'stale', count: 0 },
            { bucket: 'recent', count: 1 },
        ]);
    });
});
