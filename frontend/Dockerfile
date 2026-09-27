# syntax=docker/dockerfile:1.7
FROM node:26-alpine AS build
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
ARG VITE_SENTRY_ENVIRONMENT=production
ARG VITE_APP_VERSION=
ENV VITE_AUTH_MODE=$VITE_AUTH_MODE VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID VITE_OIDC_AUDIENCE=$VITE_OIDC_AUDIENCE VITE_SENTRY_DSN=$VITE_SENTRY_DSN VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT VITE_APP_VERSION=$VITE_APP_VERSION
RUN npm run build
# The page's Content-Security-Policy, from the same variables (CD-92). Report-only until
# CSP_ENFORCE=true (see docs/DEPLOYMENT.md).
ARG CSP_ENFORCE=false
RUN CSP_ENFORCE=$CSP_ENFORCE node scripts/csp.mjs nginx > csp.conf

FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/csp.conf /etc/nginx/snippets/csp.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
