# Runtime image for lode-managed releases.
#
# The application itself is no longer baked into this image. lode downloads a
# versioned artifact, verifies its checksum/signature according to lode.toml,
# runs the artifact entrypoint, and handles update/rollback supervision.
ARG BUN_IMAGE=docker.io/oven/bun:1.3.14-debian
ARG LODE_IMAGE=docker.io/dotns/lode:latest

FROM ${LODE_IMAGE} AS lode

FROM ${BUN_IMAGE}
WORKDIR /srv/lode

COPY --from=lode /lode /usr/local/bin/lode
RUN ln -sf /usr/local/bin/lode /usr/local/bin/lode-cli \
 && mkdir -p /srv/lode /app/secret \
 && chown -R bun:bun /srv/lode /app/secret

EXPOSE 3000
VOLUME ["/srv/lode"]

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV BASE_PATH=/app
ENV LOG_TO_STDOUT=true
ENV LODE_CONFIG=/srv/lode/lode.toml
ENV LODE_DATA_DIR=/srv/lode
ENV DATA_DIR=/srv/lode/data

USER bun

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["lode", "healthcheck"]

ENTRYPOINT ["lode"]
