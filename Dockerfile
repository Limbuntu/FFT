FROM docker.m.daocloud.io/library/python:3.12-slim

WORKDIR /app

# 换成阿里云镜像源
RUN sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt

COPY app/ ./app/
COPY static/ ./static/
COPY bench_leaderboard.json .

EXPOSE 8166

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8166"]
