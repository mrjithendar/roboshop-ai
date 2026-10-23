"""Synthetic client identities for the disposable lab, never production imports."""
def client_identity(users, original):
    # Only pre-seeded opaque sessions receive independent simulated addresses.
    # Unknown cookies retain the actual peer bucket and gain no authorization.
    addresses = {user['session']: f'198.18.0.{i}' for i, user in enumerate(users, 1)}
    def resolve(request):
        session = request.cookie('rs_auth', r'[a-f0-9]{64}')
        return addresses.get(session) or original(request)
    return resolve
