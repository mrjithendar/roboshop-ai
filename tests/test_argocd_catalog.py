"""Ownership and adoption contracts; no cluster mutations or network downloads."""
import importlib.util
from pathlib import Path
import yaml
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('catalog_validate',ROOT/'scripts/argocd/validate.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


def test_catalog_has_unique_safe_ownership():
    apps,owners=module.validate()
    names={app['metadata']['name'] for app in apps}
    assert {'coredns','kube-proxy','kindnet','shopping-agent','product-ingestion','openclaw'}<=names
    assert not {'argocd','traefik'}&names
    assert len(apps)==34
    assert owners[('apps','Deployment','roboshop-ai','mongodb')]=='mongodb'
    assert ('apps','StatefulSet','roboshop-ai','mongodb') not in owners
    assert owners[('apps','StatefulSet','roboshop-ai','kafka')]=='kafka-bridge'


def test_catalog_contains_only_projects_and_applications():
    assert all(doc['kind'] in ('Application','AppProject') for doc in module.catalog())
    assert not (ROOT/'minikube/openclaw/argocd/application.yaml').exists()
    assert (ROOT/'argocd/openclaw.yaml').is_file()


def test_adoption_baselines_have_no_credentials_or_server_metadata():
    for path in (ROOT/'minikube/gitops/adoption').glob('*/resources.yaml'):
        for doc in yaml.safe_load_all(path.read_text()):
            assert doc['kind']!='Secret'
            assert 'status' not in doc
            assert not {'uid','resourceVersion','managedFields','ownerReferences'}&doc['metadata'].keys()
            assert 'Prune=false' in doc['metadata']['annotations']['argocd.argoproj.io/sync-options']
            assert 'Delete=false' in doc['metadata']['annotations']['argocd.argoproj.io/sync-options']
            for container in doc.get('spec',{}).get('template',{}).get('spec',{}).get('containers',[]):
                for env in container.get('env',[]):
                    if any(term in env['name'].upper() for term in ('PASSWORD','TOKEN','SECRET','API_KEY')):
                        assert 'value' not in env,(path,env['name'])


def test_helm_releases_keep_names_and_pinned_versions():
    for doc in module.catalog():
        if doc['kind']!='Application':continue
        for source in doc['spec'].get('sources',[]):
            if 'chart' not in source:continue
            assert source['targetRevision'] not in ('HEAD','master','latest','*')
            assert source['helm']['releaseName']==doc['metadata']['name']
            for filename in source['helm']['valueFiles']:
                assert (ROOT/filename.removeprefix('$values/')).is_file()


def test_shared_namespace_has_valid_metadata():
    namespace,config=list(yaml.safe_load_all((ROOT/'minikube/roboshop/config.yaml').read_text()))
    assert 'LOG_FORMAT' not in namespace['metadata']
    assert config['data']['LOG_FORMAT']=='text'


def test_imperative_guard_refuses_existing_application(tmp_path):
    import os,subprocess
    binary=tmp_path/'kubectl'
    binary.write_text('#!/bin/sh\ncase "$*" in\n *"get crd"*) echo customresourcedefinition/applications.argoproj.io;;\n *) echo application.argoproj.io/grafana;;\nesac\n')
    binary.chmod(0o700)
    env={**os.environ,'PATH':str(tmp_path)+':'+os.environ['PATH']}
    result=subprocess.run(['bash',str(ROOT/'scripts/lib/check-argocd-ownership.sh'),'mk4','grafana'],env=env,text=True,capture_output=True)
    assert result.returncode==1
    assert 'Update Git and sync in Argo CD' in result.stderr


def test_imperative_guard_allows_unregistered_application(tmp_path):
    import os,subprocess
    binary=tmp_path/'kubectl'
    binary.write_text('#!/bin/sh\ncase "$*" in\n *"get crd"*) echo customresourcedefinition/applications.argoproj.io;;\nesac\n')
    binary.chmod(0o700)
    env={**os.environ,'PATH':str(tmp_path)+':'+os.environ['PATH']}
    result=subprocess.run(['bash',str(ROOT/'scripts/lib/check-argocd-ownership.sh'),'mk4','grafana'],env=env,text=True,capture_output=True)
    assert result.returncode==0
