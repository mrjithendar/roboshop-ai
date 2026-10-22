"""Explicit offline evaluation of recorded executions. Never calls an LLM.

Input rows contain caseId, traceId, observationId, products and optionally claims.
Claims are structured assertions {sku, field, value}; free-text reasoning needs
human review or a separately approved judge, not a fabricated automatic score.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import urllib.request
import uuid

DATASET = Path(__file__).parent/'catalogue-v1/dataset.json'

def supported_claim(claim, catalogue):
    if not isinstance(claim, dict) or not {"sku", "field", "value"} <= claim.keys():
        return False
    sku, field = claim["sku"], claim["field"]
    if not isinstance(sku, str) or not isinstance(field, str) or sku not in catalogue:
        return False
    specs = catalogue[sku].get("specifications")
    if not isinstance(specs, dict) or field not in specs:
        return False
    # JSON comparison avoids Python treating True as the number 1. Nested
    # malformed values fail without hash/index operations on untrusted values.
    return json.dumps(claim["value"], sort_keys=True) == json.dumps(specs[field], sort_keys=True)


def evaluate(dataset, case, result):
    catalogue={p['sku']:p for p in dataset['products']}
    selected=result.get('products')
    if not isinstance(selected,list):raise ValueError('Recorded products array required')
    ids=[p.get('sku') for p in selected if isinstance(p,dict)]
    known=len(ids)==len(selected) and all(s in catalogue for s in ids)
    scores={'valid_product_ids':int(known),
            'matching_products':int(set(ids)==set(case['allowedIds'])),
            'available_products':int(known and all(catalogue[s]['instock']>0 for s in ids)),
            'budget_and_currency':int(known and all(p.get('currency')==case['currency'] and catalogue[p['sku']]['currency']==case['currency'] and catalogue[p['sku']]['price']<=case['budget'] for p in selected)),
            'accurate_prices':int(known and all(p.get('price')==catalogue[p['sku']]['price'] and p.get('currency')==catalogue[p['sku']]['currency'] for p in selected))}
    if 'claims' in result:
        claims=result['claims']
        scores['supported_structured_claims']=int(isinstance(claims,list) and (bool(claims) or not case.get('claimsRequired')) and all(supported_claim(c, catalogue) for c in claims))
    elif case.get('claimsRequired'):
        scores['supported_structured_claims']=0  # Required evidence absent, not a perfect placeholder.
    return scores

def score_payloads(dataset, case, result):
    trace,observation=result.get('traceId',''),result.get('observationId','')
    if not re.fullmatch('[a-f0-9]{32}',trace) or not re.fullmatch('[a-f0-9]{16}',observation) or int(trace,16)==0 or int(observation,16)==0:
        raise ValueError('Actual execution traceId and observationId required')
    for name,value in evaluate(dataset,case,result).items():
        yield {'id':str(uuid.uuid5(uuid.NAMESPACE_URL,':'.join([dataset['version'],case['id'],trace,observation,name]))),
               'traceId':trace,'observationId':observation,'name':dataset['version']+'.'+name,
               'value':value,'dataType':'NUMERIC','comment':'Explicit synthetic evaluation: '+case['id']}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--results',required=True,type=Path)
    parser.add_argument('--publish',action='store_true',help='Explicitly upload scores for previously recorded synthetic executions')
    args=parser.parse_args()
    dataset=json.loads(DATASET.read_text());cases={c['id']:c for c in dataset['cases']}
    records=json.loads(args.results.read_text())
    payloads=[]
    for row in records:
        if row.get('datasetVersion')!=dataset['version'] or row.get('traffic')!='evaluation':raise ValueError('Only explicit catalogue-v1 synthetic evaluation executions accepted')
        payloads.extend(score_payloads(dataset,cases[row['caseId']],row))
    if args.publish:
        base=os.environ['LANGFUSE_BASE_URL'].rstrip('/')
        if base not in ('https://us.cloud.langfuse.com','https://cloud.langfuse.com','https://jp.cloud.langfuse.com','https://hipaa.cloud.langfuse.com'):raise ValueError('Use the configured Cloud region')
        auth=base64.b64encode((os.environ['LANGFUSE_PUBLIC_KEY']+':'+os.environ['LANGFUSE_SECRET_KEY']).encode()).decode()
        for payload in payloads:
            req=urllib.request.Request(base+'/api/public/scores',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Authorization':'Basic '+auth})
            with urllib.request.urlopen(req,timeout=3) as response:response.read(1024)
    print(json.dumps({'published':args.publish,'scores':payloads},indent=2))
if __name__=='__main__':main()
