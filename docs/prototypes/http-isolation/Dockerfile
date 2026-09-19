# THROWAWAY infrastructure experiment; not a release image.
FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251
RUN apt-get update && apt-get install -y --no-install-recommends squid curl nftables python3 iproute2 openssl dnsutils tcpdump ca-certificates && rm -rf /var/lib/apt/lists/*
COPY fixture.py /experiment/fixture.py
RUN openssl req -x509 -newkey rsa:2048 -nodes -days 30 -keyout /experiment/key.pem -out /experiment/cert.pem -subj '/CN=approved.test' -addext 'subjectAltName=DNS:approved.test,DNS:approved-v6.test,DNS:localhost' && chmod 644 /experiment/key.pem
USER 65532:65532
WORKDIR /tmp
