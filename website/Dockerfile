# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Where Sign in and Create account point; Vite inlines it at build time.
ARG VITE_APP_URL=https://app.pultly.com
# The MailerLite embedded form for newsletter signups (public IDs); empty = signups aren't stored.
ARG VITE_MAILERLITE_ACCOUNT_ID=
ARG VITE_MAILERLITE_FORM_ID=
ENV VITE_APP_URL=$VITE_APP_URL VITE_MAILERLITE_ACCOUNT_ID=$VITE_MAILERLITE_ACCOUNT_ID VITE_MAILERLITE_FORM_ID=$VITE_MAILERLITE_FORM_ID
RUN npm run build

FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
