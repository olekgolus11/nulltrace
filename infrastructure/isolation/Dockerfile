ARG DEBIAN_IMAGE=library/debian@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251
ARG BUN_IMAGE=oven/bun@sha256:5a2011bf09364b9af658ac1e66f60d08092f4291aeefbff448d58b027734fdd0
ARG NUCLEI_IMAGE=projectdiscovery/nuclei@sha256:582d5546902e67052097cb2d07296c642d50a1afc5e44623cb038845df9a32eb
ARG BROWSER_IMAGE=mcr.microsoft.com/playwright@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48
FROM ${BUN_IMAGE} AS bun
FROM ${NUCLEI_IMAGE} AS nuclei

FROM ${DEBIAN_IMAGE} AS base
COPY --from=nuclei /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ARG DEBIAN_SNAPSHOT=20260921T060000Z
RUN rm -f /etc/apt/sources.list.d/* && \
    printf 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/%s/ bookworm main non-free\n' "$DEBIAN_SNAPSHOT" > /etc/apt/sources.list && \
    apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /work /opt/nulltrace/provenance && chown 65532:65532 /work
COPY release.lock.json /opt/nulltrace/provenance/release.lock.json
COPY licenses/ /opt/nulltrace/licenses/

FROM base AS scanner-source
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
COPY build-catalog.py /build-catalog.py
COPY archives/nikto.tar.gz archives/sqlmap.tar.gz /archives/
RUN python3 /build-catalog.py /opt/nulltrace/provenance/release.lock.json /archives /sources sources

FROM base AS tools
ARG FFUF_URL
ARG FFUF_SHA256
ADD --checksum=sha256:${FFUF_SHA256} ${FFUF_URL} /tmp/ffuf.tar.gz
RUN mkdir -p /opt/nulltrace/licenses/ffuf && \
    tar -xzf /tmp/ffuf.tar.gz -C /usr/local/bin ffuf && \
    tar -xzf /tmp/ffuf.tar.gz -C /opt/nulltrace/licenses/ffuf LICENSE && rm /tmp/ffuf.tar.gz
RUN apt-get update && apt-get install -y --no-install-recommends curl nmap python3 perl libnet-ssleay-perl libio-socket-ssl-perl libxml-writer-perl libxml-libxml-perl libjson-perl zsh && \
    dpkg-query -W > /opt/nulltrace/provenance/packages.tsv && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=nuclei /usr/local/bin/nuclei /usr/local/bin/nuclei
COPY --from=scanner-source /sources /opt/nulltrace/scanner-sources
RUN printf '#!/bin/sh\nexec /usr/bin/perl /opt/nulltrace/scanner-sources/nikto/files/program/nikto.pl "$@"\n' > /usr/local/bin/nikto && \
    printf '#!/bin/sh\nexec /usr/bin/python3 /opt/nulltrace/scanner-sources/sqlmap/files/sqlmap.py "$@"\n' > /usr/local/bin/sqlmap && \
    chmod 555 /usr/local/bin/nikto /usr/local/bin/sqlmap
ENV HOME=/work XDG_CONFIG_HOME=/work/config XDG_CACHE_HOME=/work/cache
WORKDIR /work
USER 65532:65532
ENTRYPOINT []
CMD ["/usr/local/bin/bun", "--version"]

FROM base AS proxy
RUN apt-get update && apt-get install -y --no-install-recommends squid && \
    dpkg-query -W > /opt/nulltrace/provenance/packages.tsv && rm -rf /var/lib/apt/lists/*
WORKDIR /work
USER 65532:65532
ENTRYPOINT []
CMD ["squid", "-v"]

FROM base AS network-init
RUN apt-get update && apt-get install -y --no-install-recommends nftables iproute2 && \
    dpkg-query -W > /opt/nulltrace/provenance/packages.tsv && rm -rf /var/lib/apt/lists/*
WORKDIR /work
USER 65532:65532
ENTRYPOINT []
CMD ["nft", "--version"]

FROM base AS dataset-build
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
COPY build-catalog.py /build-catalog.py
COPY archives/ /archives/
RUN python3 /build-catalog.py /opt/nulltrace/provenance/release.lock.json /archives /catalogs

FROM ${DEBIAN_IMAGE} AS datasets
COPY --from=dataset-build /catalogs /opt/nulltrace/catalogs
COPY release.lock.json /opt/nulltrace/provenance/release.lock.json
COPY licenses/ /opt/nulltrace/licenses/
USER 65532:65532
ENTRYPOINT []
CMD ["true"]

FROM ${BROWSER_IMAGE} AS browser
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY browser/package.json browser/bun.lock /opt/nulltrace/browser/
WORKDIR /opt/nulltrace/browser
RUN bun install --frozen-lockfile --ignore-scripts && \
    mkdir -p /work /opt/nulltrace/provenance && chown 65532:65532 /work && \
    dpkg-query -W > /opt/nulltrace/provenance/packages.tsv
COPY release.lock.json /opt/nulltrace/provenance/release.lock.json
COPY licenses/ /opt/nulltrace/licenses/
ENV HOME=/work XDG_CONFIG_HOME=/work/config XDG_CACHE_HOME=/work/cache PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /work
USER 65532:65532
ENTRYPOINT []
CMD ["/usr/local/bin/bun", "--version"]

FROM base AS chat
ARG OPENCODE_URL
ARG OPENCODE_SHA256
ADD --checksum=sha256:${OPENCODE_SHA256} ${OPENCODE_URL} /tmp/opencode.tar.gz
RUN tar -xzf /tmp/opencode.tar.gz -C /usr/local/bin opencode && rm /tmp/opencode.tar.gz
ENV HOME=/work XDG_CONFIG_HOME=/work/config XDG_CACHE_HOME=/work/cache XDG_DATA_HOME=/work/data
WORKDIR /work
USER 65532:65532
ENTRYPOINT []
CMD ["opencode", "--version"]
