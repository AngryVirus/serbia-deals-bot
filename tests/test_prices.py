import csv
import io
import unittest
from datetime import date
from collector.prices import parse_prices,cents,gtin,normalize,characteristics
from collector.collect import resources

SOURCE={'id':'a'*24,'name':'Test'}
TODAY=date(2026,10,19)
FIELDS=['Naziv proizvoda','Robna marka','Barkod proizvoda','Jedinica mere','Naziv trgovca – formata','Datum cenovnika','Redovna cena','Snižena cena','Datum početka sniženja','Datum kraja sniženja','VRSTA_CENOVNIKA']

def csv_body(rows,fields=FIELDS):
    output=io.StringIO();writer=csv.DictWriter(output,fieldnames=fields,delimiter=';');writer.writeheader()
    for row in rows:
        default={'Naziv proizvoda':'LED sijalica E27 9W 806lm','Robna marka':'Example','Barkod proizvoda':'4006381333931','Datum cenovnika':'19-10-2026','Redovna cena':'199.99','VRSTA_CENOVNIKA':'VAZECI_CENOVNIK'}
        default.update(row);writer.writerow({key:default.get(key,'') for key in fields})
    return output.getvalue().encode('utf-8-sig')

class PricesTests(unittest.TestCase):
    def test_money_is_exact_and_invalid_values_are_not_zero(self):
        self.assertEqual(cents('199,99'),19999)
        for value in ['0','-10','NaN','1.234','1,234.99','abc','10000001']:self.assertIsNone(cents(value))
    def test_only_current_snapshot_is_used(self):
        offers,stats=parse_prices(csv_body([{}, {'Datum cenovnika':'01-10-2026','Redovna cena':'1','VRSTA_CENOVNIKA':'MESECNI_PRESEK'}]),SOURCE,today=TODAY)
        self.assertEqual(len(offers),1);self.assertEqual(offers[0]['regular'],19999)
    def test_missing_kind_field_uses_latest_dated_rows(self):
        offers,_=parse_prices(csv_body([{}, {'Datum cenovnika':'01-10-2026','Redovna cena':'1'}],[f for f in FIELDS if f!='VRSTA_CENOVNIKA']),SOURCE,today=TODAY)
        self.assertEqual(offers[0]['regular'],19999)
    def test_stale_and_future_prices_are_rejected(self):
        for value in ['15-10-2026','20-10-2026']:
            with self.assertRaises(ValueError):parse_prices(csv_body([{'Datum cenovnika':value}]),SOURCE,today=TODAY)
    def test_valid_gtin_is_shared_and_internal_codes_are_local(self):
        self.assertEqual(gtin('4006381333931'),'04006381333931')
        for value in ['4006381333932','0000020240332','2012345678903','123']:self.assertIsNone(gtin(value))
    def test_canonical_gtin_formats_preserve_leading_zero_equivalence(self):
        for value in ['96385074','000096385074','0000096385074','00000096385074']:
            self.assertEqual(gtin(value),'00000096385074')
        for value in ['036000291452','0036000291452','00036000291452']:
            self.assertEqual(gtin(value),'00036000291452')
        self.assertEqual(gtin('4006381333931'),gtin('04006381333931'))
        self.assertEqual(gtin('14006381333938'),'14006381333938')
        # The first digit is packaging, not the GS1 prefix of a GTIN-14.
        self.assertEqual(gtin('20012345678909'),'20012345678909')
    def test_all_restricted_circulation_formats_remain_local(self):
        # Each number has a valid check digit; the prefix prevents a global key.
        values=['20000004','01234565','00000000','000020000004','0000020000004','00000020000004',
                '200123456788','400123456782','0201234567899','0401234567893',
                '2012345678903','00401234567893','42012345678901']
        for value in values:
            with self.subTest(value=value):self.assertIsNone(gtin(value))
    def test_ean8_reclassification_does_not_change_offer_identity(self):
        body=csv_body([{'Barkod proizvoda':'96385074'}])
        offers,_=parse_prices(body,SOURCE,today=TODAY)
        self.assertEqual(offers[0]['product'],'gtin:00000096385074')
        import hashlib
        expected=hashlib.sha256((SOURCE['id']+'|'+SOURCE['name']+'|96385074').encode()).hexdigest()[:32]
        self.assertEqual(offers[0]['id'],expected)
        other={**SOURCE,'id':'b'*24}
        alternatives,_=parse_prices(body,other,today=TODAY)
        self.assertNotEqual(offers[0]['id'],alternatives[0]['id'])
        self.assertEqual(offers[0]['product'],alternatives[0]['product'])
    def test_duplicates_and_conflicting_prices(self):
        offers,stats=parse_prices(csv_body([{},{}]),SOURCE,today=TODAY);self.assertEqual(len(offers),1);self.assertEqual(stats['duplicates'],1)
        with self.assertRaises(ValueError):parse_prices(csv_body([{}, {'Redovna cena':'100'}]),SOURCE,today=TODAY)
    def test_formats_remain_separate(self):
        offers,_=parse_prices(csv_body([{'Naziv trgovca – formata':'Maxi'},{'Naziv trgovca – formata':'Maxi Online'}]),SOURCE,today=TODAY);self.assertEqual(len(offers),2)
    def test_discount_dates_and_unknown_end(self):
        row={'Snižena cena':'99.99','Datum početka sniženja':'19.10.2026','Datum kraja sniženja':'01.01.2200'}
        offers,_=parse_prices(csv_body([row]),SOURCE,today=TODAY);self.assertEqual(offers[0]['discount'],9999);self.assertIsNone(offers[0]['end'])
        offers,_=parse_prices(csv_body([{**row,'Datum kraja sniženja':'18.10.2026'}]),SOURCE,today=TODAY);self.assertIsNone(offers[0]['discount'])
    def test_future_promotion_is_preserved_for_runtime_activation(self):
        row={'Snižena cena':'99.99','Datum početka sniženja':'20.10.2026','Datum kraja sniženja':'25.10.2026'}
        offers,_=parse_prices(csv_body([row]),SOURCE,today=TODAY)
        self.assertEqual(offers[0]['discount'],9999)
        self.assertEqual(offers[0]['begin'],'2026-10-20')
        self.assertEqual(offers[0]['end'],'2026-10-25')
        for changes in ({'Datum početka sniženja':''},{'Datum kraja sniženja':''},
                        {'Datum kraja sniženja':'19.10.2026'},{'Snižena cena':'199.99'}):
            with self.subTest(changes=changes):
                invalid,_=parse_prices(csv_body([{**row,**changes}]),SOURCE,today=TODAY)
                self.assertIsNone(invalid[0]['discount'])
    def test_truncated_or_wrong_schema_fails(self):
        for body in [b'name;price\na;1\n',csv_body([{}]).rsplit(b';',1)[0]]:
            with self.assertRaises(ValueError):parse_prices(body,SOURCE,today=TODAY)
    def test_bulb_characteristics_and_serbian_normalization(self):
        result=characteristics('LED sijalica E 27 9 W 806 lm 4000 K 2 kom')
        self.assertEqual(result,{'socket':'E27','lumens':806,'kelvin':4000,'pack':2,'led':True,'kind':'bulb'})
        self.assertEqual(normalize('сијалица E27'),'sijalica e27')
        self.assertEqual(characteristics('Sijalično grlo porcelansko E27')['kind'],'bulb_accessory')
    def test_source_identity_and_license_must_not_change(self):
        with self.assertRaises(ValueError):resources({'id':SOURCE['id'],'license':'other'},SOURCE)
        with self.assertRaises(ValueError):resources({'id':'b'*24,'license':'sodl'},SOURCE)
    def test_archival_documentation_is_not_selected_over_current_csv(self):
        data={'id':SOURCE['id'],'license':'sodl','resources':[{'title':'EAN','format':'csv','url':'https://a.rs/EAN.csv'},{'title':'Prices','format':'csv','url':'https://a.rs/current.csv','last_modified':'2026-10-19'}]}
        self.assertEqual(len(resources(data,SOURCE)),1)

if __name__=='__main__':unittest.main()
