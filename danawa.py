# ✅ danawa.py - 간단한 다나와 검색 및 가격 추이 크롤링
import requests
from bs4 import BeautifulSoup
import re
import datetime

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

        product_url = "https:" + link_tag["href"]
        return [DanawaProduct(product_url, self.session)]

class DanawaProduct:
    def __init__(self, url, session):
        self.url = url
        self.session = session
        self.price_trend = []

    def fetch_info(self):
        res = self.session.get(self.url, headers={"User-Agent": "Mozilla/5.0"})
        soup = BeautifulSoup(res.text, "html.parser")

        script_tag = soup.find("script", text=re.compile("priceChartData"))
        if not script_tag:
            return

        # 가격 데이터 파싱
        matched = re.search(r'priceChartData\s*=\s*(\[.*?\]);', script_tag.string, re.DOTALL)
        if not matched:
            return

        import json
        try:
            chart_data = json.loads(matched.group(1))
        except:
            return

        self.price_trend = [
            {
                "date": (datetime.datetime.today() - datetime.timedelta(days=i)).strftime("%Y-%m-%d"),
                "price": int(item.get("price", 0))
            }
            for i, item in enumerate(chart_data[-7:]) if item.get("price")
        ]
