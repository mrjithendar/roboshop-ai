import unittest
from configure import tls_patch


class RoutingTests(unittest.TestCase):
    def ingress(self, hosts=None, secret='jithendar-com-tls', ingress_class='traefik'):
        return {'spec':{'ingressClassName':ingress_class,'tls':[{'hosts':hosts or ['jithendar.com'],'secretName':secret}]}}

    def test_only_shared_secret_reference_removed(self):
        self.assertEqual(tls_patch(self.ingress()), [{'op':'remove','path':'/spec/tls/0/secretName'}])

    def test_unrelated_hosts_secrets_and_controllers_preserved(self):
        for value in [self.ingress(['jfrog.jithendar.com']),self.ingress(['jithendar.com','other.com']),self.ingress(secret='custom-tls'),self.ingress(ingress_class='nginx')]:
            self.assertEqual(tls_patch(value), [])

    def test_rerun_is_noop_and_keeps_tls_enabled(self):
        ingress=self.ingress()
        del ingress['spec']['tls'][0]['secretName']
        self.assertEqual(tls_patch(ingress), [])
        self.assertEqual(ingress['spec']['tls'][0]['hosts'], ['jithendar.com'])
