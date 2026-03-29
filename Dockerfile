FROM node:22-bookworm-slim

WORKDIR /app

# better-sqlite3 icin gerekli derleme araclari (prebuild yoksa fallback)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/lojman.db

RUN mkdir -p /data /app/public/uploads

EXPOSE 3000

CMD ["npm", "start"]
