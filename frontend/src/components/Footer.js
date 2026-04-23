export default function Footer() {
  return (
    <footer className="mt-10 border-t border-slate-200">
      <div className="px-4 sm:px-6 lg:px-8 py-6 text-[12px] text-slate-500 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>데이터 출처: PassMark, 3DMark, Cinebench</div>
        <div>가격 정보는 수집 시점에 따라 변동될 수 있습니다.</div>
        <div className="sm:text-right">© {new Date().getFullYear()} GoodPricePC</div>
      </div>
    </footer>
  );
}
