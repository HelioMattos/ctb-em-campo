"""Sobe o CTB em Campo neste computador e abre o navegador."""

from __future__ import annotations

import json
import os
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from ctb.motor import analisar, catalogo, sugerir

RAIZ = Path(__file__).resolve().parent
WEB = RAIZ / "web"
PORTA = 8765

TIPOS = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
}


class Pedido(BaseHTTPRequestHandler):
    def log_message(self, formato, *args):
        return

    def do_GET(self):
        caminho = urlparse(self.path).path
        if caminho == "/api/catalogo":
            self._json(catalogo())
            return
        if caminho == "/api/sugerir":
            consulta = parse_qs(urlparse(self.path).query).get("q", [""])[0]
            self._json(sugerir(consulta))
            return
        if caminho in ("/", "/index.html"):
            self._arquivo(WEB / "index.html")
            return
        arquivo = (WEB / caminho.lstrip("/")).resolve()
        if WEB.resolve() not in arquivo.parents and arquivo != WEB.resolve():
            self.send_error(404)
            return
        if arquivo.is_file():
            self._arquivo(arquivo)
            return
        self.send_error(404)

    def do_POST(self):
        if urlparse(self.path).path != "/api/analisar":
            self.send_error(404)
            return
        tamanho = int(self.headers.get("Content-Length", "0"))
        bruto = self.rfile.read(tamanho).decode("utf-8")
        try:
            pedido = json.loads(bruto or "{}")
        except json.JSONDecodeError:
            self._json({"erro": "Pedido inválido."}, 400)
            return
        self._json(analisar(pedido))

    def _json(self, dados, codigo=200):
        corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def _arquivo(self, arquivo: Path):
        corpo = arquivo.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", TIPOS.get(arquivo.suffix, "application/octet-stream"))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)


def main():
    servidor = ThreadingHTTPServer(("127.0.0.1", PORTA), Pedido)
    url = f"http://127.0.0.1:{PORTA}"
    print(f"CTB em Campo está aberto em {url}")
    if os.environ.get("NO_BROWSER") != "1":
        webbrowser.open(url)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("Encerrado.")
    finally:
        servidor.server_close()


if __name__ == "__main__":
    main()
