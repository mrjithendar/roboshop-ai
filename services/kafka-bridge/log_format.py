import os
import json

LOG_MESSAGES = {'authentication_challenge_passed': 'Human verification passed',
 'authentication_challenge_rejected': 'Human verification rejected',
 'cart_update_rejected': 'Cart update rejected; refresh the cart',
 'cart_updated': 'Cart saved',
 'checkout_payment_captured': 'Payment captured and order confirmed',
 'checkout_reconciliation_required': 'Payment outcome uncertain; reconciliation required',
 'checkout_reserved': 'Checkout reserved; creating payment order',
 'delivery_retry': 'Kafka delivery not confirmed; message retained for retry',
 'dependency_call_completed': 'Dependency request completed',
 'dependency_retry_scheduled': 'Dependency unavailable; retrying a safe read',
 'event_delivered': 'Order event delivered to Kafka',
 'invalid_event_quarantined': 'Invalid order event moved to quarantine',
 'order_event_published': 'Order event delivered to RabbitMQ',
 'request_completed': 'HTTP request completed',
 'request_failed': 'Request failed',
 'request_rejected': 'Request rejected',
 'service_listening': 'Service listening for requests',
 'service_starting': 'Starting service',
 'service_stopping': 'Stopping service',
 'user_logged_in': 'User logged in successfully',
 'user_logged_out': 'User logged out',
 'user_login_failed': 'User failed to log in',
 'user_login_mfa_required': 'Password accepted; waiting for second-factor verification',
 'user_registered': 'User account created'}

def format_log(record):
    message = LOG_MESSAGES.get(record["event"], record["event"].replace("_", " ").capitalize())
    record = dict(record, message=message)
    if os.getenv("LOG_FORMAT", "json").lower() != "text":
        return json.dumps(record, allow_nan=False)
    # JSON-quote all field values to keep untrusted newlines/control characters
    # on one physical line. Do not include arbitrary request/exception objects.
    details = " ".join(f"{key}={json.dumps(value, ensure_ascii=True, allow_nan=False)}" for key, value in record.items() if key not in ("timestamp", "level", "service", "message", "event"))
    return f'{record["timestamp"]} {record["level"]:<5} [{record["service"]}] {message} | event={record["event"]} {details}'.rstrip()

