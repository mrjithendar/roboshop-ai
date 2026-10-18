import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = ['product-ingestion', 'recommendation-service', 'shopping-agent', 'sre-copilot', 'ai-gateway'];
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
  if (name === 'ai-gateway') env.ASSISTANT_AI_ENABLED = String(Boolean(env.OPENAI_API_KEY && env.OPENAI_MODEL));
  if (name !== 'shopping-agent') for (const key of ['OPENAI_API_KEY', 'OPENAI_MODEL', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY']) delete env[key];
  // PORT applies only to the public gateway; internal services use their defaults.
  if (name !== 'ai-gateway') delete env.PORT;
  const child = spawn(process.execPath, [`services/${name}/server.mjs`], { cwd: root, env, stdio: 'inherit' });
  children.push(child);
  child.on('error', () => stop(1));
  child.on('exit', code => { if (!stopping) stop(code || 1); });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
console.log(`RobotShop starting at ${process.env.PUBLIC_ORIGIN || `http://localhost:${process.env.PORT || 3000}`}. Ctrl+C stops all services.`);
