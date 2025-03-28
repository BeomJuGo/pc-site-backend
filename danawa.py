# ✅ danawa.py - 간단한 다나와 검색 및 가격 추이 크롤링
import requests
from bs4 import BeautifulSoup
import re
import datetime
import sys

class Danawa:
    def __init__(self):
        self.session = requests.Session()

    def search(self, query):
        url = f"https://search.danawa.com/dsearch.php?k1={query}"
        res = self.session.get(url, headers={"User-Agent": "Mozilla/5.0"})
        soup = BeautifulSoup(res.text, "html.parser")

        link_tag = soup.select_one(".prod_main_info a")
        if not link_tag:
            return []

        href = link_tag["href"]
        product_url = href if href.startswith("http") else "https:" + href
        return [DanawaProduct(product_url, self.session)]

class DanawaProduct:
    def __init__(self, url, session):
        self.url = url
        self.session = session
        self.price_trend = []

    def fetch_info(self):
        sys.stderr.write(f"✅ 상품 URL: {self.url}\n")

        res = self.session.get(self.url, headers={"User-Agent": "Mozilla/5.0"})
        soup = BeautifulSoup(res.text, "html.parser")

        script_tag = soup.find("script", text=re.compile("priceChartData"))
        sys.stderr.write(f"✅ 스크립트 태그 있음: {bool(script_tag)}\n")

        if not script_tag or not script_tag.string:
            sys.stderr.write("❌ 스크립트 태그가 없거나 비어 있음\n")
            return

        matched = re.search(r'priceChartData\s*=\s*(\[.*?\]);', script_tag.string, re.DOTALL)
        sys.stderr.write(f"✅ 정규식 매칭: {bool(matched)}\n")

        if not matched:
            sys.stderr.write("❌ 정규표현식으로 가격 정보 찾지 못함\n")
            return

        import json
        try:
            chart_data = json.loads(matched.group(1))
            sys.stderr.write(f"✅ 파싱된 데이터 개수: {len(chart_data)}\n")
        except Exception as e:
            sys.stderr.write(f"❌ JSON 파싱 실패: {str(e)}\n")
            return

        self.price_trend = [
            {
                "date": (datetime.datetime.today() - datetime.timedelta(days=i)).strftime("%Y-%m-%d"),
                "price": int(item.get("price", 0))
            }
            for i, item in enumerate(chart_data[-7:]) if item.get("price")
        ]
