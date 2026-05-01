import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCompare } from "../context/CompareContext";
import { fetchPartDetail } from "../utils/api";

const ROW_KEYS = [
  { label: "가격", key: "price", format: (v) => v ? `${Number(v).toLocaleString()}원` : "-" },
  { label: "PassMark", key: (p) => p?.benchmarkScore?.passmarkscore ?? p?.benchScore, format: (v) => v ? Number(v).toLocaleString() : "-" },
  { label: "3DMark", key: (p) => p?.benchmarkScore?.["3dmarkscore"], format: (v) => v ? Number(v).toLocaleString() : "-" },
  { label: "카테고리", key: "category", format: (v) => v || "-" },
  { label: "한줄평", key: "review", format: (v) => v || "-" },
];

function getVal(part, key) {
  if (typeof key === "function") return key(part);
  return part?.[key];
}

export default function Compare() {
  const { items, clear } = useCompare();
  const navigate = useNavigate();
  const [details, setDetails] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (items.length === 0) return;
    setLoading(true);
    Promise.all(items.map((item) => fetchPartDetail(item.category, item.name)))
      .then((parts) => setDetails(parts.filter(Boolean)))
      .finally(() => setLoading(false));
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
        <div className="text-5xl mb-4">📋</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-3">비교할 부품이 없습니다</h2>
        <p className="text-gray-500 mb-6">카테고리 페이지에서 부품 카드에 마우스를 올려<br />비교 버튼을 클릭하세요.</p>
        <button
          onClick={() => navigate("/category/cpu")}
          className="px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-all"
        >
          부품 보러가기
        </button>
      </div>
    );
  }

  const parts = details.length > 0 ? details : items;

  const prices = parts.map((p) => Number(p.price)).filter((n) => n > 0);
  const minPrice = prices.length ? Math.min(...prices) : null;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">부품 비교</h1>
        <button
          onClick={clear}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors"
        >
          초기화
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left py-3 pr-4 text-gray-500 font-medium text-sm w-28">항목</th>
                {parts.map((part) => (
                  <th key={part.name} className="pb-3 px-3 text-center min-w-[180px]">
                    <div className="flex flex-col items-center gap-2">
                      {(part.image && !part.image.includes("noImg")) ? (
                        <img src={part.image} alt={part.name} className="w-16 h-16 object-contain rounded-lg bg-gray-100 p-1" />
                      ) : (
                        <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 text-xs">NO IMG</div>
                      )}
                      <button
                        onClick={() => navigate(`/detail/${part.category}/${encodeURIComponent(part.name)}`)}
                        className="text-sm font-semibold text-gray-900 hover:text-blue-600 transition-colors text-center leading-snug"
                      >
                        {part.name}
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROW_KEYS.map(({ label, key, format }) => (
                <tr key={label} className="border-t border-gray-100">
                  <td className="py-3 pr-4 text-gray-500 text-sm font-medium">{label}</td>
                  {parts.map((part) => {
                    const raw = getVal(part, key);
                    const isMin = label === "가격" && Number(raw) === minPrice && minPrice !== null;
                    return (
                      <td key={part.name} className={`py-3 px-3 text-center text-sm ${isMin ? "text-green-600 font-bold" : "text-gray-700"}`}>
                        {isMin && <span className="text-xs mr-1">✅</span>}
                        {format(raw)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
