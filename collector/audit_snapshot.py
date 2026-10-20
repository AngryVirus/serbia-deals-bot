"""Download reviewed public catalogues for offline QA. Never publishes to Cloud."""
import argparse
import json
from pathlib import Path
import time
from .collect import resources, select_sources
from .fetch import Fetcher
from .prices import parse_prices


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='work/catalog-snapshot.json')
    parser.add_argument('--budget', type=int, default=1200)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    sources = select_sources(json.loads((root / 'collector/sources.json').read_text()), 'enabled')
    fetcher = Fetcher(deadline=time.monotonic() + max(30, min(2400, args.budget)))
    output = root / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    data = {}
    failed = []
    for source in sources:
        try:
            meta = json.loads(fetcher.read('https://data.gov.rs/api/1/datasets/' + source['id'] + '/', {'data.gov.rs'}, metadata=True))
            for resource in resources(meta, source):
                try:
                    body = fetcher.read(resource['url'], set(source['hosts']))
                    offers, stats = parse_prices(body, source)
                    data[source['alias']] = {'offers': offers, 'stats': stats}
                    break
                except (OSError, ValueError, RuntimeError):
                    continue
            if source['alias'] not in data:
                raise ValueError('No supported current public resource')
            print(json.dumps({'source': source['alias'], 'offers': len(data[source['alias']]['offers'])}), flush=True)
        except (OSError, ValueError, RuntimeError):
            failed.append(source['alias'])
            print(json.dumps({'source': source['alias'], 'state': 'unavailable'}), flush=True)
        output.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'sources': len(data), 'failed': failed}), flush=True)
    if failed:
        raise SystemExit('Incomplete public snapshot; no live data changed')


if __name__ == '__main__':
    main()
