import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
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

const CAT_HAS_USED = new Set(["storage", "memory", "gpu", "motherboard"]);
const CAT_HAS_REFER = new Set(["storage"]);
const CAT_HAS_PARALLEL = new Set(["storage", "memory"]);

export default function Category() {
  const { category } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [parts, setParts] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Local input state for immediate feedback; URL "q" param is the committed search
  const [search, setSearch] = useState(searchParams.get("q") || "");
  const debounceRef = useRef(null);

  // Derive all filter values from URL params
  const defaultSort = ["cpu", "gpu"].includes(category) ? "value" : "popularity";
  const sortBy = searchParams.get("sort") || defaultSort;
  const brandFilter = searchParams.get("brand") || "all";
  const chipsetFilter = searchParams.get("chipset") || "all";
  const memCapFilter = searchParams.get("memCap") || "all";
  const memDdrFilter = searchParams.get("memDdr") || "all";
  const storageCapFilter = searchParams.get("storageCap") || "all";
  const storageTypeFilter = searchParams.get("storageType") || "all";
  const storageIfaceFilter = searchParams.get("storageIface") || "all";
  const cpuSocketFilter = searchParams.get("socket") || "all";
  const caseFormFilter = searchParams.get("caseForm") || "all";
  const psuWattFilter = searchParams.get("psuWatt") || "all";
  const showUsedOnly = searchParams.get("used") === "1";
  const showReferOnly = searchParams.get("refer") === "1";
  const hideParallel = searchParams.get("hideParallel") === "1";
  const hideUsed = searchParams.get("hideUsed") === "1";
  const packTypeFilter = searchParams.get("packType") || "all";
  const designFilter = searchParams.get("design") || "all";
  const currentPage = parseInt(searchParams.get("page") || "1", 10);
  const debouncedSearch = searchParams.get("q") || "";

  // Generic filter setter — replaces current history entry (no back-button pollution)
  const setFilter = (key, val) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val && val !== "all" && val !== "") next.set(key, val);
      else next.delete(key);
      next.delete("page");
      return next;
    }, { replace: true });
  };

  const setBoolFilter = (key, val) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val) next.set(key, "1");
      else next.delete(key);
      next.delete("page");
      return next;
    }, { replace: true });
  };

  const setPage = (p) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p > 1) next.set("page", String(p));
      else next.delete("page");
      return next;
    }, { replace: true });
  };

  // Brand change also resets chipset
  const handleBrandChange = (brand) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (brand && brand !== "all") next.set("brand", brand);
      else next.delete("brand");
      next.delete("chipset");
      next.delete("page");
      return next;
    }, { replace: true });
  };

  // Sort change omits param when it equals the default
  const handleSortChange = (val) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val !== defaultSort) next.set("sort", val);
      else next.delete("sort");
      next.delete("page");
      return next;
    }, { replace: true });
  };

  // Search: local state updates immediately; URL param updated after 400ms debounce
  const handleSearchChange = (val) => {
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (val.trim()) next.set("q", val.trim());
        else next.delete("q");
        next.delete("page");
        return next;
      }, { replace: true });
    }, 400);
  };

  // Category change: reset local search input (URL params are already clean because
  // all category nav links are clean paths with no search params)
  useEffect(() => {
    setSearch("");
    clearTimeout(debounceRef.current);
  }, [category]);

  // Fetch data whenever any filter param changes
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const conditionShow = [showUsedOnly && "used", showReferOnly && "refer"].filter(Boolean).join(",");
    const hideConditions = [hideParallel && "parallel", hideUsed && "used", hideUsed && "refer"].filter(Boolean);
    const conditionHide = hideConditions.join(",");

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
      design: designFilter,
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
    showUsedOnly, showReferOnly, hideParallel, hideUsed, packTypeFilter, designFilter,
  ]);

  // Scroll restoration: restore saved scroll position after parts load
  useEffect(() => {
    if (!loading && parts.length > 0) {
      const saved = sessionStorage.getItem(`scroll_${category}`);
      if (saved) {
        sessionStorage.removeItem(`scroll_${category}`);
        requestAnimationFrame(() => window.scrollTo(0, parseInt(saved, 10)));
      }
    }
  }, [loading, parts.length, category]);

  const LABELS = { cpu: "CPU", gpu: "GPU", motherboard: "메인보드", memory: "메모리", storage: "저장장치", case: "케이스", cooler: "쿨러", psu: "파워" };
  const categoryLabel = LABELS[category] || category;
  useSeoMeta({
    title: `가성비PC | ${categoryLabel} 가격비교`,
    description: `${categoryLabel} 최저가 및 성능 비교. 실시간 가격과 벤치마크로 가성비 좋은 ${categoryLabel}을 찾아보세요.`,
    path: `/category/${category}`,
  });

  const brandOptions =
    category === "gpu" ? ["all", "amd", "nvidia"] :
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
          onChange={(e) => handleSearchChange(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg bg-white border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
        />
        <select
          value={sortBy}
          onChange={(e) => handleSortChange(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg bg-white border border-gray-300 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="popularity">인기순</option>
          <option value="price">가격 낮은순</option>
          <option value="price-desc">가격 높은순</option>
          {(category === "cpu" || category === "gpu") && <option value="value">가성비순</option>}
          {category === "gpu" && <option value="3dmark">3DMark 점수순</option>}
          {category === "cpu" && <option value="score">PassMark 점수순</option>}
          <option value="release">출시 연도 최신순</option>
        </select>

        {brandOptions.length > 1 && (
          <div className="flex gap-1">
            {brandOptions.map((brand) => (
              <button
                key={brand}
                onClick={() => handleBrandChange(brand)}
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
                  onClick={() => setFilter("socket", cpuSocketFilter === socket ? "" : socket)}
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
                  onClick={() => setFilter("packType", value)}
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
              onClick={() => setFilter("chipset", "")}
              className={`${pillBase} ${chipsetFilter === "all" ? subActive : pillIdle}`}
            >
              전체
            </button>
            {chipsetOptions.map((cs) => (
              <button
                key={cs}
                onClick={() => setFilter("chipset", cs)}
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
                  onClick={() => setFilter("memDdr", memDdrFilter === ddr ? "" : ddr)}
                  className={`${pillBase} ${memDdrFilter === ddr ? pillActive : pillIdle}`}
                >
                  {ddr}
                </button>
              ))}
            </div>
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setFilter("memCap", "")}
                className={`${pillBase} ${memCapFilter === "all" ? pillActive : pillIdle}`}
              >
                전체
              </button>
              {MEMORY_CAPS.map((cap) => (
                <button
                  key={cap}
                  onClick={() => setFilter("memCap", cap)}
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
                  onClick={() => setFilter("storageType", storageTypeFilter === t ? "" : t)}
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
                  onClick={() => setFilter("storageIface", storageIfaceFilter === iface ? "" : iface)}
                  className={`${pillBase} ${storageIfaceFilter === iface ? pillActive : pillIdle}`}
                >
                  {iface}
                </button>
              ))}
            </div>
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setFilter("storageCap", "")}
                className={`${pillBase} ${storageCapFilter === "all" ? pillActive : pillIdle}`}
              >
                전체
              </button>
              {STORAGE_CAPS.map((c) => (
                <button
                  key={c}
                  onClick={() => setFilter("storageCap", c)}
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
              onClick={() => setFilter("caseForm", "")}
              className={`${pillBase} ${caseFormFilter === "all" ? pillActive : pillIdle}`}
            >
              전체
            </button>
            {CASE_FORM_FACTORS.map((ff) => (
              <button
                key={ff}
                onClick={() => setFilter("caseForm", ff)}
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
              onClick={() => setFilter("psuWatt", "")}
              className={`${pillBase} ${psuWattFilter === "all" ? pillActive : pillIdle}`}
            >
              전체
            </button>
            {PSU_WATTS.map((w) => (
              <button
                key={w}
                onClick={() => setFilter("psuWatt", w)}
                className={`${pillBase} ${psuWattFilter === w ? pillActive : pillIdle}`}
              >
                {w}W
              </button>
            ))}
          </div>
        )}

        {["case", "cooler", "memory"].includes(category) && (
          <div className="flex gap-1 flex-wrap">
            {[
              { value: "all", label: "디자인 전체" },
              { value: "rgb", label: "RGB" },
              { value: "white", label: "화이트" },
            ].map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setFilter("design", value)}
                className={`${pillBase} ${designFilter === value ? pillActive : pillIdle}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 상품 상태 필터 — 데이터가 있는 카테고리에만 표시 */}
      {(CAT_HAS_USED.has(category) || CAT_HAS_REFER.has(category) || CAT_HAS_PARALLEL.has(category)) && (
        <div className="flex flex-wrap gap-3 items-center mb-4">
          {CAT_HAS_USED.has(category) && (
            <>
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-sm text-gray-700 hover:text-gray-900">
                <input
                  type="checkbox"
                  checked={hideUsed}
                  onChange={(e) => {
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev);
                      if (e.target.checked) {
                        next.set("hideUsed", "1");
                        next.delete("used");
                        next.delete("refer");
                      } else {
                        next.delete("hideUsed");
                      }
                      next.delete("page");
                      return next;
                    }, { replace: true });
                  }}
                  className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
                />
                <span className="text-sm">새상품만 보기</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-sm text-gray-700 hover:text-gray-900">
                <input
                  type="checkbox"
                  checked={showUsedOnly}
                  onChange={(e) => {
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev);
                      if (e.target.checked) {
                        next.set("used", "1");
                        next.delete("hideUsed");
                      } else {
                        next.delete("used");
                      }
                      next.delete("page");
                      return next;
                    }, { replace: true });
                  }}
                  className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 cursor-pointer"
                />
                <span className="inline-flex items-center gap-1">
                  <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded border bg-amber-100 text-amber-700 border-amber-200">중고</span>
                  중고만 보기
                </span>
              </label>
            </>
          )}
          {CAT_HAS_REFER.has(category) && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-sm text-gray-700 hover:text-gray-900">
              <input
                type="checkbox"
                checked={showReferOnly}
                onChange={(e) => setBoolFilter("refer", e.target.checked)}
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
                onChange={(e) => setBoolFilter("hideParallel", e.target.checked)}
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
              onClick={() => {
                sessionStorage.setItem(`scroll_${category}`, String(window.scrollY));
                navigate(`/detail/${category}/${encodeURIComponent(part.name)}`);
              }}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center mt-6 gap-2 items-center">
          <button
            disabled={currentPage === 1}
            onClick={() => setPage(Math.max(1, currentPage - 1))}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 disabled:opacity-40 hover:bg-gray-50 transition-colors"
          >
            이전
          </button>
          <span className="px-4 py-2 text-sm text-gray-500">
            {currentPage} / {totalPages}
          </span>
          <button
            disabled={currentPage === totalPages}
            onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 disabled:opacity-40 hover:bg-gray-50 transition-colors"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
