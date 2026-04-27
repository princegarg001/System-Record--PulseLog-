FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

RUN addgroup -g 1001 -S nevup && \
    adduser -S nevup -u 1001 -G nevup

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY migrations/ ./migrations/
COPY nevup_seed_dataset.json ./nevup_seed_dataset.json
COPY entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

USER nevup

EXPOSE 4010

ENV NODE_ENV=production

CMD ["./entrypoint.sh"]
