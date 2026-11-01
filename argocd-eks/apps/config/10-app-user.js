// Runs once, on an empty MongoDB volume only: creates the least-privilege application user.
const application = db.getSiblingDB('roboshop');
application.createUser({ user: 'roboshop', pwd: process.env.MONGO_APP_PASSWORD, roles: [{ role: 'readWrite', db: 'roboshop' }] });
