FROM python:3.11-slim

# Chrome/Chromium 설치
RUN apt-get update && apt-get install -y \
    chromium-browser \
    chromium-driver \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 필수 파일 복사
COPY requirements.txt .
COPY daily_collector.py .
COPY app.py .

# Python 패키지 설치
RUN pip install --no-cache-dir -r requirements.txt

# Chrome 실행 권한
RUN chmod +x /app/daily_collector.py

# 자동화 실행
CMD ["python", "daily_collector.py"]
