import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LabApoioQaRuntimeConfigStore } from './labApoio.qa.runtime-config.js';

test('LabApoioQaRuntimeConfigStore usa .env como fallback e persiste overrides locais', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-apoio-qa-config-'));

  try {
    const store = new LabApoioQaRuntimeConfigStore({
      rootDir: tempRoot,
      envAuthSecret: 'auth-env',
      envWebhookSecret: 'webhook-env',
    });

    const initial = store.getResolvedSecrets();
    assert.equal(initial.authSecret, 'auth-env');
    assert.equal(initial.webhookSecret, 'webhook-env');
    assert.equal(initial.authSecretSource, 'env');
    assert.equal(initial.webhookSecretSource, 'env');

    const updated = store.updateSecrets({
      authSecret: 'auth-override',
      webhookSecret: 'webhook-override',
    });

    assert.equal(updated.authSecret.source, 'override');
    assert.equal(updated.webhookSecret.source, 'override');
    assert.equal(updated.authSecret.configured, true);
    assert.equal(updated.webhookSecret.configured, true);

    const resolved = store.getResolvedSecrets();
    assert.equal(resolved.authSecret, 'auth-override');
    assert.equal(resolved.webhookSecret, 'webhook-override');
    assert.equal(resolved.authSecretSource, 'override');
    assert.equal(resolved.webhookSecretSource, 'override');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
