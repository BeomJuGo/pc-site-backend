import { useNavigate } from "react-router-dom";
import { useCompare } from "../context/CompareContext";

export default function CompareBar() {
  const { items, remove, clear } = useCompare();
  const navigate = useNavigate();

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-lg">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
        <span className="text-sm text-gray-500 flex-shrink-0">
          비교 중 ({items.length}/3)
        </span>

        <div className="flex-1 flex items-center gap-2 overflow-x-auto">
          {items.map((item) => (
            <div
              key={item.name}
              className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2 flex-shrink-0 min-w-0"
            >
              {item.image && !item.image.includes("noImg") ? (
                <img src={item.image} alt={item.name} className="w-8 h-8 object-contain rounded" />
              ) : (
                <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center text-xs text-gray-400">?</div>
              )}
              <span className="text-sm text-gray-900 truncate max-w-[120px]">{item.name}</span>
              <button
                onClick={() => remove(item.name)}
                className="text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0"
                aria-label="제거"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={clear}
            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors"
          >
            초기화
          </button>
          <button
            onClick={() => navigate("/compare")}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all shadow-sm"
          >
            비교하기 →
          </button>
        </div>
      </div>
    </div>
  );
}
