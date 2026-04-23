function Pulse({ className }) {
  return <div className={`animate-pulse bg-slate-700/60 rounded-lg ${className}`} />;
}

export function SkeletonDetail() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-4xl mx-auto">
      <div className="flex items-start gap-5 mb-6">
        <Pulse className="w-24 h-24 rounded-xl flex-shrink-0" />
        <div className="flex-1 space-y-3">
          <Pulse className="h-8 w-2/3" />
          <Pulse className="h-5 w-1/4" />
          <Pulse className="h-8 w-1/3" />
        </div>
        <div className="text-right flex-shrink-0 space-y-2">
          <Pulse className="h-8 w-32" />
          <Pulse className="h-4 w-24" />
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <Pulse className="h-6 w-24" />
        <Pulse className="h-24 w-full rounded-xl" />
      </div>

      <div className="mt-8 space-y-3">
        <Pulse className="h-6 w-32" />
        <Pulse className="h-64 w-full rounded-xl" />
      </div>

      <div className="mt-8 space-y-3">
        <Pulse className="h-6 w-32" />
        <div className="grid grid-cols-3 gap-3">
          <Pulse className="h-32 rounded-xl" />
          <Pulse className="h-32 rounded-xl" />
          <Pulse className="h-32 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
