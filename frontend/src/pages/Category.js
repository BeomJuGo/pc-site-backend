import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchFullPartData } from "../utils/api";
import PartCard from "../components/PartCard";

export default function Category() {
  const { category } = useParams();
  const navigate = useNavigate();

  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("value");
  const [brandFilter, setBrandFilter] = useState("all");
  const [chipsetFilter, setChipsetFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await fetchFullPartData(category);
      setParts(data);
      setLoading(false);
    };
    load();
  }, [category]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, sortBy, brandFilter, chipsetFilter]);

  useEffect(() => {
    setChipsetFilter("all");
  }, [brandFilter]);

  const brandOptions =
    category === "gpu"
      ? ["all", "nvidia", "amd"]
      : category === "cpu"
      ? ["all", "intel", "amd"]
      : category === "motherboard"
      ? ["all", "amd", "intel"]
      : ["all"];

  const chipsetMap = {
    amd: ["a620", "b650", "b750", "x670", "x770"],
    intel: ["h610", "h710", "b760", "b860", "z790", "z890"],
  };
  const chipsetOptions =
    category === "motherboard" ? chipsetMap[brandFilter] || [] : [];

  const filtered = parts
    .filter((p) => {
      const nm = String(p.name || "").toLowerCase();
      const s = search.toLowerCase();
      const nameMatch = nm.includes(s);
      const brandMatch =
        brandFilter === "all" ||
        ((category === "cpu" || category === "gpu") &&
          nm.includes(brandFilter)) ||
        (category === "motherboard" &&
          (chipsetMap[brandFilter] || []).some((cs) => nm.includes(cs)));
      const chipsetMatch =
        category !== "motherboard" ||
        chipsetFilter === "all" ||
        nm.includes(chipsetFilter);
      return nameMatch && brandMatch && chipsetMatch;
    })
    .sort((a, b) => {
      const aP = Number(a.price) || 0;
      const bP = Number(b.price) || 0;
      const aS = Number(a.benchmarkScore?.passmarkscore) || 0;
      const bS = Number(b.benchmarkScore?.passmarkscore) || 0;
      const a3d = Number(a.benchmarkScore?.["3dmarkscore"]) || 0;
      const b3d = Number(b.benchmarkScore?.["3dmarkscore"]) || 0;
      const aV = aP > 0 ? (Number(a.benchmarkScore?.cinebenchMulti) || 0) / aP : 0;
      const bV = bP > 0 ? (Number(b.benchmarkScore?.cinebenchMulti) || 0) / bP : 0;

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

  if (loading) return <div className="p-8 text-center text-slate-500">로딩 중...</div>;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-slate-900">{category.toUpperCase()}</h2>
        <div className="text-sm text-slate-500">총 {filtered.length.toLocaleString()}개</div>
      </div>

      <div className="flex flex-wrap gap-3 items-center mb-4">
        <input
          type="text"
          placeholder="제품명 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-[14px] w-64"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-[14px]"
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
        <div className="flex gap-1">
          {brandOptions.map((brand) => (
            <button
              key={brand}
              onClick={() => setBrandFilter(brand)}
              className={[
                "px-3 py-2 rounded-lg border text-[13px]",
                brandFilter === brand
                  ? "border-slate-800 text-slate-900"
                  : "border-slate-300 text-slate-600 hover:border-slate-400",
              ].join(" ")}
            >
              {brand === "all" ? "전체" : brand.toUpperCase()}
            </button>
          ))}
        </div>
        {category === "motherboard" && brandFilter !== "all" && (
          <div className="flex gap-1 mt-1">
            {chipsetOptions.map((cs) => (
              <button
                key={cs}
                onClick={() => setChipsetFilter(cs)}
                className={[
                  "px-3 py-2 rounded-lg border text-[13px]",
                  chipsetFilter === cs
                    ? "border-slate-800 text-slate-900"
                    : "border-slate-300 text-slate-600 hover:border-slate-400",
                ].join(" ")}
              >
                {cs.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="divide-y divide-slate-200 border rounded-lg bg-white">
        {pageItems.map((part) => (
          <PartCard
            key={part.id || part._id || part.name}
            part={part}
            onClick={() => navigate(`/detail/${category}/${encodeURIComponent(part.name)}`)}
          />
        ))}
      </div>

      <div className="flex justify-center mt-8 gap-2">
        <button
          disabled={currentPage === 1}
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          className="px-3 py-1 border rounded-lg text-sm disabled:opacity-40"
        >
          이전
        </button>
        <span className="px-4 py-1 text-sm">
          {currentPage} / {totalPages}
        </span>
        <button
          disabled={currentPage === totalPages}
          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          className="px-3 py-1 border rounded-lg text-sm disabled:opacity-40"
        >
          다음
        </button>
      </div>
    </div>
  );
}
