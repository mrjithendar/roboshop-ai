#!/usr/bin/env python3
"""Read-only public TLS and native gateway authentication checks."""
import asyncio
import json
import os
import ssl

import httpx
import websockets

origin = 'https://jithendar.com'
# Use system trust, including local trust-store configuration; never disable TLS verification.
context = ssl.create_default_context()
with httpx.Client(verify=context, timeout=10, follow_redirects=False) as client:
    response = client.get(origin + '/openclaw/')
    assert response.status_code == 200, ('UI shell', response.status_code)
    assert 'www-authenticate' not in response.headers, 'Unexpected browser authentication challenge'
    # Use the session-entry probe, which is explicitly mounted beneath the UI base path.
    probe = origin + '/openclaw/__openclaw__/session-entry?path=%2Fopenclaw%2Fchat%2Forchestrator&probe=1'
    for headers in ({}, {'Authorization': 'Bearer invalid-public-smoke-token'}):
        response = client.get(probe, headers=headers)
        assert response.status_code in (401, 403), ('Unauthenticated access was allowed', response.status_code)
        assert 'basic' not in response.headers.get('www-authenticate', '').lower()
    token = os.getenv('OPENCLAW_GATEWAY_TOKEN')
    if token:
        response = client.get(probe, headers={'Authorization': 'Bearer ' + token})
        assert response.status_code == 204, ('Valid gateway token rejected', response.status_code)

async def check():
    async with websockets.connect('wss://jithendar.com/openclaw', origin=origin,
                                  ssl=context, open_timeout=10) as ws:
        challenge = json.loads(await asyncio.wait_for(ws.recv(), 10))
        assert challenge.get('event') == 'connect.challenge', 'Gateway challenge missing'
        await ws.send(json.dumps({'type': 'req', 'id': 'auth-check', 'method': 'connect', 'params': {
            'minProtocol': 4, 'maxProtocol': 4,
            'client': {'id': 'cli', 'version': '2026.10.7', 'platform': 'linux', 'mode': 'operator'},
            'role': 'operator', 'scopes': ['operator.read'],
            'auth': {'token': 'invalid-public-smoke-token'}}}))
        response = json.loads(await asyncio.wait_for(ws.recv(), 10))
        assert response.get('type') == 'res' and response.get('ok') is False, 'Invalid token accepted'

asyncio.run(check())
print('PASS: TLS, UI without BasicAuth, protected HTTP routes, and WebSocket invalid-token rejection.')
if token:
    print('PASS: valid gateway token accepted.')
