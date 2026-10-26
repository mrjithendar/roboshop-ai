import importlib.util
from pathlib import Path
from unittest.mock import patch
import pytest

spec = importlib.util.spec_from_file_location('bootstrap', Path(__file__).resolve().parents[1] / 'scripts/argocd/bootstrap.py')
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


def test_preview_is_offline():
    with patch('sys.argv', ['bootstrap', '--dry-run']), patch.object(bootstrap.subprocess, 'check_output') as read, patch.object(bootstrap.subprocess, 'check_call') as write:
        bootstrap.main()
    read.assert_not_called()
    write.assert_not_called()


def test_fresh_install_order_and_context():
    with patch('sys.argv', ['bootstrap', '--context', 'fresh', '--deploy-apps']), patch.object(bootstrap.shutil, 'which', return_value='/bin/tool'), patch.object(bootstrap.subprocess, 'check_output', side_effect=['namespace/kube-system', '', '--all-namespaces', '[]', '', '[]', '']), patch.object(bootstrap.subprocess, 'check_call') as write:
        bootstrap.main()
    commands = [call.args[0] for call in write.call_args_list]
    installs = [c for c in commands if c[0] == 'helm']
    assert [c[c.index('install') + 1] for c in installs] == ['cert-manager', 'traefik']
    assert all('--all' not in c for c in installs)
    argo = next(i for i,c in enumerate(commands) if 'install' in c and c[0] != 'helm')
    assert argo > commands.index(installs[-1])
    assert 'install' not in commands[-1]
    assert all('fresh' in c for c in commands)


def test_existing_argo_ownership_reused_without_helm_cert_install():
    responses = ['namespace', 'crd', 'application/cert-manager', '', '[{"status":"deployed"}]']
    with patch('sys.argv', ['bootstrap']), patch.object(bootstrap.shutil, 'which', return_value='/bin/tool'), patch.object(bootstrap.subprocess, 'check_output', side_effect=responses), patch.object(bootstrap.subprocess, 'check_call') as write:
        bootstrap.main()
    commands = [call.args[0] for call in write.call_args_list]
    assert 'cert-manager' in commands[0]
    assert 'deploy.py' in commands[0][1]
    assert not any(c[0] == 'helm' for c in commands)


def test_install_failure_stops_later_stages():
    with patch('sys.argv', ['bootstrap', '--deploy-apps']), patch.object(bootstrap.shutil, 'which', return_value='/bin/tool'), patch.object(bootstrap.subprocess, 'check_output', side_effect=['namespace', '', '', '[]', '']), patch.object(bootstrap.subprocess, 'check_call', side_effect=bootstrap.subprocess.CalledProcessError(1, 'helm')) as write:
        with pytest.raises(bootstrap.subprocess.CalledProcessError):
            bootstrap.main()
    assert write.call_count == 1
