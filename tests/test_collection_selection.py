import json
import unittest
from collector.collect import select_sources,ROOT

class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.sources=json.loads((ROOT/'collector/sources.json').read_text())
    def test_enabled_is_bounded_reviewed_and_includes_original_sources(self):
        enabled=select_sources(self.sources,'enabled')
        self.assertEqual({s['alias'] for s in enabled},{'lidl','maxi','okov','gomex','matijevic','lilly','metro','aman'})
        self.assertLess(len(enabled),len(self.sources))
    def test_unknown_selection_does_not_silently_import_a_subset(self):
        for choice in ['','lidl,unknown','not-a-source']:
            with self.assertRaises(ValueError):select_sources(self.sources,choice)
    def test_ids_and_aliases_resolve_once_and_all_is_explicit(self):
        source=next(s for s in self.sources if s['alias']=='gomex')
        self.assertEqual(select_sources(self.sources,' gomex, '+source['id']),[source])
        self.assertEqual(select_sources(self.sources,'all'),self.sources)
