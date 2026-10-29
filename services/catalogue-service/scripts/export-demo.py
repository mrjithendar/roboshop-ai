#!/usr/bin/env python3
"""Create synthetic JSONL fixtures locally; never connects to a database."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
from contextlib import ExitStack
from bson import json_util
root = Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('demo',root/'scripts/seed-demo.py');demo=importlib.util.module_from_spec(spec);spec.loader.exec_module(demo)
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,default=root/'artifacts/demo-global');p.add_argument('--customers',type=int,choices=[1000,10000],default=1000);args=p.parse_args()
args.output.mkdir(parents=True,exist_ok=True)
os.environ['APP_ENV']='demo'
products=demo.catalog_products()
with ExitStack() as stack:
    files={name:stack.enter_context((args.output/(name+'.jsonl')).open('w')) for name in ('demo_profiles','demo_purchases','reviews')}
    counts=demo.seed(SimpleNamespace(name='roboshop_demo_global'),f'global-{args.customers}-v3',products,customers=args.customers,reviews=args.customers*3,writer=lambda name,row:files[name].write(json_util.dumps(row)+'\n'))
(args.output/'manifest.json').write_text(json.dumps({'synthetic':True,'authenticationDisabled':True,'countriesAndTerritories':200,'counts':counts,'datasetId':f'global-{args.customers}-v3'},indent=2)+'\n')
print(json.dumps(counts))
