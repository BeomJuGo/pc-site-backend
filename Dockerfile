# ✅ Node + Python을 모두 지원하는 베이스 이미지 사용
FROM node:18-bullseye

# Python 설치
RUN apt-get update && apt-get install -y python3 python3-pip

# 작업 디렉토리 설정
WORKDIR /app

# Node.js 의존성 설치
COPY package*.json ./
RUN npm install

# Python 의존성 설치
COPY requirements.txt ./
RUN pip3 install -r requirements.txt

# 전체 코드 복사
COPY . .

# Node 서버 실행
CMD ["node", "index.js"]
