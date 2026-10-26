import base64
import importlib.util
import json
from pathlib import Path
from unittest.mock import Mock
import pytest
import yaml

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('refresh_job',ROOT/'minikube/ecr-refresh/refresh.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
TOKEN=base64.b64encode(b'AWS:private-password').decode()


def test_updates_named_secret_preserves_other_registries_and_redacts(capsys):
    existing={'type':'kubernetes.io/dockerconfigjson','metadata':{'resourceVersion':'7'},'data':{'.dockerconfigjson':base64.b64encode(json.dumps({'auths':{'other':{'auth':'keep'}}}).encode()).decode()}}
    request=Mock(side_effect=[existing,{}])
    module.refresh('registry',['roboshop-ai'],request,TOKEN)
    method,path,body=request.call_args.args
    assert method=='PATCH' and path.endswith('/secrets/ecr-pull')
    assert body['metadata']['resourceVersion']=='7'
    config=json.loads(base64.b64decode(body['data']['.dockerconfigjson']))
    assert config['auths']=={'other':{'auth':'keep'},'registry':{'auth':TOKEN}}
    output=capsys.readouterr().out
    assert TOKEN not in output and 'private-password' not in output


def test_failure_does_not_delete_and_is_nonzero(capsys):
    request=Mock(side_effect=RuntimeError('sensitive-response'))
    with pytest.raises(RuntimeError):
        module.refresh('registry',['a','b'],request,TOKEN)
    assert all(c.args[0]=='GET' for c in request.call_args_list)
    assert 'sensitive-response' not in capsys.readouterr().out


def test_invalid_token_never_contacts_kubernetes():
    request=Mock()
    with pytest.raises(Exception): module.refresh('registry',['a'],request,'invalid')
    request.assert_not_called()


def test_schedule_rbac_and_public_images():
    docs=list(yaml.safe_load_all((ROOT/'minikube/ecr-refresh/resources.yaml').read_text()))
    cron=next(d for d in docs if d['kind']=='CronJob')['spec']
    assert cron['schedule']=='0 */6 * * *' and cron['concurrencyPolicy']=='Forbid'
    assert cron['jobTemplate']['spec']['activeDeadlineSeconds']==300
    pod=cron['jobTemplate']['spec']['template']['spec']
    assert not pod['automountServiceAccountToken']
    assert all('.dkr.ecr.' not in c['image'] for c in pod['containers']+pod['initContainers'])
    assert not any(m['name']=='api' for m in pod['initContainers'][0]['volumeMounts'])
    for role in (d for d in docs if d['kind']=='Role'):
        assert role['rules']==[{'apiGroups':[''],'resources':['secrets'],'resourceNames':['ecr-pull'],'verbs':['get','patch']}]
