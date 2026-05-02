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

const BRAND_KEYWORDS = {
  cpu: { intel: ["인텔", "intel"], amd: ["amd", "라이젠", "ryzen"] },
  gpu: { nvidia: ["지포스", "geforce", "rtx", "gtx", "nvidia"], amd: ["라데온", "radeon", "amd"] },
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
const STORAGE_CAPS = [
  { label: "128GB",  patterns: ["128gb"] },
  { label: "256GB",  patterns: ["256gb", "240gb"] },
  { label: "500GB",  patterns: ["500gb", "512gb"] },
  { label: "1TB",    patterns: ["1tb"] },
  { label: "2TB",    patterns: ["2tb"] },
  { label: "4TB",    patterns: ["4tb"] },
  { label: "8TB",    patterns: ["8tb"] },
  { label: "12TB+",  patterns: ["12tb", "14tb", "16tb", "18tb", "20tb", "22tb", "24tb"] },
];

function partText(p) {
  return [p.name, p.info, p.specSummary].filter(Boolean).join(" ").toLowerCase();
}

function matchBrand(p, category, brand) {
  if (brand === "all") return true;
  if (category === "cpu" || category === "gpu") {
    const mfr = String(p.manufacturer || "").toLowerCase();
    if (mfr === brand) return true;
    const nm = String(p.name || "").toLowerCase();
    return (BRAND_KEYWORDS[category]?.[brand] || []).some((k) => nm.includes(k));
  }
  if (category === "motherboard") {
    const nm = String(p.name || "").toLowerCase();
    return (CHIPSET_MAP[brand] || []).some((cs) => nm.includes(cs));
  }
  return true;
}

function matchMemCap(p, cap) {
  if (cap === "all") return true;
  const n = cap.replace("GB", "");
  const text = [p.name, p.info, p.specSummary, p.spec].filter(Boolean).join(" ");
  return new RegExp(`\\b${n}\\s*gb\\b`, "i").test(text);
}

const BOGUS_CAPS = new Set(["1gb","2gb","4gb","5gb","6gb","8gb","16gb","32gb"]);

function matchStorageCap(p, cap) {
  if (cap === "all") return true;
  const entry = STORAGE_CAPS.find((c) => c.label === cap);
  if (!entry) return false;
  const rawCap = String(p.specs?.capacity || "").toLowerCase();
  // 파싱 버그로 잘못 저장된 소용량 capacity는 신뢰하지 않음
  const validCap = rawCap && !BOGUS_CAPS.has(rawCap);
  if (validCap && entry.patterns.some((pat) => rawCap === pat)) return true;
  // 제품명에서 word-boundary 검색 (오탐 방지)
  const text = [p.name].filter(Boolean).join(" ").toLowerCase();
  return entry.patterns.some((pat) => new RegExp(`\\b${pat}\\b`).test(text));
}

function matchCaseForm(p, ff) {
  if (ff === "all") return true;
  const factors = p.specs?.formFactor;
  const list = Array.isArray(factors) ? factors : typeof factors === "string" ? [factors] : [];
  const text = partText(p);
  const target = ff.toLowerCase();
  return list.some((f) => String(f).toLowerCase() === target) || text.includes(target);
}

function matchStorageType(p, type) {
  if (type === "all") return true;
  const dbType = String(p.specs?.type || "").toUpperCase();
  if (dbType) return dbType === type.toUpperCase();
  return partText(p).includes(type.toLowerCase());
}

function matchStorageIface(p, iface) {
  if (iface === "all") return true;
  const dbIface = String(p.specs?.interface || "").toLowerCase();
  if (dbIface) return dbIface.includes(iface.toLowerCase());
  return partText(p).includes(iface.toLowerCase());
}

function matchCpuSocket(p, socket) {
  if (socket === "all") return true;
  const text = partText(p);
  return new RegExp(`\\b${socket.replace(/(\d)/g, "[$1]")}\\b`, "i").test(text);
}

function matchPsuWatt(p, watt) {
  if (watt === "all") return true;
  // info 필드의 "Wattage: XXXW" 패턴 우선 (가장 정확)
  const infoMatch = (p.info || "").match(/wattage:\s*(\d{3,4})\s*w/i);
  if (infoMatch) return Number(infoMatch[1]) === Number(watt);
  // 제품명에서 숫자W 패턴 검색
  const nameMatch = (p.name || "").match(/(\d{3,4})\s*w(?:\b|$)/i);
  return nameMatch && Number(nameMatch[1]) === Number(watt);
}

export default function Category() {
  const { category } = useParams();
  const navigate = useNavigate();

  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
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
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  useEffect(() => {
    const LABELS = { cpu: "CPU", gpu: "GPU", motherboard: "메인보드", memory: "메모리", storage: "저장장치", case: "케이스", cooler: "쿨러", psu: "파워" };
    const label = LABELS[category] || category;
    document.title = `${label} 가격 비교 | 가성비PC`;
  }, [category]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchFullPartData(category)
      .then((data) => { setParts(data); setLoading(false); })
      .catch(() => { setError("데이터를 불러오지 못했습니다."); setLoading(false); });
  }, [category]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, sortBy, brandFilter, chipsetFilter, memCapFilter, memDdrFilter, storageCapFilter, storageTypeFilter, storageIfaceFilter, cpuSocketFilter, caseFormFilter, psuWattFilter]);
  useEffect(() => { setChipsetFilter("all"); }, [brandFilter]);

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
    setSearch("");
    setSortBy(["cpu", "gpu"].includes(category) ? "value" : "popularity");
  }, [category]);

  const brandOptions =
    category === "gpu" ? ["all", "nvidia", "amd"] :
    category === "cpu" ? ["all", "intel", "amd"] :
    category === "motherboard" ? ["all", "amd", "intel"] : ["all"];

  const chipsetOptions = category === "motherboard" ? CHIPSET_MAP[brandFilter] || [] : [];

  const filtered = parts
    .filter((p) => {
      const nm = String(p.name || "").toLowerCase();
      const s = search.toLowerCase();
      if (!nm.includes(s)) return false;
      if (category === "motherboard" && p.price > 0 && p.price < 50000) return false;
      if (!matchBrand(p, category, brandFilter)) return false;
      if (category === "motherboard" && chipsetFilter !== "all" && !nm.includes(chipsetFilter)) return false;
      if (category === "memory" && !matchMemCap(p, memCapFilter)) return false;
      if (category === "memory" && memDdrFilter !== "all" && !partText(p).includes(memDdrFilter.toLowerCase())) return false;
      if (category === "storage" && !matchStorageCap(p, storageCapFilter)) return false;
      if (category === "storage" && !matchStorageType(p, storageTypeFilter)) return false;
      if (category === "storage" && !matchStorageIface(p, storageIfaceFilter)) return false;
      if (category === "cpu" && !matchCpuSocket(p, cpuSocketFilter)) return false;
      if (category === "case" && !matchCaseForm(p, caseFormFilter)) return false;
      if (category === "psu" && !matchPsuWatt(p, psuWattFilter)) return false;
      return true;
    })
    .sort((a, b) => {
      const aP = Number(a.price) || 0;
      const bP = Number(b.price) || 0;
      const aS = Number(a.benchmarkScore?.passmarkscore) || 0;
      const bS = Number(b.benchmarkScore?.passmarkscore) || 0;
      const a3d = Number(a.benchmarkScore?.["3dmarkscore"]) || 0;
      const b3d = Number(b.benchmarkScore?.["3dmarkscore"]) || 0;

      if (sortBy === "popularity") {
        const aScore = Number(a.popularityScore ?? a.mallCount) || 0;
        const bScore = Number(b.popularityScore ?? b.mallCount) || 0;
        return bScore - aScore;
      }
      if (sortBy === "price") return aP - bP;
      if (sortBy === "price-desc") return bP - aP;
      if (sortBy === "score") return bS - aS;
      if (sortBy === "3dmark") return b3d - a3d;
      if (sortBy === "value") {
        const aScore = category === "gpu" ? a3d : aS;
        const bScore = category === "gpu" ? b3d : bS;
        const aV = aP > 0 && aScore > 0 ? aScore / aP : 0;
        const bV = bP > 0 && bScore > 0 ? bScore / bP : 0;
        return bV - aV;
      }
      return String(a.name).localeCompare(String(b.name));
    });

  const startIdx = (currentPage - 1) * itemsPerPage;
  const pageItems = filtered.slice(startIdx, startIdx + itemsPerPage);
  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
  const catName = CATEGORY_NAMES[category] || category.toUpperCase();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

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

  const pillBase = "px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors";
  const pillActive = "bg-blue-600 text-white border-blue-600";
  const pillIdle = "bg-white text-gray-600 border-gray-300 hover:bg-gray-50 hover:border-gray-400";
  const subActive = "bg-blue-600 text-white border-blue-600";

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-2xl font-bold text-gray-900">{catName}</h2>
        <span className="text-sm text-gray-500">총 {filtered.length.toLocaleString()}개</span>
      </div>

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
                  key={c.label}
                  onClick={() => setStorageCapFilter(c.label)}
                  className={`${pillBase} ${storageCapFilter === c.label ? pillActive : pillIdle}`}
                >
                  {c.label}
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

      {pageItems.length === 0 ? (
        <div className="text-center py-16 text-gray-400">조건에 맞는 부품이 없습니다.</div>
      ) : (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden divide-y divide-gray-100 shadow-sm">
          {pageItems.map((part) => (
            <PartCard
              key={part.id || part._id || part.name}
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
