// Official Mongo image runs this only on an empty data volume.
const application = db.getSiblingDB('robotshop');
application.createUser({ user: 'team@jithendar.com', pwd: process.env.MONGO_APP_PASSWORD, roles: [{ role: 'readWrite', db: 'robotshop' }] });
