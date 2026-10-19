import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from auth import Auth, connect_mongo

if __name__ == "__main__":
    client = None
    try:
        client, db = connect_mongo()
        auth = Auth(db)
        auth.initialize()
        auth.bootstrap(
            os.getenv("SUPERADMIN_EMAIL"),
            os.getenv("SUPERADMIN_PASSWORD"),
            os.getenv("SUPERADMIN_NAME", "Super Admin"),
        )
        print("Super admin created. Remove SUPERADMIN_PASSWORD from your environment.")
    except Exception:
        print(
            "Bootstrap failed. Check configuration and whether the account already exists. No credentials were printed.",
            file=sys.stderr,
        )
        sys.exit(1)
    finally:
        if client:
            client.close()
