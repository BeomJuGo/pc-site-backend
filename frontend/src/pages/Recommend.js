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
      setResults(res.data.recommended);
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
          <PartCard
            part={results.cpu}
            onClick={() =>
              results.cpu &&
              navigate(`/detail/${results.cpu.category || "cpu"}/${encodeURIComponent(results.cpu.name)}`)
            }
          />
          <PartCard
            part={results.gpu}
            onClick={() =>
              results.gpu &&
              navigate(`/detail/${results.gpu.category || "gpu"}/${encodeURIComponent(results.gpu.name)}`)
            }
          />
          <PartCard
            part={results.memory}
            onClick={() =>
              results.memory &&
              navigate(`/detail/${results.memory.category || "memory"}/${encodeURIComponent(results.memory.name)}`)
            }
          />
          <PartCard
            part={results.mainboard || results.motherboard}
            onClick={() => {
              const mb = results.mainboard || results.motherboard;
              if (mb)
                navigate(`/detail/${mb.category || "motherboard"}/${encodeURIComponent(mb.name)}`);
            }}
          />
          <div className="px-3 py-3 text-right text-[15px] font-semibold text-slate-900">
            총합: {Number(results.totalPrice || 0).toLocaleString()}원
          </div>
        </div>
      )}
    </div>
  );
}
