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
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,default=root/'artifacts/demo-global');args=p.parse_args()
args.output.mkdir(parents=True,exist_ok=True)
os.environ['APP_ENV']='demo'
products=json.loads((root/'services/product-ingestion/products.json').read_text())
with ExitStack() as stack:
    files={name:stack.enter_context((args.output/(name+'.jsonl')).open('w')) for name in ('demo_profiles','demo_purchases','reviews')}
    counts=demo.seed(SimpleNamespace(name='robotshop_demo_global'),'global-v2',products,writer=lambda name,row:files[name].write(json_util.dumps(row)+'\n'))
(args.output/'manifest.json').write_text(json.dumps({'synthetic':True,'authenticationDisabled':True,'countriesAndTerritories':200,'counts':counts,'datasetId':'global-v2'},indent=2)+'\n')
print(json.dumps(counts))
