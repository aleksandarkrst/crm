# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Vite inlines these at build time.
ARG VITE_AUTH_MODE=oidc
ARG VITE_OIDC_AUTHORITY=
ARG VITE_OIDC_CLIENT_ID=
ARG VITE_OIDC_AUDIENCE=
ARG VITE_SENTRY_DSN=
ARG VITE_APP_VERSION=
ENV VITE_AUTH_MODE=$VITE_AUTH_MODE VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID VITE_OIDC_AUDIENCE=$VITE_OIDC_AUDIENCE VITE_SENTRY_DSN=$VITE_SENTRY_DSN VITE_APP_VERSION=$VITE_APP_VERSION
RUN npm run build

FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
