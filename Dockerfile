# Backend de Trazabilidad (Express + TypeScript) para Fly.io.
# No requiere disco persistente: el estado vive en MongoDB Atlas y Cloudflare R2.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Solo dependencias de producción para una imagen más liviana.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
# Artefactos compilados desde la etapa de build.
COPY --from=build /app/dist ./dist
EXPOSE 4000
CMD ["node", "dist/server.js"]
