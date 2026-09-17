import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/ecosmart.sqlite');
db.exec("DELETE FROM limits WHERE key LIKE 'ip:%'");
console.log('Remaining limits in database:', db.prepare('SELECT * FROM limits').all());
db.close();
