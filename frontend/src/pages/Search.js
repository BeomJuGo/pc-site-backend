import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { fetchSearch } from "../utils/api";
import PartCard from "../components/PartCard";
import SkeletonCard from "../components/SkeletonCard";

const CATEGORIES = [
  { value: "", label: "전체" },
  { value: "cpu", label: "CPU" },
  { value: "gpu", label: "GPU" },
  { value: "motherboard", label: "메인보드" },
  { value: "memory", label: "메모리" },
  { value: "storage", label: "저장장치" },
  { value: "case", label: "케이스" },
  { value: "cooler", label: "쿨러" },
  { value: "psu", label: "파워" },
];

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const q = searchParams.get("q") || "";
  const category = searchParams.get("category") || "";
  const sort = searchParams.get("sort") || "price_asc";

  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [inputValue, setInputValue] = useState(q);
  const debounceRef = useRef(null);

  useEffect(() => { setInputValue(q); }, [q]);

  useEffect(() => {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    setLoading(true);
    setSearched(true);
    fetchSearch({ q, category: category || undefined, sort })
      .then(setResults)
      .finally(() => setLoading(false));
  }, [q, category, sort]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set("q", val); return n; });
    }, 400);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    clearTimeout(debounceRef.current);
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set("q", inputValue); return n; });
  };

  const setParam = (key, value) =>
    setSearchParams((prev) => { const n = new URLSearchParams(prev); if (value) n.set(key, value); else n.delete(key); return n; });

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">부품 검색</h1>

      <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          placeholder="부품 이름을 입력하세요 (예: RTX 4070, Ryzen 7 7700X)"
          className="flex-1 px-4 py-3 rounded-xl border border-slate-600 bg-slate-800/50 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <button
          type="submit"
          className="px-5 py-3 font-medium bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-xl hover:from-blue-600 hover:to-purple-600 transition-all"
        >
          검색
        </button>
      </form>

      <div className="flex flex-wrap gap-2 mb-6">
        <div className="flex gap-1 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setParam("category", cat.value)}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                category === cat.value
                  ? "bg-purple-600 text-white"
                  : "bg-slate-800/50 text-slate-300 hover:bg-slate-700/50"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setParam("sort", e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg bg-slate-800/50 text-slate-300 border border-slate-600 focus:outline-none"
        >
          <option value="price_asc">가격 낮은 순</option>
          <option value="price_desc">가격 높은 순</option>
          <option value="score_desc">점수 높은 순</option>
          <option value="value_desc">가성비 높은 순</option>
        </select>
      </div>

      {loading && (
        <div className="space-y-3">
          {Array(6).fill(0).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🔍</div>
          <p className="text-slate-300 text-lg mb-2">"{q}"에 대한 결과가 없습니다.</p>
          <p className="text-slate-500 text-sm">다른 검색어를 시도해 보세요.</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <>
          <p className="text-slate-400 text-sm mb-3">{results.length}개 결과</p>
          <div className="space-y-3">
            {results.map((part) => (
              <PartCard
                key={part._id || part.name}
                part={part}
                onClick={() => navigate(`/detail/${part.category}/${encodeURIComponent(part.name)}`)}
              />
            ))}
          </div>
        </>
      )}

      {!searched && (
        <div className="text-center py-16 text-slate-500">
          검색어를 입력하면 모든 카테고리에서 부품을 찾아드립니다.
        </div>
      )}
    </div>
  );
}
