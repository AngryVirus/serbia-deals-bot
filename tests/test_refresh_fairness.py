import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError,URLError
from collector import collect


class RefreshFairnessTests(unittest.TestCase):
    sources=[{'id':c*24,'alias':alias,'name':alias,'hosts':['data.gov.rs']} for c,alias in [('a','small'),('b','large')]]
    stats={'date':'2026-10-25','rows':1,'accepted':1,'rejected':0,'conflicts':0,'duplicates':0}

    def test_failure_diagnoses_follow_wrapped_errors_without_echoing_credentials(self):
        wrapped=ValueError('No usable current resource')
        wrapped.__cause__=HTTPError('https://example.org/prices?sig=private',403,'private',{},None)
        self.assertEqual(collect.failure_category(wrapped),'http_403')
        wrapped.__cause__=ValueError('Price list older than two days')
        self.assertEqual(collect.failure_category(wrapped),'stale_prices')
        self.assertEqual(collect.failure_category(URLError('private proxy details')),'network_error')
        self.assertEqual(collect.failure_category(ValueError('https://example.org/?sig=private')),'source_error')

    def root(self,path):
        root=Path(path);(root/'collector').mkdir()
        (root/'collector/sources.json').write_text(json.dumps(self.sources))
        return root

    def metadata(self,source,resources=True):
        return json.dumps({'id':source['id'],'license':'sodl','resources':[
            {'title':'Current','format':'csv','url':'https://data.gov.rs/prices.csv'}] if resources else []}).encode()

    def test_cleanup_backlog_cannot_starve_the_next_store(self):
        clock=[0];calls=[]
        def invoke(op,**fields):
            clock[0]+=1;calls.append((op,fields))
            if op=='begin':return {'done':[]}
            if op=='finish':return {'published':True}
            if op=='cleanup':return {'cleanup':True}  # arbitrarily large history
            return {}
        with tempfile.TemporaryDirectory() as path:
            root=self.root(path)
            with patch.object(collect,'ROOT',root),patch('sys.argv',['collect','--publish','--sources','small,large','--budget','60']), \
                 patch.object(collect.time,'monotonic',side_effect=lambda:clock[0]),patch.object(collect,'invoke',side_effect=invoke), \
                 patch.object(collect,'Fetcher') as fetcher,patch.object(collect,'parse_prices',return_value=([{'name':'Example'}],self.stats)), \
                 contextlib.redirect_stdout(io.StringIO()):
                fetcher.return_value.read.side_effect=[self.metadata(self.sources[0]),b'first',self.metadata(self.sources[1]),b'second']
                collect.main()
            report=json.loads((root/'work/source-report.json').read_text())
        self.assertEqual([r['state'] for r in report],['ok','ok'])
        self.assertTrue(all(r['cleanup_deferred'] for r in report))
        self.assertEqual(len([op for op,_ in calls if op=='cleanup']),8)
        self.assertFalse(any(op=='source_failure' for op,_ in calls))
        self.assertEqual([f['successful'] for op,f in calls if op=='collection_complete'],[2])

    def test_partial_failure_is_reported_after_other_stores_are_attempted(self):
        with tempfile.TemporaryDirectory() as path:
            root=self.root(path)
            with patch.object(collect,'ROOT',root),patch('sys.argv',['collect','--publish','--sources','small,large']), \
                 patch.object(collect,'invoke'),patch.object(collect,'upload',return_value={'published':True}), \
                 patch.object(collect,'Fetcher') as fetcher,patch.object(collect,'parse_prices',return_value=([{'name':'Example'}],self.stats)), \
                 contextlib.redirect_stdout(io.StringIO()):
                fetcher.return_value.read.side_effect=[self.metadata(self.sources[0],False),self.metadata(self.sources[1]),b'second']
                with self.assertRaisesRegex(SystemExit,'Incomplete price refresh'):collect.main()
            report=json.loads((root/'work/source-report.json').read_text())
        self.assertEqual([r['state'] for r in report],['unavailable','ok'])

    def test_every_unprocessed_store_is_reported_when_the_budget_runs_out(self):
        clock=[0]
        def invoke(op,**fields):
            if op=='register_sources':clock[0]=100
            return {}
        with tempfile.TemporaryDirectory() as path:
            root=self.root(path)
            with patch.object(collect,'ROOT',root),patch('sys.argv',['collect','--publish','--sources','small,large','--budget','60']), \
                 patch.object(collect.time,'monotonic',side_effect=lambda:clock[0]),patch.object(collect,'invoke',side_effect=invoke), \
                 patch.object(collect,'Fetcher') as fetcher,contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit):collect.main()
                fetcher.return_value.read.assert_not_called()
            report=json.loads((root/'work/source-report.json').read_text())
        self.assertEqual([r['source'] for r in report],['small','large'])
        self.assertTrue(all(r['state']=='deferred' and r['reason']=='collection_budget' for r in report))

    def test_cleanup_failure_does_not_undo_a_confirmed_publication(self):
        with patch.object(collect,'invoke',side_effect=[{'unchanged':True},RuntimeError('private error')]):
            result=collect.upload(self.sources[0],[{'name':'Example'}],self.stats,b'csv')
        self.assertEqual(result,{'unchanged':True,'cleanup_deferred':True})

