"""Loopback-only pinned runtime + real HTTP MCP smoke; no provider call or cluster write."""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import httpx
from fastmcp import Client
ROOT=Path(__file__).resolve().parents[2]
async def mcp_check():
    from fastmcp.client.transports import StreamableHttpTransport
    async with Client(StreamableHttpTransport('http://127.0.0.1:19180/mcp',headers={'Authorization':'Bearer '+'s'*40})) as client:
        tools=await client.list_tools()
        assert any(t.name=='ops_kubernetes' for t in tools)
        result=await client.call_tool('ops_kubernetes',{'operation':'pods'})
        assert 'unavailable' in str(result)
        try: await client.call_tool('ops_aws',{'operation':'ec2'})
        except Exception:pass
        else:raise AssertionError('MCP authorization bypass')
    print('PASS: real HTTP MCP discovery, authenticated call, cross-agent denial')
async def websocket_check():
    import websockets
    async with websockets.connect('ws://127.0.0.1:19189/openclaw',origin='https://jithendar.com',open_timeout=5) as ws:
        challenge=json.loads(await asyncio.wait_for(ws.recv(),5))
        assert challenge['event']=='connect.challenge'
        await ws.send(json.dumps({'type':'req','id':'smoke-auth','method':'connect','params':{'minProtocol':4,'maxProtocol':4,'client':{'id':'cli','version':'2026.10.7','platform':'linux','mode':'operator'},'role':'operator','scopes':['operator.read'],'auth':{'token':'invalid-smoke-token'}}}))
        response=json.loads(await asyncio.wait_for(ws.recv(),5))
        assert response['type']=='res' and response['ok'] is False
    print('PASS: WebSocket upgrade at base path and invalid-auth rejection')

def wait(url,process):
    for _ in range(90):
        if process.poll() is not None:raise RuntimeError('Runtime exited before readiness')
        try:
            if httpx.get(url,timeout=1).status_code==200:return
        except httpx.HTTPError:pass
        time.sleep(1)
    raise RuntimeError('Runtime readiness timeout')
with tempfile.TemporaryDirectory(prefix='openclaw-smoke-') as tmp:
    tmp=Path(tmp); processes=[]
    config=json.loads((ROOT/'minikube/openclaw/base/openclaw.json').read_text())
    config['gateway'].update({'bind':'loopback','port':19189})
    config.pop('proxy');config['diagnostics']['otel']['enabled']=False
    for agent,entry in config['agents']['entries'].items():
        entry['workspace']=str(tmp/'workspaces'/agent)
        Path(entry['workspace']).mkdir(parents=True)
        (Path(entry['workspace'])/'AGENTS.md').write_text('Read-only smoke test. Do not call an LLM.')
    for server in config['mcp']['servers'].values():server['url']='http://127.0.0.1:19180/mcp'
    (tmp/'config.json').write_text(json.dumps(config))
    (tmp/'identities.json').write_text(json.dumps({'sre':'s'*40,'orchestrator':'o'*40}))
    env=dict(os.environ,OPENCLAW_CONFIG_PATH=str(tmp/'config.json'),OPENCLAW_STATE_DIR=str(tmp/'state'),OPENCLAW_GATEWAY_TOKEN='g'*40,OPENAI_API_KEY='smoke-only-not-a-real-key',OPS_IDENTITIES_FILE=str(tmp/'identities.json'),PYTHONPATH=str(ROOT/'services/mcp-server'))
    env['OPENCLAW_PLUGINS_DIR']=str(ROOT/'services/mcp-server/operations/plugins')
    for agent in config['agents']['entries']:env['OPS_'+agent.upper()+'_TOKEN']=('s' if agent=='sre' else 'o')*40
    command=[os.getenv('OPENCLAW_BIN','openclaw')]
    if os.getenv('OPENCLAW_NODE'):command=[os.environ['OPENCLAW_NODE'],*command]
    try:
        with (tmp/'operations.log').open('w') as out:
            operations=subprocess.Popen([sys.executable,'-m','uvicorn','operations.server:create_app','--factory','--host','127.0.0.1','--port','19180'],env=env,stdout=out,stderr=out);processes.append(operations)
        wait('http://127.0.0.1:19180/health',operations)
        asyncio.run(mcp_check())
        with (tmp/'gateway.log').open('w') as out:
            gateway=subprocess.Popen(command+['gateway','run'],env=env,stdout=out,stderr=out);processes.append(gateway)
        try:wait('http://127.0.0.1:19189/startupz',gateway)
        except RuntimeError:
            print((tmp/'gateway.log').read_text()[-6000:]);raise
        for path in ('/healthz','/startupz','/openclaw/'):
            response=httpx.get('http://127.0.0.1:19189'+path,timeout=5)
            assert response.status_code==200,(path,response.status_code)
        asyncio.run(websocket_check())
        metrics_url='http://127.0.0.1:19189/api/diagnostics/prometheus'
        assert httpx.get(metrics_url,timeout=5).status_code==401
        assert httpx.get(metrics_url,headers={'Authorization':'Bearer '+'g'*40},timeout=5).status_code==200
        print('PASS: official telemetry plugin authenticated metrics route')
        result=subprocess.run(command+['mcp','doctor','ops-sre','--probe'],env=env,capture_output=True,text=True,timeout=60)
        if result.returncode:print(result.stdout[-3000:]);print(result.stderr[-3000:])
        assert result.returncode==0
        print('PASS: pinned OpenClaw startup/liveness/base path and native MCP probe')
    finally:
        for process in reversed(processes):
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait()
