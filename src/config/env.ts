import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../.env');

const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn(`[env] .env nao encontrado em ${envPath}. Variaveis globais serao usadas.`);
} else {
  console.log(`[env] .env carregado de ${envPath}`);
}

function parsePositiveInt(value: string | undefined, fallbackValue: number) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function parseOptionalPositiveInt(value: string | undefined) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Valor numerico invalido: ${value}`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallbackValue: boolean) {
  if (value === undefined) return fallbackValue;
  return value.trim().toLowerCase() === 'true';
}

function parseCsv(value: string | undefined) {
  if (!value) return [] as string[];
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parseBasePath(value: string | undefined) {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed === '/') {
    return '';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

function isTestRuntime() {
  return process.execArgv.includes('--test')
    || process.argv.includes('--test')
    || process.argv.some(arg => /\.test\.(c|m)?[jt]s$/i.test(arg))
    || Boolean(process.env.NODE_TEST_CONTEXT);
}

const env = {
  PORT: parsePositiveInt(process.env.PORT, 3001),
  NODE_ENV: process.env.NODE_ENV || 'development',
  ALLOW_ORIGINS: parseCsv(process.env.ALLOW_ORIGINS),
  PUBLIC_BASE_PATH: parseBasePath(process.env.PUBLIC_BASE_PATH),
  INTEGRALAB_API_BASE_URL: (process.env.INTEGRALAB_API_BASE_URL || 'https://api.stg.datanorte.com.br').replace(/\/+$/, ''),
  LAB_APOIO_TENANT_ID: process.env.LAB_APOIO_TENANT_ID?.trim() || '',
  LAB_APOIO_VINCULO_ID: process.env.LAB_APOIO_VINCULO_ID?.trim() || '',
  LAB_APOIO_AUTH_SECRET: process.env.LAB_APOIO_AUTH_SECRET?.trim() || '',
  LAB_APOIO_WEBHOOK_SECRET: process.env.LAB_APOIO_WEBHOOK_SECRET?.trim() || '',
  LAB_APOIO_FORNEC_ID: parseOptionalPositiveInt(process.env.LAB_APOIO_FORNEC_ID),
  API_REQUEST_TIMEOUT_MS: parsePositiveInt(process.env.API_REQUEST_TIMEOUT_MS, 7000),
  PROCESSING_BATCH_SIZE: parsePositiveInt(process.env.PROCESSING_BATCH_SIZE, 20),
  PROCESSING_DELAY_MS: Math.max(Number.parseInt(process.env.PROCESSING_DELAY_MS || '0', 10) || 0, 0),
  PROCESSING_MAX_BATCHES: parsePositiveInt(process.env.PROCESSING_MAX_BATCHES, 25),
  WEBHOOK_MAX_AGE_MS: parsePositiveInt(process.env.WEBHOOK_MAX_AGE_MS, 300000),
  AUTO_PROCESS_WEBHOOK: parseBoolean(process.env.AUTO_PROCESS_WEBHOOK, true),
  LAB_APOIO_SEND_INLINE_PDF: parseBoolean(process.env.LAB_APOIO_SEND_INLINE_PDF, false),
  QA_STORAGE_DIR: process.env.QA_STORAGE_DIR?.trim() || '.runtime/qa-data',
};

const varsToCheck = [
  'INTEGRALAB_API_BASE_URL',
  'LAB_APOIO_VINCULO_ID',
  'LAB_APOIO_AUTH_SECRET',
  'LAB_APOIO_WEBHOOK_SECRET',
  'NODE_ENV',
];

for (const name of varsToCheck) {
  const status = process.env[name] ? 'configured' : 'missing';
  console.log(`[env] ${name}: ${status}`);
}

if ((env.NODE_ENV || 'development') === 'production' && !isTestRuntime()) {
  const required = [
      'INTEGRALAB_API_BASE_URL',
      'LAB_APOIO_VINCULO_ID',
      'LAB_APOIO_AUTH_SECRET',
      'LAB_APOIO_WEBHOOK_SECRET',
  ].filter(name => !process.env[name]);

  if (required.length > 0) {
    console.error(`[env] Variaveis obrigatorias ausentes: ${required.join(', ')}`);
    process.exit(1);
  }
}

export function withPublicBasePath(targetPath: string) {
  if (!targetPath) {
    return env.PUBLIC_BASE_PATH || '/';
  }

  const normalizedTarget = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
  return `${env.PUBLIC_BASE_PATH}${normalizedTarget}` || '/';
}

export default env;
