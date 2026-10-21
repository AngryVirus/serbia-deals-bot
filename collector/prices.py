"""Conservative normalization of official Serbian retail price lists."""
import csv
import hashlib
import io
import re
import unicodedata
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

CYR = dict(zip('абвгдђежзијклљмнњопрстћуфхцчџш',
               ['a','b','v','g','d','dj','e','z','z','i','j','k','l','lj','m','n','nj','o','p','r','s','t','c','u','f','h','c','c','dz','s']))


def normalize(value):
    value = ''.join(CYR.get(c, c) for c in str(value).casefold()).replace('đ', 'dj')
    value = ''.join(c for c in unicodedata.normalize('NFKD', value) if not unicodedata.combining(c))
    value = re.sub(r'\b(e|gu)\s+(\d+)\b', r'\1\2', value)
    value = re.sub(r'(?<=\d)\s+(?=w\b|lm\b|k\b|kg\b|g\b|ml\b|l\b)', '', value)
    return ' '.join(re.findall(r'[\w]+', value.replace('_', ' ')))


def cents(value):
    value = str(value or '').strip().replace(' ', '')
    if not value or not re.fullmatch(r'\d+(?:[.,]\d{1,2})?', value):
        return None
    try:
        amount = Decimal(value.replace(',', '.'))
        return int(amount * 100) if 0 < amount <= 10000000 else None
    except InvalidOperation:
        return None


def parse_date(value):
    for pattern in ('%d-%m-%Y', '%d.%m.%Y', '%d.%m.%Y.', '%Y-%m-%d', '%d/%m/%Y'):
        try:
            return datetime.strptime(str(value).strip(), pattern).date()
        except ValueError:
            pass
    return None


def gtin(value):
    value = str(value or '').strip()
    if len(value) not in (8, 12, 13, 14) or not value.isascii() or not value.isdigit():
        return None
    padded = value.zfill(14)
    # Retailer-internal restricted circulation codes must not join across chains.
    short = padded[-13:]
    if short.startswith('00000') or short.startswith('02') or short[:2] in {str(i) for i in range(20, 30)}:
        return None
    check = (10 - sum(int(n) * (3 if i % 2 == 0 else 1)
                      for i, n in enumerate(reversed(padded[:-1]))) % 10) % 10
    return padded if check == int(padded[-1]) else None


def characteristics(name):
    value = normalize(name)
    accessory = bool(re.search(r'\b(?:grlo|grla|adapter|adapteri|drzac|nosac)\b', value))
    bulb = bool(re.search(r'\b(?:sijalic\w*|zarulj\w*|bulbs?)\b', value)) and not accessory
    def integer(pattern):
        found = re.search(pattern, value)
        return int(found[1]) if found else None
    socket = re.search(r'\b(e14|e27|gu10|gu53|g9|g4|g13|h4|h7)\b', value)
    pack = re.search(r'\b(\d{1,3})\s*(?:kom|komada|pcs|шт)\b', value)
    return {'socket': socket[1].upper() if socket else None,
            'lumens': integer(r'\b(\d{2,5})lm\b'),
            'kelvin': integer(r'\b(\d{4,5})k\b'),
            'pack': int(pack[1]) if pack and 0 < int(pack[1]) <= 100 else None,
            'led': bool(re.search(r'\bled\b', value)),
            'kind': 'bulb_accessory' if accessory else 'bulb' if bulb else None}


FIELDS = {'name': 'Naziv proizvoda', 'brand': 'Robna marka', 'barcode': 'Barkod proizvoda',
          'format': 'Naziv trgovca - formata', 'date': 'Datum cenovnika',
          'regular': 'Redovna cena', 'discount': 'Snižena cena',
          'begin': 'Datum početka sniženja', 'end': 'Datum kraja sniženja',
          'kind': 'VRSTA_CENOVNIKA', 'unit': 'Jedinica mere'}


def parse_prices(body, source, *, today=None):
    today = today or datetime.now(ZoneInfo('Europe/Belgrade')).date()
    text = body.decode('utf-8-sig')
    try:
        dialect = csv.Sniffer().sniff(text[:32000], delimiters=';,\t')
    except csv.Error:
        raise ValueError('Unreadable CSV structure') from None
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    headings = {normalize(h): h for h in reader.fieldnames or [] if h}
    columns = {k: headings.get(normalize(v)) for k, v in FIELDS.items()}
    if any(not columns[k] for k in ('name', 'regular', 'date')):
        raise ValueError('Unsupported CSV columns')
    try:
        rows = list(reader)
    except csv.Error:
        raise ValueError('Malformed CSV rows') from None
    if not rows or any(None in r or any(v is None for v in r.values()) for r in rows):
        raise ValueError('Empty or truncated CSV')
    def get(row, key):
        return str(row.get(columns.get(key), '') or '').strip()
    dated = [(r, parse_date(get(r, 'date'))) for r in rows]
    dates = [d for r, d in dated if d and d <= today and
             (not columns['kind'] or normalize(get(r, 'kind')) == 'vazeci cenovnik')]
    if not dates:
        raise ValueError('No current dated price list')
    latest = max(dates)
    if (today - latest).days > 2:
        raise ValueError('Price list older than two days')
    offers, rejected, conflicts, duplicates = {}, 0, set(), 0
    for row, published in dated:
        if published != latest or (columns['kind'] and normalize(get(row, 'kind')) != 'vazeci cenovnik'):
            continue
        name, regular = get(row, 'name')[:300], cents(get(row, 'regular'))
        if not name or regular is None:
            rejected += 1; continue
        barcode, brand, fmt = get(row, 'barcode'), get(row, 'brand')[:120], get(row, 'format')[:120] or source['name']
        code = gtin(barcode)
        normalized = normalize(name)
        identity = barcode or normalized + ':' + normalize(brand)
        key = hashlib.sha256((source['id']+'|'+fmt+'|'+identity).encode()).hexdigest()[:32]
        discount = cents(get(row, 'discount'))
        begin, end = parse_date(get(row, 'begin')), parse_date(get(row, 'end'))
        if not begin or begin > today or not end or end < today or discount is None or discount >= regular:
            discount = None
        # A sentinel means unknown end, not a promotion lasting until 2200.
        end_iso = end.isoformat() if end and end.year < 2100 else None
        offer = {'id': key, 'source': source['id'], 'name': name, 'brand': brand,
                 'barcode': barcode, 'product': 'gtin:'+code if code else 'local:'+key,
                 'format': fmt, 'regular': regular, 'discount': discount,
                 'begin': begin.isoformat() if begin else None, 'end': end_iso,
                 'date': latest.isoformat(), 'terms': [t for t in dict.fromkeys(normalized.split()+[barcode]+([code] if code else [])) if t and len(t)<=100][:35],
                 'norm': normalized, 'traits': characteristics(name), 'unit': get(row, 'unit')[:30]}
        if key in offers:
            duplicates += 1
            old = offers[key]
            if old['name'] != name or old['regular'] != regular or old['discount'] != discount:
                conflicts.add(key)
            continue
        offers[key] = offer
    # Conflicting identities cannot establish a reliable lowest price.
    for key in conflicts:
        offers.pop(key, None)
    if not offers:
        raise ValueError('No unambiguous current prices')
    return list(offers.values()), {'date': latest.isoformat(), 'rows': len(rows),
                                  'accepted': len(offers), 'rejected': rejected,
                                  'conflicts': len(conflicts), 'duplicates': duplicates}
