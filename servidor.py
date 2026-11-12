"""Sobe o CTB em Campo neste computador e abre o navegador."""

from __future__ import annotations

import json
import os
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from ctb.endereco import endereco_por_coordenada, municipios, ruas
from ctb.modelo import ensinar, resumo
from ctb.motor import analisar, catalogo, sugerir

RAIZ = Path(__file__).resolve().parent
WEB = RAIZ / "web"
PORTA = 8765
_ARQUIVO_NUMERO = RAIZ / "ctb" / "numeracao.json"
_trava_numero = threading.Lock()


def _ler_proximo() -> int:
    try:
        dados = json.loads(_ARQUIVO_NUMERO.read_text(encoding="utf-8"))
        return max(1, int(dados.get("proximo", 1)))
    except (OSError, ValueError, json.JSONDecodeError):
        return 1


def _gravar_proximo(numero: int) -> None:
    _ARQUIVO_NUMERO.write_text(json.dumps({"proximo": numero}), encoding="utf-8")


def proximo_auto() -> str:
    with _trava_numero:
        return f"{_ler_proximo():06d}"


def reservar_autos(quantidade: int) -> list[str]:
    quantidade = max(1, min(int(quantidade or 1), 20))
    with _trava_numero:
        inicio = _ler_proximo()
        numeros = [f"{inicio + i:06d}" for i in range(quantidade)]
        _gravar_proximo(inicio + quantidade)
        return numeros

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
            qs = parse_qs(urlparse(self.path).query)
            consulta = qs.get("q", [""])[0]
            tipo = qs.get("tipo", ["passeio"])[0]
            if tipo not in ("passeio", "moto", "carga", "coletivo"):
                tipo = "passeio"
            self._json(sugerir(consulta, tipo=tipo))
            return
        if caminho == "/api/municipios":
            qs = parse_qs(urlparse(self.path).query)
            self._json(municipios(qs.get("uf", [""])[0]))
            return
        if caminho == "/api/ruas":
            qs = parse_qs(urlparse(self.path).query)
            self._json(ruas(qs.get("uf", [""])[0], qs.get("cidade", [""])[0], qs.get("q", [""])[0]))
            return
        if caminho == "/api/onde":
            qs = parse_qs(urlparse(self.path).query)
            self._json(endereco_por_coordenada(qs.get("lat", [""])[0], qs.get("lon", [""])[0]))
            return
        if caminho == "/api/proximo-auto":
            self._json({"numero": proximo_auto()})
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
        caminho = urlparse(self.path).path
        if caminho not in ("/api/analisar", "/api/aprender", "/api/reservar-autos"):
            self.send_error(404)
            return
        tamanho = int(self.headers.get("Content-Length", "0"))
        bruto = self.rfile.read(tamanho).decode("utf-8")
        try:
            pedido = json.loads(bruto or "{}")
        except json.JSONDecodeError:
            self._json({"erro": "Pedido inválido."}, 400)
            return
        if caminho == "/api/aprender":
            ids = pedido.get("ids") if isinstance(pedido.get("ids"), list) else []
            self._json(ensinar(pedido.get("relato") or "", ids) | resumo())
            return
        if caminho == "/api/reservar-autos":
            try:
                quantidade = int(pedido.get("quantidade", 1))
            except (TypeError, ValueError):
                quantidade = 1
            self._json({"numeros": reservar_autos(quantidade)})
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
