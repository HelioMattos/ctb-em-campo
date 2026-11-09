"""Aprendizado local. Cada caso confirmado ajusta um classificador simples de palavras."""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

from ctb.base import POR_ID

ARQUIVO_MODELO = Path(__file__).with_name("modelo.json")


def _caminho(arquivo: Path | None = None) -> Path:
    if arquivo is not None:
        return Path(arquivo)
    env = os.environ.get("CTB_MODELO")
    if env:
        return Path(env)
    return ARQUIVO_MODELO


def _vazio() -> dict:
    return {"casos": 0, "classes": {}}


def _ler(arquivo: Path | None = None) -> dict:
    caminho = _caminho(arquivo)
    if not caminho.is_file():
        return _vazio()
    try:
        dados = json.loads(caminho.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _vazio()
    if not isinstance(dados, dict):
        return _vazio()
    dados.setdefault("casos", 0)
    dados.setdefault("classes", {})
    return dados


def _gravar(dados: dict, arquivo: Path | None = None) -> None:
    caminho = _caminho(arquivo)
    caminho.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")


def _tokens(texto: str) -> list[str]:
    from ctb.motor import PARADAS, corrigir_escrita, normalizar

    bruto = corrigir_escrita(normalizar(texto))
    vistos = []
    for palavra in bruto.split():
        if len(palavra) < 3 or palavra in PARADAS or palavra in vistos:
            continue
        vistos.append(palavra)
    return vistos


def ensinar(texto: str, ids: list[str], arquivo: Path | None = None) -> dict:
    """Soma este texto às fichas confirmadas pelo agente."""
    fichas = []
    for codigo in ids:
        if codigo in POR_ID and codigo not in fichas and not str(codigo).startswith("fx-"):
            fichas.append(codigo)
    palavras = _tokens(texto)
    if len(palavras) < 2 or not fichas:
        return {"erro": "Preciso de um texto e de ao menos uma infração para aprender.", "casos": _ler(arquivo)["casos"]}
    dados = _ler(arquivo)
    for codigo in fichas:
        classe = dados["classes"].setdefault(codigo, {"docs": 0, "tok": {}, "total": 0})
        classe["docs"] += 1
        for palavra in palavras:
            classe["tok"][palavra] = classe["tok"].get(palavra, 0) + 1
            classe["total"] += 1
    dados["casos"] += 1
    _gravar(dados, arquivo)
    return {"erro": "", "casos": dados["casos"], "fichas": fichas}


def resumo(arquivo: Path | None = None) -> dict:
    dados = _ler(arquivo)
    return {"casos": dados["casos"], "fichas": len(dados["classes"])}


def prever(texto: str, arquivo: Path | None = None) -> dict:
    """Devolve a ficha mais parecida com os casos já confirmados."""
    dados = _ler(arquivo)
    classes = dados.get("classes") or {}
    palavras = _tokens(texto)
    if len(palavras) < 2 or not classes:
        return {"fechar": [], "sugerir": []}
    vocabulario = set()
    for classe in classes.values():
        vocabulario.update(classe.get("tok") or {})
    if not vocabulario:
        return {"fechar": [], "sugerir": []}
    tamanho = len(vocabulario)
    candidatos = []
    for codigo, classe in classes.items():
        if codigo not in POR_ID:
            continue
        tok = classe.get("tok") or {}
        vistos = [palavra for palavra in palavras if tok.get(palavra, 0) > 0]
        if len(vistos) < 2:
            continue
        distintivo = False
        for palavra in vistos:
            maior = max((outra.get("tok") or {}).get(palavra, 0) for outra in classes.values())
            if tok.get(palavra, 0) >= maior and tok.get(palavra, 0) > 0:
                distintivo = True
                break
        if not distintivo:
            continue
        total = classe.get("total") or 1
        nota = math.log(classe.get("docs") or 1)
        for palavra in palavras:
            nota += math.log((tok.get(palavra, 0) + 1) / (total + tamanho))
        candidatos.append({"id": codigo, "nota": nota, "docs": classe.get("docs") or 0})
    candidatos.sort(key=lambda item: item["nota"], reverse=True)
    if not candidatos:
        return {"fechar": [], "sugerir": [item["id"] for item in candidatos]}
    melhor = candidatos[0]
    folga = True
    if len(candidatos) > 1:
        folga = melhor["nota"] - candidatos[1]["nota"] >= 1
    fechar = [melhor["id"]] if melhor["docs"] >= 2 and folga else []
    sugerir = [item["id"] for item in candidatos if item["id"] not in fechar][:3]
    return {"fechar": fechar, "sugerir": sugerir}
