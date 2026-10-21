"""Explicit maintenance operations; activation is never a deploy side effect."""
import argparse
from .cloud import call,invoke


def diagnostic_failures(result,require_deployed=False):
    """Validate release evidence, reporting only fixed safe group/flag names."""
    if not isinstance(result,dict):
        return ['diagnostics.shape']
    failures=[]
    revision=result.get('revision')
    if type(revision) is not int or revision<=0:
        failures.append('revision')
    for name in ('ui','search','basket','language','handler','quality','advertising'):
        section=result.get(name)
        if not isinstance(section,dict) or section.get('ok') is not True:
            failures.append(name)
    handler=result.get('handler')
    active=handler.get('active') if isinstance(handler,dict) else None
    if type(active) is not bool:
        failures.append('handler.active')
    # A paused installation may intentionally have no synchronized webhook yet.
    # A nonzero pending count is normal live traffic, not a failed release.
    routing=result.get('routing')
    if active is True and (not isinstance(routing,dict) or routing.get('in_sync') is not True):
        failures.append('routing.in_sync')
    deployed=result.get('deployed')
    if require_deployed and (not isinstance(deployed,dict) or deployed.get('matches_local') is not True):
        failures.append('deployed')
    return failures


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['stage','check','activate','pause','notify','health','diagnose','moderation','commands','quality','ads'])
    parser.add_argument('--expected-revision',type=int)
    parser.add_argument('--require-deployed',action='store_true')
    args=parser.parse_args()
    if args.action=='stage':
        # Identity check executes against this bot's SDK before deployment.
        state=invoke('init')
        result=call('deploy',expected_revision=args.expected_revision)
        print('Code staged:',result)
        print('Activation unchanged:',state['active'])
        print('Telegram command menu:',invoke('configure_commands'))
    elif args.action=='ads':
        for _ in range(20):
            result=invoke('ads_tick')
            if result.get('done') or result.get('busy') or result.get('retry_after',0)>2:break
        print('Advertising queue:',result,flush=True)
    elif args.action=='commands':
        print('Telegram command menu:',invoke('configure_commands'))
    elif args.action=='check':
        print('Identity and schema:',invoke('init'),flush=True)
        result=invoke('status')
        print('Active:',result['active'],'sources:',len(result['sources']))
        print('Queue:',result['queue'])
        print('Catalog:',result['catalog'],'SQLite storage:',result['storage'])
        for source in result['sources']:
            if source['active'] or source['status']!='pending':
                print('Source:',source['name'],'status:',source['status'],'date:',source['date'])
        for query in ['огурцы','энергетик','энергетик Red Bull','курица','сливочное масло','оливковое масло','минеральная вода','корм для кошек','krastavac','piletina']:
            print('Search check:',invoke('search_check',query=query),flush=True)
    elif args.action=='diagnose':
        result=call('diagnose')
        failures=diagnostic_failures(result,require_deployed=args.require_deployed)
        if failures:
            raise SystemExit('Runtime diagnostics failed: '+', '.join(failures))
        print('Safe runtime diagnostics:',result,flush=True)
        print('Owner basket summary:',invoke('basket_check'),flush=True)
        print('Access notice image check:',call('moderation',args={'operation':'preview'}),flush=True)
    elif args.action=='quality':
        import time
        deadline=time.monotonic()+1800
        for index,source in enumerate(invoke('status')['sources']):
            if not source.get('active'):continue
            for _ in range(2000):
                if time.monotonic()>deadline:raise RuntimeError('Catalog audit budget; checkpoint retained')
                result=invoke('quality_page',source=source['id'],pages=5)
                if result.get('done') or result.get('skipped'):break
            else:raise RuntimeError('Catalog audit page bound')
            print('Catalog audit source',index+1,result,flush=True)
    elif args.action=='moderation':
        result=invoke('notices_due')
        if result['due']:
            print('Access notice worker:',call('moderation',args={'operation':'tick'}),flush=True)
        else:
            print('No access notices due',flush=True)
    elif args.action=='activate':
        status=invoke('status')
        if not any(s.get('active') for s in status.get('sources',[])):
            raise RuntimeError('Collect at least one real price source before activation')
        invoke('activate',confirm_username='SerbiaDealsBot')
        result=call('sync')
        if not result.get('in_sync'):raise RuntimeError('Routing not confirmed')
        print('SerbiaDealsBot activated; webhook synchronized')
    elif args.action=='pause':
        invoke('pause');print('Bot paused')
    elif args.action=='notify':
        for _ in range(20):
            result=invoke('prepare_notifications')
            if not result.get('more'):break
        for _ in range(12):
            result=invoke('deliver_notifications')
            print('Notification worker:',result)
            if not result.get('sent'):break
    else:
        print('Independent health check:',invoke('health'))


if __name__=='__main__':main()
