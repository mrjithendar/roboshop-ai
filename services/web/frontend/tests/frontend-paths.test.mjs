import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const base of ['', '/roboshop']) {
  test(`frontend URLs resolve under ${base || '/'}`, async () => {
    const source = readFileSync(new URL('../dist/paths.js', import.meta.url), 'utf8')
      .replaceAll('import.meta.url', JSON.stringify(`https://jithendar.com${base}/paths.js`));
    const { appPath, basePath } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    assert.equal(basePath, base);
    for (const path of ['/api/cart', '/api/auth/login', '/images/placeholder.png', '/products/arduino-alvik', '/admin']) {
      assert.equal(appPath(path), base + path);
    }
    assert.equal(appPath('https://example.com/image.png'), 'https://example.com/image.png');
    assert.equal(appPath('//example.com/image.png'), '//example.com/image.png');
    assert.equal(`${base}/products/arduino-alvik`.slice(basePath.length).split('/')[2], 'arduino-alvik');
  });
}
