import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchFilteredParts } from "../utils/api";
import { useSeoMeta } from "../hooks/useSeoMeta";
import PartCard from "../components/PartCard";
import SkeletonCard from "../components/SkeletonCard";

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

const CHIPSET_MAP = {
  amd: [
    "a320", "a520", "a620",
    "b350", "b450", "b550", "b650", "b850",
    "x370", "x470", "x570", "x670", "x870",
  ],
  intel: [
    "h81", "h97", "h110", "h170", "h270", "h310", "h370", "h410", "h470", "h510", "h610", "h810",
    "b150", "b250", "b360", "b365", "b460", "b560", "b660", "b760", "b840", "b860",
    "z170", "z270", "z370", "z390", "z490", "z590", "z690", "z790", "z890",
  ],
};

const MEMORY_CAPS = ["8GB", "16GB", "32GB", "64GB"];
const MEMORY_DDRS = ["DDR4", "DDR5"];
const PSU_WATTS = [500, 600, 650, 700, 750, 800, 850, 1000, 1200];
const STORAGE_TYPES = ["SSD", "HDD"];
const STORAGE_IFACES = ["NVMe", "SATA"];
const CPU_SOCKETS = ["AM4", "AM5", "LGA1700", "LGA1851"];
const CASE_FORM_FACTORS = ["ATX", "mATX", "Mini-ITX", "E-ATX"];
const STORAGE_CAPS = ["128GB", "256GB", "500GB", "1TB", "2TB", "4TB", "8TB", "12TB+"];

const ITEMS_PER_PAGE = 24;

// 중고/리퍼/병행수입 데이터가 실제로 존재하는 카테고리
const CAT_HAS_USED = new Set(["storage", "memory", "gpu", "motherboard"]);
const CAT_HAS_REFER = new Set(["storage"]);
const CAT_HAS_PARALLEL = new Set(["storage", "memory"]);

