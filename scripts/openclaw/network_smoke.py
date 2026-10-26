#!/usr/bin/env python3
"""Opt-in isolated allow/deny/recovery test; never touches existing workloads."""
import argparse
import datetime
import json
import subprocess
import sys
import time
import uuid
from pathlib import Path
from manage import context, confirm


def probe(ctx, ns, ip):
    # Only a completed remote probe can report denial. Exec failures are inconclusive.
    code = """import json, socket, sys
try:
    with socket.create_connection((sys.argv[1], 8080), timeout=3):
        connected = True
except OSError:
    connected = False
print(json.dumps({'openclawConnected': connected}))
"""
    command = ['kubectl', '--context', ctx, '--request-timeout=20s',
               'exec', '-n', ns, 'client', '--', 'python', '-c', code, ip]
    for attempt in range(3):
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                data = json.loads(result.stdout)
                if isinstance(data, dict) and type(data.get('openclawConnected')) is bool:
                    return data['openclawConnected']
        except (subprocess.TimeoutExpired, ValueError):
            pass
        if attempt < 2:
            print('Probe transport failed; retrying kubectl exec (not counted as a denied connection).', flush=True)
            time.sleep(2)
    raise RuntimeError('kubectl exec failed or timed out after 3 attempts. Network test is inconclusive; no evidence written. Check cluster/API connectivity and rerun.')


def controls(connects, apply_deny, remove_deny):
    for attempt in range(10):
        if connects():
            break
        if attempt < 9:
            time.sleep(2)
    else:
        raise RuntimeError('Positive control failed after 10 attempts before any deny policy was applied. Check server readiness and pod-to-pod routing; no evidence written.')
    apply_deny()
    streak = 0
    for _ in range(10):
        time.sleep(2)
        streak = 0 if connects() else streak + 1
        if streak == 3:
            break
    else:
        raise RuntimeError('NetworkPolicy denial was not verified; enable policy enforcement before bootstrap. No evidence written.')
    remove_deny()
    for _ in range(10):
        time.sleep(2)
        if connects():
            return
    raise RuntimeError('Recovery control failed; denial is inconclusive. No evidence written.')


def pod(ns,name,command):return {'apiVersion':'v1','kind':'Pod','metadata':{'name':name,'namespace':ns,'labels':{'app':name}},'spec':{'automountServiceAccountToken':False,'restartPolicy':'Never','securityContext':{'runAsNonRoot':True,'runAsUser':1000,'seccompProfile':{'type':'RuntimeDefault'}},'containers':[{'name':'test','image':'python:3.14.0-slim','command':command,'workingDir':'/tmp','securityContext':{'allowPrivilegeEscalation':False,'readOnlyRootFilesystem':True,'capabilities':{'drop':['ALL']}},'resources':{'requests':{'cpu':'10m','memory':'32Mi'},'limits':{'cpu':'100m','memory':'64Mi'}}}]}}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output).expanduser()
    if output.exists():
        raise RuntimeError('Refusing to overwrite evidence; choose a new output filename.')
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    ctx = context()
    confirm('network-test')
    ns = 'openclaw-netcheck-' + uuid.uuid4().hex[:8]

    def kubectl(*args, **kwargs):
        return subprocess.run(['kubectl', '--context', ctx, '--request-timeout=120s', *args],
                              text=True, check=True, timeout=150, **kwargs)

    def apply(obj):
        kubectl('apply', '-f', '-', input=json.dumps(obj), stdout=subprocess.DEVNULL)

    created = False
    try:
        kubectl('create', '-f', '-', input=json.dumps({'apiVersion':'v1','kind':'Namespace',
                'metadata':{'name':ns,'labels':{'pod-security.kubernetes.io/enforce':'restricted'}}}),
                stdout=subprocess.DEVNULL)
        created = True
        print('Testing allow, deny, and recovery in ' + ns, flush=True)
        server = pod(ns, 'server', ['python', '-m', 'http.server', '8080', '--bind', '0.0.0.0'])
        server['spec']['containers'][0]['readinessProbe'] = {
            'tcpSocket': {'port': 8080}, 'periodSeconds': 2,
            'timeoutSeconds': 2, 'failureThreshold': 30}
        apply(server)
        apply(pod(ns, 'client', ['python', '-c', 'import time; time.sleep(1800)']))
        kubectl('wait', '-n', ns, 'pod', '--all', '--for=condition=Ready', '--timeout=90s', capture_output=True)
        ip = kubectl('get', 'pod', 'server', '-n', ns, '-o', 'jsonpath={.status.podIP}', capture_output=True).stdout.strip()
        policy = {'apiVersion':'networking.k8s.io/v1','kind':'NetworkPolicy',
                  'metadata':{'name':'deny-server','namespace':ns},
                  'spec':{'podSelector':{'matchLabels':{'app':'server'}},'policyTypes':['Ingress'],'ingress':[]}}
        controls(lambda: probe(ctx, ns, ip), lambda: apply(policy),
                 lambda: kubectl('delete', 'networkpolicy', 'deny-server', '-n', ns, capture_output=True))
        data = {'context':ctx,'allowedConnection':True,'deniedConnection':True,
                'recoveredConnection':True,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'testNamespace':ns}
        with output.open('x') as stream:
            stream.write(json.dumps(data, indent=2) + '\n')
        print('Network enforcement verified:', output)
        return 0
    except (RuntimeError, OSError, subprocess.SubprocessError):
        if created:
            print('Collecting test namespace diagnostics before cleanup:', flush=True)
            for args in [('get', 'pods', '-n', ns, '-o', 'wide'),
                         ('logs', 'server', '-n', ns, '--tail=20'),
                         ('get', 'events', '-n', ns, '--sort-by=.metadata.creationTimestamp'),
                         ('get', 'networkpolicy', '-n', ns)]:
                try:
                    result = subprocess.run(['kubectl', '--context', ctx, '--request-timeout=10s', *args],
                                            text=True, capture_output=True, timeout=15)
                    print(result.stdout or result.stderr, flush=True)
                except (OSError, subprocess.SubprocessError):
                    print('Could not retrieve ' + args[0] + ' diagnostics.', flush=True)
        raise
    finally:
        if created:
            try:
                kubectl('delete', 'namespace', ns, '--wait=false', '--ignore-not-found', capture_output=True)
                print('Cleanup requested for ' + ns + '; namespace termination may take a moment.')
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                print('WARNING: Cleanup failed. Delete only test namespace ' + ns + ' in context ' + ctx, file=sys.stderr)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print('ERROR:', error, file=sys.stderr)
        sys.exit(1)
