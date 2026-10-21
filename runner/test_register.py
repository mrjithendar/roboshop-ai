import unittest
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError
from setup_lab.docker.runner.register import registration_token


class RegistrationTests(unittest.TestCase):
    def test_password_registration_token_does_not_call_api(self):
        with patch('urllib.request.urlopen') as request:
            self.assertEqual(registration_token({'password': 'REGISTRATION_TOKEN'}, 'owner/repo'), 'REGISTRATION_TOKEN')
            request.assert_not_called()

    def test_password_pat_exchanged_for_registration_token(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"token":"fresh-registration"}'
        with patch('urllib.request.urlopen', return_value=response) as request:
            self.assertEqual(registration_token({'password': 'github_pat_example'}, 'owner/repo'), 'fresh-registration')
            self.assertEqual(request.call_args.args[0].full_url, 'https://api.github.com/repos/owner/repo/actions/runners/registration-token')
            self.assertEqual(request.call_args.args[0].get_header('Authorization'), 'Bearer github_pat_example')

    def test_invalid_secrets_rejected(self):
        for secret in ({}, {'password': ''}, {'password': 'a\nb'}, {'github_token': 123}, 'text'):
            with self.subTest(secret=secret), self.assertRaises(ValueError):
                registration_token(secret, 'owner/repo')

    def test_api_error_does_not_disclose_token(self):
        with patch('urllib.request.urlopen', side_effect=HTTPError('url', 403, 'denied', {}, None)):
            with self.assertRaisesRegex(ValueError, 'HTTP 403'):
                registration_token({'github_token': 'ghp_example'}, 'owner/repo')

    def test_pat_in_runner_token_rejected_with_actionable_message(self):
        with patch('urllib.request.urlopen') as request:
            with self.assertRaisesRegex(ValueError, 'Store it under github_token'):
                registration_token({'runner_token': 'github_pat_example'}, 'owner/repo')
            request.assert_not_called()

    def test_github_pat_field_exchanged_for_registration_token(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"token":"fresh-registration"}'
        with patch('urllib.request.urlopen', return_value=response) as request:
            self.assertEqual(registration_token({'github_pat': 'github_pat_example'}, 'owner/repo'), 'fresh-registration')
            self.assertEqual(request.call_args.args[0].get_header('Authorization'), 'Bearer github_pat_example')
            self.assertEqual(request.call_args.args[0].full_url, 'https://api.github.com/repos/owner/repo/actions/runners/registration-token')
