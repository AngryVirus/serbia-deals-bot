"""Do not retry ambiguous mutations; repeat only explicit gateway rate limits."""
import json
import os
from pathlib import Path
import subprocess
import time

ROOT=Path(__file__).resolve().parents[1]/'serverless'
LAST=0
class ManagementError(RuntimeError):
    def __init__(self,status,category,hints=None):
        self.status=status if isinstance(status,int) else None
        self.category=category if category in {'sqlite_full','pragma_restricted','execution_limit','sql_error','source_lease','revision_review','unclassified'} else 'unclassified'
        allowed={'database','quota','limit','size','disk','full','memory','timeout','execution','sql','sqlite','pragma','authorized','denied','syntax','column','table','request','payload','argument','module','invalid','unsupported','function','rate','maximum','rows','bytes','budget','read','only','statement','failed','step','steps','instruction','instructions','row','scanned','scan','exceeded','result','returned','output'}
        self.hints=[word for word in (hints or []) if word in allowed]
        super().__init__(f'Management request failed (HTTP {self.status}; category={self.category}; hints={self.hints}); private output withheld')


def call(command='run', **fields):
    global LAST
    env=dict(os.environ,NO_COLOR='1')
    if not env.get('TGCLOUD_TOKEN'):
        raise RuntimeError('Add the separate SERBIA_DEALS_CLOUD_TOKEN GitHub secret')
    for attempt in range(3):
        time.sleep(max(0,LAST+2-time.monotonic())); LAST=time.monotonic()
        try:
            result=subprocess.run(['node',str(ROOT/'bridge.mjs')],input=json.dumps({'command':command,**fields}),text=True,capture_output=True,cwd=ROOT,env=env,timeout=90)
            output=json.loads(result.stdout)
        except (OSError,ValueError,subprocess.TimeoutExpired):
            raise RuntimeError('Management result uncertain; inspect before retrying') from None
        if result.returncode or output.get('ok') is not True:
            if output.get('status')==429 and attempt<2:
                delay=output.get('retry_after') or 30
                if not isinstance(delay,(int,float)) or not 0<delay<=60:
                    raise RuntimeError('Management rate limit; retry in the next cycle')
                time.sleep(delay);continue
            raise ManagementError(output.get('status'),output.get('category'),output.get('hints'))
        return output['result']


def invoke(operation,**fields):
    return call(args={'operation':operation,**fields})
