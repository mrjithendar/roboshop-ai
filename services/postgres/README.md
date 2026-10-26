# PostgreSQL shipping database

Argo CD's `postgres` Application renders this Kustomize directory. Wave 0
starts PostgreSQL; a wave 1 Sync hook imports `shipping.sql` with psql, then
removes the successful Job. The SQL uses a transaction, advisory lock, migration
checksums and a seed version, so retries do not duplicate location rows. Failed
jobs remain visible; no database volume is deleted.

The SQL is 1.8 MB, too large for a ConfigMap. Its gzip copy is mounted through a
binary ConfigMap (under the 1 MiB decoded limit). ServerSideApply avoids the
client-side last-applied annotation size limit. The regression test requires the
gzip copy to match the SQL exactly. After editing shipping.sql regenerate with:

```bash
python3 -c "import gzip,pathlib; p=pathlib.Path('services/postgres/shipping.sql'); p.with_suffix('.sql.gz').write_bytes(gzip.compress(p.read_bytes(),mtime=0))"
```

Publish changes before running `./deploy-argocd.sh postgres`. Shipping-service
may retry during initial import; it verifies the expected seed before serving.
Database credentials remain in roboshop-secrets. Existing database passwords
must match that Secret; changing it does not rotate database roles. Back up data
before deliberate schema/seed changes. No network location download is needed.
