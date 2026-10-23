"""Disposable lab entry points. Never imported by a production image/entry point."""
import hashlib, json, os, sys, time
from pathlib import Path
from datetime import datetime, timedelta, timezone
ROOT=Path(__file__).resolve().parents[2]
role=sys.argv[1]
fixture=json.loads(Path(os.environ['LOAD_FIXTURES']).read_text())
assert fixture['synthetic'] is True
service={'gateway':'ai-gateway','user':'user-service','moks':'moks'}[role]
sys.path[:0]=[str(ROOT/'services'/service),str(ROOT/'services'/service/'lib')]
import mongomock
from runtime import serve
# No real Mongo credentials are read. Capacity results cannot claim MongoDB performance.
db=mongomock.MongoClient(tz_aware=True).get_database('load_'+fixture['runId'])
for row in fixture['products']:db.products.insert_one(dict(row))
if role=='user':
 from server import UserService
 app=UserService(db)
 for user in fixture['users']:
  db.users.insert_one({'_id':user['id'],'email':user['id']+'@load.invalid','name':'Synthetic load user','role':'customer','version':1,'synthetic':True})
  db.auth_sessions.insert_one({'_id':hashlib.sha256(user['session'].encode()).hexdigest(),'userId':user['id'],'version':1,'expiresAt':datetime.now(timezone.utc)+timedelta(hours=8)})
 serve('user-service',int(os.environ['PORT']),app.handle)
elif role=='gateway':
 import server
 from server import Gateway
 if os.environ.get('LOAD_RATE_LIMIT_MODE') == 'per-user':
  from identity import client_identity
  server.client_address = client_identity(fixture['users'], server.client_address)
 from store import Store
 from asgi_app import create_app
 import uvicorn
 db.llm_configuration.insert_one({'_id':'active','revision':1,'config':{'provider':'ollama','endpoint':'load','model':'load-mock'},'audit':[{'actor':'load-fixture','reason':'synthetic isolated mock configuration'}]})
 store=Store(str(Path(os.environ['LOAD_FIXTURES']).parent/'ledger'))
 gateway=Gateway(db,store)
 # No outbox workers run: test fulfilment/email/broker delivery must stay inert.
 uvicorn.run(create_app(gateway),host='127.0.0.1',port=int(os.environ['PORT']),log_level='warning',access_log=False)
else:
 import llm_config
 # Loopback is intentionally forbidden by production's Ollama allowlist. This
 # isolated entry point permits exactly the locally spawned mock, not user URLs.
 mock=os.environ['LOAD_MOCK_URL']
 assert mock.startswith('http://127.0.0.1:')
 llm_config.endpoints=lambda:{'load':mock}
 from server import create_application
 from waitress import serve as wserve
 wserve(create_application(),host='127.0.0.1',port=int(os.environ['PORT']),threads=16)