export default function Category() {
  const { category } = useParams();
  const navigate = useNavigate();

  const [parts, setParts] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState(() => ["cpu", "gpu"].includes(category) ? "value" : "popularity");
  const [brandFilter, setBrandFilter] = useState("all");
  const [chipsetFilter, setChipsetFilter] = useState("all");
  const [memCapFilter, setMemCapFilter] = useState("all");
  const [memDdrFilter, setMemDdrFilter] = useState("all");
  const [storageCapFilter, setStorageCapFilter] = useState("all");
  const [storageTypeFilter, setStorageTypeFilter] = useState("all");
  const [storageIfaceFilter, setStorageIfaceFilter] = useState("all");
  const [cpuSocketFilter, setCpuSocketFilter] = useState("all");
  const [caseFormFilter, setCaseFormFilter] = useState("all");
  const [psuWattFilter, setPsuWattFilter] = useState("all");
  const [showUsedOnly, setShowUsedOnly] = useState(false);
  const [showReferOnly, setShowReferOnly] = useState(false);
  const [hideParallel, setHideParallel] = useState(false);
  const [packTypeFilter, setPackTypeFilter] = useState("all");

  // 검색 디바운스 400ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // 카테고리 변경 시 전체 초기화
  useEffect(() => {
    setBrandFilter("all");
    setChipsetFilter("all");
    setMemCapFilter("all");
    setMemDdrFilter("all");
    setStorageCapFilter("all");
    setStorageTypeFilter("all");
    setStorageIfaceFilter("all");
    setCpuSocketFilter("all");
    setCaseFormFilter("all");
    setPsuWattFilter("all");
    setShowUsedOnly(false);
    setShowReferOnly(false);
    setHideParallel(false);
    setPackTypeFilter("all");
    setSearch("");
    setDebouncedSearch("");
    setSortBy(["cpu", "gpu"].includes(category) ? "value" : "popularity");
    setCurrentPage(1);
  }, [category]);

  // 필터 변경 시 페이지 1로 리셋
  useEffect(() => {
    setCurrentPage(1);
  }, [
    category, debouncedSearch, sortBy, brandFilter, chipsetFilter,
    memCapFilter, memDdrFilter, storageCapFilter, storageTypeFilter,
    storageIfaceFilter, cpuSocketFilter, caseFormFilter, psuWattFilter,
    showUsedOnly, showReferOnly, hideParallel, packTypeFilter,
  ]);

  // 브랜드 변경 시 칩셋 초기화
  useEffect(() => { setChipsetFilter("all"); }, [brandFilter]);

  // 서버에서 데이터 fetch
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const conditionShow = [showUsedOnly && "used", showReferOnly && "refer"].filter(Boolean).join(",");
    const conditionHide = hideParallel ? "parallel" : "";

    fetchFilteredParts({
      category,
      page: currentPage,
      limit: ITEMS_PER_PAGE,
      sort: sortBy,
      q: debouncedSearch,
      brand: brandFilter,
      socket: cpuSocketFilter,
      chipset: chipsetFilter,
      memCap: memCapFilter,
      memDdr: memDdrFilter,
      storageType: storageTypeFilter,
      storageIface: storageIfaceFilter,
      storageCap: storageCapFilter,
      psuWatt: psuWattFilter,
      caseForm: caseFormFilter,
      conditionShow,
      conditionHide,
      packType: packTypeFilter,
    }).then(({ parts: p, total: t, totalPages: tp }) => {
      if (!active) return;
      setParts(p);
      setTotal(t);
      setTotalPages(tp);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setError("데이터를 불러오지 못했습니다.");
      setLoading(false);
    });

    return () => { active = false; };
  }, [
    category, currentPage, debouncedSearch, sortBy, brandFilter, chipsetFilter,
    memCapFilter, memDdrFilter, storageCapFilter, storageTypeFilter,
    storageIfaceFilter, cpuSocketFilter, caseFormFilter, psuWattFilter,
    showUsedOnly, showReferOnly, hideParallel, packTypeFilter,
  ]);

  const LABELS = { cpu: "CPU", gpu: "GPU", motherboard: "메인보드", memory: "메모리", storage: "저장장치", case: "케이스", cooler: "쿨러", psu: "파워" };
  const categoryLabel = LABELS[category] || category;
  useSeoMeta({
    title: `가성비PC | ${categoryLabel} 가격비교`,
    description: `${categoryLabel} 최저가 및 성능 비교. 실시간 가격과 벤치마크로 가성비 좋은 ${categoryLabel}을 찾아보세요.`,
    path: `/category/${category}`,
  });

  const brandOptions =
    category === "gpu" ? ["all", "nvidia", "amd"] :
    category === "cpu" ? ["all", "intel", "amd"] :
    category === "motherboard" ? ["all", "amd", "intel"] : ["all"];

  const chipsetOptions = category === "motherboard" ? CHIPSET_MAP[brandFilter] || [] : [];

  const catName = CATEGORY_NAMES[category] || category.toUpperCase();

  const pillBase = "px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors";
  const pillActive = "bg-blue-600 text-white border-blue-600";
  const pillIdle = "bg-white text-gray-600 border-gray-300 hover:bg-gray-50 hover:border-gray-400";
  const subActive = "bg-blue-600 text-white border-blue-600";

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] text-center px-4">
        <div className="text-4xl mb-4">⚠️</div>
        <p className="text-gray-600 mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-2xl font-bold text-gray-900">{catName}</h2>
        <span className="text-sm text-gray-500">
          {loading ? "로딩 중..." : `총 ${total.toLocaleString()}개`}
        </span>
      </div>

      {/* 검색 + 정렬 */}
      <div className="flex flex-wrap gap-2 items-center mb-5">
        <input
          type="text"
          placeholder="제품명 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg bg-white border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg bg-white border border-gray-300 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="popularity">인기순</option>
          <option value="price">가격 낮은순</option>
          <option value="price-desc">가격 높은순</option>
          {(category === "cpu" || category === "gpu") && <option value="value">가성비순</option>}
          {category === "gpu" && <option value="3dmark">3DMark 점수순</option>}
          {category === "cpu" && <option value="score">PassMark 점수순</option>}
          <option value="name">이름순</option>
        </select>

        {brandOptions.length > 1 && (
          <div className="flex gap-1">
            {brandOptions.map((brand) => (
              <button
                key={brand}
                onClick={() => setBrandFilter(brand)}
                className={`${pillBase} ${brandFilter === brand ? pillActive : pillIdle}`}
              >
                {brand === "all" ? "전체" : brand.toUpperCase()}
              </button>
            ))}
          </div>
        )}

        {category === "cpu" && (
          <>
            <div className="flex gap-1 flex-wrap">
              {CPU_SOCKETS.map((socket) => (
                <button
                  key={socket}
                  onClick={() => setCpuSocketFilter(cpuSocketFilter === socket ? "all" : socket)}
                  className={`${pillBase} ${cpuSocketFilter === socket ? pillActive : pillIdle}`}
                >
                  {socket}
                </button>
              ))}
            </div>
            <div className="flex gap-1 flex-wrap">
              {[
                { value: "all", label: "구성 전체" },
                { value: "standard", label: "일반 정품" },
                { value: "multipack", label: "멀티팩 정품" },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setPackTypeFilter(value)}
                  className={`${pillBase} ${packTypeFilter === value ? pillActive : pillIdle}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        {category === "motherboard" && brandFilter !== "all" && chipsetOptions.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setChipsetFilter("all")}
              className={`${pillBase} ${chipsetFilter === "all" ? subActive : pillIdle}`}
            >
              전체
            </button>
            {chipsetOptions.map((cs) => (
              <button
                key={cs}
                onClick={() => setChipsetFilter(cs)}
                className={`${pillBase} ${chipsetFilter === cs ? subActive : pillIdle}`}
              >
                {cs.toUpperCase()}
              </button>
            ))}
          </div>
        )}

        {category === "memory" && (
          <>
            <div className="flex gap-1 flex-wrap">
              {MEMORY_DDRS.map((ddr) => (
                <button
                  key={ddr}
                  onClick={() => setMemDdrFilter(memDdrFilter === ddr ? "all" : ddr)}
                  className={`${pillBase} ${memDdrFilter === ddr ? pillActive : pillIdle}`}
                >
                  {ddr}
                </button>
              ))}
            </div>
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setMemCapFilter("all")}
                className={`${pillBase} ${memCapFilter === "all" ? pillActive : pillIdle}`}
              >
                전체
              </button>
              {MEMORY_CAPS.map((cap) => (
                <button
                  key={cap}
                  onClick={() => setMemCapFilter(cap)}
                  className={`${pillBase} ${memCapFilter === cap ? pillActive : pillIdle}`}
                >
                  {cap}
                </button>
              ))}
            </div>
          </>
        )}

        {category === "storage" && (
          <>
            <div className="flex gap-1 flex-wrap">
              {STORAGE_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setStorageTypeFilter(storageTypeFilter === t ? "all" : t)}
                  className={`${pillBase} ${storageTypeFilter === t ? pillActive : pillIdle}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex gap-1 flex-wrap">
              {STORAGE_IFACES.map((iface) => (
                <button
                  key={iface}
                  onClick={() => setStorageIfaceFilter(storageIfaceFilter === iface ? "all" : iface)}
                  className={`${pillBase} ${storageIfaceFilter === iface ? pillActive : pillIdle}`}
                >
                  {iface}
                </button>
              ))}
            </div>
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setStorageCapFilter("all")}
                className={`${pillBase} ${storageCapFilter === "all" ? pillActive : pillIdle}`}
              >
                전체
              </button>
              {STORAGE_CAPS.map((c) => (
                <button
                  key={c}
                  onClick={() => setStorageCapFilter(c)}
                  className={`${pillBase} ${storageCapFilter === c ? pillActive : pillIdle}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </>
        )}

        {category === "case" && (
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setCaseFormFilter("all")}
              className={`${pillBase} ${caseFormFilter === "all" ? pillActive : pillIdle}`}
            >
              전체
            </button>
            {CASE_FORM_FACTORS.map((ff) => (
              <button
                key={ff}
                onClick={() => setCaseFormFilter(ff)}
                className={`${pillBase} ${caseFormFilter === ff ? pillActive : pillIdle}`}
              >
                {ff}
              </button>
            ))}
          </div>
        )}

        {category === "psu" && (
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setPsuWattFilter("all")}
              className={`${pillBase} ${psuWattFilter === "all" ? pillActive : pillIdle}`}
            >
              전체
            </button>
            {PSU_WATTS.map((w) => (
              <button
                key={w}
                onClick={() => setPsuWattFilter(w)}
                className={`${pillBase} ${psuWattFilter === w ? pillActive : pillIdle}`}
              >
                {w}W
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 상품 상태 필터 — 데이터가 있는 카테고리에만 표시 */}
      {(CAT_HAS_USED.has(category) || CAT_HAS_REFER.has(category) || CAT_HAS_PARALLEL.has(category)) && (
        <div className="flex flex-wrap gap-3 items-center mb-4">
          {CAT_HAS_USED.has(category) && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-sm text-gray-700 hover:text-gray-900">
              <input
                type="checkbox"
                checked={showUsedOnly}
                onChange={(e) => setShowUsedOnly(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 cursor-pointer"
              />
              <span className="inline-flex items-center gap-1">
                <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded border bg-amber-100 text-amber-700 border-amber-200">중고</span>
                중고만 보기
              </span>
            </label>
          )}
          {CAT_HAS_REFER.has(category) && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-sm text-gray-700 hover:text-gray-900">
              <input
                type="checkbox"
                checked={showReferOnly}
                onChange={(e) => setShowReferOnly(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-purple-500 focus:ring-purple-400 cursor-pointer"
              />
              <span className="inline-flex items-center gap-1">
                <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded border bg-purple-100 text-purple-700 border-purple-200">리퍼</span>
                리퍼만 보기
              </span>
            </label>
          )}
          {CAT_HAS_PARALLEL.has(category) && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-sm text-gray-700 hover:text-gray-900">
              <input
                type="checkbox"
                checked={hideParallel}
                onChange={(e) => setHideParallel(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-yellow-500 focus:ring-yellow-400 cursor-pointer"
              />
              <span className="inline-flex items-center gap-1">
                <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded border bg-yellow-100 text-yellow-700 border-yellow-200">병행수입</span>
                병행수입 제외
              </span>
            </label>
          )}
        </div>
      )}

      {/* 부품 목록 */}
      {loading ? (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden divide-y divide-gray-100 shadow-sm">
          {Array(ITEMS_PER_PAGE).fill(0).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : parts.length === 0 ? (
        <div className="text-center py-16 text-gray-400">조건에 맞는 부품이 없습니다.</div>
      ) : (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden divide-y divide-gray-100 shadow-sm">
          {parts.map((part) => (
            <PartCard
              key={part._id || part.name}
              part={part}
              onClick={() => navigate(`/detail/${category}/${encodeURIComponent(part.name)}`)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center mt-6 gap-2 items-center">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 disabled:opacity-40 hover:bg-gray-50 transition-colors"
          >
            이전
          </button>
          <span className="px-4 py-2 text-sm text-gray-500">
            {currentPage} / {totalPages}
          </span>
          <button
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 disabled:opacity-40 hover:bg-gray-50 transition-colors"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
