"""Motor de enquadramento. Lê o relato e os achados marcados e devolve a conduta."""

from __future__ import annotations

import re
import unicodedata

from ctb.base import FAIXAS_EXCESSO_PESO, GRUPOS, INFRACOES, POR_ID, PONTOS, VALOR_CENTAVOS


def normalizar(texto: str) -> str:
    if not texto:
        return ""
    texto = texto.lower().strip()
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    texto = texto.replace("ç", "c")
    texto = re.sub(r"[^a-z0-9%]+", " ", texto)
    return re.sub(r"\s+", " ", texto).strip()


def contem(texto: str, frase: str) -> bool:
    frase = normalizar(frase)
    if not frase:
        return False
    return re.search(rf"(?<![a-z0-9]){re.escape(frase)}(?![a-z0-9])", texto) is not None


def alguma(texto: str, frases: list[str]) -> str | None:
    for frase in frases:
        if contem(texto, frase):
            return frase
    return None


def moeda(centavos: int) -> str:
    sinal = "-" if centavos < 0 else ""
    centavos = abs(int(centavos))
    reais, cents = divmod(centavos, 100)
    corpo = f"{reais:,}".replace(",", ".")
    return f"{sinal}R$ {corpo},{cents:02d}"


def artigo_legivel(info: dict) -> str:
    if info.get("inciso"):
        return f"art. {info['artigo']}, {info['inciso']}"
    return f"art. {info['artigo']}"


def valor_base(info: dict, reincidencia_alcool: bool, excesso_kg: int | None) -> tuple[int, int, str]:
    """Retorna centavos, multiplicador efetivo e observação de cálculo."""
    if info.get("orientacao") or info.get("multiplicador", 1) == 0:
        return 0, 0, ""
    mult = info["multiplicador"]
    nota = ""
    if reincidencia_alcool and info["id"] in ("165", "165-a"):
        mult *= 2
        nota = "A reincidência em 12 meses dobra a multa já agravada."
    centavos = VALOR_CENTAVOS[info["natureza"]] * mult
    if info["id"] == "231-v" and excesso_kg:
        adicional, explicacao = adicional_excesso_peso(excesso_kg)
        centavos += adicional
        nota = explicacao
    elif info["id"] == "231-v":
        nota = "Sem o excesso em quilogramas, o valor mostrado é só a multa média. O adicional da tabela entra depois da aferição."
    return centavos, mult, nota


def adicional_excesso_peso(excesso_kg: int) -> tuple[int, str]:
    faixa = FAIXAS_EXCESSO_PESO[-1][1]
    for limite, centavos in FAIXAS_EXCESSO_PESO:
        if excesso_kg <= limite:
            faixa = centavos
            break
    fracoes = (excesso_kg + 199) // 200
    adicional = fracoes * faixa
    return adicional, (
        f"Excesso de {excesso_kg} kg: {fracoes} fração(ões) de 200 kg "
        f"a {moeda(faixa)}, somadas à multa média."
    )


