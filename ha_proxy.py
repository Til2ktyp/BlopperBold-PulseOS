#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
from select import select
from socket import create_connection
from ssl import create_default_context
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


HOST = "192.168.178.96"
PORT = 8001
HOME_ASSISTANT = "http://homeassistant.local:8123"
SPOTIFY = "https://open.spotify.com"
SPOTIFY_ACCOUNTS = "https://accounts.spotify.com"
INDEX_FILE = Path(__file__).with_name("index.html")


class DashboardProxy(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_HEAD(self):
        if self.path in ("/", "/index.html", "/dashboard"):
            self.serve_dashboard(include_body=False)
            return

        self.proxy_home_assistant(include_body=False)

    def do_GET(self):
        if self.path in ("/", "/index.html", "/dashboard"):
            self.serve_dashboard()
            return

        if self.is_websocket_request():
            self.proxy_websocket()
            return

        self.proxy_home_assistant()

    def do_POST(self):
        self.proxy_home_assistant()

    def do_OPTIONS(self):
        self.proxy_home_assistant()

    def serve_dashboard(self, include_body=True):
        html = INDEX_FILE.read_bytes()

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(html)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if include_body:
            self.wfile.write(html)

    def proxy_home_assistant(self, include_body=True):
        target_url = self.build_target_url()
        body = self.read_body()
        headers = self.build_forward_headers(target_url)
        request = Request(target_url, data=body, headers=headers, method=self.command)

        try:
            with urlopen(request, timeout=30) as response:
                self.forward_response(response.status, response.headers, response.read(), include_body)
        except HTTPError as error:
            self.forward_response(error.code, error.headers, error.read(), include_body)
        except URLError as error:
            message = f"Home Assistant ist nicht erreichbar: {error.reason}".encode()
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(message)))
            self.end_headers()
            self.wfile.write(message)

    def build_target_url(self):
        upstream = self.get_upstream()
        path = self.path

        if path.startswith("/ha/"):
            path = path[3:]

        if path == "/ha":
            path = "/"

        if path.startswith("/spotify/"):
            path = path[8:]

        if path == "/spotify":
            path = "/"

        if path.startswith("/spotify-accounts/"):
            path = path[17:]

        if path == "/spotify-accounts":
            path = "/"

        return f"{upstream}{path}"

    def get_upstream(self):
        if self.path.startswith("/spotify-accounts"):
            return SPOTIFY_ACCOUNTS

        if self.path.startswith("/spotify"):
            return SPOTIFY

        referer = self.headers.get("Referer", "")

        if "/spotify-accounts" in referer:
            return SPOTIFY_ACCOUNTS

        if "/spotify" in referer:
            return SPOTIFY

        return HOME_ASSISTANT

    def is_websocket_request(self):
        connection = self.headers.get("Connection", "").lower()
        upgrade = self.headers.get("Upgrade", "").lower()

        return "upgrade" in connection and upgrade == "websocket"

    def read_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(length) if length else None

    def build_forward_headers(self, target_url):
        headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in {
                "accept-encoding",
                "connection",
                "content-length",
                "host",
                "origin",
                "referer",
            }
        }

        target = urlsplit(target_url)
        headers["Host"] = target.netloc
        upstream = self.get_upstream()
        headers["Origin"] = upstream
        headers["Referer"] = upstream + "/"
        headers["X-Forwarded-Host"] = self.headers.get("Host", f"{HOST}:{PORT}")
        headers["X-Forwarded-Proto"] = "http"

        return headers

    def proxy_websocket(self):
        target = urlsplit(self.build_target_url())
        port = target.port or (443 if target.scheme == "https" else 80)
        upstream = create_connection((target.hostname, port), timeout=30)

        if target.scheme == "https":
            upstream = create_default_context().wrap_socket(upstream, server_hostname=target.hostname)

        path = target.path or "/"

        if target.query:
            path = f"{path}?{target.query}"

        request_lines = [
            f"{self.command} {path} HTTP/1.1",
            f"Host: {target.netloc}",
            f"Origin: {self.get_upstream()}",
        ]

        for key, value in self.headers.items():
            if key.lower() in {"host", "origin"}:
                continue

            request_lines.append(f"{key}: {value}")

        upstream.sendall(("\r\n".join(request_lines) + "\r\n\r\n").encode())
        self.tunnel(upstream)

    def tunnel(self, upstream):
        sockets = [self.connection, upstream]

        try:
            while True:
                readable, _, _ = select(sockets, [], [], 60)

                if not readable:
                    break

                for sock in readable:
                    data = sock.recv(65536)

                    if not data:
                        return

                    target = upstream if sock is self.connection else self.connection
                    target.sendall(data)
        finally:
            upstream.close()

    def forward_response(self, status, source_headers, body, include_body=True):
        source_headers = dict(source_headers.items())
        content_type = self.get_response_header(source_headers, "content-type")

        if self.get_upstream() in (SPOTIFY, SPOTIFY_ACCOUNTS) and "text/html" in content_type:
            body = self.rewrite_spotify_html(body)

        self.send_response(status)

        for key, value in source_headers.items():
            header = key.lower()

            if header in {
                "connection",
                "content-encoding",
                "content-length",
                "content-security-policy",
                "transfer-encoding",
                "x-frame-options",
            }:
                continue

            if header == "location":
                value = self.rewrite_location(value)

            if header == "set-cookie":
                value = self.rewrite_cookie(value)

            self.send_header(key, value)

        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def get_response_header(self, headers, name):
        name = name.lower()

        for key, value in headers.items():
            if key.lower() == name:
                return value

        return ""

    def rewrite_location(self, value):
        if value.startswith(HOME_ASSISTANT):
            return "/ha" + value.removeprefix(HOME_ASSISTANT)

        if value.startswith(SPOTIFY):
            return "/spotify" + value.removeprefix(SPOTIFY)

        if value.startswith(SPOTIFY_ACCOUNTS):
            return "/spotify-accounts" + value.removeprefix(SPOTIFY_ACCOUNTS)

        return value

    def rewrite_cookie(self, value):
        value = re.sub(r";?\s*domain=[^;]+", "", value, flags=re.IGNORECASE)

        if not value.startswith("__Host-"):
            value = re.sub(r";?\s*secure", "", value, flags=re.IGNORECASE)

        value = re.sub(r"samesite=none", "SameSite=Lax", value, flags=re.IGNORECASE)
        return value

    def rewrite_spotify_html(self, body):
        text = body.decode("utf-8", errors="ignore")
        prefix = "/spotify-accounts/" if self.get_upstream() == SPOTIFY_ACCOUNTS else "/spotify/"
        text = re.sub(r'(?P<attr>\b(?:href|src|action|content)=["\'])/(?P<path>[^/"\'])', rf'\g<attr>{prefix}\g<path>', text)
        text = text.replace("https://accounts.spotify.com/", "http://127.0.0.1:8001/spotify-accounts/")
        text = text.replace("https://accounts.spotify.com", "http://127.0.0.1:8001/spotify-accounts")
        text = text.replace("//accounts.spotify.com/", "//127.0.0.1:8001/spotify-accounts/")
        text = text.replace("https://accounts.spotify.com/", "http://127.0.0.1:8001/spotify-accounts/")
        text = text.replace("https://open.spotify.com/", "http://127.0.0.1:8001/spotify/")
        text = self.inject_spotify_login_hook(text)
        return text.encode("utf-8")

    def inject_spotify_login_hook(self, text):
        script = """
<script>
(() => {
    const toLocalSpotifyUrl = (value) => {
        if (!value) return value;
        return value
            .replace("https://accounts.spotify.com/", "http://127.0.0.1:8001/spotify-accounts/")
            .replace("https://accounts.spotify.com", "http://127.0.0.1:8001/spotify-accounts")
            .replace("https://open.spotify.com/", "http://127.0.0.1:8001/spotify/");
    };

    const rewriteElement = (element) => {
        if (element.href) element.href = toLocalSpotifyUrl(element.href);
        if (element.action) element.action = toLocalSpotifyUrl(element.action);
    };

    const rewriteSpotifyLinks = () => {
        document
            .querySelectorAll("a[href], form[action]")
            .forEach(rewriteElement);
    };

    document.addEventListener("click", (event) => {
        const link = event.target.closest && event.target.closest("a[href]");

        if (!link) return;

        const nextUrl = toLocalSpotifyUrl(link.href);

        if (nextUrl !== link.href) {
            event.preventDefault();
            window.location.href = nextUrl;
        }
    }, true);

    window.open = new Proxy(window.open, {
        apply(target, thisArg, args) {
            if (args[0]) args[0] = toLocalSpotifyUrl(String(args[0]));
            return Reflect.apply(target, thisArg, args);
        }
    });

    rewriteSpotifyLinks();
    setInterval(rewriteSpotifyLinks, 500);
})();
</script>
"""

        if "</body>" in text:
            return text.replace("</body>", script + "</body>")

        return text + script


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), DashboardProxy)
    print(f"Dashboard: http://{HOST}:{PORT}/")
    print(f"Home Assistant proxy: http://{HOST}:{PORT}/ha/")
    print(f"Spotify proxy: http://{HOST}:{PORT}/spotify/")
    print(f"Spotify accounts proxy: http://{HOST}:{PORT}/spotify-accounts/")
    server.serve_forever()
