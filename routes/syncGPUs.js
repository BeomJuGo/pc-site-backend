// routes/syncGPUs.js

import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { getDB } from "../db.js";
import { getImageAndPrice } from "../utils/danawa.js";
import { getGPTSummary } from "../utils/gpt.js";

const router = express.Router();

router.get("/sync-gpus", async (req, res) => {
  try {
    const db = await getDB();
    const collection = db.collection("parts");

    const { data: html } = await axios.get("https://tech-mons.com/gpu-ranking/");
    const $ = cheerio.load(html);

    const rows = $("table tbody tr");
    const gpuList = [];

    for (let i = 0; i < rows.length; i++) {
      const cols = $(rows[i]).find("td");
      const name = $(cols[1]).text().trim();
      const scoreText = $(cols[2]).text().trim().replace(/,/g, "");
      const score = parseInt(scoreText, 10);

      if (!name || isNaN(score)) continue;
      if (score < 5000) {
        console.log(`❌ 필터링됨: ${name} (score: ${score})`);
        continue;
      }

      console.log(`🔍 처리중: ${name} (score: ${score})`);

      const { image, price } = await getImageAndPrice(name);
      const { review, spec } = await getGPTSummary("gpu", name, score);

      const doc = {
        name,
        category: "gpu",
        passmarkscore: score,
        image,
        price,
        gptReview: review,
        specSummary: spec,
        updatedAt: new Date(),
      };

      await collection.updateOne({ name }, { $set: doc }, { upsert: true });
      gpuList.push(doc);

      console.log(`✅ 저장됨: ${name}`);
    }

    res.send({ message: "GPU 동기화 완료", count: gpuList.length });
  } catch (err) {
    console.error("❌ GPU 동기화 오류:", err.message);
    res.status(500).send("GPU 동기화 실패");
  }
});

export default router;
