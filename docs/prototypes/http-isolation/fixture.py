"""THROWAWAY controlled HTTP/HTTPS and DNS endpoints; synthetic data only."""
import http.server
import json
import socket
import ssl
import threading
import time

lock = threading.Lock()


def record(kind, value):
    with lock:
        with open('/tmp/events.jsonl', 'a') as events:
            events.write(json.dumps({'kind': kind, 'value': value}) + '\n')


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        record('http', self.path)
        if self.path == '/redirect':
            self.send_response(302)
            self.send_header('Location', 'http://forbidden.test:8080/redirect-received')
        else:
            self.send_response(200)
        self.end_headers()
        self.wfile.write(b'fixture-ok\n')

    def log_message(self, *args):
        pass


class Server6(http.server.ThreadingHTTPServer):
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        super().server_bind()


def dns_udp():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(('0.0.0.0', 53))
    while True:
        payload, peer = sock.recvfrom(4096)
        record('dns-udp', payload.hex())
        # NXDOMAIN with the original question, suitable for a reachability canary.
        response = payload[:2] + b'\x81\x83' + payload[4:6] + b'\x00\x00\x00\x00\x00\x00' + payload[12:]
        sock.sendto(response, peer)


def dns_tcp():
    sock = socket.socket()
    sock.bind(('0.0.0.0', 53))
    sock.listen()
    while True:
        conn, peer = sock.accept()
        with conn:
            record('dns-tcp', conn.recv(4096).hex())


open('/tmp/events.jsonl', 'w').close()
for cls, host in [(http.server.ThreadingHTTPServer, '0.0.0.0'), (Server6, '::')]:
    for port in [8080, 8443, 9000]:
        server = cls((host, port), Handler)
        if port == 8443:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain('/experiment/cert.pem', '/experiment/key.pem')
            server.socket = ctx.wrap_socket(server.socket, server_side=True)
        threading.Thread(target=server.serve_forever, daemon=True).start()
threading.Thread(target=dns_udp, daemon=True).start()
threading.Thread(target=dns_tcp, daemon=True).start()
open('/tmp/ready', 'w').close()
while True:
    time.sleep(60)
