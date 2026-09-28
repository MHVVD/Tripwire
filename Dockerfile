FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY web ./web
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["npx", "tsx", "src/index.ts"]
