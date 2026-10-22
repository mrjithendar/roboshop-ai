"""Observe SQL operation classes only, never statements, bind values or DSNs."""
import psycopg
from runtime import trace_span

class TracingCursor(psycopg.Cursor):
    def execute(self, query, params=None, **kwargs):
        command = query.lstrip().split(None, 1)[0].upper() if isinstance(query,str) and query.strip() else 'QUERY'
        if command not in ('SELECT','INSERT','UPDATE','DELETE','BEGIN','COMMIT','ROLLBACK','SET','CREATE','ALTER'):
            command='QUERY'
        with trace_span(command,kind=3,attributes={'db.system.name':'postgresql','db.operation.name':command}):
            return super().execute(query,params,**kwargs)
