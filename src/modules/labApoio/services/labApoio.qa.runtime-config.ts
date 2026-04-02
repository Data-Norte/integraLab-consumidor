import fs from 'node:fs';
import path from 'node:path';

import env from '../../../config/env.js';

type QaRuntimeSecretsFile = {
  authSecret?: string | null;
  webhookSecret?: string | null;
  updatedAt?: string | null;
};

export type QaResolvedSecrets = {
  authSecret: string;
  webhookSecret: string;
  authSecretSource: 'override' | 'env' | 'missing';
  webhookSecretSource: 'override' | 'env' | 'missing';
  updatedAt: string | null;
};

export type QaPublicSecretsState = {
  authSecret: {
    configured: boolean;
    source: QaResolvedSecrets['authSecretSource'];
    preview: string | null;
  };
  webhookSecret: {
    configured: boolean;
    source: QaResolvedSecrets['webhookSecretSource'];
    preview: string | null;
  };
  updatedAt: string | null;
};

export type QaSecretsUpdateInput = {
  authSecret?: string;
  webhookSecret?: string;
  clearAuthSecret?: boolean;
  clearWebhookSecret?: boolean;
};

type QaRuntimeConfigOptions = {
  rootDir?: string;
  envAuthSecret?: string;
  envWebhookSecret?: string;
};

function normalizeSecret(value: string | null | undefined) {
  return value?.trim() || '';
}

function maskSecret(value: string) {
  if (!value) return null;
  if (value.length <= 6) {
    return `${value.slice(0, 1)}${'*'.repeat(Math.max(value.length - 2, 1))}${value.slice(-1)}`;
  }

  return `${value.slice(0, 3)}${'*'.repeat(Math.max(value.length - 6, 4))}${value.slice(-3)}`;
}

export class LabApoioQaRuntimeConfigStore {
  private readonly filePath: string;

  private readonly envAuthSecret: string;

  private readonly envWebhookSecret: string;

  constructor(options: QaRuntimeConfigOptions = {}) {
    const rootDir = path.resolve(options.rootDir ?? env.QA_STORAGE_DIR);
    this.filePath = path.join(rootDir, 'qa-runtime-secrets.json');
    this.envAuthSecret = normalizeSecret(options.envAuthSecret ?? env.LAB_APOIO_AUTH_SECRET);
    this.envWebhookSecret = normalizeSecret(options.envWebhookSecret ?? env.LAB_APOIO_WEBHOOK_SECRET);
  }

  private ensureParentDir() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  private readFile(): QaRuntimeSecretsFile {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      if (!raw.trim()) {
        return {};
      }

      const parsed = JSON.parse(raw) as QaRuntimeSecretsFile;
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch {
      return {};
    }
  }

  private writeFile(data: QaRuntimeSecretsFile) {
    this.ensureParentDir();
    fs.writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      // Best effort only. Some filesystems or platforms may ignore chmod.
    }
  }

  getResolvedSecrets(): QaResolvedSecrets {
    const stored = this.readFile();
    const storedAuthSecret = normalizeSecret(stored.authSecret);
    const storedWebhookSecret = normalizeSecret(stored.webhookSecret);

    const authSecret = storedAuthSecret || this.envAuthSecret;
    const webhookSecret = storedWebhookSecret || this.envWebhookSecret;

    return {
      authSecret,
      webhookSecret,
      authSecretSource: storedAuthSecret ? 'override' : (this.envAuthSecret ? 'env' : 'missing'),
      webhookSecretSource: storedWebhookSecret ? 'override' : (this.envWebhookSecret ? 'env' : 'missing'),
      updatedAt: stored.updatedAt?.trim() || null,
    };
  }

  getPublicState(): QaPublicSecretsState {
    const resolved = this.getResolvedSecrets();
    return {
      authSecret: {
        configured: Boolean(resolved.authSecret),
        source: resolved.authSecretSource,
        preview: resolved.authSecret ? maskSecret(resolved.authSecret) : null,
      },
      webhookSecret: {
        configured: Boolean(resolved.webhookSecret),
        source: resolved.webhookSecretSource,
        preview: resolved.webhookSecret ? maskSecret(resolved.webhookSecret) : null,
      },
      updatedAt: resolved.updatedAt,
    };
  }

  updateSecrets(input: QaSecretsUpdateInput): QaPublicSecretsState {
    const current = this.readFile();
    const next: QaRuntimeSecretsFile = {
      authSecret: current.authSecret ?? null,
      webhookSecret: current.webhookSecret ?? null,
      updatedAt: current.updatedAt ?? null,
    };

    if (input.authSecret !== undefined) {
      next.authSecret = normalizeSecret(input.authSecret) || null;
    }
    if (input.webhookSecret !== undefined) {
      next.webhookSecret = normalizeSecret(input.webhookSecret) || null;
    }
    if (input.clearAuthSecret) {
      next.authSecret = null;
    }
    if (input.clearWebhookSecret) {
      next.webhookSecret = null;
    }

    next.updatedAt = new Date().toISOString();
    this.writeFile(next);
    return this.getPublicState();
  }
}

let qaRuntimeConfigStore: LabApoioQaRuntimeConfigStore | null = null;

export function getLabApoioQaRuntimeConfig() {
  if (!qaRuntimeConfigStore) {
    qaRuntimeConfigStore = new LabApoioQaRuntimeConfigStore();
  }

  return qaRuntimeConfigStore;
}
