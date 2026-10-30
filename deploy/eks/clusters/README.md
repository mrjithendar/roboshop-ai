# Rendered clusters

`scripts/render.sh env/<cluster>.env` writes `clusters/<cluster>/<layer>/manifests.yaml`.
Commit these files in **your fork**: they are what Argo CD syncs, and the Git diff is the review
of exactly what will change (image digests included). They contain no secret values.
