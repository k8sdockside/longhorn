// The slices of Longhorn's custom resources these pages actually read.
//
// The bridge hands back whole objects typed only as K8sDockside.KubeObject,
// whose `spec` and `status` are `unknown`. Narrowing them here, once, is what
// makes the rest of src/ type-safe: a page says `list<Volume>(...)` and gets
// fields rather than casts.
//
// Only the fields the pages read are declared, and every one of them is
// optional: a resource Longhorn has not reconciled yet has no status at all,
// and a field added in a later Longhorn is simply absent in an older one.
// Longhorn serves longhorn.io/v1beta2; where v1beta1 wrote something
// differently it is noted.

/** The kinds this plugin reads, spelled as the app spells them. */
export const VOLUMES = 'crd:volumes.longhorn.io';
export const ENGINES = 'crd:engines.longhorn.io';
export const REPLICAS = 'crd:replicas.longhorn.io';
export const NODES = 'crd:nodes.longhorn.io';
export const SETTINGS = 'crd:settings.longhorn.io';
export const BACKUP_TARGETS = 'crd:backuptargets.longhorn.io';
export const BACKUP_VOLUMES = 'crd:backupvolumes.longhorn.io';
export const BACKUPS = 'crd:backups.longhorn.io';
export const RECURRING_JOBS = 'crd:recurringjobs.longhorn.io';

export interface Condition {
    type?: string;
    status?: string;
    reason?: string;
    message?: string;
    lastTransitionTime?: string;
}

/** What a volume's data is doing: Longhorn writes these lowercase. */
export type VolumeState = 'creating' | 'attached' | 'detached' | 'attaching' | 'detaching' | 'deleting' | string;

/** How safe the data is: the word Longhorn's own UI colours a volume by. */
export type Robustness = 'healthy' | 'degraded' | 'faulted' | 'unknown' | string;

export interface WorkloadStatus {
    podName?: string;
    podStatus?: string;
    workloadName?: string;
    workloadType?: string;
}

export interface KubernetesStatus {
    pvName?: string;
    pvStatus?: string;
    namespace?: string;
    pvcName?: string;
    lastPVCRefAt?: string;
    lastPodRefAt?: string;
    workloadsStatus?: WorkloadStatus[] | null;
}

export interface Volume extends K8sDockside.KubeObject {
    spec?: {
        /** Bytes, as a string: Longhorn stores sizes as quantities of bytes. */
        size?: string;
        numberOfReplicas?: number;
        nodeID?: string;
        frontend?: string;
        accessMode?: string;
        dataLocality?: string;
        dataEngine?: string;
        encrypted?: boolean;
        backingImage?: string;
        fromBackup?: string;
        staleReplicaTimeout?: number;
        replicaAutoBalance?: string;
        diskSelector?: string[] | null;
        nodeSelector?: string[] | null;
        migratable?: boolean;
        standby?: boolean;
    };
    status?: {
        state?: VolumeState;
        robustness?: Robustness;
        /** Bytes actually written, as a string. Smaller than spec.size for a thin volume. */
        actualSize?: string;
        currentNodeID?: string;
        pendingNodeID?: string;
        ownerID?: string;
        currentImage?: string;
        frontendDisabled?: boolean;
        restoreRequired?: boolean;
        expansionRequired?: boolean;
        lastBackup?: string;
        lastBackupAt?: string;
        lastDegradedAt?: string;
        conditions?: Condition[] | null;
        kubernetesStatus?: KubernetesStatus;
        cloneStatus?: { state?: string; sourceVolume?: string; snapshot?: string };
    };
}

/** The mode the engine has a replica in: read-write, write-only (rebuilding), or failed. */
export type ReplicaMode = 'RW' | 'WO' | 'ERR' | string;

export interface RebuildStatus {
    isRebuilding?: boolean;
    /** Percent, 0-100. */
    progress?: number;
    state?: string;
    error?: string;
    fromReplica?: string;
}

export interface Engine extends K8sDockside.KubeObject {
    spec?: {
        volumeName?: string;
        nodeID?: string;
        active?: boolean;
    };
    status?: {
        currentState?: string;
        endpoint?: string;
        currentImage?: string;
        started?: boolean;
        ownerID?: string;
        /** Replica name -> the mode the engine has it in. */
        replicaModeMap?: Record<string, ReplicaMode> | null;
        /** Replica name -> how far its rebuild has got. */
        rebuildStatus?: Record<string, RebuildStatus> | null;
        restoreStatus?: Record<string, { isRestoring?: boolean; progress?: number; error?: string }> | null;
        purgeStatus?: Record<string, { isPurging?: boolean; progress?: number; error?: string }> | null;
        isExpanding?: boolean;
        lastExpansionError?: string;
        lastRestoredBackup?: string;
    };
}

