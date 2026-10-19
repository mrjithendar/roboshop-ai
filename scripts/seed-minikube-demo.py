#!/usr/bin/env python3
"""Import isolated, labelled synthetic data using a temporary localhost Mongo tunnel."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import time
from urllib.parse import urlparse
from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[1]
DATABASE = 'robotshop_demo_merchant20'
DATASET = 'merchant20-1000-v1'


def run(args, payload=None):
    result = subprocess.run(args, input=payload, text=True, capture_output=True, timeout=100)
    if result.returncode: raise RuntimeError('Kubernetes operation failed. Check context, connectivity and permissions; credentials withheld.')
    return result.stdout


def main():
    if not os.getenv('KUBECONFIG'):
        config=Path.home()/'.kube/vultr-minikube.json'
        if config.is_file(): os.environ['KUBECONFIG']=str(config)
    k=['kubectl','--request-timeout=30s']
    if os.getenv('KUBE_CONTEXT'): k += ['--context',os.environ['KUBE_CONTEXT']]
    k += ['-n','robotshop-ai']
    os.environ['APP_ENV']='demo'
    spec=importlib.util.spec_from_file_location('demo',ROOT/'scripts/seed-demo.py')
    demo=importlib.util.module_from_spec(spec);spec.loader.exec_module(demo)
    demo.guard(DATABASE)
    secret=json.loads(run(k+['get','secret','robotshop-secrets','-o','json']))
    root_password=base64.b64decode(secret['data']['MONGO_ROOT_PASSWORD']).decode()
    previous=run(k+['get','secret','robotshop-demo-reviews','--ignore-not-found','-o','json'])
    password=secrets.token_hex(32)
    if previous.strip():
        parsed=urlparse(base64.b64decode(json.loads(previous)['data']['MONGODB_URL']).decode())
        if parsed.username!='robotshop_demo_reader' or parsed.hostname!='mongodb' or parsed.path not in ('/'+DATABASE,'/robotshop_demo_global'):
            raise ValueError('Existing demo connection is managed elsewhere; refusing to replace it.')
        password=parsed.password
    uri=f'mongodb://robotshop_demo_reader:{password}@mongodb:27017/{DATABASE}?authSource={DATABASE}'
    with socket.socket() as probe:
        probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
    forward=subprocess.Popen(k+['port-forward','--address=127.0.0.1','deployment/mongodb',f'{port}:27017'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(300):
            if forward.poll() is not None: raise RuntimeError('Mongo port-forward failed. Check cluster connectivity.')
            try:
                with socket.create_connection(('127.0.0.1',port),timeout=.2): break
            except OSError: time.sleep(.1)
        else: raise RuntimeError('Mongo port-forward did not become ready.')
        with MongoClient('127.0.0.1',port,username='root',password=root_password,authSource='admin',directConnection=True,serverSelectionTimeoutMS=10000,socketTimeoutMS=30000) as client:
            client.admin.command('ping')
            target=client[DATABASE]
            if target.demo_profiles.count_documents({'datasetId':{'$ne':DATASET}}):
                raise ValueError('Another dataset exists in the demo database; no data removed.')
            print('Connected. Seeding isolated synthetic profiles and reviews...',flush=True)
            counts=demo.seed(target,DATASET,json.loads((ROOT/'services/product-ingestion/products.json').read_text()),customers=1000,reviews=3000)
            if target.command('usersInfo','robotshop_demo_reader')['users']:
                target.command('updateUser','robotshop_demo_reader',pwd=password,roles=[{'role':'read','db':DATABASE}])
            else:
                target.command('createUser','robotshop_demo_reader',pwd=password,roles=[{'role':'read','db':DATABASE}])
            actual={'profiles':target.demo_profiles.count_documents({'datasetId':DATASET}),'reviews':target.reviews.count_documents({'datasetId':DATASET}),'countries':len(target.demo_profiles.distinct('country',{'datasetId':DATASET}))}
            if actual!={'profiles':1000,'reviews':3000,'countries':200}: raise RuntimeError('Import verification failed; rerun the same command to resume.')
            print(json.dumps(actual),flush=True)
    finally:
        forward.terminate()
        try: forward.wait(timeout=5)
        except subprocess.TimeoutExpired: forward.kill();forward.wait()
    manifest={'apiVersion':'v1','kind':'Secret','metadata':{'name':'robotshop-demo-reviews','namespace':'robotshop-ai'},'type':'Opaque','stringData':{'MONGODB_URL':uri}}
    run(k+['apply','-f','-'],json.dumps(manifest))
    run(k+['set','env','deployment/ai-gateway','DEMO_REVIEWS_DATABASE='+DATABASE])
    run(k+['rollout','restart','deployment/ai-gateway'])
    run(k+['rollout','status','deployment/ai-gateway','--timeout=90s'])
    print('Verified demo import and gateway rollout. Real customer data was not changed.')

if __name__=='__main__':
    try: main()
    except Exception as error:
        print(str(error) if isinstance(error,(ValueError,RuntimeError)) else 'Demo import failed ('+type(error).__name__+'); credentials withheld. Check MongoDB readiness, cluster connectivity and retry.',flush=True)
        raise SystemExit(1)