def pelo_relato(texto_original: str, tipo: str) -> tuple[dict[str, str], list[dict]]:
    texto = normalizar(texto_original)
    achados: dict[str, str] = {}
    duvidas: list[dict] = []
    if not texto:
        return achados, duvidas

    def add(codigo: str, porque: str) -> None:
        achados.setdefault(codigo, porque)

    # Documentos e placa
    if alguma(texto, ["placa clonada", "placa fria", "placa adulterada", "placa falsificada", "chassi adulterado", "chassi raspado", "chassi remarcado", "lacre violado", "lacre rompido"]):
        add("230-i", "identificação do veículo violada ou falsificada")
    if alguma(texto, ["documento falso", "cnh falsa", "cnh adulterada", "crlv falso", "crlv adulterado", "documento adulterado"]):
        add("234", "documento falso ou adulterado")
    if alguma(texto, ["recusou entregar", "recusou apresentar o documento", "recusou mostrar o documento", "nao quis entregar a cnh", "nao entregou o documento"]):
        add("238", "recusa de entregar documento")

    if alguma(texto, ["licenciamento vencido", "crlv vencido", "documento do veiculo vencido", "nao licenciado", "sem licenciamento", "licenciamento atrasado"]):
        add("230-v", "licenciamento vencido ou veículo não licenciado")
    if alguma(texto, ["sem placa", "sem as placas", "nao tinha placa", "faltava a placa", "placa dianteira ausente", "sem a placa dianteira", "sem a placa traseira"]) and not alguma(texto, ["placa ilegivel", "placa sem leitura"]):
        add("230-iv", "placa ausente")
    if alguma(texto, ["placa ilegivel", "placa apagada", "placa sem leitura", "nao da para ler a placa", "placa tampada", "placa encoberta", "placa amassada"]):
        add("230-vi", "placa sem legibilidade")

    # Habilitação — casos fechados antes da dúvida
    if alguma(texto, ["cnh cassada", "habilitacao cassada", "cnh suspensa", "direito de dirigir suspenso", "suspensao do direito de dirigir", "dirigia suspenso"]):
        add("162-ii", "habilitação cassada ou suspensa")
    if alguma(texto, ["categoria diferente", "categoria incompativel", "categoria errada", "nao tem categoria"]):
        add("162-iii", "categoria diferente da do veículo")
    if alguma(texto, ["cnh vencida ha mais de 30", "cnh vencida ha mais de trinta", "habilitacao vencida ha mais de 30", "vencida ha mais de 30 dias", "vencida a mais de 30"]):
        add("162-v", "CNH vencida há mais de 30 dias")
    if alguma(texto, ["cnh vencida ha menos de 30", "vencida ha menos de 30", "venceu esta semana", "venceu ontem", "venceu ha poucos dias"]):
        duvidas.append({
            "id": "cnh-no-prazo",
            "pergunta": "CNH vencida há 30 dias ou menos não é o art. 162, V. Confirme a data.",
            "opcoes": [
                {"id": "nao-autuar-cnh", "rotulo": "Venceu há 30 dias ou menos: não autuar por isso"},
                {"id": "162-v", "rotulo": "Já passou de 30 dias: autuar pelo art. 162, V"},
            ],
        })
    if alguma(texto, ["sem lente", "sem oculos", "sem as lentes", "exige lente", "sem aparelho auditivo", "sem a protese"]):
        add("162-vi", "restrição da CNH não observada")
    if alguma(texto, ["entregou a direcao", "emprestou o carro para quem nao", "deixou um inabilitado dirigir", "entregou a chave para quem nao"]):
        add("163", "entrega da direção a quem não podia dirigir")

    fechou_habilitacao = any(k in achados for k in ("162-i", "162-ii", "162-v"))
    if alguma(texto, ["nao possui cnh", "nao tem cnh", "nao e habilitado", "nao eh habilitado", "inabilitado", "sem possuir cnh", "sem possuir habilitacao", "nunca tirou cnh", "nunca teve cnh", "nao tem habilitacao", "sem ser habilitado"]):
        add("162-i", "não possui habilitação")
        fechou_habilitacao = True
    if alguma(texto, ["nao portava", "sem porte", "esqueceu a cnh", "esqueceu o documento", "deixou a cnh", "documento em casa", "cnh em casa", "nao estava com a cnh", "estava sem o documento", "sem portar a cnh", "sem portar o documento"]):
        add("232", "não portava o documento")
        fechou_habilitacao = True
    if not fechou_habilitacao and alguma(texto, ["sem cnh", "sem habilitacao", "sem carteira", "nao apresentou cnh"]):
        duvidas.append({
            "id": "porte-ou-falta",
            "pergunta": "Quando o relato diz só “sem CNH”, faltam dois enquadramentos diferentes. Qual é o caso?",
            "opcoes": [
                {"id": "232", "rotulo": "Ele tem CNH, mas não estava portando"},
                {"id": "162-i", "rotulo": "Ele não possui CNH, Permissão nem ACC"},
            ],
        })
    if "230-v" not in achados and "162-v" not in achados and alguma(texto, ["documento vencido", "documento atrasado"]):
        duvidas.append({
            "id": "qual-documento-vencido",
            "pergunta": "“Documento vencido” pode ser a CNH ou o licenciamento do veículo. São artigos e medidas diferentes.",
            "opcoes": [
                {"id": "162-v", "rotulo": "A CNH está vencida há mais de 30 dias"},
                {"id": "230-v", "rotulo": "O licenciamento do veículo está vencido"},
                {"id": "nao-autuar-cnh", "rotulo": "A CNH venceu há 30 dias ou menos"},
            ],
        })

    # Álcool
    if alguma(texto, ["recusou o bafometro", "recusou o etilometro", "recusou o teste", "recusou soprar", "recusa do teste", "recusou o exame", "nao quis soprar"]):
        add("165-a", "recusa do teste")
    elif alguma(texto, ["bafometro positivo", "etilometro positivo", "teste positivo", "alcool confirmado", "sob influencia de alcool", "alcoolizado", "embriagado", "bafometro deu", "etilometro acusou"]):
        add("165", "influência de álcool confirmada")
    elif alguma(texto, ["cheiro de alcool", "halito de alcool", "sinais de embriaguez", "sinais de alteracao", "parece bebado", "suspeito de alcool"]):
        add("277", "sinais de alteração, sem teste ainda")
    if alguma(texto, ["substancia psicoativa", "sob efeito de droga", "exame de droga positivo", "entorpecente"]):
        add("165-b", "substância psicoativa")
    if "165-a" not in achados and "238" not in achados and re.search(r"\brecusou\b", texto):
        duvidas.append({
            "id": "o-que-recusou",
            "pergunta": "O relato diz que houve recusa, sem dizer de quê.",
            "opcoes": [
                {"id": "165-a", "rotulo": "Recusou o teste de álcool ou o exame"},
                {"id": "238", "rotulo": "Recusou entregar o documento para conferência"},
            ],
        })

    # Ocupantes
    fala_de_moto = tipo == "moto" or alguma(texto, ["motocicleta", "motoneta", "ciclomotor", "na moto", "da moto", "de moto"])
    if "cinto" in texto and not fala_de_moto:
        sem_cinto = alguma(texto, ["sem cinto", "sem o cinto", "nao usava o cinto", "nao usava cinto", "desatado"])
        if sem_cinto:
            cita_passageiro = "passageiro" in texto or "carona" in texto
            if cita_passageiro:
                add("167-p", "passageiro sem cinto")
            exclusivo_do_passageiro = cita_passageiro and not alguma(
                texto,
                ["condutor sem cinto", "condutor sem o cinto", "motorista sem cinto", "e o passageiro", "e passageiro", "os dois sem", "ambos sem"],
            )
            if not exclusivo_do_passageiro:
                add("167-c", "condutor sem cinto")
    if alguma(texto, ["sem cadeirinha", "sem bebe conforto", "sem bebê conforto", "crianca no colo", "crianca no banco da frente", "menor no banco da frente", "sem assento de elevacao", "crianca sem cinto"]):
        add("168", "criança sem o dispositivo de segurança")
    if alguma(texto, ["na cacamba", "no porta malas", "pessoas na caçamba", "passageiro na carga", "gente na carroceria"]):
        add("230-ii", "passageiro em compartimento de carga")

    # Veículo
    if alguma(texto, ["sem triangulo", "sem macaco", "sem chave de roda", "sem estepe", "sem o step", "equipamento obrigatorio"]):
        add("230-ix", "equipamento obrigatório ausente")
    if alguma(texto, ["sem extintor", "extintor vencido", "extintor ausente"]):
        if tipo in ("carga", "coletivo"):
            add("230-ix-extintor", "extintor ausente em veículo que pode exigi-lo")
        else:
            add("nao-extintor", "extintor em veículo de passeio")
    if alguma(texto, ["escapamento furado", "descarga livre", "silenciador", "escapamento estourado", "ronco do motor", "escapamento esportivo"]):
        add("230-xi", "descarga ou silenciador")
    if alguma(texto, ["acessorio proibido", "equipamento proibido"]):
        add("230-xii", "acessório proibido")
    if alguma(texto, ["xenon", "xenonio", "led irregular", "farol alterado", "luz alterada", "iluminacao alterada"]):
        add("230-xiii", "iluminação alterada")
    if alguma(texto, ["pelicula", "insulfilm", "insufilm", "vidro fume", "vidro escuro", "pelicula refletiva"]):
        add("230-xvi", "película nos vidros")
    if alguma(texto, ["pneu careca", "pneu liso", "pneu careca", "para-brisa trincado", "parabrisa trincado", "freio ruim", "sem freio", "mau estado", "compromete a seguranca"]):
        add("230-xviii", "mau estado que compromete a segurança")
    if alguma(texto, ["limpador nao funciona", "sem limpador", "limpador quebrado"]) and alguma(texto, ["chuva", "chovendo", "sob chuva"]):
        add("230-xix", "limpador sob chuva")
    if alguma(texto, ["lampada queimada", "luz queimada", "lanterna queimada", "luz de freio queimada", "seta queimada", "farol queimado"]):
        add("230-xxii", "lâmpada queimada")
    if alguma(texto, ["cor alterada", "cor diferente", "rebaixado", "suspensao alterada", "caracteristica alterada"]):
        add("230-vii", "cor ou característica alterada")
    if alguma(texto, ["som alto", "som automotivo", "paredao", "volume alto", "caixa de som"]):
        add("228", "som acima do permitido")
    if alguma(texto, ["farol apagado a noite", "sem farol a noite", "luz baixa apagada", "de noite sem farol", "a noite sem luz"]):
        add("250-i", "luz baixa apagada à noite")
    if alguma(texto, ["sem farol na chuva", "farol apagado na chuva", "sem luz no tunel", "neblina sem farol"]):
        add("250-ii", "luz baixa apagada na condição do inciso II")

    # Moto
    if fala_de_moto:
        if alguma(texto, ["sem capacete", "sem o capacete", "capacete na mao", "nao usava capacete"]):
            if alguma(texto, ["passageiro sem capacete", "garupa sem capacete"]):
                add("244-ii", "passageiro sem capacete")
            if "condutor" in texto or "piloto" in texto or "passageiro sem capacete" not in texto:
                add("244-i", "sem capacete")
        if alguma(texto, ["sem viseira", "sem oculos de protecao"]):
            if "passageiro" in texto or "garupa" in texto:
                add("244-xi", "passageiro sem viseira")
            else:
                add("244-x", "capacete sem viseira")
        if alguma(texto, ["empinando", "uma roda", "malabarismo", "grau de moto"]):
            add("244-iii", "malabarismo ou uma roda")
        if alguma(texto, ["crianca na moto", "menor na garupa", "crianca na garupa", "menor de 10 na moto", "crianca de colo na moto"]):
            add("244-v", "criança na motocicleta")
        if alguma(texto, ["sem as duas maos", "uma mao so no guidao", "sem segurar o guidao"]):
            add("244-vii", "mãos fora do guidão")
        if alguma(texto, ["carga incompativel", "carga na moto"]):
            add("244-viii", "carga incompatível")
        if tipo == "moto" and alguma(texto, ["farol apagado", "sem farol", "luz apagada"]):
            add("250-moto", "motocicleta sem luz baixa")

    # Condução
    if alguma(texto, ["celular na mao", "no celular", "manuseando o celular", "segurando o celular", "no whatsapp", "olhando o telefone", "filmando dirigindo", "usando o celular"]):
        add("252-cel", "celular ao dirigir")
    if alguma(texto, ["fone de ouvido", "de fone", "usando fone"]):
        add("252-vi", "fone de ouvido")
    if alguma(texto, ["braco para fora", "braço para fora"]):
        add("252-i", "braço para fora")
    if alguma(texto, ["de chinelo", "descalco", "sem sapato"]):
        add("252-iv", "calçado inadequado")
    if alguma(texto, ["sinal vermelho", "furou o sinal", "avancou o sinal", "avancou a parada obrigatoria", "nao parou na placa pare"]):
        add("208", "avanço de sinal ou parada obrigatória")
    if alguma(texto, ["desobedeceu a ordem", "desobedeceu o agente", "nao obedeceu a ordem", "desobediencia"]):
        add("195", "desobediência")
    if alguma(texto, ["contramao em sentido unico", "contramao na via de sentido unico", "contra mao sentido unico"]):
        add("186-ii", "contramão em sentido único")
    elif alguma(texto, ["contramao", "contra mao", "na pista contraria"]):
        duvidas.append({
            "id": "tipo-de-contramao",
            "pergunta": "Contramão muda de gravidade conforme a via.",
            "opcoes": [
                {"id": "186-i", "rotulo": "Via de duplo sentido (infração grave)"},
                {"id": "186-ii", "rotulo": "Via de sentido único (infração gravíssima)"},
            ],
        })
    if alguma(texto, ["derrapagem", "arrancada brusca", "cantou pneu", "manobra perigosa"]):
        add("175", "manobra perigosa")
    if alguma(texto, ["disputar corrida", "racha", "corrida com outro"]):
        add("173", "disputa de corrida")
    if alguma(texto, ["vaga de idoso", "vaga de deficiente", "vaga pcd", "vaga de cadeirante", "sem credencial na vaga"]):
        add("181-xx", "vaga reservada")

    # Carga e transporte
    if alguma(texto, ["lotacao excedente", "excesso de passageiro", "excesso de passageiros", "mais gente que o permitido", "superlotado"]):
        add("231-vii", "lotação excedente")
    if alguma(texto, ["carga larga demais", "excesso de altura", "excesso de largura", "sem autorizacao de dimensao"]):
        add("231-iv", "dimensão excedente")
    if alguma(texto, ["excesso de peso", "acima do peso", "sobrecarga"]):
        add("231-v", "excesso de peso")
    if alguma(texto, ["transporte pirata", "sem licenca de transporte", "transporte remunerado irregular", "van clandestina"]):
        add("231-viii", "transporte remunerado sem licença")
    if alguma(texto, ["escolar sem autorizacao", "transporte escolar irregular", "sem autorizacao de escolar"]):
        add("230-xx", "transporte escolar sem autorização")

    return achados, duvidas


