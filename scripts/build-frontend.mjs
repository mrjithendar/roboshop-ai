import { rm, mkdir, copyFile, cp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const frontend = new URL('../services/frontend/', import.meta.url);
await rm(new URL('dist/', frontend), { recursive: true, force: true });
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'services/frontend/tsconfig.json'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
await mkdir(new URL('dist/', frontend), { recursive: true });
await Promise.all(['index.html', 'admin.html', 'product.html', 'styles.css'].map(name => copyFile(new URL(name, frontend), new URL(`dist/${name}`, frontend))));

await cp(new URL('illustrations/', frontend), new URL('dist/illustrations/', frontend), { recursive: true });

await cp(new URL('product-media/', frontend), new URL('dist/product-media/', frontend), { recursive: true });
