import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';

export async function startNginx({ port, gatewayPort, directory, tls }) {
  const image = process.env.NGINX_TEST_IMAGE;
  const name = `robotshop-nginx-test-${port}`;
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const frontendPort = probe.address().port; await new Promise(r => probe.close(r));
  const frontendName = `${name}-frontend`;
  const mime = ['/opt/homebrew/etc/nginx/mime.types', '/etc/nginx/mime.types'].find(existsSync);
  let frontend;
  if (image) {
    frontend = spawn('docker', ['run', '--rm', '--name', frontendName, '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '-p', `127.0.0.1:${frontendPort}:8080`, process.env.FRONTEND_TEST_IMAGE || image.replace('robotshop-nginx', 'robotshop-frontend')], { stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    const web = join(directory, 'web'); mkdirSync(web, { recursive: true });
    cpSync(resolve('services/frontend/dist'), web, { recursive: true });
    const conf = readFileSync('services/frontend/nginx.conf', 'utf8').replace('/etc/nginx/mime.types', process.env.NGINX_MIME_TYPES || mime).replace('/usr/share/nginx/html', web).replace('listen 8080;', `listen ${frontendPort};`).replaceAll('/tmp/', `${directory}/`);
    const path = join(directory, 'frontend.conf'); writeFileSync(path, conf);
    frontend = spawn('nginx', ['-c', path, '-g', 'daemon off;'], { stdio: ['ignore', 'pipe', 'pipe'] });
  }
  let frontendLogs = '';
  frontend.stdout.on('data', d => { frontendLogs = (frontendLogs + d).slice(-32000); });
  frontend.stderr.on('data', d => { frontendLogs = (frontendLogs + d).slice(-32000); });
  frontend.on('error', e => { frontendLogs += e.message; });
  async function stopFrontend() {
    if (image) { const child = spawn('docker', ['stop', '-t', '2', frontendName], { stdio: 'ignore' }); await once(child, 'exit'); }
    else if (frontend.exitCode === null && frontend.signalCode === null) { frontend.kill('SIGQUIT'); await once(frontend, 'exit'); }
  }
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`http://127.0.0.1:${frontendPort}/health`)).ok) { ready = true; break; } } catch {}
    if (frontend.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (!ready) { await stopFrontend(); throw new Error('Frontend failed to start: ' + frontendLogs); }
  let command, args, env = { ...process.env };
  if (image) {
    command = 'docker';
    args = ['run', '--rm', '--name', name, '--network', 'host', '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '-e', 'FRONTEND_HOST=127.0.0.1', '-e', `FRONTEND_PORT=${frontendPort}`, '-e', 'GATEWAY_HOST=127.0.0.1', '-e', `GATEWAY_PORT=${gatewayPort}`, '-e', `NGINX_HTTP_PORT=${port}`, ...(tls ? ['-e','NGINX_TLS=true','-e','NGINX_SERVER_NAME=localhost','-e',`NGINX_HTTPS_PORT=${tls.port}`,'-v',`${tls.directory}:/etc/nginx/tls:ro`] : []), image];
  } else {
    command = 'sh'; args = [resolve('services/nginx/start.sh')];
    const mime = ['/opt/homebrew/etc/nginx/mime.types', '/etc/nginx/mime.types'].find(existsSync);
    env = { ...env, FRONTEND_HOST: '127.0.0.1', FRONTEND_PORT: String(frontendPort), GATEWAY_HOST: '127.0.0.1', GATEWAY_PORT: String(gatewayPort), NGINX_HTTP_PORT: String(port), NGINX_CONFIG_DIR: resolve('services/nginx'), NGINX_RUN_DIR: join(directory, 'nginx'), NGINX_MIME_TYPES: process.env.NGINX_MIME_TYPES || mime, NGINX_RESOLVER: '127.0.0.1', NGINX_TLS: tls ? 'true' : 'false', ...(tls ? { NGINX_SERVER_NAME: 'localhost', NGINX_HTTPS_PORT: String(tls.port), NGINX_TLS_CERT_FILE: join(tls.directory,'tls.crt'), NGINX_TLS_KEY_FILE: join(tls.directory,'tls.key') } : {}) };
  }
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', d => { logs = (logs+d).slice(-32000); });
  child.stderr.on('data', d => { logs = (logs+d).slice(-32000); });
  child.on('error', e => { logs += e.message; });
  async function stop() {
    await stopFrontend();
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
