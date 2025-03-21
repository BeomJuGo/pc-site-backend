const fetchCpuBenchmark = async (cpuName) => {
  try {
    const urls = {
      single: "https://www.cpu-monkey.com/en/cpu_benchmark-cinebench_2024_single_core",
      multi: "https://www.cpu-monkey.com/en/cpu_benchmark-cinebench_2024_multi_core",
    };

    const formatName = cpuName.toLowerCase().replace(/\s+/g, " ").trim();

    const fetchAndFindScore = async (url) => {
      const { data } = await axios.get(url);
      const $ = cheerio.load(data);

      let score = null;

      $("table tbody tr").each((_, row) => {
        const name = $(row).find("td").eq(1).text().toLowerCase().trim();
        const val = $(row).find("td").eq(2).text().trim();

        if (name.includes(formatName)) {
          score = val;
          return false; // break loop
        }
      });

      return score;
    };

    const singleCore = await fetchAndFindScore(urls.single) || "점수 없음";
    const multiCore = await fetchAndFindScore(urls.multi) || "점수 없음";

    console.log(`✅ [Cinebench 점수] ${cpuName} ➜ Single: ${singleCore}, Multi: ${multiCore}`);
    return { singleCore, multiCore };
  } catch (err) {
    console.error(`❌ [Cinebench 점수 크롤링 실패] ${cpuName}:`, err.message);
    return { singleCore: "점수 없음", multiCore: "점수 없음", error: err.message };
  }
};
