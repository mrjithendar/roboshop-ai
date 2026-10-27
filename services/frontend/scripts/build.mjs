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
for (const name of ['index.html', 'admin.html', 'product.html', 'checkout.html', 'profile.html', 'auth.html']) {
  const account = name === 'admin.html'
    ? '<a class="store-account" href="/account">My account</a>'
    : '<a class="store-account" id="account-button" href="/login">Sign in</a><a id="admin-link" href="/admin" hidden>Manage store</a><button class="store-signout" id="logout-button" hidden>Sign out</button>';
  const count = ['index.html', 'checkout.html'].includes(name) ? '<span id="bag-count" aria-label="Items in cart">0</span>' : '';
  // Mark the current section so the shared header shows where the visitor is.
  const current = ' aria-current="page"';
  const shell = header.replace('{{ACCOUNT_CONTROL}}', name === 'profile.html' ? account.replace('class="store-account"', `class="store-account"${current}`) : account).replace('{{CART_COUNT}}', count)
    .replace('{{NAV_SHOP}}', ['index.html', 'product.html'].includes(name) ? current : '').replace('{{NAV_CART}}', name === 'checkout.html' ? current : '');
  const html = (await readFile(new URL(name, frontend), 'utf8'))
    .replace('<!-- STORE_HEADER -->', shell)
    .replace('<!-- STORE_FOOTER -->', footer);
  await writeFile(new URL(`dist/${name}`, frontend), html);
}
await copyFile(new URL('styles.css', frontend), new URL('dist/styles.css', frontend));

await cp(new URL('illustrations/', frontend), new URL('dist/illustrations/', frontend), { recursive: true });

await cp(new URL('product-media/', frontend), new URL('dist/product-media/', frontend), { recursive: true });

await cp(new URL('images/', frontend), new URL('dist/images/', frontend), { recursive: true });

await cp(new URL('fonts/', frontend), new URL('dist/fonts/', frontend), { recursive: true });
