import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchFullPartData } from "../utils/api";
import PartCard from "../components/PartCard";

const CATEGORY_NAMES = {
  cpu: "CPU",
  gpu: "GPU",
  motherboard: "메인보드",
  memory: "메모리",
  storage: "저장장치",
  case: "케이스",
  cooler: "쿨러",
  psu: "파워",
};

export default function Category() {
  const { category } = useParams();
  const navigate = useNavigate();

  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("value");
  const [brandFilter, setBrandFilter] = useState("all");
  const [chipsetFilter, setChipsetFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchFullPartData(category)
      .then((data) => { setParts(data); setLoading(false); })
      .catch(() => { setError("데이터를 불러오지 못했습니다."); setLoading(false); });
  }, [category]);

  useEffect(() => { setCurrentPage(1); }, [search, sortBy, brandFilter, chipsetFilter]);
  useEffect(() => { setChipsetFilter("all"); }, [brandFilter]);

  const brandOptions =
    category === "gpu" ? ["all", "nvidia", "amd"] :
    category === "cpu" ? ["all", "intel", "amd"] :
    category === "motherboard" ? ["all", "amd", "intel"] : ["all"];

  const chipsetMap = {
    amd: ["a620", "b650", "b750", "x670", "x770"],
    intel: ["h610", "h710", "b760", "b860", "z790", "z890"],
  };
  const chipsetOptions = category === "motherboard" ? chipsetMap[brandFilter] || [] : [];

  const filtered = parts
    .filter((p) => {
      const nm = String(p.name || "").toLowerCase();
      const s = search.toLowerCase();
      const nameMatch = nm.includes(s);
      const brandMatch =
        brandFilter === "all" ||
        ((category === "cpu" || category === "gpu") && nm.includes(brandFilter)) ||
        (category === "motherboard" && (chipsetMap[brandFilter] || []).some((cs) => nm.includes(cs)));
      const chipsetMatch = category !== "motherboard" || chipsetFilter === "all" || nm.includes(chipsetFilter);
      return nameMatch && brandMatch && chipsetMatch;
    })
    .sort((a, b) => {
      const aP = Number(a.price) || 0;
      const bP = Number(b.price) || 0;
      const aS = Number(a.benchmarkScore?.passmarkscore) || 0;
      const bS = Number(b.benchmarkScore?.passmarkscore) || 0;
      const a3d = Number(a.benchmarkScore?.["3dmarkscore"]) || 0;
      const b3d = Number(b.benchmarkScore?.["3dmarkscore"]) || 0;
      const aCB = Number(a.benchmarkScore?.cinebenchMulti) || 0;
      const bCB = Number(b.benchmarkScore?.cinebenchMulti) || 0;
      const aV = aP > 0 ? aCB / aP : 0;
      const bV = bP > 0 ? bCB / bP : 0;

      if (sortBy === "price") return aP - bP;
      if (sortBy === "price-desc") return bP - aP;
      if (sortBy === "score") return bS - aS;
      if (sortBy === "3dmark") return b3d - a3d;
      if (sortBy === "value") return bV - aV;
      return String(a.name).localeCompare(String(b.name));
    });

  const startIdx = (currentPage - 1) * itemsPerPage;
  const pageItems = filtered.slice(startIdx, startIdx + itemsPerPage);
  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
  const catName = CATEGORY_NAMES[category] || category.toUpperCase();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] text-center px-4">
        <div className="text-4xl mb-4">⚠️</div>
        <p className="text-slate-300 mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-2xl font-bold text-white">{catName}</h2>
        <span className="text-sm text-slate-400">총 {filtered.length.toLocaleString()}개</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center mb-5">
        <input
          type="text"
          placeholder="제품명 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg bg-slate-800/50 border border-slate-600 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 w-52"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg bg-slate-800/50 border border-slate-600 text-slate-200 focus:outline-none"
        >
          <option value="value">가성비순</option>
          <option value="price">가격 낮은순</option>
          <option value="price-desc">가격 높은순</option>
          {category === "gpu" ? (
            <option value="3dmark">3DMark 점수순</option>
          ) : (
            <option value="score">PassMark 점수순</option>
          )}
          <option value="name">이름순</option>
        </select>

        {brandOptions.length > 1 && (
          <div className="flex gap-1">
            {brandOptions.map((brand) => (
              <button
                key={brand}
                onClick={() => setBrandFilter(brand)}
                className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                  brandFilter === brand
                    ? "bg-purple-600 text-white border-purple-500"
                    : "bg-slate-800/50 text-slate-300 border-slate-600 hover:bg-slate-700/50"
                }`}
              >
                {brand === "all" ? "전체" : brand.toUpperCase()}
              </button>
            ))}
          </div>
        )}

        {category === "motherboard" && brandFilter !== "all" && chipsetOptions.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setChipsetFilter("all")}
              className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                chipsetFilter === "all"
                  ? "bg-blue-600 text-white border-blue-500"
                  : "bg-slate-800/50 text-slate-300 border-slate-600 hover:bg-slate-700/50"
              }`}
            >
              전체
            </button>
            {chipsetOptions.map((cs) => (
              <button
                key={cs}
                onClick={() => setChipsetFilter(cs)}
                className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                  chipsetFilter === cs
                    ? "bg-blue-600 text-white border-blue-500"
                    : "bg-slate-800/50 text-slate-300 border-slate-600 hover:bg-slate-700/50"
                }`}
              >
                {cs.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Part list */}
      {pageItems.length === 0 ? (
        <div className="text-center py-16 text-slate-500">조건에 맞는 부품이 없습니다.</div>
      ) : (
        <div className="border border-slate-700/50 rounded-xl bg-slate-800/20 backdrop-blur-sm overflow-hidden divide-y divide-slate-700/30">
          {pageItems.map((part) => (
            <PartCard
              key={part.id || part._id || part.name}
              part={part}
              onClick={() => navigate(`/detail/${category}/${encodeURIComponent(part.name)}`)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center mt-6 gap-2 items-center">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="px-4 py-2 border border-slate-600 rounded-lg text-sm text-slate-300 disabled:opacity-40 hover:bg-slate-700/50 transition-colors"
          >
            이전
          </button>
          <span className="px-4 py-2 text-sm text-slate-400">
            {currentPage} / {totalPages}
          </span>
          <button
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="px-4 py-2 border border-slate-600 rounded-lg text-sm text-slate-300 disabled:opacity-40 hover:bg-slate-700/50 transition-colors"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
