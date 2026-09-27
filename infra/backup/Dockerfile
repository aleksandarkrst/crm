FROM postgres:17-alpine
RUN apk add --no-cache curl rclone tini
COPY backup.sh restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh
ENV RCLONE_CONFIG=/config/rclone/rclone.conf
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/backup.sh"]
CMD ["loop"]