def velocidade(medida: float | None, limite: float | None) -> dict | None:
    if not medida or not limite or limite <= 0:
        return None
    if medida <= limite:
        return {"dentro": True, "percentual": 0}
    percentual = (medida - limite) / limite
    if percentual <= 0.20 + 1e-9:
        codigo = "218-i"
    elif percentual <= 0.50 + 1e-9:
        codigo = "218-ii"
    else:
        codigo = "218-iii"
    return {"dentro": False, "percentual": percentual, "id": codigo, "medida": medida, "limite": limite}


def suprimir_duplicados(ids: set[str]) -> list[str]:
    alertas = []
    if "162-i" in ids and "232" in ids:
        ids.discard("232")
        alertas.append("Quem não possui CNH não leva também o art. 232. Falta de porte só vale para quem é habilitado.")
    if "162-i" in ids and "162-v" in ids:
        ids.discard("162-v")
        alertas.append("Sem possuir CNH, não se autua ao mesmo tempo a CNH vencida.")
    if "165" in ids and "165-a" in ids:
        ids.discard("277")
        alertas.append("Teste positivo (art. 165) e recusa (art. 165-A) não se somam pelo mesmo fato. Os dois ficaram marcados: desmarque o que não aconteceu.")
    if "165" in ids or "165-a" in ids:
        ids.discard("277")
    if "244-i" in ids and "244-x" in ids:
        ids.discard("244-x")
        alertas.append("Sem capacete é o art. 244, I. O inciso da viseira só vale quando o capacete está na cabeça.")
    if "230-xxii" in ids and "230-ix" in ids:
        alertas.append("Lâmpada queimada é o art. 230, XXII. O inciso IX fica só se faltar outro equipamento, como estepe ou triângulo.")
    return alertas


