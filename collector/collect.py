"""Official open-price ingestion. Dry-run is the default; publication is explicit."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import uuid
import base64
import zlib
from datetime import datetime
from zoneinfo import ZoneInfo
from urllib.error import HTTPError,URLError
from .fetch import Fetcher,SourceUnavailable
from .prices import parse_prices
from .cloud import invoke

ROOT=Path(__file__).resolve().parents[1]
POST_PUBLISH_CLEANUP_CALLS=4


def failure_category(error):
    """Keep useful diagnoses without URLs, SAS credentials or response bodies."""
    reasons={'Price list older than two days':'stale_prices','No current dated price list':'no_current_prices',
             'No unambiguous current prices':'ambiguous_prices','Unsupported CSV columns':'unsupported_columns',
             'Unreadable CSV structure':'invalid_csv','Malformed CSV rows':'invalid_csv',
             'Empty or truncated CSV':'incomplete_csv','Dataset identity or license changed':'dataset_changed',
             'Import budget; checkpoint retained':'import_budget','Upload budget; checkpoint retained':'import_budget',
             'Verification budget; checkpoint retained':'import_budget'}
    for _ in range(4):
        if isinstance(error,HTTPError):return 'http_'+str(error.code) if error.code in {401,403,404,410,429,500,502,503,504} else 'http_error'
        if isinstance(error,URLError):return 'network_error'
        if isinstance(error,SourceUnavailable):
            value=str(error)
            if value in {'unapproved_url','dns_unavailable','nonpublic_host','time_budget','robots_unavailable','robots_disallowed','size_budget','incomplete_download'}:return value
        if isinstance(error,(ValueError,RuntimeError)) and str(error) in reasons:return reasons[str(error)]
        error=error.__cause__
        if error is None:break
    return 'source_error'


def cleanup(context,deadline):
    """Retire a bounded tail; a successful publication must not drain the clock."""
    for _ in range(POST_PUBLISH_CLEANUP_CALLS):
        if deadline and time.monotonic()>=deadline-15:return True
        if not invoke('cleanup',**context).get('cleanup'):return False
    return True


def generation(body):
    # Include parser semantics: an unchanged publisher CSV must still be
    # reindexed when canonical product identities change.
    return hashlib.sha256(b'prices-v3\0'+body).hexdigest()[:32]


def resources(dataset,source):
    if dataset.get('id')!=source['id'] or dataset.get('license')!='sodl':
        raise ValueError('Dataset identity or license changed')
    candidates=[r for r in dataset.get('resources',[]) if r.get('format','').lower()=='csv' and
                r.get('url','').startswith('https://') and r.get('title','').upper()!='EAN']
    # Current linked publisher feeds outrank static portal snapshots. Within a
    # class choose the newest advertised resource; never guess a changed URL.
    candidates.sort(key=lambda r:(not r['url'].startswith('https://data.gov.rs/s/'),r.get('last_modified','')),reverse=True)
    return candidates[:2]


def upload(source,offers,stats,body,deadline=None):
    gen=generation(body)
    owner=str(uuid.uuid4())
    # Compress bounded batches so broad coverage does not require one Cloud
    # management request per few dozen products. Raw batch stays below 1.2 MiB.
    batches=[];batch=[];size=2
    for offer in offers:
        amount=len(json.dumps(offer,ensure_ascii=False,separators=(',',':')).encode())+1
        if batch and (len(batch)>=500 or size+amount>600000):batches.append(batch);batch=[];size=2
        batch.append(offer);size+=amount
    if batch:batches.append(batch)
    context={'source':source['id'],'gen':gen,'owner':owner}
    while True:
        if deadline and time.monotonic()>deadline-15:raise RuntimeError('Import budget; checkpoint retained')
        state=invoke('begin',**context,name=source['name'],url=f"https://data.gov.rs/sr/datasets/{source['id']}/",date=stats['date'],chunks=len(batches))
        if not state.get('cleanup'):break
    if state.get('unchanged'):
        result={'unchanged':True}
        try:
            if cleanup(context,deadline):result['cleanup_deferred']=True
        except RuntimeError:result['cleanup_deferred']=True
        return result
    done=set(state.get('done',[]))
    for part,rows in enumerate(batches):
        if deadline and time.monotonic()>deadline-15:raise RuntimeError('Upload budget; checkpoint retained')
        if part not in done:
            packed=base64.b64encode(zlib.compress(json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode())).decode()
            if len(packed)>110000:raise ValueError('Compressed batch too large')
            invoke('chunk',**context,part=part,packed=packed)
    while True:
        if deadline and time.monotonic()>deadline-15:raise RuntimeError('Verification budget; checkpoint retained')
        result=invoke('finish',**context,count=len(offers))
        if not result.get('verifying'):break
    try:
        if cleanup(context,deadline):result['cleanup_deferred']=True
    except RuntimeError:
        result['cleanup_deferred']=True
    return result


def select_sources(sources,selection):
    if selection=='all':return sources
    if selection=='enabled':
        selected=set(json.loads((ROOT/'collector/enabled-sources.json').read_text())['sources'])
    else:
        selected={value.strip() for value in selection.split(',') if value.strip()}
    known={value for source in sources for value in [source['id'],source['alias']]}
    if not selected or selected-known:raise ValueError('Unknown or empty source selection')
    return [source for source in sources if source['id'] in selected or source['alias'] in selected]


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--publish',action='store_true')
    parser.add_argument('--sources',default='enabled',help='enabled, all, or comma-separated reviewed dataset IDs/aliases')
    parser.add_argument('--budget',type=int,default=2100)
    parser.add_argument('--limit',type=int,default=100)
    args=parser.parse_args()
    try:
        sources=select_sources(json.loads((ROOT/'collector/sources.json').read_text()),args.sources)
    except ValueError:
        raise SystemExit('Unknown or empty reviewed source selection') from None
    deadline=time.monotonic()+max(30,min(2400,args.budget));fetcher=Fetcher(deadline=deadline)
    if args.publish:invoke('register_sources',rows=[{'id':s['id'],'name':s['name']} for s in sources],expected=args.sources=='enabled')
    # Rotate the first source daily so slow/failing sources cannot starve the tail.
    if args.sources in {'all','enabled'}:
        offset=datetime.now(ZoneInfo('Europe/Belgrade')).toordinal()%len(sources)
        sources=sources[offset:]+sources[:offset]
    report=[];successful=0
    selected=sources[:max(1,min(100,args.limit))]
    for source in selected:
        if time.monotonic()>deadline-30:
            report.append({'source':source['alias'],'state':'deferred','reason':'collection_budget'})
            print(json.dumps(report[-1]),flush=True)
            continue
        try:
            dataset=json.loads(fetcher.read('https://data.gov.rs/api/1/datasets/'+source['id']+'/',{'data.gov.rs'},metadata=True))
            candidates=resources(dataset,source)
            if not candidates:raise ValueError('No supported CSV resource')
            error=None
            for resource in candidates:
                try:
                    body=fetcher.read(resource['url'],set(source['hosts']))
                    offers,stats=parse_prices(body,source)
                    break
                except (OSError,ValueError,SourceUnavailable) as exc:error=exc
            else:raise ValueError('No usable current resource') from error
            result=upload(source,offers,stats,body,deadline) if args.publish else {'dry_run':True}
            if args.publish:
                try:invoke('source_audit',source=source['id'],gen=generation(body),stats={key:stats[key] for key in ['rows','accepted','rejected','conflicts','duplicates']})
                except RuntimeError:print('Catalog audit counters deferred; published prices retained',flush=True)
            report.append({'source':source['alias'],'state':'ok',**stats,**result});successful+=1
            print(json.dumps(report[-1],ensure_ascii=False),flush=True)
        except (OSError,ValueError,RuntimeError) as error:
            # URLs can contain publisher SAS credentials. Never print exceptions.
            report.append({'source':source['alias'],'state':'unavailable','reason':type(error).__name__,'category':failure_category(error)})
            from .cloud import ManagementError
            if isinstance(error,ManagementError):
                report[-1].update(http_status=error.status,category=error.category,hints=error.hints,operation=error.operation)
            print(json.dumps(report[-1]),flush=True)
            if args.publish:
                try:invoke('source_failure',source=source['id'])
                except RuntimeError:print('Source status update deferred; last valid catalog retained',flush=True)
    ROOT.joinpath('work').mkdir(exist_ok=True)
    ROOT.joinpath('work/source-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    if args.publish and successful:invoke('collection_complete',successful=successful)
    if not successful:raise SystemExit('No successful price source')
    if successful<len(selected):raise SystemExit('Incomplete price refresh; unavailable/deferred sources are listed above')


if __name__=='__main__':main()
