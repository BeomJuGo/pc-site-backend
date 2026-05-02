import { memo } from "react";
import { useCompare } from "../context/CompareContext";
import { useFavorites } from "../hooks/useFavorites";

function PartCard({ part, onClick }) {
  const { add: addCompare, remove: removeCompare, has: inCompare } = useCompare();
  const { toggle: toggleFavorite, isFavorite } = useFavorites();

  if (!part) return null;

  const name = String(part.name || "");
  const priceNum = Number(part.price);
  const priceText = Number.isFinite(priceNum) ? `${priceNum.toLocaleString()}원` : "가격 정보 없음";

  const benchScore = part?.benchScore || part?.benchmarkScore?.passmarkscore;
  const mark3d = part?.benchmarkScore?.["3dmarkscore"];
  const subScore =
    mark3d != null
      ? `3DMark ${Number(mark3d).toLocaleString()}`
      : benchScore != null
      ? `PassMark ${Number(benchScore).toLocaleString()}`
      : null;

  const comparing = inCompare(name);
  const favorited = isFavorite(name, part.category);

  const handleCompare = (e) => {
    e.stopPropagation();
    comparing ? removeCompare(name) : addCompare(part);
  };

  const handleFavorite = (e) => {
    e.stopPropagation();
    toggleFavorite(part);
  };

  return (
    <div
      onClick={onClick}
      className="w-full cursor-pointer px-4 py-4 hover:bg-gray-50 transition-colors relative group"
    >
      {/* Hover action buttons */}
      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
        <button
          onClick={handleFavorite}
          title={favorited ? "즐겨찾기 해제" : "즐겨찾기 추가"}
          className={`p-1.5 rounded-md transition-colors ${
            favorited
              ? "bg-pink-50 text-pink-500"
              : "bg-gray-100 text-gray-400 hover:text-pink-500 hover:bg-pink-50"
          }`}
        >
          <svg className="w-4 h-4" fill={favorited ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
        </button>
        <button
          onClick={handleCompare}
          title={comparing ? "비교 제거" : "비교에 추가 (최대 3개)"}
          className={`p-1.5 rounded-md transition-colors ${
            comparing
              ? "bg-blue-50 text-blue-600"
              : "bg-gray-100 text-gray-400 hover:text-blue-600 hover:bg-blue-50"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div className="w-16 h-16 flex-shrink-0 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden">
          {part.image && !part.image.includes("noImg") && !part.image.includes("noData") ? (
            <img
              src={part.image}
              alt={name || "부품 이미지"}
              loading="lazy"
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.target.style.display = "none";
                if (e.target.nextSibling) e.target.nextSibling.classList.remove("hidden");
              }}
            />
          ) : (
            <span className="text-xs text-gray-400">NO IMG</span>
          )}
          <span className="text-xs text-gray-400 hidden">NO IMG</span>
        </div>
        <div className="flex-1 min-w-0 pr-16">
          <h3 className="text-[15px] font-semibold text-gray-900 break-words leading-snug">{name}</h3>
          {part.review && (
            <p className="mt-1 text-[12px] text-gray-500 truncate leading-relaxed">{part.review}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div className="text-[16px] font-bold text-gray-900">{priceText}</div>
          {subScore && <div className="text-[12px] text-gray-500">{subScore}</div>}
        </div>
      </div>
    </div>
  );
}

export default memo(PartCard);
