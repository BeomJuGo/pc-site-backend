const fetchCpuBenchmark = async (cpuName) => {
  try {
    const url = "https://browser.geekbench.com/processor-benchmarks";
    console.log(`🔍 [Geekbench CPU 목록 페이지 요청] ${url}`);

    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    let singleCore = "점수 없음";
    let multiCore = "점수 없음";
    let found = false;

    $(".table tbody tr").each((_, element) => {
      const name = $(element).find("td.name").text().trim().toLowerCase();
      const single = $(element).find("td.score").eq(0).text().trim();
      const multi = $(element).find("td.score").eq(1).text().trim();

      if (name.includes(cpuName.toLowerCase())) {
        singleCore = single || "점수 없음";
        multiCore = multi || "점수 없음";
        found = true;
        return false; // 찾으면 루프 종료
      }
    });

    if (!found) {
      throw new Error(`CPU 이름 (${cpuName})을 Geekbench 목록에서 찾을 수 없음.`);
    }

    console.log(`✅ [Geekbench 점수] ${cpuName} Single: ${singleCore}, Multi: ${multiCore}`);

    return { singleCore, multiCore };
  } catch (error) {
    console.error(`❌ [Geekbench CPU 벤치마크 가져오기 실패] ${cpuName}:`, error.message);
    return { singleCore: "점수 없음", multiCore: "점수 없음" };
  }
};
