import importlib.util
import json
from pathlib import Path
from unittest.mock import patch

import pytest

spec = importlib.util.spec_from_file_location('argocd_deploy', Path(__file__).resolve().parents[1] / 'scripts/argocd/deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


@pytest.fixture(autouse=True)
def no_external_writes():
    with patch.object(deploy.subprocess, 'check_call'):
        yield


def test_roboshop_preview_never_touches_cluster(capsys):
    with patch('sys.argv', ['deploy', 'roboshop', '--dry-run']), patch.object(deploy.subprocess, 'check_output') as run:
        deploy.main()
    run.assert_not_called()
    output = capsys.readouterr().out
    assert 'frontend' in output
    assert 'product-ingestion' not in output
    assert 'shopping-agent' not in output
    assert 'mongodb' not in output


def test_unknown_app_fails_before_cluster_access():
    with patch('sys.argv', ['deploy', 'frontend', 'typo']), patch.object(deploy.subprocess, 'check_output') as run:
        with pytest.raises(SystemExit):
            deploy.main()
    run.assert_not_called()


def test_existing_settings_preserved_and_no_pruning():
    app = {'metadata': {'name': 'frontend'}, 'spec': {'project': 'platform'},
           'status': {'operationState': {'phase': 'Succeeded'},
                      'sync': {'status': 'Synced'}, 'health': {'status': 'Healthy'}}}
    listing = json.dumps({'items': [app]})
    with patch('sys.argv', ['deploy', 'frontend']), patch.object(deploy.subprocess, 'check_output',
            side_effect=['crd/applications', 'crd/appprojects', listing, 'appproject/platform', 'patched\n', listing]) as run:
        deploy.main()
    commands = [call.args[0] for call in run.call_args_list]
    assert all('create' not in c and 'apply' not in c for c in commands)
    body = json.loads(run.call_args_list[4].kwargs['input'])
    assert set(body) == {'operation'}
    assert body['operation']['sync']['prune'] is False


@pytest.mark.parametrize('arguments', [[], ['all']])
def test_default_and_all_include_entire_catalog(arguments, capsys):
    with patch('sys.argv', ['deploy', *arguments, '--dry-run']), patch.object(deploy.subprocess, 'check_output') as run:
        deploy.main()
    run.assert_not_called()
    output = capsys.readouterr().out
    apps, _ = deploy.catalog()
    assert 'action: ' + ' '.join(sorted(apps)) in output
    for name in ('mongodb', 'moks', 'catalogue-service'):
        assert name in output

    for name in ('openclaw', 'jfrog', 'product-ingestion', 'shopping-agent'):
        assert name not in output


def test_status_missing_crd_has_actionable_error_without_mutation():
    with patch('sys.argv', ['deploy', 'status']), patch.object(deploy.subprocess, 'check_output', return_value='') as run:
        with pytest.raises(RuntimeError, match='deploy-argocd.sh'):
            deploy.main()
    assert len(run.call_args_list) == 1
    assert 'get' in run.call_args.args[0]


def test_install_preview_is_offline():
    with patch('sys.argv', ['deploy', 'install', '--dry-run']), patch.object(deploy.subprocess, 'check_output') as read, patch.object(deploy.subprocess, 'check_call') as write:
        deploy.main()
    read.assert_not_called()
    write.assert_not_called()


def test_fresh_install_uses_pinned_chart_and_absolute_values():
    with patch('sys.argv', ['deploy', 'install', '--context', 'fresh']), patch.object(deploy.shutil, 'which', return_value='/bin/helm'), patch.object(deploy.subprocess, 'check_output', side_effect=['  -A, --all-namespaces list across namespaces', '[]', '', 'established', 'established']), patch.object(deploy.subprocess, 'check_call') as write:
        deploy.main()
    command=write.call_args.args[0]
    assert 'fresh' in command
    assert deploy.ARGOCD_CHART_VERSION in command
    assert str(deploy.ROOT / 'minikube/argocd/values.yaml') in command
    assert '--wait' in command
    assert command[command.index('--repo') + 1] == 'https://argoproj.github.io/argo-helm'
    assert not any(arg.startswith('oci://') for arg in command)


def test_install_reuses_existing_release_without_upgrade():
    with patch('sys.argv', ['deploy', 'install']), patch.object(deploy.shutil, 'which', return_value='/bin/helm'), patch.object(deploy.subprocess, 'check_output', side_effect=['  -a, --all show all releases', '[{"status":"deployed"}]', 'established', 'established']), patch.object(deploy.subprocess, 'check_call') as write:
        deploy.main()
    write.assert_not_called()


def test_install_does_not_adopt_unmanaged_crds():
    with patch('sys.argv', ['deploy', 'install']), patch.object(deploy.shutil, 'which', return_value='/bin/helm'), patch.object(deploy.subprocess, 'check_output', side_effect=['', '[]', 'crd/applications']), patch.object(deploy.subprocess, 'check_call') as write:
        with pytest.raises(RuntimeError, match='Refusing automatic adoption'):
            deploy.main()
    write.assert_not_called()


@pytest.mark.parametrize('help_text,uses_all', [
    ('  -a, --all show all releases', True),
    ('      --all show all releases', True),
    ('  -A, --all-namespaces list all namespaces', False),
])
def test_helm_list_version_compatibility_and_pending_release(help_text, uses_all):
    with patch('sys.argv', ['deploy', 'install']), patch.object(deploy.shutil, 'which', return_value='/bin/helm'), patch.object(deploy.subprocess, 'check_output', side_effect=[help_text, '[{"status":"pending-upgrade"}]']) as read, patch.object(deploy.subprocess, 'check_call') as write:
        with pytest.raises(RuntimeError, match='not deployed'):
            deploy.main()
    command = read.call_args_list[1].args[0]
    assert ('--all' in command) == uses_all
    assert '--namespace' in command
    assert '--all-namespaces' not in command
    write.assert_not_called()


def test_missing_controller_installed_before_application_sync():
    healthy = {'metadata': {'name': 'frontend'}, 'spec': {'project': 'platform'},
               'status': {'operationState': {'phase': 'Succeeded'},
                          'sync': {'status': 'Synced'}, 'health': {'status': 'Healthy'}}}
    responses = ['', '--all-namespaces', '[]', '', 'established', 'established',
                 '{"items":[]}', 'appproject/platform', 'created', 'patched',
                 json.dumps({'items': [healthy]})]
    with patch('sys.argv', ['deploy', 'frontend', '--context', 'fresh']), patch.object(deploy.shutil, 'which', return_value='/bin/helm'), patch.object(deploy.subprocess, 'check_output', side_effect=responses) as read, patch.object(deploy.subprocess, 'check_call') as install:
        deploy.main()
    assert len([c for c in install.call_args_list if c.args[0][0] == 'helm']) == 1
    assert all('fresh' in c.args[0] for c in install.call_args_list)
    assert any('patch' in call.args[0] for call in read.call_args_list)


def test_failed_automatic_install_never_deploys_apps():
    with patch('sys.argv', ['deploy', 'frontend']), patch.object(deploy.shutil, 'which', return_value='/bin/helm'), patch.object(deploy.subprocess, 'check_output', side_effect=['', '', '[]', '']) as read, patch.object(deploy.subprocess, 'check_call', side_effect=deploy.subprocess.CalledProcessError(1, 'helm')):
        with pytest.raises(deploy.subprocess.CalledProcessError):
            deploy.main()
    assert not any('patch' in call.args[0] or 'create' in call.args[0] for call in read.call_args_list)


@pytest.mark.parametrize('existing', [False, True])
def test_cert_manager_sync_carries_namespace_and_ssa_options(existing):
    app = deploy.yaml.safe_load((deploy.ROOT / 'argocd/cert-manager.yaml').read_text())
    options = app['spec']['syncPolicy']['syncOptions']
    if existing:
        options.append('RespectIgnoreDifferences=true')
    app['status'] = {'operationState': {'phase': 'Succeeded'},
                     'sync': {'status': 'Synced'}, 'health': {'status': 'Healthy'}}
    responses = ['crd/applications', 'crd/appprojects', json.dumps({'items': [app] if existing else []}), 'appproject/platform']
    if not existing:
        responses.append('created')
    responses += ['patched', json.dumps({'items': [app]})]
    with patch('sys.argv', ['deploy', 'cert-manager']), patch.object(deploy.subprocess, 'check_output', side_effect=responses) as run:
        deploy.main()
    call = next(c for c in run.call_args_list if 'patch' in c.args[0])
    sync = json.loads(call.kwargs['input'])['operation']['sync']
    assert sync['syncOptions'] == options
    assert 'CreateNamespace=true' in sync['syncOptions']
    assert 'ServerSideApply=true' in sync['syncOptions']
    assert sync['prune'] is False


def test_pending_install_reused_only_after_workload_and_crd_checks():
    with patch('sys.argv', ['deploy', 'install']), patch.object(deploy.shutil, 'which', return_value='/bin/helm'), patch.object(deploy.subprocess, 'check_output', side_effect=['', '[{"status":"pending-install"}]'] + ['ready'] * 6) as read, patch.object(deploy.subprocess, 'check_call') as write:
        deploy.main()
    commands = [c.args[0] for c in read.call_args_list]
    assert len([c for c in commands if 'rollout' in c]) == 4
    assert len([c for c in commands if 'wait' in c]) == 2
    write.assert_not_called()


def test_unhealthy_pending_install_stops_without_release_mutation():
    with patch('sys.argv', ['deploy', 'install']), patch.object(deploy.shutil, 'which', return_value='/bin/helm'), patch.object(deploy.subprocess, 'check_output', side_effect=['', '[{"status":"pending-install"}]', deploy.subprocess.CalledProcessError(1, 'kubectl')]), patch.object(deploy.subprocess, 'check_call') as write:
        with pytest.raises(deploy.subprocess.CalledProcessError):
            deploy.main()
    write.assert_not_called()


def test_namespace_applied_before_sync_and_deduplicated():
    app = deploy.catalog()[0]['frontend']
    app['status'] = {'operationState': {'phase': 'Succeeded'}, 'sync': {'status': 'Synced'}, 'health': {'status': 'Healthy'}}
    events = []
    responses = iter(['crd', 'crd', json.dumps({'items':[app]}), 'project', 'patched', json.dumps({'items':[app]})])
    def read(command, **kwargs):
        events.append(command)
        return next(responses)
    with patch('sys.argv', ['deploy', 'frontend', 'frontend']), patch.object(deploy.subprocess, 'check_output', side_effect=read), patch.object(deploy.subprocess, 'check_call', side_effect=lambda c: events.append(c)):
        deploy.main()
    applies = [c for c in events if 'apply' in c]
    assert len(applies) == 1
    assert applies[0][-1].endswith('/minikube/namespaces/roboshop-ai.yaml')
    assert '--server-side' in applies[0]
    assert events.index(applies[0]) < next(i for i,c in enumerate(events) if 'patch' in c)


def test_all_catalog_destinations_have_namespace_manifests():
    for app in deploy.catalog()[0].values():
        namespace = app['spec']['destination']['namespace']
        doc = deploy.yaml.safe_load((deploy.ROOT / 'minikube/namespaces' / f'{namespace}.yaml').read_text())
        assert doc == {'apiVersion':'v1', 'kind':'Namespace', 'metadata':{'name':namespace}}
