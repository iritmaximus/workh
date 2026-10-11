# ---- build: type-check and bundle the React frontend ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test && npm run build

# ---- runtime: Express server + built frontend ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY backend ./backend
COPY shared ./shared
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME /app/data
EXPOSE 3001
# Run node directly (not via npm) so SIGTERM reaches the server.
CMD ["node", "--import", "tsx", "backend/server.ts"]
