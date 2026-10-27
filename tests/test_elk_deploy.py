import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('elk_deploy',Path(__file__).resolve().parents[1]/'scripts/observability/elk.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class DeployTests(unittest.TestCase):
    def test_preview_offline(self):
        with patch.object(m.subprocess,'check_output') as read, patch.object(m.subprocess,'check_call') as write:
            m.deploy('mk4',30,False)
            read.assert_not_called();write.assert_not_called()

    def test_ordered_fresh_install(self):
        events=[]
        def call(args,**kwargs):
            events.append(args)
            return ''
        with patch.object(m.subprocess,'check_output',side_effect=call),patch.object(m.subprocess,'check_call',side_effect=call):
            m.deploy('mk4',30,True)
        stages=[a[a.index('--app')+1] for a in events if '--app' in a]
        self.assertEqual(stages,['elk-operator','elk-core','elk-pipeline'])
        pipeline=next(i for i,a in enumerate(events) if '--app' in a and 'elk-pipeline' in a)
        es=next(i for i,a in enumerate(events) if 'elasticsearch/logs' in a)
        self.assertLess(es,pipeline)
        self.assertFalse(any('delete' in a for a in events))

    def test_external_operator_not_reinstalled(self):
        def read(args,**kwargs):
            if 'pods' in args:
                return json.dumps({'items':[{'metadata':{'namespace':'external','name':'operator'},'spec':{'containers':[{'image':'docker.elastic.co/eck/eck-operator:3.5.0'}]}}]})
            if 'get' in args and 'crd' in args and '--ignore-not-found' in args:return 'crd/exists'
            return ''
        with patch.object(m.subprocess,'check_output',side_effect=read),patch.object(m.subprocess,'check_call') as write:
            m.deploy('mk4',30,True)
        stages=[a.args[0][a.args[0].index('--app')+1] for a in write.call_args_list]
        self.assertEqual(stages,['elk-core','elk-pipeline'])

    def test_failed_readiness_stops_pipeline(self):
        def read(args,**kwargs):
            if 'elasticsearch/logs' in args:raise RuntimeError('not ready')
            return ''
        with patch.object(m.subprocess,'check_output',side_effect=read),patch.object(m.subprocess,'check_call') as write:
            with self.assertRaisesRegex(RuntimeError,'not ready'):m.deploy('mk4',30,True)
        self.assertFalse(any('elk-pipeline' in a.args[0] for a in write.call_args_list))

if __name__=='__main__':unittest.main()
