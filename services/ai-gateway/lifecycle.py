"""One resource owner per ASGI process, including failure-safe startup cleanup."""
import os
from contextlib import ExitStack, contextmanager
from server import (connect_mongo, CartRepository, Store, Gateway, OrderPublisher, SERVICE_ROOT)
from runtime import log_event

@contextmanager
def resources():
    log_event("service_starting")
    with ExitStack() as cleanup:
        client, db = connect_mongo()
        cleanup.callback(client.close)
        carts = CartRepository(os.environ['CART_URL'], os.environ['CART_SERVICE_TOKEN']) if os.getenv('CART_URL') else None
        backend = os.getenv('COMMERCE_BACKEND', 'json')
        if backend == 'postgres':
            from postgres_store import PostgresStore
            store = PostgresStore(os.environ['COMMERCE_DATABASE_URL'], carts)
        elif backend == 'json':
            store = Store(os.getenv('DATA_DIR', str(SERVICE_ROOT / '.data')), carts)
        else:
            raise RuntimeError('COMMERCE_BACKEND must be json or postgres')
        cleanup.callback(store.close)
        gateway = Gateway(db, store)
        if hasattr(gateway, 'demo_client'):
            cleanup.callback(gateway.demo_client.close)
        publisher = OrderPublisher(store, os.getenv('RABBITMQ_URL'))
        cleanup.callback(publisher.stop)
        publisher.start()
        cleanup.callback(gateway.customers.stop)
        gateway.customers.start()
        log_event("service_ready", backend=backend)
        try:
            yield gateway
        finally:
            log_event("service_stopping")
