// index.js (상단 발췌)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./db.js";
import syncCPUsRouter from "./routes/syncCPUs.js";
import syncGPUsRouter from "./routes/syncGPUs.js";
import partsRouter from "./routes/parts.js";
import recommendRouter from "./routes/recommend.js";
import syncBoardsMemoryRouter from "./routes/syncBoardsMemory.js";
