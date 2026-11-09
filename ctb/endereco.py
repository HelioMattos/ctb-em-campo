"""Endereço da abordagem: municípios do IBGE, ruas do CEP e ponto do aparelho."""

from __future__ import annotations

import gzip
import json
import re
import unicodedata
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

UFS = (
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
    "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
)

_ESTADO_POR_UF = {
    "AC": "Acre", "AL": "Alagoas", "AM": "Amazonas", "AP": "Amapá", "BA": "Bahia",
    "CE": "Ceará", "DF": "Distrito Federal", "ES": "Espírito Santo", "GO": "Goiás",
    "MA": "Maranhão", "MG": "Minas Gerais", "MS": "Mato Grosso do Sul", "MT": "Mato Grosso",
    "PA": "Pará", "PB": "Paraíba", "PE": "Pernambuco", "PI": "Piauí", "PR": "Paraná",
    "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte", "RO": "Rondônia", "RR": "Roraima",
    "RS": "Rio Grande do Sul", "SC": "Santa Catarina", "SE": "Sergipe", "SP": "São Paulo",
    "TO": "Tocantins",
}

AGENTE = "CTB-em-Campo/1.0 (apoio local de abordagem)"


def sem_acento(texto: str) -> str:
    texto = unicodedata.normalize("NFD", texto or "")
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", texto).strip().casefold()


_UF_POR_ESTADO = {sem_acento(nome): sigla for sigla, nome in _ESTADO_POR_UF.items()}


def montar_local(logradouro: str = "", numero: str = "", bairro: str = "", cidade: str = "", uf: str = "", cep: str = "") -> str:
    partes = []
    via = (logradouro or "").strip()
    casa = (numero or "").strip()
    if via and casa:
        partes.append(f"{via}, {casa}")
    elif via:
        partes.append(via)
    if (bairro or "").strip():
        partes.append(bairro.strip())
    cidade = (cidade or "").strip()
    uf = (uf or "").strip().upper()
    if cidade and uf:
        partes.append(f"{cidade}/{uf}")
    elif cidade:
        partes.append(cidade)
    cep = re.sub(r"\D", "", cep or "")
    if len(cep) == 8:
        partes.append(f"CEP {cep[:5]}-{cep[5:]}")
    return ", ".join(partes)


def _baixar(url: str, timeout: int = 8) -> object:
    pedido = Request(url, headers={
        "User-Agent": AGENTE,
        "Accept": "application/json",
        "Accept-Encoding": "identity",
    })
    with urlopen(pedido, timeout=timeout) as resposta:
        bruto = resposta.read()
        if resposta.headers.get("Content-Encoding") == "gzip" or bruto[:2] == b"\x1f\x8b":
            bruto = gzip.decompress(bruto)
        return json.loads(bruto.decode("utf-8"))


def municipios(uf: str) -> dict:
    sigla = (uf or "").strip().upper()
    if sigla not in UFS:
        return {"erro": "Escolha o estado.", "municipios": [], "codigos": {}}
    try:
        dados = _baixar(
            f"https://servicodados.ibge.gov.br/api/v1/localidades/estados/{sigla}/municipios?orderBy=nome"
        )
    except (URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError, OSError):
        return {"erro": "Não consegui carregar os municípios agora.", "municipios": [], "codigos": {}}
    nomes = []
    codigos = {}
    for item in dados:
        nome = item.get("nome") or ""
        if not nome:
            continue
        nomes.append(nome)
        if item.get("id") is not None:
            codigos[nome] = str(item["id"])
    return {"erro": "", "municipios": nomes, "codigos": codigos}


def ruas(uf: str, cidade: str, consulta: str) -> dict:
    sigla = (uf or "").strip().upper()
    cidade_limpa = sem_acento(cidade)
    texto = sem_acento(consulta)
    if sigla not in UFS or len(cidade_limpa) < 2:
        return {"erro": "Escolha o estado e o município antes da rua.", "opcoes": []}
    if len(texto) < 3:
        return {"erro": "", "opcoes": []}
    url = "https://viacep.com.br/ws/{}/{}/{}/json/".format(
        quote(sigla), quote(cidade_limpa), quote(texto)
    )
    try:
        dados = _baixar(url)
    except (URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError, OSError):
        return {"erro": "Não consegui consultar as ruas agora.", "opcoes": []}
    if isinstance(dados, dict):
        return {"erro": "Nenhuma rua com esse nome nesse município.", "opcoes": []}
    opcoes = []
    for item in dados:
        if not item.get("logradouro"):
            continue
        opcoes.append({
            "logradouro": item.get("logradouro") or "",
            "bairro": item.get("bairro") or "",
            "cep": item.get("cep") or "",
            "cidade": item.get("localidade") or cidade.strip(),
            "uf": item.get("uf") or sigla,
            "complemento": item.get("complemento") or "",
        })
    if not opcoes:
        return {"erro": "Nenhuma rua com esse nome nesse município.", "opcoes": []}
    return {"erro": "", "opcoes": opcoes[:12]}


def endereco_por_coordenada(lat: str, lon: str) -> dict:
    try:
        latitude = float(str(lat).replace(",", "."))
        longitude = float(str(lon).replace(",", "."))
    except (TypeError, ValueError):
        return {"erro": "A localização recebida não serve."}
    if not (-34.0 <= latitude <= 6.0 and -74.0 <= longitude <= -32.0):
        return {"erro": "Esse ponto está fora do Brasil. Digite o endereço."}
    url = (
        "https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1"
        f"&lat={latitude}&lon={longitude}"
    )
    try:
        dados = _baixar(url)
    except (URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError, OSError):
        return {"erro": "Não consegui transformar o ponto em endereço. Digite a rua."}
    endereco = dados.get("address") or {}
    cidade = endereco.get("city") or endereco.get("town") or endereco.get("village") or endereco.get("municipality") or ""
    uf = ""
    codigo = endereco.get("ISO3166-2-lvl4") or ""
    if codigo.startswith("BR-"):
        uf = codigo.split("-", 1)[1]
    if uf not in UFS:
        uf = _UF_POR_ESTADO.get(sem_acento(endereco.get("state") or ""), "")
    logradouro = endereco.get("road") or endereco.get("pedestrian") or ""
    numero = endereco.get("house_number") or ""
    bairro = endereco.get("suburb") or endereco.get("neighbourhood") or endereco.get("quarter") or ""
    cep = endereco.get("postcode") or ""
    local = montar_local(logradouro, numero, bairro, cidade, uf, cep)
    if not local:
        return {"erro": "Achei o ponto, mas não a rua. Digite o endereço."}
    return {
        "erro": "",
        "local": local,
        "logradouro": logradouro,
        "numero": numero,
        "bairro": bairro,
        "cidade": cidade,
        "uf": uf,
        "cep": cep,
    }
