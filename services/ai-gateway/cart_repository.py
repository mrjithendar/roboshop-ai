"""Authenticated cart repository client; no prices or user-controlled session IDs."""
import os
from runtime import upstream

class CartRepository:
    def __init__(self, url, token):
        if len(token) < 32: raise RuntimeError('CART_SERVICE_TOKEN must contain at least 32 characters.')
        self.url, self.headers = url.rstrip('/'), {'Authorization':'Bearer ' + token}
    def call(self, session, data=None, suffix=''):
        return upstream(self.url+'/internal/carts/'+session+suffix,data,self.headers,timeout=5)
    def initialize(self, session, items):
        return self.call(session, {'initialize':True,'items':items})
    def replace(self, session, items, revision):
        return self.call(session, {'items':items,'revision':revision})
    def clear_paid(self, session, order, revision=None, require_empty=False):
        if revision is not None or require_empty:
            data={'orderId':order,'requireEmpty':require_empty}
            if revision is not None: data['expectedRevision']=revision
            # A versioned path fails closed on an older cart service.
            return self.call(session,data,'/clear-checked')
        return self.call(session, {'orderId':order}, '/clear')
