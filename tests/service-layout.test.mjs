import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
const services=['user-service','frontend','nginx','shipping-service','ai-gateway','moks','mcp-server','cart-service','catalogue-service','payment-service'];
for(const service of services) test(`${service} owns its Docker build inputs`,()=>{
  const root=resolve('services',service);
  assert.ok(existsSync(resolve(root,'.dockerignore')));
  const docker=readFileSync(resolve(root,'Dockerfile'),'utf8');
  for(const line of docker.split('\n').filter(l=>l.startsWith('COPY ')&&!l.includes('--from='))){
    const paths=line.split(/\s+/).slice(1).filter(p=>!p.startsWith('--')).slice(0,-1);
    for(const source of paths){
      assert.ok(!source.startsWith('/')&&!source.includes('..'),`${service}: outside source ${source}`);
      assert.ok(existsSync(resolve(root,source)),`${service}: missing ${source}`);
    }
  }
  for(const file of readdirSync(root).filter(n=>n.endsWith('.mjs'))){
    const code=readFileSync(resolve(root,file),'utf8');
    for(const [,path] of code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)){
      assert.ok(!relative(root,resolve(root,path)).startsWith('..'),`${service}: sibling import ${path}`);
    }
  }
});