def destino_veiculo(cartas: list[dict]) -> dict:
    tags = set()
    insegura = False
    for carta in cartas:
        if carta.get("orientacao"):
            continue
        tags.update(carta["medidas"])
        if carta["circulacao_insegura"]:
            insegura = True
    if "remocao" in tags:
        return {
            "tipo": "remocao",
            "titulo": "Remover o veículo",
            "texto": "Há infração cuja medida é a remoção. O veículo não segue com quem foi abordado. Recolha a depósito e lavre todas as infrações, inclusive as que, sozinhas, seriam só multa.",
        }
    if insegura:
        return {
            "tipo": "remocao",
            "titulo": "Remover: o veículo não oferece segurança",
            "texto": "O art. 270, § 2º, só permite liberar com prazo quando o veículo oferece condições de segurança para circular. Neste caso, não oferece. Remova.",
        }
    if "transbordo" in tags:
        return {
            "tipo": "transbordo",
            "titulo": "Reter e transbordar o excesso",
            "texto": "O veículo só continua a viagem depois de descarregar o que excede. Não dê prazo para seguir carregado.",
        }
    if "retencao_habilitado" in tags or "recolhimento_cnh" in tags:
        return {
            "tipo": "habilitado",
            "titulo": "Não deixar o abordado seguir na direção",
            "texto": "Quem foi abordado não segue conduzindo. Se a medida é recolhimento da habilitação, faça o registro no RENACH quando o documento for digital. O veículo sai com outro condutor habilitado e em condições de dirigir. Se ninguém se apresentar, remova (art. 270, § 4º).",
        }
    if "retencao_sanar" in tags and "retencao_regularizar" in tags:
        return {
            "tipo": "misto",
            "titulo": "Corrigir no local o que der e reter o resto",
            "texto": "O que se resolve na hora (cinto, capacete, documento esquecido) é corrigido e a retenção desse fato acaba. O que exige oficina ou despacho fica no art. 270, § 2º: veículo com segurança, condutor habilitado, CRLV recolhido contra recibo e prazo de até 30 dias.",
        }
    if "retencao_sanar" in tags:
        return {
            "tipo": "sanar",
            "titulo": "Regularizar na hora e liberar",
            "texto": "A retenção dura até sanar o fato no local (art. 270, § 1º). A multa continua. Sem alguém habilitado para seguir, remova.",
        }
    if "retencao_regularizar" in tags:
        return {
            "tipo": "prazo",
            "titulo": "Recolher o licenciamento e dar prazo",
            "texto": "Não deu para corrigir na via. Se o veículo oferece segurança e há condutor habilitado, recolha o CRLV contra recibo e assinale prazo de até 30 dias (art. 270, § 2º). Documento digital: o recolhimento é registro no RENAVAM. Sem condutor habilitado, remova.",
        }
    return {
        "tipo": "multa",
        "titulo": "Lavrar e liberar o veículo",
        "texto": "Nesta abordagem a consequência imediata é a multa, sem retenção nem remoção. Liberte o veículo depois do auto, se todos estiverem em condições de seguir.",
    }


