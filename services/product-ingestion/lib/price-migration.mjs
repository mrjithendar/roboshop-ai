export async function repriceCatalogue(db, products) {
  // One-time repricing of current listings, without changing stock or historical orders.
  const priceVersion = 'merchant-inr-99-999-v1';
  const collection = db.collection('products');
  let repriced = 0;
  for (const row of await collection.find({archived: {$ne: true}, priceVersion: {$ne: priceVersion}}).toArray()) {
    const listed = products.find(p => p.sku === row.sku);
    if (!listed || row.collection === 'reference' || row.sku.startsWith('REF-')) continue;
    const price = listed.price;
    const result = await collection.updateOne({_id: row._id, revision: row.revision, priceVersion: {$ne: priceVersion}},
      {$set: {price, currency: 'INR', priceVersion, updatedAt: new Date()}, $inc: {revision: 1}});
    if (!result.matchedCount) throw Error('Catalogue changed during repricing. Rerun to finish safely.');
    repriced += result.modifiedCount;
  }
  console.log(`Repriced ${repriced} active listings to INR 99–999. Inventory and historical orders unchanged.`);
  return repriced;
}
