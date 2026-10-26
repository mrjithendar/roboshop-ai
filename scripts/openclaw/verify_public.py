#!/usr/bin/env python3
"""Read-only public TLS/edge-auth/WebSocket checks after approved exposure."""
import asyncio,base64,json,os
import httpx
import websockets
url='https://jithendar.com/openclaw/'
# httpx verifies the hostname and trust chain; no insecure option exists.
response=httpx.get(url,follow_redirects=False,timeout=10)
if response.status_code not in (401,403):raise SystemExit('FAIL: unauthenticated request was not rejected by the edge')
user=os.environ['OPENCLAW_EDGE_USER'];password=os.environ['OPENCLAW_EDGE_PASSWORD']
response=httpx.get(url,auth=(user,password),follow_redirects=False,timeout=10)
if response.status_code!=200:raise SystemExit('FAIL: authenticated Control UI was not reachable')
async def check():
 basic=base64.b64encode((user+':'+password).encode()).decode()
 async with websockets.connect('wss://jithendar.com/openclaw',origin='https://jithendar.com',additional_headers={'Authorization':'Basic '+basic},open_timeout=10) as ws:
  challenge=json.loads(await asyncio.wait_for(ws.recv(),10))
  if challenge.get('event')!='connect.challenge':raise RuntimeError('Gateway challenge missing')
asyncio.run(check())
print('PASS: public TLS, edge authentication and WebSocket challenge. A paired browser investigation must still be verified manually.')
