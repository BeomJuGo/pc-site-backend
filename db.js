// db.js
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/pcsite";
console.log("\uD83D\uDD17 MongoDB URI:", mongoUri ? "\uc124\uc815\ub428" : "\uc124\uc815\ub418\uc9c0 \uc54a\uc74c");

const client = new MongoClient(mongoUri);

let db;

async function ensureIndexes(database) {
  const parts = database.collection("parts");
  await parts.createIndex({ category: 1 });
  await parts.createIndex({ category: 1, name: 1 });
  await parts.createIndex({ category: 1, price: 1 });
  await parts.createIndex({ category: 1, "benchmarkScore.passmarkscore": 1 });
  await parts.createIndex({ category: 1, "benchmarkScore.3dmarkscore": 1 });
  console.log("\uD83D\uDCD1 MongoDB \uc778\ub371\uc2a4 \uc0dd\uc131 \uc644\ub8cc");
}

export async function connectDB() {
  await client.connect();

  const url = new URL(mongoUri);
  const dbName = url.pathname.substring(1) || "pcsite";
  console.log("\uD83D\uDCCA \uc0ac\uc6a9\ud560 \ub370\uc774\ud130\ubca0\uc774\uc2a4:", dbName);

  db = client.db(dbName);
  await ensureIndexes(db);
  console.log("\u2705 MongoDB \uc5f0\uacb0 \uc644\ub8cc");
}

export function getDB() {
  return db;
}
