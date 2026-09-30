# Standalone build for the Sequence model gateway.
# Self-contained: copies only this package (no workspace deps) and has zero
# runtime npm dependencies, so a plain `npm ci` (or nothing) is enough.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
# The gateway has no runtime deps; devDeps (typescript) are needed only to build.
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Only the compiled output and package manifest ship in the runtime image.
COPY package.json ./
COPY --from=build /app/dist ./dist
EXPOSE 8787
CMD ["node", "dist/server.js"]
