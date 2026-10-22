#!/usr/bin/env python3
"""Prepare Minikube PVC ownership before non-root data-store init containers."""
import sys
import yaml
for resource in yaml.safe_load_all(sys.stdin):
    if not resource:
        continue
    name = resource.get('metadata', {}).get('name')
    if resource.get('kind') in ('Deployment', 'StatefulSet') and name in ('langfuse-postgresql','langfuse-redis'):
        uid, volume = (999,'postgres-data') if name.endswith('postgresql') else (1000,'valkey-data')
        resource['spec']['template']['spec']['initContainers'].insert(0, {
            'name':'prepare-data-permissions','image':'busybox:1.37.0',
            'command':['sh','-ec',f'chown -R {uid}:{uid} /data; chmod 750 /data'],
            'securityContext':{'runAsUser':0,'runAsGroup':0,'runAsNonRoot':False,'allowPrivilegeEscalation':False,'capabilities':{'drop':['ALL'],'add':['CHOWN','FOWNER','DAC_OVERRIDE']}},
            'resources':{'requests':{'cpu':'10m','memory':'16Mi'},'limits':{'cpu':'100m','memory':'64Mi'}},
            'volumeMounts':[{'name':volume,'mountPath':'/data'}]})
    print(yaml.safe_dump(resource, sort_keys=False), end='---\n')
