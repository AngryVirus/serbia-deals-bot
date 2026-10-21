import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from collector import collect


class GenerationTests(unittest.TestCase):
    def test_parser_semantics_change_generation_for_an_unchanged_csv(self):
        body=b'public publisher CSV'
        current=collect.generation(body)
        self.assertEqual(current,collect.generation(body))
        self.assertNotEqual(current,collect.generation(body+b'\n'))
        self.assertNotEqual(current,hashlib.sha256(b'prices-v2\0'+body).hexdigest()[:32])
        self.assertRegex(current,r'^[a-f0-9]{32}$')

    def test_upload_uses_the_same_generation_helper_for_all_operations(self):
        body=b'unchanged CSV'
        with patch.object(collect,'invoke',side_effect=[{'unchanged':True},{'cleanup':False}]) as invoke:
            result=collect.upload({'id':'a'*24,'name':'Example'},[{'name':'Example'}],{'date':'2026-10-21'},body)
        self.assertEqual(result,{'unchanged':True})
        self.assertEqual([call.args[0] for call in invoke.call_args_list],['begin','cleanup'])
        for call in invoke.call_args_list:
            self.assertEqual(call.kwargs['gen'],collect.generation(body))

    def test_audit_and_upload_use_the_same_parser_generation(self):
        source={'id':'a'*24,'alias':'example','name':'Example','hosts':['data.gov.rs']}
        body=b'public CSV'
        stats={'date':'2026-10-21','rows':1,'accepted':1,'rejected':0,'conflicts':0,'duplicates':0}
        metadata={'id':source['id'],'license':'sodl','resources':[{'title':'Prices','format':'csv','url':'https://data.gov.rs/prices.csv'}]}
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'collector').mkdir()
            (root/'collector/sources.json').write_text(json.dumps([source]))
            with patch.object(collect,'ROOT',root),patch('sys.argv',['collect','--publish','--sources','example']),patch.object(collect,'Fetcher') as fetcher,patch.object(collect,'parse_prices',return_value=([{'name':'Example'}],stats)),patch.object(collect,'upload',return_value={'published':True}) as upload,patch.object(collect,'invoke') as invoke,contextlib.redirect_stdout(io.StringIO()):
                fetcher.return_value.read.side_effect=[json.dumps(metadata).encode(),body]
                collect.main()
            self.assertEqual(upload.call_args.args[3],body)
            audit=next(call for call in invoke.call_args_list if call.args[0]=='source_audit')
            self.assertEqual(audit.kwargs['gen'],collect.generation(body))


if __name__=='__main__':
    unittest.main()