export interface Replica extends K8sDockside.KubeObject {
    spec?: {
        volumeName?: string;
        nodeID?: string;
        diskID?: string;
        diskPath?: string;
        dataDirectoryName?: string;
        /** RFC 3339, or empty. Set means this replica is no good any more. */
        failedAt?: string;
        healthyAt?: string;
        active?: boolean;
        evictionRequested?: boolean;
        rebuildRetryCount?: number;
        /** Bytes, as a string. */
        volumeSize?: string;
    };
    status?: {
        currentState?: string;
        instanceManagerName?: string;
        started?: boolean;
        ownerID?: string;
        currentImage?: string;
        ip?: string;
        port?: number;
    };
}

export interface DiskSpec {
    path?: string;
    allowScheduling?: boolean;
    evictionRequested?: boolean;
    /** Bytes held back from Longhorn, as a number. */
    storageReserved?: number;
    tags?: string[] | null;
    diskType?: string;
    diskDriver?: string;
}

export interface DiskStatus {
    conditions?: Condition[] | null;
    /** Bytes free on the filesystem right now. */
    storageAvailable?: number;
    /** Bytes promised to the replicas that live here. */
    storageScheduled?: number;
    /** Bytes the filesystem holds in total. */
    storageMaximum?: number;
    /** Replica name -> the size promised to it. */
    scheduledReplica?: Record<string, number> | null;
    diskUUID?: string;
    diskType?: string;
    diskDriver?: string;
    filesystemType?: string;
}

export interface LonghornNode extends K8sDockside.KubeObject {
    spec?: {
        allowScheduling?: boolean;
        evictionRequested?: boolean;
        tags?: string[] | null;
        /** Disk name -> what the operator asked for. */
        disks?: Record<string, DiskSpec> | null;
        instanceManagerCPURequest?: number;
    };
    status?: {
        conditions?: Condition[] | null;
        /** Disk name -> what Longhorn found. */
        diskStatus?: Record<string, DiskStatus> | null;
        region?: string;
        zone?: string;
        autoEvicting?: boolean;
    };
}

export interface BackupTarget extends K8sDockside.KubeObject {
    spec?: {
        backupTargetURL?: string;
        credentialSecret?: string;
        pollInterval?: string;
    };
    status?: {
        available?: boolean;
        lastSyncedAt?: string;
        conditions?: Condition[] | null;
    };
}

export interface BackupVolume extends K8sDockside.KubeObject {
    spec?: {
        syncRequestedAt?: string;
        /** Longhorn 1.7 and later, where a volume may have several targets. */
        volumeName?: string;
        backupTargetName?: string;
    };
    status?: {
        lastBackupName?: string;
        lastBackupAt?: string;
        /** Bytes, as a string. */
        size?: string;
        dataStored?: string;
        backingImageName?: string;
        lastSyncedAt?: string;
        messages?: Record<string, string> | null;
        /** v1beta2 with a backup target per volume; absent before that. */
        volumeName?: string;
    };
}

export interface Backup extends K8sDockside.KubeObject {
    spec?: { snapshotName?: string; labels?: Record<string, string> | null };
    status?: {
        state?: string;
        /** Percent, 0-100. */
        progress?: number;
        snapshotName?: string;
        snapshotCreatedAt?: string;
        backupCreatedAt?: string;
        /** Bytes, as a string. */
        size?: string;
        url?: string;
        error?: string;
        volumeName?: string;
        messages?: Record<string, string> | null;
    };
}

export interface RecurringJob extends K8sDockside.KubeObject {
    spec?: {
        name?: string;
        groups?: string[] | null;
        /** snapshot, snapshot-force-create, backup, backup-force-create, filesystem-trim, ... */
        task?: string;
        cron?: string;
        retain?: number;
        concurrency?: number;
        labels?: Record<string, string> | null;
    };
    status?: {
        executionCount?: number;
        ownerID?: string;
    };
}

/** The condition of a type, from a list that may be absent altogether. */
export function condition(list: Condition[] | null | undefined, type: string): Condition | undefined {
    return (list ?? []).find((c) => (c.type ?? '').toLowerCase() === type.toLowerCase());
}

/** Whether a condition of that type says True. */
export function conditionTrue(list: Condition[] | null | undefined, type: string): boolean {
    return (condition(list, type)?.status ?? '') === 'True';
}

/**
 * A byte count Longhorn wrote as a string, as a number. Longhorn stores sizes
 * as plain byte counts in strings ("10737418240"), not as quantities with a
 * suffix, so this is a parse and not a unit conversion -- but an empty or
 * unparseable one reads as 0 rather than NaN, which is the kind of thing that
 * ends up drawn as a bar of width NaN.
 */
export function bytes(value: string | number | undefined | null): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (!value) return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}
