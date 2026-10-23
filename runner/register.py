#!/usr/bin/env python3
"""Obtain fresh registration tokens using a GitHub login or optional AWS secret."""

# CentOS-only operator command; imports remain usable by isolated tests.
if __name__ == '__main__':
    import sys as _host_sys
    if not any(arg in ('--help', '-h') for arg in _host_sys.argv[1:]):
        import subprocess as _host_subprocess
        from pathlib import Path as _HostPath
        _host_gate = _HostPath(__file__).resolve().parent / '..' / 'scripts/lib/require-centos.sh'
        if _host_subprocess.call(['bash', str(_host_gate)]):
            raise SystemExit(1)

import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request


class RegistrationError(ValueError):
    """Safe diagnostic text that never includes secret contents."""



def aws_retrieval_reason(stderr):
    """Classify CLI failures without emitting raw responses or credential values."""
    match = re.search(r'An error occurred \(([A-Za-z0-9]+)\)', stderr or '')
    code = match.group(1) if match else ''
    reasons = {
        'AccessDeniedException': 'Access denied: grant secretsmanager:GetSecretValue and, for a customer-managed key, kms:Decrypt.',
        'ResourceNotFoundException': 'Secret not found: check the secret name, AWS account and region.',
        'UnrecognizedClientException': 'AWS credentials are invalid; check the active profile and environment credentials.',
        'InvalidClientTokenId': 'AWS credentials are invalid; check the active profile and environment credentials.',
        'ExpiredTokenException': 'AWS session credentials expired; refresh the session.',
        'ExpiredToken': 'AWS session credentials expired; refresh the session.',
        'DecryptionFailure': 'AWS cannot decrypt the secret; check its KMS key and permissions.',
    }
    if code in reasons:
        return reasons[code]
    if 'Unable to locate credentials' in (stderr or ''):
        return 'No AWS credentials found for the invoking user; configure a profile or workload role.'
    if 'Could not connect to the endpoint URL' in (stderr or ''):
        return 'Cannot reach Secrets Manager; check region, DNS, proxy and outbound HTTPS.'
    return 'Check credentials, secret name/region and read permissions.'


def registration_token(secret, repo):
    if not isinstance(secret, dict):
        raise RegistrationError('Secret must be JSON with github_token, github_pat or runner_token.')
    key = next((key for key in ('github_token', 'github_pat', 'runner_token', 'password') if key in secret), 'runner_token')
    token = secret.get(key)
    if not isinstance(token, str) or not token.strip() or any(c.isspace() for c in token):
        raise RegistrationError('Set github_token (GitHub access token) or runner_token (fresh registration token) in the configured AWS secret. A generated password cannot register a runner.')
    if key == 'runner_token' and token.startswith(('ghp_', 'github_pat_')):
        raise RegistrationError('runner_token contains a personal access token. Store it under github_token so setup exchanges it for a registration token.')
    if key == 'runner_token' or (key == 'password' and not token.startswith(('ghp_', 'github_pat_'))):
        return token
    request = urllib.request.Request(
        f'https://api.github.com/repos/{repo}/actions/runners/registration-token',
        data=b'', method='POST', headers={
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        })
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RegistrationError(f'GitHub registration request failed (HTTP {error.code}); check token permissions and repository access.') from None
    except urllib.error.URLError:
        raise RegistrationError('Cannot connect to GitHub to obtain a registration token.') from None
    token = result.get('token')
    if not isinstance(token, str) or not token:
        raise RegistrationError('GitHub did not return a registration token.')
    return token


def load_credentials():
    mode = os.getenv('RUNNER_AUTH', 'auto')
    if mode not in ('auto', 'github', 'aws'):
        raise RegistrationError('RUNNER_AUTH must be auto, github or aws.')
    if mode != 'aws':
        token = os.getenv('GH_TOKEN') or os.getenv('GITHUB_TOKEN')
        if token:
            return {'github_token': token}
        if shutil.which('gh'):
            try:
                result = subprocess.run(['gh', 'auth', 'token', '--hostname', 'github.com'], capture_output=True, text=True, timeout=15)
            except subprocess.TimeoutExpired:
                raise RegistrationError('GitHub CLI authentication lookup timed out.') from None
            if result.returncode == 0 and result.stdout.strip():
                return {'github_token': result.stdout.strip()}
        if mode == 'github':
            raise RegistrationError('GitHub authentication required: run gh auth login --hostname github.com --web, or set GH_TOKEN to a PAT with repository Administration write permission. Setup requests a fresh registration token automatically.')
    result = subprocess.run([
        'aws', 'secretsmanager', 'get-secret-value', '--secret-id', os.environ.get('RUNNER_SECRET_NAME', 'mrjithendar-github-pat'),
        '--region', os.environ.get('AWS_REGION', 'us-east-1'), '--output', 'json',
    ], check=True, capture_output=True, text=True)
    return json.loads(json.loads(result.stdout)['SecretString'])


def main():
    repo, name = sys.argv[1:]
    secret = load_credentials()
    print(f'Registering runner for https://github.com/{repo}', flush=True)
    token = registration_token(secret, repo)
    env = os.environ.copy()
    # Do not let config.sh/env.sh persist the long-lived bootstrap PAT.
    env.pop('GH_TOKEN', None)
    env.pop('GITHUB_TOKEN', None)
    env['ACTIONS_RUNNER_INPUT_TOKEN'] = token
    try:
        subprocess.run(['./config.sh', '--unattended', '--url', 'https://github.com/' + repo,
                        '--name', name, '--work', '_work'], env=env, check=True)
    except subprocess.CalledProcessError:
        raise RegistrationError('GitHub rejected runner configuration. Verify the printed repository URL. If using runner_token/password, obtain a fresh repository registration token (valid one hour) from that exact repository, not organization settings. Alternatively use github_token with repository Administration write access. Installed tools and runner files are preserved; rerunning setup will reuse them. Refresh your GitHub login or configured credentials before retrying.') from None


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        if error.cmd[0] == 'aws':
            print('AWS secret retrieval unavailable. ' + aws_retrieval_reason(error.stderr) + ' Registration is pending; no secret contents were logged.', file=sys.stderr)
            sys.exit(75)  # Setup may defer only AWS retrieval failures, not configuration errors.
        sys.exit('Runner configuration failed. See the runner output above; AWS secret retrieval succeeded.')
    except RegistrationError as error:
        sys.exit(str(error))
    except (ValueError, KeyError):
        # Never include malformed secret contents in error output.
        sys.exit('Runner registration failed. The configured secret must contain a valid github_token, github_pat, runner_token, or password token; verify GitHub repository administration permissions.')
