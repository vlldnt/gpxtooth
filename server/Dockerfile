FROM node:22-alpine

WORKDIR /app
COPY server.js hash-password.js ./

# Dossier des traces (volume Docker), accessible à l'utilisateur non-root
RUN mkdir -p /data && chown node:node /data
USER node

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
