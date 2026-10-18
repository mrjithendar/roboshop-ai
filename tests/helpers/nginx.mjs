import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { once } from 'node:events';

export async function startNginx({ port, gatewayPort, directory, tls }) {
  const image = process.env.NGINX_TEST_IMAGE;
  const name = `robotshop-nginx-test-${port}`;
  let command, args, env = { ...process.env };
  if (image) {
    command = 'docker';
    args = ['run', '--rm', '--name', name, '--network', 'host', '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '-e', 'GATEWAY_HOST=127.0.0.1', '-e', `GATEWAY_PORT=${gatewayPort}`, '-e', `NGINX_HTTP_PORT=${port}`, ...(tls ? ['-e','NGINX_TLS=true','-e','NGINX_SERVER_NAME=localhost','-e',`NGINX_HTTPS_PORT=${tls.port}`,'-v',`${tls.directory}:/etc/nginx/tls:ro`] : []), image];
  } else {
    const web = join(directory, 'web'); mkdirSync(web, { recursive: true });
    cpSync(resolve('services/frontend/dist'), web, { recursive: true });
    cpSync(resolve('legacy/original-robotshop/web/static/images'), join(web, 'images'), { recursive: true });
    command = 'sh'; args = [resolve('services/nginx/start.sh')];
    const mime = ['/opt/homebrew/etc/nginx/mime.types', '/etc/nginx/mime.types'].find(existsSync);
    env = { ...env, GATEWAY_HOST: '127.0.0.1', GATEWAY_PORT: String(gatewayPort), NGINX_HTTP_PORT: String(port), NGINX_CONFIG_DIR: resolve('services/nginx'), NGINX_RUN_DIR: join(directory, 'nginx'), NGINX_WEB_ROOT: web, NGINX_MIME_TYPES: process.env.NGINX_MIME_TYPES || mime, NGINX_RESOLVER: '127.0.0.1', NGINX_TLS: tls ? 'true' : 'false', ...(tls ? { NGINX_SERVER_NAME: 'localhost', NGINX_HTTPS_PORT: String(tls.port), NGINX_TLS_CERT_FILE: join(tls.directory,'tls.crt'), NGINX_TLS_KEY_FILE: join(tls.directory,'tls.key') } : {}) };
  }
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', d => { logs = (logs+d).slice(-32000); });
  child.stderr.on('data', d => { logs = (logs+d).slice(-32000); });
  child.on('error', e => { logs += e.message; });
  async function stop() {
    if (image) {
      const stop = spawn('docker', ['stop', '-t', '2', name], { stdio: 'ignore' });
      await once(stop, 'exit');
    } else if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGQUIT'); await once(child, 'exit');
    }
  }
  for (let i=0; i<150; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return { stop, logs: () => logs }; } catch {}
    if (child.exitCode !== null) break;
    await new Promise(r => setTimeout(r,100));
  }
  await stop(); throw new Error('NGINX failed to start: '+logs);
}