def montar_plano(cartas: list[dict], destino: dict, contexto: dict, alertas: list[str]) -> list[str]:
    passos = []
    reais = [c for c in cartas if not c.get("orientacao")]
    if any(c["comunicar_policia"] for c in reais):
        passos.append("Comunique a autoridade policial e preserve veículo e documentos. Não devolva documento ou placa com sinal de falsidade.")
    if any(c["id"] in ("165", "165-a", "165-b", "162-i", "162-ii", "162-v") for c in reais):
        passos.append("Não deixe a pessoa abordada continuar dirigindo.")
    if any(c["id"] == "277" for c in cartas):
        passos.append("Ainda não lavre multa de álcool. Ofereça o teste do art. 277 e só então escolha o art. 165 (confirmado) ou o art. 165-A (recusa).")
    if any(c["medidas"] and "recolhimento_cnh" in c["medidas"] for c in reais):
        passos.append("Recolha o documento de habilitação. Se estiver só no celular, registre no RENACH (art. 269, § 5º). O telefone não é o documento.")
    passos.append(destino["texto"])
    if reais:
        linhas = []
        for carta in reais:
            linhas.append(f"{carta['artigo_legivel']} — {carta['titulo']} — {carta['valor']}")
        passos.append("Lavre um auto para cada infração: " + "; ".join(linhas) + ".")
    else:
        passos.append("Nenhum auto de infração saiu dos fatos confirmados.")
    faltando = campos_do_auto(contexto)["faltando"]
    if faltando:
        passos.append("Antes de fechar, complete no auto: " + ", ".join(faltando) + ". O art. 280 exige tipificação, local, data, hora, identificação do veículo quando possível e a do agente.")
    if any(c.get("advertencia") for c in reais):
        passos.append("Infração leve ou média pode virar advertência por escrito se a pessoa não for reincidente na mesma infração em 12 meses (art. 267). Quem decide é a autoridade de julgamento. Você lavra o auto do mesmo jeito.")
    return passos


def campos_do_auto(contexto: dict) -> dict:
    nomes = [
        ("local", "local da abordagem"),
        ("data_hora", "data e hora"),
        ("placa", "placa do veículo"),
        ("agente", "identificação do agente"),
    ]
    prontos = []
    faltando = []
    for chave, rotulo in nomes:
        if str(contexto.get(chave, "")).strip():
            prontos.append(rotulo)
        else:
            faltando.append(rotulo)
    return {"prontos": prontos, "faltando": faltando}


def carta_de(info: dict, origem: str, porque: str, reincidencia: bool, excesso_kg: int | None) -> dict:
    centavos, mult, nota = valor_base(info, reincidencia, excesso_kg)
    pontos = 0 if info.get("orientacao") else PONTOS[info["natureza"]]
    return {
        "id": info["id"],
        "artigo_legivel": artigo_legivel(info),
        "titulo": info["titulo"],
        "grupo": info["grupo"],
        "natureza": info["natureza"],
        "natureza_rotulo": "Procedimento" if info.get("orientacao") else {
            "leve": "Leve",
            "media": "Média",
            "grave": "Grave",
            "gravissima": "Gravíssima",
        }[info["natureza"]],
        "multiplicador": mult,
        "pontos": pontos,
        "lanca_pontos": info["lanca_pontos"],
        "valor": "Sem multa neste passo" if info.get("orientacao") else moeda(centavos),
        "valor_centavos": centavos,
        "penalidade": info["penalidade_extra"],
        "suspensao": info["suspensao"],
        "medida_texto": info["medida_texto"],
        "medidas": info["medidas"],
        "responsavel": info["responsavel"],
        "tipificacao": info["tipificacao"],
        "conduta": info["conduta"],
        "observacao": " ".join(p for p in (info["observacao"], nota) if p),
        "origem": origem,
        "porque": porque,
        "comunicar_policia": info["comunicar_policia"],
        "circulacao_insegura": info["circulacao_insegura"],
        "advertencia": info["advertencia"],
        "orientacao": bool(info.get("orientacao")),
        "sanavel_no_local": info["sanavel_no_local"],
    }


