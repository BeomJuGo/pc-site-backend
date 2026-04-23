import { useState } from "react";
import axios from "axios";
import PartCard from "../components/PartCard";
import { useNavigate } from "react-router-dom";

const PURPOSES = ["게임용", "작업용", "문서용"];
const BUDGETS = [500000, 700000, 1000000, 1500000, 2000000, 3000000];

const PART_LABELS = {
  cpu: "CPU",
  gpu: "GPU",
  motherboard: "메인보드",
  memory: "메모리",
  storage: "저장장치",
  psu: "파워",
  cooler: "쿨러",
  case: "케이스",
};

const PART_COLORS = {
  cpu: "bg-blue-900/40 text-blue-300 border-blue-700/50",
  gpu: "bg-purple-900/40 text-purple-300 border-purple-700/50",
  motherboard: "bg-orange-900/40 text-orange-300 border-orange-700/50",
  memory: "bg-green-900/40 text-green-300 border-green-700/50",
  storage: "bg-indigo-900/40 text-indigo-300 border-indigo-700/50",
  psu: "bg-yellow-900/40 text-yellow-300 border-yellow-700/50",
  cooler: "bg-cyan-900/40 text-cyan-300 border-cyan-700/50",
  case: "bg-slate-700/40 text-slate-300 border-slate-600/50",
};

export default function Recommend() {
  const [budget, setBudget] = useState(1000000);
  const [customBudget, setCustomBudget] = useState("");
  const [purpose, setPurpose] = useState("게임용");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const effectiveBudget = customBudget ? Number(customBudget) : budget;

  const handleRecommend = async () => {
    if (!effectiveBudget || effectiveBudget < 300000) {
      setError("예산을 30만원 이상 입력해주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await axios.post("/api/recommend", {
        budget: effectiveBudget,
        purpose,
      });
      const builds = res.data.builds || [];
      const recommendedLabel = res.data.recommended;
      const build = builds.find((b) => b.label === recommendedLabel) || builds[0];
      if (!build) throw new Error("추천 결과를 받지 못했습니다.");
      // attach category to each part so PartCard hooks work
      const parts = {};
      for (const [key, part] of Object.entries(build.parts || {})) {
        if (part) parts[key] = { ...part, category: part.category || key };
      }
      setResults({ parts, totalPrice: build.totalPrice, summary: build.summary });
    } catch (e) {
      setError(e.response?.data?.error || e.message || "추천 요청에 실패했습니다.");
      console.error(e);
    }
    setLoading(false);
  };

  const navigableCats = ["cpu", "gpu", "motherboard", "memory", "storage"];

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">✨ AI PC 견적 추천</h1>
        <p className="text-slate-400">예산과 용도를 선택하면 AI가 최적의 부품 조합을 추천합니다.</p>
      </div>

      {/* 설정 패널 */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 mb-6 backdrop-blur-sm">
        {/* 용도 선택 */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-slate-300 mb-2">용도</label>
          <div className="flex gap-2 flex-wrap">
            {PURPOSES.map((p) => (
              <button
                key={p}
                onClick={() => setPurpose(p)}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                  purpose === p
                    ? "bg-gradient-to-r from-blue-500 to-purple-500 text-white border-transparent shadow"
                    : "bg-slate-700/50 text-slate-300 border-slate-600 hover:bg-slate-700"
                }`}
              >
                {p === "게임용" ? "🎮 게임용" : p === "작업용" ? "💼 작업용" : "📄 문서용"}
              </button>
            ))}
          </div>
        </div>

        {/* 예산 선택 */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-slate-300 mb-2">예산</label>
          <div className="flex flex-wrap gap-2 mb-3">
            {BUDGETS.map((b) => (
              <button
                key={b}
                onClick={() => { setBudget(b); setCustomBudget(""); }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                  budget === b && !customBudget
                    ? "bg-blue-600 text-white border-blue-500"
                    : "bg-slate-700/50 text-slate-300 border-slate-600 hover:bg-slate-700"
                }`}
              >
                {(b / 10000).toFixed(0)}만원
              </button>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              placeholder="직접 입력 (원)"
              value={customBudget}
              onChange={(e) => setCustomBudget(e.target.value)}
              className="flex-1 px-3 py-2 bg-slate-700 border border-slate-500 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              step={100000}
              min={300000}
            />
            {customBudget && (
              <span className="text-sm text-slate-400">{Number(customBudget).toLocaleString()}원</span>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleRecommend}
          disabled={loading}
          className="w-full py-3 font-semibold text-base rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 text-white hover:from-pink-600 hover:to-rose-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              AI 추천 중... (10~30초 소요)
            </span>
          ) : (
            `✨ ${effectiveBudget.toLocaleString()}원 / ${purpose} 추천 받기`
          )}
        </button>
      </div>

      {/* 결과 */}
      {results && (
        <div className="space-y-3">
          {results.summary && (
            <div className="px-5 py-3 bg-blue-900/30 border border-blue-700/50 rounded-xl text-blue-300 text-sm">
              💡 {results.summary}
            </div>
          )}

          <div className="bg-slate-800/30 border border-slate-700 rounded-2xl overflow-hidden backdrop-blur-sm">
            {Object.entries(PART_LABELS).map(([key, label]) => {
              const part = results.parts[key];
              if (!part) return null;
              return (
                <div key={key} className="border-b border-slate-700/50 last:border-b-0">
                  <div className={`px-4 pt-3 pb-1 flex items-center gap-2`}>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${PART_COLORS[key]}`}>
                      {label}
                    </span>
                  </div>
                  <PartCard
                    part={part}
                    onClick={
                      navigableCats.includes(key)
                        ? () => navigate(`/detail/${part.category || key}/${encodeURIComponent(part.name)}`)
                        : undefined
                    }
                  />
                </div>
              );
            })}

            <div className="px-5 py-4 bg-slate-700/30 flex items-center justify-between">
              <span className="text-slate-400 text-sm">총 견적</span>
              <span className="text-xl font-bold text-white">
                {Number(results.totalPrice || 0).toLocaleString()}원
              </span>
            </div>
          </div>

          <button
            onClick={() => setResults(null)}
            className="w-full py-2 text-sm text-slate-400 hover:text-white border border-slate-700 rounded-xl hover:border-slate-500 transition-colors"
          >
            다시 추천받기
          </button>
        </div>
      )}
    </div>
  );
}
