export const fetchParts = async (category) => {
  const partsData = {
    cpu: [
      {
        id: 1,
        name: "Intel Core i5-14600K",
        specs: {
          cores: 14, threads: 20,
          baseClock: "3.5GHz", boostClock: "5.3GHz", TDP: "125W"
        }
      },
      {
        id: 2,
        name: "Intel Core i9-14900K",
        specs: {
          cores: 24, threads: 32,
          baseClock: "3.2GHz", boostClock: "6.0GHz", TDP: "125W"
        }
      }
    ]
  };
  return new Promise((resolve) => setTimeout(() => resolve(partsData[category]), 300));
};

export const fetchNaverPrice = async (query) => {
  try {
    const res = await fetch(`https://pc-site-backend.onrender.com/api/naver-price?query=${encodeURIComponent(query)}`);
    const data = await res.json();
    const item = data.items?.[0];
    return {
      price: item?.lprice || "가격 정보 없음",
      image: item?.image || ""
    };
  } catch {
    return { price: "가격 정보를 가져올 수 없습니다.", image: "" };
  }
};

export const fetchCpuBenchmark = async (cpuName) => {
  try {
    const res = await fetch(`https://pc-site-backend.onrender.com/api/cpu-benchmark?cpu=${encodeURIComponent(cpuName)}`);
    const data = await res.json();
    return data.benchmarkScore;
  } catch {
    return { singleCore: "점수 없음", multiCore: "점수 없음" };
  }
};

export const fetchGPTReview = async (partName, specSummary) => {
  try {
    const res = await fetch("https://pc-site-backend.onrender.com/api/gpt-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partName, specs: specSummary })
    });
    const data = await res.json();
    return data.review || "한줄평 없음";
  } catch {
    return "한줄평 생성 실패";
  }
};

export const fetchFullPartData = async (category) => {
  const parts = await fetchParts(category);

  const enriched = await Promise.all(
    parts.map(async (part) => {
      const specSummary = Object.entries(part.specs)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");

      const { price, image } = await fetchNaverPrice(part.name);
      const benchmarkScore = await fetchCpuBenchmark(part.name);
      const review = await fetchGPTReview(part.name, specSummary);

      return { ...part, price, image, specSummary, review, benchmarkScore };
    })
  );

  return enriched;
};

export const fetchPartDetail = async (category, id) => {
  const parts = await fetchFullPartData(category);
  return parts.find((p) => p.id.toString() === id.toString());
};

export const fetchPriceHistory = async () => {
  return [
    { date: "2024-12", price: 560000 },
    { date: "2025-01", price: 570000 },
    { date: "2025-02", price: 545000 },
    { date: "2025-03", price: 552000 },
  ];
};
