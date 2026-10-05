FROM nginx

ENV PROJECT_FILE_UPLOAD_MAX_BYTES=10485760

COPY ./default.conf /etc/nginx/default.conf.template
COPY ./render-upload-body-limit.sh /docker-entrypoint.d/19-render-upload-body-limit.sh

RUN chmod +x /docker-entrypoint.d/19-render-upload-body-limit.sh
