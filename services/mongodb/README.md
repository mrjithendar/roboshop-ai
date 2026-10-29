# MongoDB product catalogue

MongoDB itself (Deployment, Service, volume, init-script ConfigMaps) is deployed from
the [tools repository](https://github.com/mrjithendar/tools/tree/master/roboshop/minikube/mongodb)
by the `mongodb` Argo CD Application. This folder holds only the application data that
MongoDB imports: [`catalog.js`](catalog.js), the single definition of the product catalogue.

`catalog.js` is a `mongosh` script whose `CATALOG` block is a JSON array of 32 robots.
It upserts each product by SKU with `$setOnInsert` and ensures the unique slug index,
so re-running it never changes existing products (admin edits, stock, prices, archived
flags and revisions always win); only missing SKUs are added.

- **New database:** the tools repo mounts a copy (ConfigMap `mongodb-catalog`, key
  `20-catalog.js`) into `/docker-entrypoint-initdb.d`; MongoDB runs it on an empty volume.
- **Existing database:** run either command:

  ```bash
  kubectl -n roboshop-ai exec -i deploy/mongodb -- sh -c 'mongosh --quiet -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin' < services/mongodb/catalog.js
  npm run catalog:import          # Node driver with MONGODB_URL/MONGODB_DATABASE (also run by npm run dev)
  ```

- **Adding products:** edit the `CATALOG` array, run `npm run catalog:configmap` (writes
  the ConfigMap into `../tools/roboshop/minikube/mongodb`, or `$TOOLS_DIR`), then
  `npm test` here and the tools tests, and commit both repositories. Edit live products
  in the admin console; editing this file does not update existing rows.

Saved Moks conversations (`chat_history`), accounts, sessions and settings are also
stored in this MongoDB; include it in backup and retention policies.
