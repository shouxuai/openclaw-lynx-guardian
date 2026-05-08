export interface ArtifactTaintRecord {
  taints: string[];
  fingerprint?: string;
  updatedAt: number;
}

export function createArtifactTaintStore() {
  const taints = new Map<string, ArtifactTaintRecord>();

  return {
    mark(path: string, labels: string[], options?: { fingerprint?: string; atMs?: number }) {
      taints.set(path, {
        taints: [...new Set(labels)],
        fingerprint: options?.fingerprint,
        updatedAt: options?.atMs ?? Date.now(),
      });
    },

    read(path: string, options?: { fingerprint?: string }) {
      const record = taints.get(path) ?? null;
      if (!record) {
        return null;
      }

      if (options?.fingerprint && record.fingerprint && record.fingerprint !== options.fingerprint) {
        taints.delete(path);
        return null;
      }

      return record;
    },

    clear(path: string) {
      taints.delete(path);
    },
  };
}
