# Twenty-model USD catalogue

The merchant supplied the twenty model names and authorized prices of US$100–500 and randomly assigned initial stock of 20–50 units per model. Those values are fixed in `services/product-ingestion/products.json`; rebuilds never randomize or replenish stock. They are merchant-configured inventory, not a warehouse verification. No manufacturer specifications have been invented.

Each product has its own AI-generated concept render. Captions identify these as concept renders, not manufacturer photographs. Replace them with matching supplier photographs when available.

## Release

On the Minikube host after syncing this code:

```bash
bash build-images.sh
bash deploy-minikube.sh
kubectl -n robotshop-ai exec deployment/product-ingestion -- node services/product-ingestion/publish-catalogue.mjs
```

The explicit publish command inserts the twenty products and archives older listings without deleting historical records. Reruns preserve administrator edits, stock and prices. Existing payment records retain their original amounts and currency.

The cart supports USD and legacy EUR sale items, never both currencies in one cart. Shipping retains the distance tariff of 0.05 per kilometre, denominated in the cart's currency; it is a separate tariff, not an exchange-rate conversion. Quotes with mismatched currency are rejected. Razorpay orders use the cart currency and integer minor units. Actual payments require working merchant credentials and the corresponding currency enabled in the Razorpay account.

## Synthetic profiles and reviews

```bash
python scripts/export-demo.py
python scripts/seed-minikube-demo.py
```

These scripts require `pymongo` in your Python environment and `kubectl` for the import. The importer uses `KUBECONFIG` when set; otherwise it prefers `~/.kube/vultr-minikube.json`. Set `KUBE_CONTEXT` to select another context. It uses namespace `robotshop-ai` and the isolated database `robotshop_demo_merchant20`.

Creates 1,000 synthetic profiles, five for each of 200 countries/territories, and 3,000 generated reviews. Profiles use example.com addresses and have authentication disabled. They are not live customer accounts. Reviews appear in a separate labelled Demo reviews section and do not count toward customer ratings or verified purchases. The review-dataset selector is removed.

The import refuses to mix another dataset, configures a read-only demo reader through Secret `robotshop-demo-reviews`, and restarts the gateway. No real users, real reviews, orders, inventory or payments are overwritten. If MongoDB is not ready, resolve readiness before rerunning. A failed import is not evidence that all records were added; check the printed counts (1,000 profiles, 3,000 reviews, 200 countries).
