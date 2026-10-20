FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/voorraad.db
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node","server.js"]
