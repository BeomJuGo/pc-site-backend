import { useNavigate } from "react-router-dom";
import { useCompare } from "../context/CompareContext";

export default function CompareBar() {
  const { items, remove, clear } = useCompare();
  const navigate = useNavigate();

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-md border-t border-slate-700 shadow-2xl">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
        <span className="text-sm text-slate-400 flex-shrink-0">
          비교 중 ({items.length}/3)
        </span>

        <div className="flex-1 flex items-center gap-2 overflow-x-auto">
          {items.map((item) => (
            <div
              key={item.name}
              className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2 flex-shrink-0 min-w-0"
            >
              {item.image && !item.image.includes("noImg") ? (
                <img src={item.image} alt={item.name} className="w-8 h-8 object-contain rounded" />
              ) : (
                <div className="w-8 h-8 bg-slate-700 rounded flex items-center justify-center text-xs text-slate-400">?</div>
              )}
              <span className="text-sm text-white truncate max-w-[120px]">{item.name}</span>
              <button
                onClick={() => remove(item.name)}
                className="text-slate-400 hover:text-white transition-colors flex-shrink-0"
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
            className="px-3 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            초기화
          </button>
          <button
            onClick={() => navigate("/compare")}
            className="px-4 py-2 text-sm font-medium bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg hover:from-blue-600 hover:to-purple-600 transition-all shadow"
          >
            비교하기 →
          </button>
        </div>
      </div>
    </div>
  );
}
