import importlib.util
import json
from pathlib import Path
from unittest.mock import patch

import pytest

spec = importlib.util.spec_from_file_location('argocd_deploy', Path(__file__).resolve().parents[1] / 'scripts/argocd/deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


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
            side_effect=[listing, 'appproject/platform', 'patched\n', listing]) as run:
        deploy.main()
    commands = [call.args[0] for call in run.call_args_list]
    assert all('create' not in c and 'apply' not in c for c in commands)
    body = json.loads(run.call_args_list[2].kwargs['input'])
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
