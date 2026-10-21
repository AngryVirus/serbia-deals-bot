import contextlib
import copy
import io
import unittest
from unittest.mock import patch

from collector import operations


GROUPS=('ui','search','basket','language','handler','quality','advertising')


def diagnostics(active=True):
    return {
        'revision':27,
        'routing':{'in_sync':active,'pending':0},
        **{name:{'ok':True} for name in GROUPS},
        'handler':{'ok':True,'active':active},
    }


class DiagnosticTests(unittest.TestCase):
    def test_healthy_active_release_accepts_live_pending_updates(self):
        result=diagnostics()
        result['routing']['pending']=15
        self.assertEqual(operations.diagnostic_failures(result),[])

    def test_paused_bootstrap_does_not_require_a_synchronized_webhook(self):
        for routing in ({'in_sync':False,'pending':0},None):
            result=diagnostics(active=False)
            result['routing']=routing
            self.assertEqual(operations.diagnostic_failures(result),[])

    def test_every_required_group_must_explicitly_pass(self):
        for group in GROUPS:
            for section in (None,False,[],{'ok':False},{'ok':1},{},'unexpected'):
                with self.subTest(group=group,section=section):
                    result=diagnostics()
                    result[group]=copy.deepcopy(section)
                    self.assertIn(group,operations.diagnostic_failures(result))
            result=diagnostics()
            del result[group]
            self.assertIn(group,operations.diagnostic_failures(result))

    def test_invalid_top_level_revision_and_handler_state_fail(self):
        for result in (None,False,[],27,'unexpected'):
            self.assertEqual(operations.diagnostic_failures(result),['diagnostics.shape'])
        for revision in (None,False,True,0,-1,27.0,'27'):
            result=diagnostics();result['revision']=revision
            self.assertIn('revision',operations.diagnostic_failures(result))
        for active in (None,0,1,'true',[],{}):
            result=diagnostics();result['handler']['active']=active
            self.assertIn('handler.active',operations.diagnostic_failures(result))

    def test_active_bot_requires_explicit_synchronization(self):
        for routing in (None,[],{},False,{'in_sync':False},{'in_sync':1}):
            result=diagnostics();result['routing']=routing
            self.assertIn('routing.in_sync',operations.diagnostic_failures(result))

    def test_preflight_allows_different_sources_but_postdeploy_requires_a_match(self):
        for deployed in (None,False,[],{}, {'matches_local':False},{'matches_local':1}):
            result=diagnostics();result['deployed']=deployed
            self.assertEqual(operations.diagnostic_failures(result),[])
            self.assertIn('deployed',operations.diagnostic_failures(result,require_deployed=True))
        for active in (True,False):
            result=diagnostics(active);result['deployed']={'matches_local':True}
            self.assertEqual(operations.diagnostic_failures(result,require_deployed=True),[])

    def test_require_deployed_flag_blocks_success_for_other_installed_code(self):
        result=diagnostics();result['deployed']={'matches_local':False,'detail':'PRIVATE-CODE-NOT-FOR-LOGS'}
        output=io.StringIO()
        with patch('sys.argv',['operations','diagnose','--require-deployed']),patch.object(operations,'call',return_value=result),patch.object(operations,'invoke') as invoke,contextlib.redirect_stdout(output):
            with self.assertRaises(SystemExit) as raised:
                operations.main()
        self.assertEqual(str(raised.exception),'Runtime diagnostics failed: deployed')
        self.assertEqual(output.getvalue(),'')
        invoke.assert_not_called()

    def test_failed_command_exits_before_extra_probes_without_dumping_payload(self):
        result=diagnostics()
        result['advertising']={'ok':False,'detail':'PRIVATE-PAYLOAD-NOT-FOR-LOGS'}
        output=io.StringIO()
        with patch('sys.argv',['operations','diagnose']),patch.object(operations,'call',return_value=result) as call,patch.object(operations,'invoke') as invoke,contextlib.redirect_stdout(output):
            with self.assertRaises(SystemExit) as raised:
                operations.main()
        self.assertEqual(str(raised.exception),'Runtime diagnostics failed: advertising')
        self.assertEqual(output.getvalue(),'')
        call.assert_called_once_with('diagnose')
        invoke.assert_not_called()

    def test_successful_command_runs_remaining_safe_probes(self):
        for active in (True,False):
            with self.subTest(active=active):
                with patch('sys.argv',['operations','diagnose']),patch.object(operations,'call',side_effect=[diagnostics(active),{'ban_bytes':1,'unban_bytes':1}]) as call,patch.object(operations,'invoke',return_value={'items':0}) as invoke,contextlib.redirect_stdout(io.StringIO()) as output:
                    operations.main()
                self.assertIn('Safe runtime diagnostics:',output.getvalue())
                invoke.assert_called_once_with('basket_check')
                self.assertEqual(call.call_count,2)
                self.assertEqual(call.call_args.args,('moderation',))


if __name__=='__main__':
    unittest.main()
