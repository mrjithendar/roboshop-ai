import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { once } from 'node:events';

// Starts the single web service: built storefront files plus the /api proxy.
// NGINX_TEST_IMAGE runs the published container; otherwise a local NGINX >= 1.28 is used.
export async function startNginx({ port, gatewayPort, directory, tls, basePath = process.env.FRONTEND_BASE_PATH || '' }) {
  const image = process.env.NGINX_TEST_IMAGE;
  const name = `roboshop-web-test-${port}`;
  const settings = { GATEWAY_HOST: '127.0.0.1', GATEWAY_PORT: String(gatewayPort), NGINX_HTTP_PORT: String(port), FRONTEND_BASE_PATH: basePath,
    ...(tls ? { NGINX_TLS: 'true', NGINX_SERVER_NAME: 'localhost', NGINX_HTTPS_PORT: String(tls.port) } : {}) };
  let command, args, env = { ...process.env };
  if (image) {
    command = 'docker';
    args = ['run', '--rm', '--name', name, '--network', 'host', '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL',
      ...Object.entries(settings).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
      ...(tls ? ['-v', `${tls.directory}:/etc/nginx/tls:ro`] : []), image];
  } else {
    // The checkout path may contain spaces, which WEB_ROOT rejects: serve a copy.
    const web = join(directory, 'web'); mkdirSync(web, { recursive: true });
    cpSync(resolve('services/web/frontend/dist'), web, { recursive: true });
    const mime = ['/opt/homebrew/etc/nginx/mime.types', '/etc/nginx/mime.types'].find(existsSync);
    command = 'sh'; args = [resolve('services/web/nginx/start.sh')];
    env = { ...env, ...settings, WEB_ROOT: web, NGINX_CONFIG_DIR: resolve('services/web/nginx'), NGINX_RUN_DIR: join(directory, 'nginx'),
      NGINX_MIME_TYPES: process.env.NGINX_MIME_TYPES || mime, NGINX_RESOLVER: '127.0.0.1', NGINX_TLS: tls ? 'true' : 'false',
      ...(tls ? { NGINX_TLS_CERT_FILE: join(tls.directory, 'tls.crt'), NGINX_TLS_KEY_FILE: join(tls.directory, 'tls.key') } : {}) };
  }
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', d => { logs = (logs + d).slice(-32000); });
  child.stderr.on('data', d => { logs = (logs + d).slice(-32000); });
  child.on('error', e => { logs += e.message; });
  async function stop() {
    // Test teardown must close idle HTTP keepalives rather than wait for their timeout.
    if (image) {
      const stopper = spawn('docker', ['stop', '-t', '2', name], { stdio: 'ignore' });
      await once(stopper, 'exit');
    } else if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM'); await once(child, 'exit');
    }
  }
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return { stop, logs: () => logs }; } catch {}
    if (child.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  await stop(); throw new Error('Web service failed to start: ' + logs);
}
