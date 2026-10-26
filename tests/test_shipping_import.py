import base64
import gzip
from pathlib import Path
import subprocess
import yaml

ROOT=Path(__file__).resolve().parents[1]


def test_seed_copy_matches_sql_and_configmap_size():
    source=ROOT/'services/postgres'
    assert gzip.decompress((source/'shipping.sql.gz').read_bytes())==(source/'shipping.sql').read_bytes()
    docs=list(yaml.safe_load_all(subprocess.check_output(['kubectl','kustomize',str(source)],text=True)))
    cm=next(d for d in docs if d['kind']=='ConfigMap')
    assert len(base64.b64decode(cm['binaryData']['shipping.sql.gz'])) < 1024*1024
    job=next(d for d in docs if d['kind']=='Job')
    assert job['metadata']['annotations']['argocd.argoproj.io/sync-wave']=='1'
    spec=job['spec']['template']['spec']
    assert spec['volumes'][0]['configMap']['name']==cm['metadata']['name']
    assert 'pipefail' in spec['containers'][0]['args'][0]
    assert 'ON_ERROR_STOP=1' in spec['containers'][0]['args'][0]
    app=yaml.safe_load((ROOT/'argocd/postgres.yaml').read_text())
    assert 'directory' not in app['spec']['source']
    assert 'ServerSideApply=true' in app['spec']['syncPolicy']['syncOptions']
