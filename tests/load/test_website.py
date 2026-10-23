import threading
import unittest
from unittest.mock import patch
import website


class WebsiteTests(unittest.TestCase):
    def test_only_public_page_allowed(self):
        self.assertEqual(website.validate_target(website.TARGET), website.TARGET)
        for url in ['https://jithendar.com/api/cart', 'http://jithendar.com/roboshop/',
                    'https://other.test/roboshop/', 'https://jithendar.com/roboshop/?token=x',
                    'https://user@jithendar.com/roboshop/']:
            with self.assertRaises(ValueError):website.validate_target(url)

    def test_success(self):
        result = website.stage(website.TARGET, 2, .02, .01, 1, 3, threading.Event(),
                               fetch=lambda *args: (200, .01, False))
        self.assertGreaterEqual(result['requests'], 2)
        self.assertFalse(result['stoppedEarly'])
        self.assertEqual(result['transportErrors'], 0)

    def test_error_and_latency_abort(self):
        for response in [(429, .01, False), (503, .01, False), (0, .01, True), (200, 4, False)]:
            stop=threading.Event()
            result=website.stage(website.TARGET, 1, 10, 1, 1, 3, stop, fetch=lambda *args: response)
            self.assertEqual(result['requests'], 1)
            self.assertTrue(result['stoppedEarly'])

    def test_curl_does_not_follow_redirects_or_read_user_configuration(self):
        with patch('website.subprocess.run') as run:
            run.return_value.stdout='200 0.5';run.return_value.returncode=0
            self.assertEqual(website.request(website.TARGET,1), (200,.5,False))
            args=run.call_args.args[0]
            self.assertEqual(args[1],'--disable')
            self.assertNotIn('--location',args)
            self.assertNotIn('--insecure',args)
