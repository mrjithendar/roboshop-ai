"""Bounded, repeatable bootstrap; run only in the explicit Argo Sync Job.

Elastic superuser is confined to bootstrap. Ingestion has monitor/create_doc
only; lifecycle/template changes are owned here, never by Logstash/Filebeat.
"""
import base64
import json
from pathlib import Path
import ssl
import time
import urllib.request
import urllib.error

URL = 'https://logs-es-http.els.svc:9200'


def definitions():
    mappings = {'dynamic': False, 'properties': {
        '@timestamp': {'type': 'date_nanos'},
        'service': {'properties': {'name': {'type': 'keyword'}, 'version': {'type': 'keyword'}}},
        'deployment': {'properties': {'environment': {'type': 'keyword'}}},
        'log': {'properties': {'level': {'type': 'keyword'}}},
        'message': {'type': 'match_only_text'},
        'trace': {'properties': {'id': {'type': 'keyword'}}},
        'span': {'properties': {'id': {'type': 'keyword'}}},
        'event': {'properties': {'action': {'type': 'keyword'}, 'duration': {'type': 'long'}, 'created': {'type': 'date_nanos'}}},
        'http': {'properties': {'request': {'properties': {'method': {'type': 'keyword'}}}, 'response': {'properties': {'status_code': {'type': 'integer'}}}}},
        'kubernetes': {'properties': {'namespace': {'type': 'keyword'}}},
        'diagnostic': {'properties': {key: {'type': 'keyword'} for key in ['errorCode', 'errorType', 'provider', 'outcome']}}
    }}
    result = [('/_ingest/pipeline/roboshop-timestamps', {'processors': [{'date': {
        'field': 'event.created', 'formats': ['ISO8601'], 'target_field': '@timestamp',
        'output_format': "yyyy-MM-dd'T'HH:mm:ss.SSSSSSSSSXXX", 'ignore_failure': True
    }}]})]
    for name, days, size in [('roboshop-logs', 7, '2gb'), ('roboshop-malformed', 1, '256mb')]:
        result += [(f'/_ilm/policy/{name}', {'policy': {'phases': {
            'hot': {'actions': {'rollover': {'max_primary_shard_size': size, 'max_age': '1d'}}},
            'delete': {'min_age': f'{days}d', 'actions': {'delete': {}}}
        }}}), (f'/_index_template/{name}', {'index_patterns': [name+'-*'], 'priority': 200,
              'template': {'settings': {'number_of_shards': 1, 'number_of_replicas': 0,
                'index.lifecycle.name': name, 'index.lifecycle.rollover_alias': name,
                'index.mapping.total_fields.limit': 100}, 'mappings': mappings}})]
    result.append(('/_security/role/elk_ingest', {'cluster': ['monitor'], 'indices': [
        {'names': ['roboshop-logs', 'roboshop-logs-*', 'roboshop-malformed', 'roboshop-malformed-*'], 'privileges': ['create_doc']}]}))
    result.append(('/_security/role/elk_viewer', {'cluster': [], 'indices': [
        {'names': ['roboshop-logs*', 'roboshop-malformed*'], 'privileges': ['read', 'view_index_metadata']}],
        'applications': [{'application': 'kibana-.kibana', 'privileges': ['read'], 'resources': ['space:default']}]}))
    return result


def main():
    password = Path('/admin/elastic').read_text().strip()
    auth = base64.b64encode(('elastic:'+password).encode()).decode()
    context = ssl.create_default_context(cafile='/es-ca/ca.crt')
    def request(method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(URL+path, data=data, method=method,
            headers={'Authorization': 'Basic '+auth, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, context=context, timeout=10) as response:
            return response.read(1024*1024)
    deadline = time.monotonic()+300
    while True:
        try:
            request('GET', '/_cluster/health?wait_for_status=yellow&timeout=5s'); break
        except (OSError, urllib.error.URLError):
            if time.monotonic() >= deadline:raise RuntimeError('Elasticsearch bootstrap readiness timed out') from None
            time.sleep(5)
    for path, body in definitions(): request('PUT', path, body)
    for name in ('roboshop-logs', 'roboshop-malformed'):
        try:request('GET', '/_alias/'+name)
        except urllib.error.HTTPError as error:
            if error.code != 404:raise
            request('PUT', '/'+name+'-000001', {'aliases': {name: {'is_write_index': True}}})
    for username, key in [('elk_ingest', 'ingestPassword'), ('elk_viewer', 'viewerPassword')]:
        request('PUT', '/_security/user/'+username, {'password': Path('/credentials',key).read_text().strip(), 'roles': [username]})
    print('ELK policies, templates, write aliases and restricted users ready; no credentials logged.')


if __name__ == '__main__':
    try:main()
    except Exception as error:
        # Response bodies/exception text can contain payloads; report type/status only.
        print('Bootstrap failed:', type(error).__name__, getattr(error,'code','no_http_status'))
        raise SystemExit(1)
