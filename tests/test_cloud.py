import json
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from collector import cloud


class CloudPacingTests(unittest.TestCase):
    def test_long_read_only_diagnostics_have_a_separate_timeout(self):
        for command,timeout in [('diagnose',600),('deploy',300),('run',90)]:
            with self.subTest(command=command),patch.dict('os.environ',{'TGCLOUD_TOKEN':'test-only'}), \
                 patch.object(cloud,'LAST',0),patch.object(cloud.time,'sleep'), \
                 patch.object(cloud.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=json.dumps({'ok':True,'result':{}}))) as run:
                cloud.call(command)
                self.assertEqual(run.call_args.kwargs['timeout'],timeout)

    def test_timeout_never_repeats_an_ambiguous_write_or_echoes_details(self):
        with patch.dict('os.environ',{'TGCLOUD_TOKEN':'test-only'}),patch.object(cloud.time,'sleep'), \
             patch.object(cloud.subprocess,'run',side_effect=subprocess.TimeoutExpired('private command',90)) as run:
            with self.assertRaises(RuntimeError) as error:cloud.invoke('chunk',source='private')
        self.assertEqual(run.call_count,1);self.assertNotIn('private',str(error.exception))

    def test_separate_control_requests_are_spaced(self):
        stamp=[100.0]
        def sleep(seconds):stamp[0]+=seconds
        with patch.dict('os.environ',{'TGCLOUD_TOKEN':'test-only'}),patch.object(cloud,'LAST',0), \
             patch.object(cloud.time,'monotonic',side_effect=lambda:stamp[0]),patch.object(cloud.time,'sleep',side_effect=sleep), \
             patch.object(cloud.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=json.dumps({'ok':True,'result':{}}))):
            cloud.call();self.assertEqual(stamp[0],100);cloud.call();self.assertEqual(stamp[0],106)
