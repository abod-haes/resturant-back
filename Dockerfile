FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/database/migrations ./database/migrations
COPY --from=build /app/scripts/migrate.mjs /app/scripts/bootstrap-primary.mjs /app/scripts/seed-complete.mjs ./scripts/
COPY --from=build /app/mocks/fixtures.json ./mocks/fixtures.json
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm run db:migrate && exec node dist/main.js"]
