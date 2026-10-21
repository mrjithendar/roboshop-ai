#!/usr/bin/env python3
"""Fetch installation credentials without printing or persisting the AWS secret."""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request


class RegistrationError(ValueError):
    """Safe diagnostic text that never includes secret contents."""


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


def main():
    repo, name = sys.argv[1:]
    result = subprocess.run([
        'aws', 'secretsmanager', 'get-secret-value', '--secret-id', os.environ.get('RUNNER_SECRET_NAME', 'roboshop-ai'),
        '--region', os.environ.get('AWS_REGION', 'us-east-1'), '--output', 'json',
    ], check=True, capture_output=True, text=True)
    secret = json.loads(json.loads(result.stdout)['SecretString'])
    print(f'Registering runner for https://github.com/{repo}', flush=True)
    token = registration_token(secret, repo)
    env = os.environ.copy()
    env['ACTIONS_RUNNER_INPUT_TOKEN'] = token
    try:
        subprocess.run(['./config.sh', '--unattended', '--url', 'https://github.com/' + repo,
                        '--name', name, '--work', '_work'], env=env, check=True)
    except subprocess.CalledProcessError:
        raise RegistrationError('GitHub rejected runner configuration. Verify the printed repository URL. If using runner_token/password, obtain a fresh repository registration token (valid one hour) from that exact repository, not organization settings. Alternatively use github_token with repository Administration write access. The WordPress password cannot register a runner.') from None


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        if error.cmd[0] == 'aws':
            sys.exit('AWS secret retrieval failed. Check the configured secret and region as the invoking user.')
        sys.exit('Runner configuration failed. See the runner output above; AWS secret retrieval succeeded.')
    except RegistrationError as error:
        sys.exit(str(error))
    except (ValueError, KeyError):
        # Never include malformed secret contents in error output.
        sys.exit('Runner registration failed. The configured secret must contain a valid github_token, github_pat, runner_token, or password token; verify GitHub repository administration permissions.')
