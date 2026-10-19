# Recommendations

Port 4102. GET `/api/recommendations?q=mining&budget=1000&limit=4`.
Optional `category` and comma-separated `exclude` filters. Results include prices,
stock and ranking reasons. Keyword/synonym ranking is deterministic and not personalized.
Unknown use cases return no matches instead of unrelated products. The gateway
excludes products depleted by demo orders.

## Independent service build

Run `docker build -t robotshop-recommendation-service:local .` from this directory. The Docker context is this folder, not the platform root. Dependencies and runtime libraries are owned here; see [repository split guidance](../../docs/architecture/service-repositories.md).
