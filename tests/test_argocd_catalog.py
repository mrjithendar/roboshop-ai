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
    assert {'moks','catalogue-service'} <= names
    assert not {'shopping-agent','product-ingestion','jfrog'} & names
    assert not {'argocd','traefik','coredns','kube-proxy','kindnet'}&names
    assert len(apps)==24  # frontend + nginx consolidated into web
    assert owners[('apps','Deployment','roboshop-ai','web')]=='web'
    assert 'cert-manager' not in names
    assert owners[('apps','Deployment','roboshop-ai','mongodb')]=='mongodb'
    assert ('apps','StatefulSet','roboshop-ai','mongodb') not in owners
    assert owners[('apps','StatefulSet','roboshop-ai','kafka')]=='kafka-bridge'


def test_catalog_contains_only_projects_and_applications():
    assert all(doc['kind'] in ('Application','AppProject') for doc in module.catalog())


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
    namespace=yaml.safe_load((ROOT/'minikube/roboshop/roboshop-ai-namespace.yaml').read_text())
    config=yaml.safe_load((ROOT/'minikube/roboshop/roboshop-config-configmap.yaml').read_text())
    assert 'LOG_FORMAT' not in namespace['metadata']
    assert config['data']['LOG_FORMAT']=='json'


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


def test_inventory_excludes_cluster_managed_networking():
    import json
    inventory=json.loads((ROOT/'argocd/workload-inventory.json').read_text())
    assert not any(namespace=='kube-system' and name in {'coredns','kindnet','kube-proxy'}
                   for kind,namespace,name in inventory)
    assert ['Deployment','kube-system','metrics-server'] in inventory


def test_required_inventory_matches_active_catalog_and_rejects_missing_workloads():
    import json
    import pytest
    expected={tuple(row) for row in json.loads((ROOT/'argocd/workload-inventory.json').read_text())}
    assert not any(name in ('product-ingestion','shopping-agent') for _,ns,name in expected)
    assert ('Deployment','roboshop-ai','moks') in expected
    assert ('Deployment','roboshop-ai','catalogue-service') in expected
    module.validate_inventory(expected)
    # Every remaining entry stays mandatory, including chart-generated workloads.
    for workload in expected:
        with pytest.raises(AssertionError, match='Unmanaged workloads'):
            module.validate_inventory(expected-{workload})


def test_external_validation_calls_required_inventory(monkeypatch):
    # Mock Helm rendering, not the coverage assertion. Missing chart workloads must fail.
    original=module.render
    monkeypatch.setattr(module,'render',lambda app,external=False: original(app,False))
    import pytest
    with pytest.raises(AssertionError,match='Unmanaged workloads'):
        module.validate(external=True)


def test_frontend_and_nginx_are_retired_into_web():
    import json
    import yaml
    inventory={tuple(row) for row in json.loads((ROOT/'argocd/workload-inventory.json').read_text())}
    assert ('Deployment','roboshop-ai','web') in inventory
    assert not {('Deployment','roboshop-ai','frontend'),('Deployment','roboshop-ai','nginx')} & inventory
    resources=yaml.safe_load((ROOT/'argocd/kustomization.yaml').read_text())['resources']
    assert 'web.yaml' in resources and not {'frontend.yaml','nginx.yaml'} & set(resources)
    assert not (ROOT/'services/frontend').exists() and not (ROOT/'services/nginx').exists()
    for name in ('roboshop-ingress.yaml','roboshop-http-ingress.yaml'):
        ingress=yaml.safe_load((ROOT/'minikube/roboshop'/name).read_text())
        assert ingress['spec']['rules'][0]['http']['paths'][0]['backend']['service']['name']=='web'


def test_retired_ingestion_has_no_deployable_or_runtime_references():
    assert not (ROOT/'services/product-ingestion').exists()
    assert not (ROOT/'minikube/gitops/adoption/product-ingestion').exists()
    assert not (ROOT/'argocd/product-ingestion.yaml').exists()
    for directory in ('services', 'scripts', 'argocd', '.github/workflows', 'infrastructure', 'minikube'):
        for path in (ROOT/directory).rglob('*'):
            if not path.is_file() or path.suffix not in ('.py','.mjs','.sh','.yaml','.yml','.tf'):
                continue
            if any(part in ('node_modules','.venv','__pycache__','.terraform','build') for part in path.parts):
                continue
            text=path.read_text()
            assert 'product-ingestion' not in text,path
            assert 'INGESTION_URL' not in text,path
