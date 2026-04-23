import React from "react";

export default function PartCard({ part, onClick }) {
  if (!part) return null;

  const name = String(part.name || "");
  const priceNum = Number(part.price);
  const priceText = Number.isFinite(priceNum) ? `${priceNum.toLocaleString()}원` : "가격 정보 없음";
  const passmark = part?.benchmarkScore?.passmarkscore;
  const mark3d = part?.benchmarkScore?.["3dmarkscore"];
  const subScore =
    mark3d != null
      ? `3DMark ${Number(mark3d).toLocaleString()}`
      : passmark != null
      ? `PassMark ${Number(passmark).toLocaleString()}`
      : null;

  return (
    <div
      onClick={onClick}
      className="w-full cursor-pointer border-b border-slate-200 px-3 py-4 hover:bg-slate-50 transition"
    >
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 flex-shrink-0 rounded bg-slate-50 border border-slate-200 flex items-center justify-center overflow-hidden">
          {part.image ? (
            <img src={part.image} alt={name} className="w-full h-full object-contain" />
          ) : (
            <span className="text-xs text-slate-400">NO IMAGE</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] sm:text-[16px] font-medium text-slate-900 truncate">{name}</h3>
          {part.review && (
            <p className="mt-1 text-[12px] sm:text-[13px] text-slate-500 truncate">{part.review}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="text-[16px] sm:text-[18px] font-semibold text-slate-900">{priceText}</div>
          {subScore && <div className="text-[12px] sm:text-[13px] text-slate-500">{subScore}</div>}
        </div>
      </div>
    </div>
  );
}
