"""PyMongo command monitoring: no documents, queries, addresses or credentials."""
import threading
import time
from pymongo.monitoring import CommandListener
from runtime import ctx,trace_context,trace_header,telemetry
class MongoTracing(CommandListener):
    def __init__(self):self.pending={};self.lock=threading.Lock()
    def started(self,event):
        parent=ctx.get()
        if not parent:return
        with self.lock:
            if len(self.pending)>=64:return
            context=trace_context(trace_header(parent),parent.get('tracestate'))
            context.update(service=parent.get('service','roboshop'),kind=3,quiet=parent.get('quiet',False))
            context['attributes']={'db.system.name':'mongodb','db.operation.name':event.command_name}
            self.pending[event.request_id]=(context,time.time_ns(),event.command_name)
    def finish(self,event,status):
        with self.lock:item=self.pending.pop(event.request_id,None)
        if item:
            context,start,name=item
            telemetry(context['service'],context,start,name,status)
    def succeeded(self,event):self.finish(event,200)
    def failed(self,event):self.finish(event,503)
