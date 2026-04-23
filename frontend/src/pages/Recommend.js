import React, { useState } from "react";
import axios from "axios";
import PartCard from "../components/PartCard";
import { useNavigate } from "react-router-dom";

export default function Recommend() {
  const [budget, setBudget] = useState(1000000);
  const [purpose, setPurpose] = useState("작업용");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleRecommend = async () => {
    if (!budget) return alert("예산을 입력해주세요.");
    setLoading(true);
    try {
      const res = await axios.post("/api/recommend", {
        budget: Number(budget),
        purpose,
      });
      const builds = res.data.builds || [];
      const recommendedLabel = res.data.recommended;
      const build = builds.find((b) => b.label === recommendedLabel) || builds[0];
      if (!build) throw new Error("추천 결과 없음");
      setResults({ ...build.parts, totalPrice: build.totalPrice });
    } catch (e) {
      alert("추천 실패");
      console.error(e);
    }
    setLoading(false);
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-4">AI 추천</h1>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <label className="text-sm text-slate-600">예산</label>
        <input
          type="number"
          className="border border-slate-300 rounded-lg px-3 py-2 text-[14px] w-40"
          placeholder="예: 1000000"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          step={100000}
        />
        <label className="text-sm text-slate-600">용도</label>
        <select
          className="border border-slate-300 rounded-lg px-3 py-2 text-[14px]"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
        >
          <option value="작업용">작업용</option>
          <option value="문서용">문서용</option>
          <option value="게임용">게임용</option>
        </select>
        <button
          onClick={handleRecommend}
          className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm"
        >
          {loading ? "추천 중..." : "추천 받기"}
        </button>
      </div>

      {results && (
        <div className="divide-y divide-slate-200 border rounded-lg bg-white">
          {[
            { key: "cpu", label: "CPU", fallback: "cpu" },
            { key: "gpu", label: "GPU", fallback: "gpu" },
            { key: "motherboard", label: "메인보드", fallback: "motherboard" },
            { key: "memory", label: "메모리", fallback: "memory" },
            { key: "storage", label: "스토리지", fallback: "storage" },
            { key: "psu", label: "파워", fallback: "psu" },
            { key: "cooler", label: "쿨러", fallback: "cooler" },
            { key: "case", label: "케이스", fallback: "case" },
          ].map(({ key, label, fallback }) => {
            const part = results[key];
            if (!part) return null;
            const navigableCats = ["cpu", "gpu", "motherboard", "memory"];
            return (
              <div key={key}>
                <div className="px-3 pt-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
                <PartCard
                  part={part}
                  onClick={
                    navigableCats.includes(key)
                      ? () => navigate(`/detail/${part.category || fallback}/${encodeURIComponent(part.name)}`)
                      : undefined
                  }
                />
              </div>
            );
          })}
          <div className="px-3 py-3 text-right text-[15px] font-semibold text-slate-900">
            총합: {Number(results.totalPrice || 0).toLocaleString()}원
          </div>
        </div>
      )}
    </div>
  );
}
