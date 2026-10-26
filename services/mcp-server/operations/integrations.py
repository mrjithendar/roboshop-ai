"""Fixed-destination GET adapters. No user-selected URLs, shell, or write methods."""
import base64
import datetime as dt
import json
import os
from pathlib import Path
from urllib.parse import quote, urlsplit
from contextvars import ContextVar
import time
DEADLINE = ContextVar("operations_deadline", default=None)
import httpx
from .policy import Arguments, GROUPS, redact
from contextlib import nullcontext

class Unavailable(Exception): pass

class Integrations:
    def __init__(self, env=None, client=None, aws_factory=None):
        self.env = dict(os.environ if env is None else env)
        self.client = client or httpx.Client(timeout=8, follow_redirects=False, trust_env=False)
        self.aws_factory = aws_factory
        self.tracer = None
        self.namespace = self.env.get('OPS_NAMESPACE', 'roboshop-ai')

    def get(self, backend, path, params=None, headers=None):
        base = self.env.get(backend + '_URL')
        if not base: raise Unavailable(backend + ' is not configured')
        auth = dict(headers or {})
        if backend == 'GATEWAY':
            from opentelemetry.propagate import inject
            inject(auth)
        token = self.env.get(backend + '_TOKEN')
        if token: auth['Authorization'] = 'Bearer ' + token
        if backend == 'LANGFUSE':
            public, secret = self.env.get('LANGFUSE_PUBLIC_KEY'), self.env.get('LANGFUSE_SECRET_KEY')
            if not public or not secret: raise Unavailable('LANGFUSE credentials unavailable')
            auth['Authorization'] = 'Basic ' + base64.b64encode(f'{public}:{secret}'.encode()).decode()
        remaining = (DEADLINE.get() or (time.monotonic()+60)) - time.monotonic()
        if remaining <= 0: raise Unavailable('Investigation deadline exceeded')
        with self.client.stream('GET', base.rstrip('/') + path, params=params, headers=auth, timeout=min(8,remaining)) as response:
            if backend == 'GITHUB' and path.endswith('/logs') and response.status_code == 302:
                location = response.headers.get('location','')
                parsed = urlsplit(location)
                if parsed.scheme != 'https' or not parsed.hostname or not parsed.hostname.endswith('.blob.core.windows.net') or parsed.username or parsed.port not in (None,443):
                    raise Unavailable('Unexpected GitHub log redirect')
                # No GitHub credentials are forwarded to the signed storage URL.
                with self.client.stream('GET', location, timeout=min(8,remaining)) as logs:
                    if logs.status_code != 200: raise Unavailable('GitHub logs unavailable')
                    body=bytearray()
                    for chunk in logs.iter_bytes():
                        body.extend(chunk)
                        if len(body)>512000: raise Unavailable('GitHub log exceeds limit')
                    return body.decode('utf-8',errors='replace')
            if response.status_code != 200: raise Unavailable(backend + ' returned HTTP ' + str(response.status_code))
            body = bytearray()
            for chunk in response.iter_bytes():
                body.extend(chunk)
                if len(body) > 512000: raise Unavailable(backend + ' response exceeds limit')
            if 'json' in response.headers.get('content-type', ''):
                return json.loads(body)
            return body.decode('utf-8', errors='replace')

    def kube(self, path, params=None):
        token_file = self.env.get('KUBE_TOKEN_FILE', '/var/run/secrets/kubernetes.io/serviceaccount/token')
        try: token = Path(token_file).read_text().strip()
        except OSError: raise Unavailable('Kubernetes service account unavailable') from None
        return self.get('KUBERNETES', path, params, {'Authorization': 'Bearer ' + token})

    def kubernetes(self, a):
        ns = quote(self.namespace, safe='')
        core = f'/api/v1/namespaces/{ns}'
        if a.operation == 'pods':
            data = self.kube(core + '/pods', {'limit': 100, 'labelSelector': 'app=' + a.service})
            # Never send pod env values, command args, annotations or mounted secret names to the model.
            return [{'name': p['metadata']['name'], 'status': p.get('status', {})} for p in data.get('items', [])]
        if a.operation == 'workloads':
            data = self.kube(f'/apis/apps/v1/namespaces/{ns}/deployments', {'limit': 100})
            return [{'name': p['metadata']['name'], 'generation': p['metadata'].get('generation'),
                     'replicas': p.get('spec', {}).get('replicas'), 'status': p.get('status', {})} for p in data.get('items', [])]
        if a.operation == 'events':
            return self.kube(core + '/events', {'limit': 100, 'fieldSelector': 'involvedObject.name=' + (a.name or a.service)})
        if a.operation == 'logs':
            if not a.name: raise ValueError('An exact pod name is required')
            return self.kube(core + '/pods/' + quote(a.name, safe='') + '/log', {'tailLines': 100, 'limitBytes': 16000, 'timestamps': 'true'})
        if a.operation == 'utilization': return self.kube(f'/apis/metrics.k8s.io/v1beta1/namespaces/{ns}/pods')
        if a.operation == 'connectivity':
            return {'service': self.kube(core + '/services/' + a.service),
                    'endpoints': self.kube(f'/apis/discovery.k8s.io/v1/namespaces/{ns}/endpointslices', {'labelSelector': 'kubernetes.io/service-name=' + a.service, 'limit':100}),
                    'limitation': 'Endpoint inventory only; no exec or active network probe.'}

    def argocd(self, a):
        data = self.kube('/apis/argoproj.io/v1alpha1/namespaces/' + quote(self.env.get('ARGOCD_NAMESPACE', 'argocd'), safe='') + '/applications', {'limit':100})
        result = []
        for app in data.get('items', []):
            if a.name and app['metadata']['name'] != a.name: continue
            status = app.get('status', {})
            item = {'name':app['metadata']['name'], 'sync':status.get('sync'), 'health':status.get('health')}
            if a.operation == 'history': item['history'] = [{k:v for k,v in h.items() if k in ('id','revision','revisions','deployedAt','deployStartedAt')} for h in status.get('history', [])[-10:]]
            if a.operation == 'failures': item['operationState'] = status.get('operationState')
            result.append(item)
        return result

    def observability(self, a):
        selector = f'{{service="{a.service}"}}'
        queries = {
            'health': 'up',
            'errors': f'sum(rate(roboshop_http_requests_total{{service="{a.service}",status=~"5.."}}[5m]))',
            'latency': f'histogram_quantile({a.quantile}, sum by (le) (rate(http_server_request_duration_seconds_bucket{selector}[5m])))',
        }
        if a.operation in queries:
            result = self.get('PROMETHEUS', '/api/v1/query', {'query':queries[a.operation]})
            return {'query': queries[a.operation], 'result': result, 'caveat': 'An empty series is unavailable evidence, not zero. Histogram names must match deployed instrumentation.'}
        if a.operation == 'logs': return self.get('LOKI', '/loki/api/v1/query_range', {'query':f'{{namespace="{self.namespace}",app="{a.service}"}}', 'limit':100, 'since':'15m'})
        if a.operation == 'traces':
            if self.env.get('TEMPO_URL'): return self.get('TEMPO', '/api/search', {'tags':'service.name=' + a.service, 'limit':20})
            return self.get('JAEGER', '/api/traces', {'service':a.service, 'limit':20, 'lookback':'1h'})
        if a.operation == 'trace':
            import re
            if not re.fullmatch(r'[a-f0-9]{16,32}', a.name): raise ValueError('A trace ID is required')
            if self.env.get('TEMPO_URL'): return self.get('TEMPO', '/api/traces/' + a.name)
            return self.get('JAEGER', '/api/traces/' + a.name)
        if a.operation == 'llm':
            # Metadata-only projection below; prompts/completions are discarded.
            data = self.get('LANGFUSE', '/api/public/observations', {'type':'GENERATION','limit':20})
            return [{k:v for k,v in o.items() if k in ('id','traceId','name','startTime','endTime','model','usage','usageDetails','level')} for o in data.get('data', [])]
        if a.operation == 'dashboards': return self.get('GRAFANA', '/api/search', {'type':'dash-db','limit':20})

    def github(self, a):
        repo = self.env.get('GITHUB_REPOSITORY')
        if not repo: raise Unavailable('GitHub repository is not configured')
        prefix = '/repos/' + repo
        paths = {'workflows':'/actions/runs?status=failure&per_page=20', 'jobs':f'/actions/runs/{a.number}/jobs?per_page=50',
                 'job_logs':f'/actions/jobs/{a.number}/logs', 'pull_requests':'/pulls?per_page=20',
                 'pull_request':f'/pulls/{a.number}', 'vulnerabilities':'/dependabot/alerts?state=open&per_page=20',
                 'terraform':f'/pulls/{a.number}/files?per_page=100'}
        result = self.get('GITHUB', prefix + paths[a.operation], headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'})
        if a.operation == 'terraform': return [f for f in result if f.get('filename','').endswith(('.tf','.tfvars'))]
        return result

    def aws(self, a):
        if not self.env.get('AWS_REGION'): raise Unavailable('AWS region / short-lived identity is not configured')
        if self.env.get('AWS_ACCESS_KEY_ID') and not self.env.get('AWS_SESSION_TOKEN'):
            raise Unavailable('Long-lived static AWS credentials are prohibited')
        import boto3
        from botocore.config import Config
        def default_factory(service):
            session=boto3.Session(region_name=self.env['AWS_REGION'])
            credentials=session.get_credentials()
            if credentials is None or not credentials.get_frozen_credentials().token:
                raise Unavailable('A short-lived AWS session is required, including for profile credentials')
            return session.client(service,config=Config(connect_timeout=3,read_timeout=8,retries={'max_attempts':1},proxies={'https':self.env['OPS_HTTPS_PROXY']} if self.env.get('OPS_HTTPS_PROXY') else None))
        factory = self.aws_factory or default_factory
        if a.operation == 'ec2': return factory('ec2').describe_instances(MaxResults=100)
        if a.operation == 'eks': return factory('eks').list_clusters(maxResults=100)
        if a.operation == 'iam': return factory('iam').list_roles(MaxItems=100)
        if a.operation == 'cloudwatch': return factory('cloudwatch').describe_alarms(MaxRecords=100)
        if a.operation == 'utilization':
            import re
            if not re.fullmatch(r'i-[a-f0-9]{8,17}',a.name): raise ValueError('An EC2 instance ID is required')
            now=dt.datetime.now(dt.timezone.utc)
            return factory('cloudwatch').get_metric_data(StartTime=now-dt.timedelta(hours=1),EndTime=now,MaxDatapoints=60,MetricDataQueries=[{'Id':'cpu','MetricStat':{'Metric':{'Namespace':'AWS/EC2','MetricName':'CPUUtilization','Dimensions':[{'Name':'InstanceId','Value':a.name}]},'Period':300,'Stat':'Average'}}])
        if a.operation == 'inspector': return factory('inspector2').list_findings(maxResults=100)
        if a.operation == 'cost':
            today = dt.date.today()
            return factory('ce').get_cost_and_usage(TimePeriod={'Start':(today-dt.timedelta(days=7)).isoformat(),'End':today.isoformat()}, Granularity='DAILY', Metrics=['UnblendedCost'])

    def roboshop(self, a):
        if a.operation == 'health': return self.get('GATEWAY', '/api/ops')
        evidence, unavailable, findings = {}, {}, []
        steps = [('pods', 'kubernetes', 'pods'), ('workloads','kubernetes','workloads'),
                 ('events','kubernetes','events'), ('metrics','observability','errors'),
                 ('deployments','argocd','history'), ('traces','observability','traces'), ('health','roboshop','health')]
        for label, group, operation in steps:
            try: evidence[label] = self.call(group, a.model_copy(update={'operation':operation}))
            except (Unavailable, ValueError): unavailable[label] = 'Evidence unavailable'
        for pod in evidence.get('pods', [])[:3]:
            for status in pod.get('status', {}).get('containerStatuses', []):
                for state in (status.get('state', {}), status.get('lastState', {})):
                    for detail in state.values():
                        if detail.get('reason') in ('OOMKilled','CrashLoopBackOff','ImagePullBackOff'):
                            findings.append({'pod':pod['name'], 'reason':detail['reason'], 'evidence':'pods'})
            try: evidence['events:' + pod['name']] = self.kubernetes(a.model_copy(update={'operation':'events','name':pod['name']}))
            except (Unavailable, ValueError): unavailable['events:' + pod['name']] = 'Evidence unavailable'
            try: evidence['logs:' + pod['name']] = self.kubernetes(a.model_copy(update={'operation':'logs','name':pod['name']}))
            except (Unavailable, ValueError): unavailable['logs:' + pod['name']] = 'Evidence unavailable'
        return {'service':a.service,'evidence':evidence,'unavailable':unavailable,'observations':findings,
                'rootCause':'Not established. Correlate timestamps, deployment revisions and trace errors before concluding.',
                'recommendations':['Review the cited evidence; propose a change for human approval.'], 'actionsExecuted':[]}

    def blog(self, a):
        if a.operation == 'discover':
            # Destination is operator configured; never follow links from untrusted RSS.
            import xml.etree.ElementTree as ET
            data = self.get('RSS', '')
            if not isinstance(data, str) or '<!DOCTYPE' in data.upper() or '<!ENTITY' in data.upper(): raise ValueError('Unsafe RSS')
            root = ET.fromstring(data)
            return [{'title':n.findtext('title'), 'link':n.findtext('link'), 'description':n.findtext('description')} for n in root.findall('.//item')[:20]]
        # Plain Markdown inside .mdx, escaping JSX/expression syntax. Never executable MDX.
        import re
        text = a.text.replace('<','&lt;').replace('>','&gt;').replace('{','&#123;').replace('}','&#125;')
        text = re.sub(r'(?m)^(import|export)(?=\s)', lambda m: '&#'+str(ord(m.group(0)[0]))+';'+m.group(0)[1:], text)
        return {'path':'content/drafts/' + a.service + '.mdx', 'content':'---\ntitle: ' + json.dumps(a.title) + '\ndraft: true\ndescription: ' + json.dumps(a.title[:150]) + '\n---\n\n' + text,
                'editorialApprovalRequired':True, 'published':False}

    def call(self, group, a):
        if group not in GROUPS or a.operation not in GROUPS[group]: raise ValueError('Operation not allowed')
        token = DEADLINE.set(time.monotonic()+60) if DEADLINE.get() is None else None
        try:
            span = self.tracer.start_as_current_span('tool.'+group+'.'+a.operation, record_exception=False, set_status_on_exception=False) if self.tracer else nullcontext()
            with span:
                result = redact(getattr(self, group)(a))
            if len(json.dumps(result, default=str)) > 256000: raise Unavailable('Evidence exceeds bounded response limit; narrow investigation')
            return result
        except (httpx.HTTPError, OSError, json.JSONDecodeError):
            raise Unavailable(group + ' is unavailable') from None
        finally:
            if token is not None: DEADLINE.reset(token)