def analisar(pedido: dict) -> dict:
    relato = pedido.get("relato") or ""
    tipo = pedido.get("tipo_veiculo") or "passeio"
    marcados = [i for i in (pedido.get("itens") or []) if i in POR_ID or i in ("nao-autuar-cnh", "nao-extintor")]
    reincidencia = bool(pedido.get("reincidencia_alcool"))
    excesso = pedido.get("excesso_kg")
    try:
        excesso_kg = int(excesso) if excesso not in (None, "") else None
    except (TypeError, ValueError):
        excesso_kg = None
    medida = pedido.get("velocidade_medida")
    limite = pedido.get("velocidade_maxima")
    try:
        medida_f = float(str(medida).replace(",", ".")) if medida not in (None, "") else None
        limite_f = float(str(limite).replace(",", ".")) if limite not in (None, "") else None
    except ValueError:
        medida_f = limite_f = None

    do_texto, duvidas = pelo_relato(relato, tipo)
    origens: dict[str, dict] = {}
    for codigo, porque in do_texto.items():
        if codigo in ("nao-extintor", "nao-autuar-cnh"):
            continue
        origens[codigo] = {"origem": "relato", "porque": porque}
    for codigo in marcados:
        if codigo in ("nao-autuar-cnh", "nao-extintor"):
            continue
        if codigo in origens:
            origens[codigo]["origem"] = "agente e relato"
        else:
            origens[codigo] = {"origem": "agente", "porque": "marcado na abordagem"}

    vel = velocidade(medida_f, limite_f)
    nota_velocidade = ""
    if vel and vel.get("dentro"):
        nota_velocidade = f"A velocidade informada ({medida_f:g} km/h) não passa do limite ({limite_f:g} km/h). Não há art. 218."
    elif vel and vel.get("id"):
        percentual = round(vel["percentual"] * 100, 1)
        origens[vel["id"]] = {
            "origem": "medição",
            "porque": f"{vel['medida']:g} km/h em limite de {vel['limite']:g} km/h ({percentual}% acima)",
        }

    ids = set(origens)
    if tipo == "moto" and "167-c" in ids and origens["167-c"]["origem"] == "relato":
        ids.discard("167-c")
        nota_velocidade = (nota_velocidade + " " if nota_velocidade else "") + "Em motocicleta, falta de cinto do condutor não se enquadra no art. 167. O equipamento é o capacete."
    alertas = suprimir_duplicados(ids)

    orientacoes = []
    if "nao-extintor" in do_texto or "nao-extintor" in marcados:
        orientacoes.append({
            "titulo": "Não autue por falta de extintor",
            "texto": "Em automóvel, utilitário, camioneta e caminhonete de passageiros o extintor deixou de ser equipamento obrigatório. Só prossiga se o veículo for caminhão, ônibus ou transporte de produto perigoso e a norma do CONTRAN exigir o aparelho.",
        })
    if "nao-autuar-cnh" in marcados:
        orientacoes.append({
            "titulo": "CNH vencida há 30 dias ou menos",
            "texto": "O art. 162, V, só existe depois de trinta dias do vencimento. Até lá, não lavre por CNH vencida e não recolha o documento por esse motivo.",
        })

    duvidas = [d for d in duvidas if not any(op["id"] in ids or op["id"] in marcados for op in d["opcoes"])]

    cartas = []
    for codigo in sorted(ids, key=lambda c: (POR_ID[c]["grupo"], POR_ID[c]["artigo"], c)):
        meta = origens[codigo]
        cartas.append(carta_de(POR_ID[codigo], meta["origem"], meta["porque"], reincidencia, excesso_kg))

    reais = [c for c in cartas if not c["orientacao"]]
    procedimentos = [c for c in cartas if c["orientacao"]]
    total = sum(c["valor_centavos"] for c in reais)
    pontos = 0
    pontos_passageiro = 0
    pontos_confirmar = False
    sem_cnh = any(c["id"] == "162-i" for c in reais)
    for carta in reais:
        if carta["id"] == "167-p":
            pontos_passageiro += carta["pontos"]
            continue
        if sem_cnh and carta["responsavel"] == "condutor":
            continue
        if carta["lanca_pontos"] is True:
            pontos += carta["pontos"]
        elif carta["lanca_pontos"] == "confirmar":
            pontos_confirmar = True

    destino = destino_veiculo(reais)
    if not reais and procedimentos:
        destino = {
            "tipo": "procedimento",
            "titulo": "Cumprir o procedimento antes de multar",
            "texto": "Ainda não há enquadramento de multa. Conclua o teste ou o exame. Só depois escolha o artigo. Não libere a direção se a pessoa não estiver em condições de dirigir.",
        }
    contexto = pedido.get("contexto") or {}
    plano = montar_plano(cartas, destino, contexto, alertas)
    if nota_velocidade:
        alertas.append(nota_velocidade.strip())

    resumo = _resumo(reais, destino, total, pontos)
    return {
        "resumo": resumo,
        "plano": plano,
        "destino": destino,
        "infracoes": reais,
        "procedimentos": procedimentos,
        "orientacoes": orientacoes,
        "duvidas": duvidas,
        "alertas": [a for a in alertas if a],
        "totais": {
            "multa": moeda(total),
            "multa_centavos": total,
            "quantidade": len(reais),
            "pontos_condutor": pontos,
            "pontos_passageiro": pontos_passageiro,
            "pontos_observacao": _texto_pontos(pontos, pontos_confirmar, reais, pontos_passageiro),
        },
        "auto": campos_do_auto(contexto),
        "observacao_sugerida": _observacao(contexto, reais, destino),
    }


def _texto_pontos(pontos: int, confirmar: bool, reais: list[dict], pontos_passageiro: int = 0) -> str:
    if any(c["id"] == "162-i" for c in reais):
        extra = " Quem não possui CNH não recebe pontuação; a multa do art. 162, I, permanece."
    else:
        extra = ""
    if pontos_passageiro:
        extra += f" Passageiro sem cinto: {pontos_passageiro} ponto(s), se ele for identificado e habilitado."
    if confirmar:
        extra += " Há infração em que o lançamento de pontos precisa de confirmação no RENACH."
    if pontos == 0 and reais:
        return "Nenhum ponto de condutor somado nesta abordagem." + extra
    return (
        f"{pontos} ponto(s) de infração de responsabilidade do condutor, se a CNH estiver válida para lançamento. "
        "Infração do proprietário gera multa e medida, sem ponto na CNH. "
        "A suspensão por contagem (art. 261) olha 12 meses: 20 pontos se houver gravíssima, 30 se houver grave, 40 se só houver média ou leve."
        + extra
    )


def _resumo(reais: list[dict], destino: dict, total: int, pontos: int) -> str:
    if not reais:
        return "Nenhuma multa fechada. Se o fato ficou genérico, responda à pergunta da tela ou marque o achado no quadro."
    return f"{len(reais)} infração(ões), {moeda(total)} em multas, {pontos} ponto(s) de condutor. Conduta do veículo: {destino['titulo']}."


def _observacao(contexto: dict, reais: list[dict], destino: dict) -> str:
    placa = (contexto.get("placa") or "não informada").strip()
    local = (contexto.get("local") or "local não informado").strip()
    quando = (contexto.get("data_hora") or "data e hora não informadas").strip()
    fatos = "; ".join(f"{c['artigo_legivel']} ({c['titulo']})" for c in reais) or "nenhum enquadramento confirmado"
    return (
        f"Abordagem do veículo placa {placa}, em {local}, {quando}. "
        f"Constatado e tipificado: {fatos}. "
        f"Medida sobre o veículo: {destino['titulo']}."
    )


