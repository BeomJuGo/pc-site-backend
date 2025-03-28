# ✅ crawl_price.py
import sys
import json
from danawa import Danawa

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "제품명을 입력하세요"}))
        return

    query = sys.argv[1]
    danawa = Danawa()
    results = danawa.search(query)

    if not results:
        print(json.dumps({"error": "검색 결과 없음"}))
        return

    item = results[0]
    item.fetch_info()

    if not item.price_trend:
        print(json.dumps({"error": "가격 추이 없음"}))
        return

    trend_data = [
        {"date": point["date"], "price": point["price"]}
        for point in item.price_trend[-7:]
    ]
    print(json.dumps(trend_data, ensure_ascii=False))

if __name__ == "__main__":
    main()
