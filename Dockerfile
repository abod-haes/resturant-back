FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Sharp SVG rasterization needs an installed font to shape Arabic restaurant names.
RUN apk add --no-cache fontconfig font-dejavu
# Cairo is the dashboard's typeface; retain its SIL OFL license.
ADD https://raw.githubusercontent.com/google/fonts/a2c83daed9bc723922de8d0a9512990bd3d91df4/ofl/cairo/Cairo%5Bslnt%2Cwght%5D.ttf /usr/local/share/fonts/cairo/Cairo.ttf
ADD https://raw.githubusercontent.com/google/fonts/a2c83daed9bc723922de8d0a9512990bd3d91df4/ofl/cairo/OFL.txt /usr/local/share/fonts/cairo/OFL.txt
RUN chmod 644 /usr/local/share/fonts/cairo/* && fc-cache -f && fc-list : family | grep -i Cairo
COPY --from=build /app/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/database/migrations ./database/migrations
COPY --from=build /app/scripts/migrate.mjs /app/scripts/bootstrap-primary.mjs /app/scripts/seed-jubran.mjs ./scripts/
COPY --from=build /app/mocks/fixtures.json ./mocks/fixtures.json
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm run db:migrate && exec node dist/main.js"]
