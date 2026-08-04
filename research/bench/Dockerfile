ARG BASE_IMAGE=node:22-bookworm-slim
FROM ${BASE_IMAGE}

ARG MEMORIX_VERSION=1.4.1

USER root

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/runs/home \
    PATH=/opt/memorixbench-venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git python3 python3-pip python3-venv make g++ tini \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 --shell /usr/sbin/nologin bench \
  && mkdir -p /runner /runs/home /input \
  && chown -R bench:bench /runner /runs

# The image deliberately installs the released product under study, not the
# host checkout. Trial credentials are injected only by docker exec at runtime.
RUN npm install --global --omit=dev "memorix@${MEMORIX_VERSION}"

WORKDIR /runner

COPY . /runner
RUN python3 -m venv /opt/memorixbench-venv \
  && /opt/memorixbench-venv/bin/pip install --no-cache-dir . \
  && mkdir -p /runs/memorix-data \
  && chown -R bench:bench /runner /runs

# Do not inherit a storage path from a locally supplied fallback base image.
# This is deliberately late in the Dockerfile so a runtime-path change does
# not invalidate the published Memorix installation layer.
ENV MEMORIX_DATA_DIR=/runs/memorix-data

ENTRYPOINT ["tini", "--"]
CMD ["sleep", "infinity"]
