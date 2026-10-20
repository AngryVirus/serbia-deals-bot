"""Explicit maintenance operations; activation is never a deploy side effect."""
import argparse
from .cloud import call,invoke


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['stage','check','activate','pause','notify','health','diagnose','moderation','commands'])
    parser.add_argument('--expected-revision',type=int)
    args=parser.parse_args()
    if args.action=='stage':
        # Identity check executes against this bot's SDK before deployment.
        state=invoke('init')
        result=call('deploy',expected_revision=args.expected_revision)
        print('Code staged:',result)
        print('Activation unchanged:',state['active'])
        print('Telegram command menu:',invoke('configure_commands'))
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
        print('Safe runtime diagnostics:',call('diagnose'),flush=True)
        print('Owner basket summary:',invoke('basket_check'),flush=True)
        print('Access notice image check:',call('moderation',args={'operation':'preview'}),flush=True)
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
