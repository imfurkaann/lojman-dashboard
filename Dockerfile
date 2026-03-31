# Stage 1: Build with all dependencies
FROM node:22-alpine AS builder

WORKDIR /app

# Gerekli build tools
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

# Stage 2: Production image
FROM node:22-alpine

WORKDIR /app

# Runtime dependencies only
RUN apk add --no-cache curl sqlite

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/lojman.db

RUN mkdir -p /data /app/public/uploads/personnel

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=45s \
  CMD curl -f http://localhost:3000/dashboard || exit 1

CMD ["npm", "start"]
