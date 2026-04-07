FROM nginx:1.27-alpine

# Copier tous les fichiers vers la racine web de Nginx
COPY . /var/www/html/

# Copier la config Nginx du site (conteneur)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
