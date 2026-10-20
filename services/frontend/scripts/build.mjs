import { rm, mkdir, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const frontend = new URL('../', import.meta.url);
await rm(new URL('dist/', frontend), { recursive: true, force: true });
const result = spawnSync(process.execPath, [fileURLToPath(new URL('./bin/tsc', import.meta.resolve('typescript/package.json'))), '-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
await mkdir(new URL('dist/', frontend), { recursive: true });
const header = await readFile(new URL('templates/header.html', frontend), 'utf8');
const footer = await readFile(new URL('templates/footer.html', frontend), 'utf8');
for (const name of ['index.html', 'admin.html', 'product.html', 'checkout.html', 'profile.html']) {
  const account = name === 'admin.html'
    ? '<a class="store-account" href="/account">My account</a>'
    : '<button class="store-account" id="account-button">Sign in</button><a id="admin-link" href="/admin" hidden>Manage store</a><button class="store-signout" id="logout-button" hidden>Sign out</button>';
  const count = ['index.html', 'checkout.html'].includes(name) ? '<span id="bag-count" aria-label="Items in cart">0</span>' : '';
  const html = (await readFile(new URL(name, frontend), 'utf8'))
    .replace('<!-- STORE_HEADER -->', header.replace('{{ACCOUNT_CONTROL}}', account).replace('{{CART_COUNT}}', count))
    .replace('<!-- STORE_FOOTER -->', footer);
  await writeFile(new URL(`dist/${name}`, frontend), html);
}
await copyFile(new URL('styles.css', frontend), new URL('dist/styles.css', frontend));

await cp(new URL('illustrations/', frontend), new URL('dist/illustrations/', frontend), { recursive: true });

await cp(new URL('product-media/', frontend), new URL('dist/product-media/', frontend), { recursive: true });

await cp(new URL('images/', frontend), new URL('dist/images/', frontend), { recursive: true });
