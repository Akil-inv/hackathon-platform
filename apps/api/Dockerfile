FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --include=dev

COPY . .

RUN npx prisma generate
RUN npx nest build

EXPOSE 4000

USER node
USER node
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/main.js"]
