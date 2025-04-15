// ✅ utils/cpuCache.js
import axios from "axios";
import * as cheerio from "cheerio";
import { getDB } from "../db.js";

const GEEK_URL = "https://browser.geekbench.com/processor-benchmarks";

export async function fetchGeekbenchCPUsCached(force = false) {
  const db = getDB();
  const cache = db.collection("cpu_cache");

  if (!force) {
    const existing = await cache.findOne({ _id: "cached-list" });
    if (existing && Array.isArray(existing.data)) {
      console.log("📦 캐시에서 CPU 목록 불러옴 (", existing.data.length, "개)");
      return existing.data;
    }
  }

  console.log("🌐 Geekbench에서 CPU 목록 크롤링 중...");
  const { data: html } = await axios.get(GEEK_URL);
  const $ = cheerio.load(html);
  const cpus = [];

  $("table tbody tr").each((_, row) => {
    const name = $(row).find("td").eq(0).text().trim();
    const score = parseInt($(row).find("td").eq(1).text().trim().replace(/,/g, ""), 10);
    if (name && score) cpus.push({ name, score });
  });

  await cache.updateOne(
    { _id: "cached-list" },
    { $set: { data: cpus, updatedAt: new Date() } },
    { upsert: true }
  );
  console.log("✅ 캐시 갱신 완료 (", cpus.length, "개)");
  return cpus;
}
