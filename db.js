// db.js
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const client = new MongoClient(process.env.MONGODB_URI);

let db;
export async function connectDB() {
  await client.connect();
  db = client.db("pcsite");
  console.log("✅ MongoDB 연결 완료");
}

export function getDB() {
  return db;
}