GATILHOS = {
    "232": ["esqueceu", "esquedo", "documento em casa", "nao portava", "porte", "deixou a cnh"],
    "230-v": ["licenciamento", "documento vencido", "crlv vencido", "ipva", "nao licenciado", "atrasado"],
    "230-iv": ["sem placa", "falta placa", "placa dianteira", "placa traseira"],
    "230-vi": ["placa ilegivel", "placa apagada", "placa suja", "placa tampada", "nao le a placa"],
    "230-i": ["placa clonada", "placa fria", "placa adulterada", "chassi", "lacre", "remarcado"],
    "234": ["documento falso", "cnh falsa", "crlv falso", "adulterado", "falsificado"],
    "238": ["recusou documento", "nao entregou documento", "nao quis mostrar"],
    "162-i": ["sem cnh", "sem habilitacao", "nao habilitado", "inabilitado", "nunca tirou", "sem carteira"],
    "162-ii": ["cassada", "suspensa", "suspensao", "direito de dirigir"],
    "162-iii": ["categoria", "categoria errada", "categoria b", "carreta", "moto com cnh de carro"],
    "162-v": ["cnh vencida", "habilitacao vencida", "validade"],
    "162-vi": ["lente", "oculos", "protese", "aparelho auditivo"],
    "163": ["entregou a direcao", "emprestou", "deixou dirigir"],
    "277": ["bebida", "bebida alcoolica", "alcool", "alcoolica", "alcoolico", "alcoolizado", "alcoolizada", "bebendo", "bebeu", "cerveja", "cachaca", "pinga", "whisky", "vinho", "cheiro", "halito", "embriagado", "embriaguez", "bebado", "lei seca", "sob efeito", "sob alcool", "sob influencia"],
    "165": ["bebida", "bebida alcoolica", "alcool", "alcoolica", "alcoolico", "alcoolizado", "alcoolizada", "bebendo", "bebeu", "cerveja", "cachaca", "pinga", "bafometro", "etilometro", "teste positivo", "lei seca", "embriagado", "embriaguez", "sob efeito", "sob alcool", "sob influencia"],
    "165-a": ["bebida", "bebida alcoolica", "alcool", "recusou", "recusa", "nao quis soprar", "bafometro", "etilometro", "lei seca"],
    "165-b": ["droga", "maconha", "cocaina", "entorpecente", "psicoativa", "substancia"],
    "167-c": ["cinto", "sem cinto", "cinto do motorista", "cinto do condutor"],
    "167-p": ["cinto", "sem cinto", "cinto do passageiro", "carona sem cinto"],
    "168": ["crianca", "cadeirinha", "bebe conforto", "assento", "menor no banco"],
    "230-ii": ["cacamba", "porta malas", "carroceria", "gente na carga"],
    "230-ix": ["triangulo", "macaco", "estepe", "step", "chave de roda", "equipamento"],
    "230-ix-extintor": ["extintor"],
    "230-xi": ["escapamento", "descarga", "silenciador", "ronco"],
    "230-xii": ["acessorio proibido"],
    "230-xiii": ["xenon", "xenonio", "led", "farol alterado", "luz alterada"],
    "230-xvi": ["pelicula", "insulfilm", "insufilm", "vidro escuro", "vidro fume"],
    "230-xviii": ["pneu", "careca", "parabrisa", "para-brisa", "freio", "mau estado"],
    "230-xix": ["limpador", "chuva"],
    "230-xxii": ["lampada", "lanterna", "luz de freio", "seta queimada", "farol queimado"],
    "230-vii": ["rebaixado", "cor alterada", "suspensao", "caracteristica"],
    "228": ["som", "paredao", "volume", "caixa de som"],
    "250-i": ["farol", "luz baixa", "noite"],
    "250-ii": ["farol", "luz baixa", "tunel", "neblina", "chuva"],
    "250-moto": ["farol", "moto sem farol"],
    "244-i": ["capacete", "sem capacete", "moto"],
    "244-ii": ["capacete", "garupa", "passageiro sem capacete"],
    "244-iii": ["empinar", "grau", "malabarismo", "uma roda"],
    "244-v": ["crianca na moto", "menor na garupa"],
    "244-vii": ["guidao", "mao no guidao"],
    "244-viii": ["carga na moto"],
    "244-x": ["viseira", "oculos de protecao"],
    "244-xi": ["viseira", "garupa"],
    "252-cel": ["celular", "telefone", "whatsapp", "filmando", "no cel"],
    "252-vi": ["fone", "ouvido"],
    "252-i": ["braco para fora"],
    "252-iv": ["chinelo", "descalco", "sapato"],
    "208": ["sinal", "semaforo", "vermelho", "pare", "parada obrigatoria"],
    "195": ["desobedeceu", "ordem", "desobediencia"],
    "186-i": ["contramao", "mao dupla", "contra mao"],
    "186-ii": ["contramao", "sentido unico", "contra mao"],
    "203-i": ["ultrapassagem", "ultrapassou", "ultrapassagem na curva"],
    "203-ii": ["ultrapassagem", "ultrapassou", "faixa de pedestre"],
    "203-iii": ["ultrapassagem", "ultrapassou", "ultrapassagem na ponte", "ultrapassagem no tunel", "ultrapassagem no viaduto"],
    "203-iv": ["ultrapassagem", "ultrapassou", "parado em fila"],
    "203-v": ["ultrapassagem", "ultrapassou", "faixa continua", "linha continua", "linha dupla", "continua amarela", "dupla continua"],
    "169": ["sem atencao", "distraido"],
    "175": ["derrapagem", "arrancada", "cantou pneu", "manobra"],
    "173": ["racha", "corrida", "disputar"],
    "181-xx": ["vaga", "idoso", "cadeirante", "pcd", "deficiente"],
    "218-i": ["velocidade", "radar", "acima da velocidade", "km"],
    "218-ii": ["velocidade", "radar", "acima da velocidade", "km"],
    "218-iii": ["velocidade", "radar", "acima da velocidade", "km"],
    "231-vii": ["lotacao", "superlotado", "excesso de passageiro"],
    "231-iv": ["largura", "altura", "dimensao", "carga larga"],
    "231-v": ["peso", "excesso de peso", "balanca", "sobrecarga"],
    "231-viii": ["pirata", "transporte pago", "sem licenca"],
    "230-xx": ["escolar", "van escolar"],
}

