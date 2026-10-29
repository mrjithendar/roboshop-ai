#!/usr/bin/env node
import { execFileSync as hostCheck } from 'node:child_process';
if (!process.argv.includes('--help')) hostCheck('bash', [fileURLToPath(new URL('../lib/require-centos.sh', import.meta.url))], {stdio:'inherit'});
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (process.argv.includes('--help')) { console.log('Usage: node scripts/dev/start.mjs; requires Node, .venv, built frontend/Java jar and configured backing services. Starts local application processes using .env.'); process.exit(0); }
const names = ['catalogue-service', 'moks', 'payment-service', 'shipping-service', 'user-service', 'ai-gateway'];
const llmToken = process.env.LLM_SERVICE_TOKEN || randomBytes(32).toString('hex');
const paymentToken = process.env.PAYMENT_SERVICE_TOKEN || randomBytes(32).toString('hex');
const userToken = process.env.USER_SERVICE_TOKEN || randomBytes(32).toString('hex');
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => { for (const child of children) child.kill('SIGKILL'); process.exit(code); }, 2000).unref();
  Promise.all(children.map(child => new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)))).then(() => process.exit(code));
}
for (const name of names) {
  const env = { ...process.env };
  if (['ai-gateway', 'user-service'].includes(name)) env.USER_SERVICE_TOKEN = userToken;
  else delete env.USER_SERVICE_TOKEN;
  if (name !== 'user-service') for (const key of Object.keys(env)) if (key.startsWith('SMTP_') || key === 'AUTH_ENCRYPTION_KEY') delete env[key];
  if (name === 'moks') {
    env.AI_GATEWAY_URL ??= `http://127.0.0.1:${process.env.PORT || 3000}`;
    env.CHAT_URL ??= `${env.AI_GATEWAY_URL}/api/chat`;
    env.AUTH_URL ??= `${env.AI_GATEWAY_URL}/api/auth/me`;
    env.HEALTH_URLS ??= `${env.AI_GATEWAY_URL}/api/status,${env.USER_URL || 'http://127.0.0.1:4109'}/api/users/ready`;
    env.UPSTREAM_ORIGIN ??= env.PUBLIC_ORIGIN || env.AI_GATEWAY_URL;
    env.ALLOWED_ORIGINS ??= env.UPSTREAM_ORIGIN;
  }
  if (name === 'ai-gateway') { env.FRONTEND_DIST = resolve(root, 'services/web/frontend/dist'); env.DATA_DIR ??= resolve(root, '.data'); }
  delete env.OPENAI_API_KEY; delete env.OPENAI_MODEL; delete env.ASSISTANT_AI_ENABLED;
  if (['ai-gateway', 'moks'].includes(name)) env.LLM_SERVICE_TOKEN = llmToken;
  else { delete env.LLM_SERVICE_TOKEN; delete env.OLLAMA_ENDPOINTS_JSON; }
  delete env.MCP_SESSION_TOKEN;
  delete env.DEMO_MONGODB_URL;
  if (name !== 'user-service') for (const key of ['REGISTRATION_CHALLENGE_PROVIDER', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'TURNSTILE_HOSTNAME']) delete env[key];
  if (name !== 'ai-gateway') delete env.TRUSTED_PROXY_CIDRS;
  if (name === 'user-service') env.TRUST_PROXY = 'false';
  if (['payment-service', 'ai-gateway'].includes(name)) env.PAYMENT_SERVICE_TOKEN = paymentToken;
  else delete env.PAYMENT_SERVICE_TOKEN;
  if (name !== 'payment-service') for (const key of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) delete env[key];
  if (name !== 'shipping-service') { delete env.SHIPPING_DATABASE_URL; delete env.SHIPPING_DB_CA_FILE; }
  if (name !== 'ai-gateway') delete env.RABBITMQ_URL;
  if (name !== 'shipping-service') for (const key of Object.keys(env)) if (/^(REDIS_|RABBITMQ_(HOST|PORT|USERNAME|PASSWORD|VHOST|TLS)|CACHE_ENABLED|MESSAGING_ENABLED)/.test(key)) delete env[key];
  if (!['user-service', 'ai-gateway', 'catalogue-service'].includes(name)) { delete env.MONGODB_URL; delete env.MONGODB_DATABASE; }
  for (const key of ['SUPERADMIN_EMAIL', 'SUPERADMIN_PASSWORD', 'SUPERADMIN_NAME', 'MONGO_ROOT_PASSWORD', 'MONGO_APP_PASSWORD']) delete env[key];
  // Database bootstrap passwords are never needed by application processes.
  delete env.SHIPPING_DB_PASSWORD;
  delete env.SHIPPING_APP_PASSWORD;
  if (name !== 'shipping-service') delete env.SHIPPING_MIGRATION_DATABASE_URL;
  if (name === 'shipping-service') env.SHIPPING_TRACING_ENABLED ??= String(Boolean(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT));
  if (name !== 'moks') for (const key of ['OPENAI_API_KEY', 'OPENAI_MODEL', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY']) delete env[key];
  // PORT applies only to the public gateway; internal services use their defaults.
  if (name !== 'ai-gateway') delete env.PORT;
  const child = spawn(name === 'shipping-service' ? 'java' : ['user-service', 'ai-gateway', 'moks'].includes(name) ? (process.env.PYTHON || 'python3') : process.execPath, name === 'shipping-service' ? ['-jar', 'services/shipping-service/build/libs/shipping-service.jar'] : [`services/${name}/server.${['user-service', 'ai-gateway', 'moks'].includes(name) ? 'py' : 'mjs'}`], { cwd: root, env, stdio: 'inherit' });
  children.push(child);
  child.on('error', () => stop(1));
  child.on('exit', code => { if (!stopping) stop(code || 1); });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
console.log(`RoboShop starting at ${process.env.PUBLIC_ORIGIN || `http://localhost:${process.env.PORT || 3000}`}. Ctrl+C stops all services.`);
