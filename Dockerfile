FROM node:22-alpine AS deps

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS prod-deps

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS builder

WORKDIR /usr/src/app
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner

ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /usr/src/app

COPY package*.json ./
COPY --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/docs ./docs

EXPOSE 3001

CMD ["node", "dist/server.js"]
