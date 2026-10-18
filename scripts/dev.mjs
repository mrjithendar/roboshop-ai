import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = ['product-ingestion', 'recommendation-service', 'shopping-agent', 'payment-service', 'shipping-service', 'sre-copilot', 'ai-gateway'];
const llmToken = process.env.LLM_SERVICE_TOKEN || randomBytes(32).toString('hex');
const paymentToken = process.env.PAYMENT_SERVICE_TOKEN || randomBytes(32).toString('hex');
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
  delete env.OPENAI_API_KEY; delete env.OPENAI_MODEL; delete env.ASSISTANT_AI_ENABLED;
  if (['ai-gateway', 'shopping-agent'].includes(name)) env.LLM_SERVICE_TOKEN = llmToken;
  else { delete env.LLM_SERVICE_TOKEN; delete env.OLLAMA_ENDPOINTS_JSON; }
  delete env.MCP_SESSION_TOKEN;
  if (['payment-service', 'ai-gateway'].includes(name)) env.PAYMENT_SERVICE_TOKEN = paymentToken;
  else delete env.PAYMENT_SERVICE_TOKEN;
  if (name !== 'payment-service') for (const key of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) delete env[key];
  if (name !== 'shipping-service') { delete env.SHIPPING_DATABASE_URL; delete env.SHIPPING_DB_CA_FILE; }
  if (name !== 'ai-gateway') delete env.RABBITMQ_URL;
  if (name !== 'shipping-service') for (const key of Object.keys(env)) if (/^(REDIS_|RABBITMQ_(HOST|PORT|USERNAME|PASSWORD|VHOST|TLS)|CACHE_ENABLED|MESSAGING_ENABLED)/.test(key)) delete env[key];
  if (!['ai-gateway', 'product-ingestion'].includes(name)) { delete env.MONGODB_URL; delete env.MONGODB_DATABASE; }
  for (const key of ['SUPERADMIN_EMAIL', 'SUPERADMIN_PASSWORD', 'SUPERADMIN_NAME', 'MONGO_ROOT_PASSWORD', 'MONGO_APP_PASSWORD']) delete env[key];
  // Compose bootstrap passwords are never needed by application processes.
  delete env.SHIPPING_DB_PASSWORD;
  delete env.SHIPPING_APP_PASSWORD;
  if (name !== 'shipping-service') delete env.SHIPPING_MIGRATION_DATABASE_URL;
  if (name === 'shipping-service') env.SHIPPING_TRACING_ENABLED ??= String(Boolean(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT));
  if (name !== 'shopping-agent') for (const key of ['OPENAI_API_KEY', 'OPENAI_MODEL', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY']) delete env[key];
  // PORT applies only to the public gateway; internal services use their defaults.
  if (name !== 'ai-gateway') delete env.PORT;
  const child = spawn(name === 'shipping-service' ? 'java' : ['ai-gateway', 'shopping-agent'].includes(name) ? (process.env.PYTHON || 'python3') : process.execPath, name === 'shipping-service' ? ['-jar', 'services/shipping-service/build/libs/shipping-service.jar'] : [`services/${name}/server.${['ai-gateway', 'shopping-agent'].includes(name) ? 'py' : 'mjs'}`], { cwd: root, env, stdio: 'inherit' });
  children.push(child);
  child.on('error', () => stop(1));
  child.on('exit', code => { if (!stopping) stop(code || 1); });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
console.log(`RobotShop starting at ${process.env.PUBLIC_ORIGIN || `http://localhost:${process.env.PORT || 3000}`}. Ctrl+C stops all services.`);
