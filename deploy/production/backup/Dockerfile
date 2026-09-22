FROM postgres:16-alpine

# aws-cli (S3 compatible con B2 + Object Lock) y openssl para cifrar en el VPS.
RUN apk add --no-cache aws-cli openssl

COPY backup-postgres.sh /usr/local/bin/backup-postgres.sh
RUN chmod 0755 /usr/local/bin/backup-postgres.sh

# Ciclo de 30 minutos; el plan exige completar generacion y subida en <15 min.
CMD ["sh", "-c", "while true; do backup-postgres.sh --once || echo 'backup failed'; sleep 1800; done"]
