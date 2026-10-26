"""Closed tool vocabulary, strict arguments, bounded redaction and service identities."""
import json
import re
from pathlib import Path
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal

GROUPS = {
    'kubernetes': ['pods', 'workloads', 'events', 'logs', 'utilization', 'connectivity'],
    'argocd': ['applications', 'history', 'failures'],
    'observability': ['health', 'errors', 'latency', 'logs', 'traces', 'trace', 'llm', 'dashboards'],
    'github': ['workflows', 'jobs', 'job_logs', 'pull_requests', 'pull_request', 'vulnerabilities', 'terraform'],
    'aws': ['ec2', 'eks', 'iam', 'cloudwatch', 'utilization', 'inspector', 'cost'],
    'roboshop': ['health', 'investigate'],
    'blog': ['discover', 'draft'],
}
AGENTS = {'orchestrator': list(GROUPS), 'sre': ['kubernetes', 'roboshop'],
          'argocd': ['argocd'], 'github': ['github'], 'aws': ['aws'],
          'observability': ['observability'], 'roboshop': ['roboshop', 'kubernetes', 'observability', 'argocd'],
          'blog': ['blog']}
class Arguments(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    operation: str = Field(max_length=32)
    service: str = Field(default='cart-service', pattern=r'^[a-z0-9][a-z0-9-]{0,62}$')
    name: str = Field(default='', pattern=r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$|^$')
    number: int = Field(default=1, ge=1, le=2147483647)
    quantile: Literal['0.5', '0.9', '0.95', '0.99'] = '0.95'
    title: str = Field(default='', max_length=150)
    text: str = Field(default='', max_length=12000)

AGENTS['monitor'] = []  # Metrics-only credential; never a configured LLM agent.

SECRET_KEY = re.compile(r'(?i)(password|secret|token|authorization|cookie|api.?key|credential|private.?key|client.?key|prompt|completion|input|output)')
SECRET_TEXT = re.compile(r'(?i)(bearer\s+\S+|(?:password|secret|token|api[_-]?key|authorization)["\']?\s*[=:]\s*["\']?[^\s,"\'}]+|(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16})')
def redact(value, depth=0):
    if depth > 12: return '[depth limit]'
    if isinstance(value, dict):
        if SECRET_KEY.search(str(value.get('Key',value.get('key','')))) and ('Value' in value or 'value' in value):
            value={**value,**{k:'[redacted]' for k in ('Value','value') if k in value}}
        return {str(k): '[redacted]' if SECRET_KEY.search(str(k)) else redact(v, depth+1)
                for k,v in list(value.items())[:100]}
    if isinstance(value, list): return [redact(v, depth+1) for v in value[:100]]
    if isinstance(value, str):
        value = re.sub(r'-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----', '[redacted]', value, flags=re.S)
        return SECRET_TEXT.sub('[redacted]', value[:16000])
    return value

def identities(path):
    data = json.loads(Path(path).read_text())
    if not isinstance(data, dict) or not data: raise ValueError('Empty identity configuration')
    for agent, token in data.items():
        if agent not in AGENTS or not isinstance(token, str) or len(token) < 32:
            raise ValueError('Invalid operations identity configuration')
    if len(set(data.values())) != len(data): raise ValueError('Identities require distinct tokens')
    return data
