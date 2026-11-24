# ---- Stage 1: build the React app ----------------------------------------
FROM node:20-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The amber "Under development" mark; build with an empty value to hide it.
ARG VITE_APP_STAGE="Under development"
ENV VITE_APP_STAGE=$VITE_APP_STAGE
RUN npm run build

# ---- Stage 2: serve it with an unprivileged nginx ------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/nginx-health || exit 1