PARADAS = {
    "sem", "com", "nao", "por", "que", "uma", "dos", "das", "para", "ele", "ela",
    "estava", "tinha", "veiculo", "carro", "condutor", "motorista", "sobre", "muito",
}

PERGUNTA_GRUPO = {
    "documentos": "Documento ou placa. O que encontrou?",
    "habilitacao": "Habilitação. Qual é o caso?",
    "alcool": "Bebida alcoólica. O que aconteceu?",
    "ocupantes": "Ocupantes. O que viu?",
    "veiculo": "Veículo. O que está irregular?",
    "moto": "Moto. O que encontrou?",
    "conducao": "Condução. O que aconteceu?",
    "carga": "Carga ou lotação. O que encontrou?",
}


def _trechos(bruto: str) -> list[str]:
    partes = [parte.strip() for parte in re.split(r"[,.\n;]+|\s+e\s+", bruto) if parte.strip()]
    return partes or ([bruto] if bruto else [])


def _palavras_uteis(foco: str) -> list[str]:
    return [palavra for palavra in foco.split() if len(palavra) >= 3 and palavra not in PARADAS]


def _liga(palavra: str, alvo: str) -> int:
    """Liga o que foi digitado ao gatilho, inclusive prefixo e flexão (alcoolizado, bebi)."""
    if len(alvo) < 3 or alvo in PARADAS:
        return 0
    if palavra == alvo:
        return 6
    if len(alvo) >= 5 and palavra.startswith(alvo) and 0 < len(palavra) - len(alvo) <= 6:
        return 5
    if len(palavra) >= 4 and alvo.startswith(palavra) and 0 < len(alvo) - len(palavra) <= 4:
        return 4
    if len(palavra) >= 6 and len(alvo) >= 6 and palavra[:6] == alvo[:6]:
        return 4
    return 0


def _pontuar(foco: str) -> list[tuple[int, dict]]:
    palavras = _palavras_uteis(foco)
    rank = []
    for info in INFRACOES:
        pontos = 0
        for bruto_gatilho in GATILHOS.get(info["id"], []):
            gatilho = normalizar(bruto_gatilho)
            if not gatilho:
                continue
            if contem(foco, gatilho):
                pontos += 8
                continue
            partes = [parte for parte in gatilho.split() if len(parte) >= 3 and parte not in PARADAS]
            if not partes:
                continue
            notas = [max((_liga(palavra, parte) for palavra in palavras), default=0) for parte in partes]
            if any(len(parte) <= 3 for parte in partes) and not all(notas):
                continue
            pontos += max(notas)
        if pontos:
            rank.append((pontos, info))
    return rank


def _opcao(pontos: int, info: dict) -> dict:
    return {
        "id": info["id"],
        "artigo": artigo_legivel(info),
        "titulo": info["checklist"],
        "natureza": info["natureza"],
        "pontos_busca": pontos,
    }


def sugerir(texto: str, limite: int = 6) -> dict:
    """Oferece um bloco de opções para cada fato escrito, para o agente incluir mais de um."""
    bruto = normalizar(texto)
    trechos = _trechos(bruto)
    melhor: dict[str, tuple[int, dict, int]] = {}
    for indice, foco in enumerate(trechos):
        for pontos, info in _pontuar(foco):
            atual = melhor.get(info["id"])
            if not atual or pontos > atual[0]:
                melhor[info["id"]] = (pontos, info, indice)
        ambiguo = alguma(foco, ["sem cnh", "sem a cnh", "sem habilitacao", "sem a habilitacao", "sem carteira", "sem a carteira", "nao apresentou cnh"]) or (
            contem(foco, "cnh") and not alguma(foco, ["falsa", "falso", "vencida", "cassada", "suspensa", "categoria"])
        )
        especifico = alguma(foco, ["esqueceu", "nao portava", "em casa", "cassada", "suspensa", "vencida", "categoria", "falsa", "falso"])
        if ambiguo and not especifico:
            for codigo, pontos in (("162-i", 8), ("232", 7)):
                info = POR_ID[codigo]
                atual = melhor.get(codigo)
                if not atual or pontos > atual[0]:
                    melhor[codigo] = (pontos, info, indice)

    por_grupo: dict[str, list[tuple[int, dict, int]]] = {}
    for item in melhor.values():
        por_grupo.setdefault(item[1]["grupo"], []).append(item)

    grupos = []
    for gid, _nome in GRUPOS:
        membros = por_grupo.get(gid)
        if not membros:
            continue
        membros.sort(key=lambda item: (-item[0], item[1]["artigo"], item[1]["id"]))
        grupos.append({
            "id": gid,
            "pergunta": PERGUNTA_GRUPO.get(gid, "O que aconteceu?"),
            "ordem": min(item[2] for item in membros),
            "opcoes": [_opcao(pontos, info) for pontos, info, _indice in membros[:limite]],
        })
    grupos.sort(key=lambda grupo: (grupo["ordem"], grupo["id"]))
    for grupo in grupos:
        grupo.pop("ordem", None)

    opcoes = [opcao for grupo in grupos for opcao in grupo["opcoes"]]
    if len(grupos) > 1:
        pergunta = "Há mais de um achado. Escolha cada um que aconteceu."
    elif grupos:
        pergunta = grupos[0]["pergunta"]
    else:
        pergunta = ""
    return {"foco": bruto, "pergunta": pergunta, "opcoes": opcoes, "grupos": grupos}


def catalogo() -> list[dict]:
    grupos = []
    for gid, nome in GRUPOS:
        itens = []
        for info in INFRACOES:
            if info["grupo"] != gid:
                continue
            itens.append({
                "id": info["id"],
                "checklist": info["checklist"],
                "artigo": artigo_legivel(info),
                "natureza": info["natureza"],
            })
        grupos.append({"id": gid, "nome": nome, "itens": itens})
    return grupos
