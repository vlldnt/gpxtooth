FROM nginx:1.27-alpine

# Copier les fichiers web vers la racine de Nginx
COPY index.html style.css /var/www/html/
COPY scripts/ /var/www/html/scripts/
COPY assets/ /var/www/html/assets/
COPY data/ /var/www/html/data/

# Copier la config Nginx du site (conteneur)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
