import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ctb.motor import analisar, classificar_placa, sugerir


def ids(pedido):
    return {item["id"] for item in analisar(pedido)["infracoes"]}


class Enquadramento(unittest.TestCase):
    def test_relato_completo_de_abordagem(self):
        relato = "Condutor não possui CNH, passageiro sem cinto, película no para-brisa e licenciamento vencido."
        resultado = analisar({"relato": relato, "tipo_veiculo": "passeio"})
        self.assertEqual(ids({"relato": relato}), {"162-i", "230-v", "230-xvi", "167-p"})
        self.assertEqual(resultado["destino"]["tipo"], "remocao")
        self.assertEqual(resultado["totais"]["pontos_condutor"], 0)
        self.assertEqual(resultado["totais"]["pontos_passageiro"], 5)
        valores = {item["id"]: item["valor_centavos"] for item in resultado["infracoes"]}
        self.assertEqual(valores["162-i"], 29347 * 3)
        self.assertEqual(valores["230-xvi"], 19523)
        self.assertEqual(valores["167-p"], 19523)

    def test_falta_de_porte_nao_e_falta_de_habilitacao(self):
        self.assertEqual(ids({"relato": "O condutor esqueceu a CNH em casa."}), {"232"})

    def test_sem_cnh_generico_pede_esclarecimento(self):
        resultado = analisar({"relato": "Estava sem CNH."})
        self.assertEqual(resultado["infracoes"], [])
        self.assertTrue(any(d["id"] == "porte-ou-falta" for d in resultado["duvidas"]))

    def test_recusa_do_bafometro(self):
        resultado = analisar({"relato": "Recusou o bafômetro."})
        self.assertEqual(ids({"relato": "Recusou o bafômetro."}), {"165-a"})
        self.assertEqual(resultado["infracoes"][0]["valor_centavos"], 29347 * 10)
        self.assertEqual(resultado["destino"]["tipo"], "habilitado")

    def test_reincidencia_dobra_a_multa_de_alcool(self):
        resultado = analisar({"relato": "Teste positivo no etilômetro.", "reincidencia_alcool": True})
        self.assertEqual(resultado["infracoes"][0]["valor_centavos"], 29347 * 20)

    def test_extintor_de_passeio_nao_gera_multa(self):
        resultado = analisar({"relato": "Carro sem extintor.", "tipo_veiculo": "passeio"})
        self.assertEqual(resultado["infracoes"], [])
        self.assertTrue(resultado["orientacoes"])

    def test_extintor_de_caminhao(self):
        self.assertIn("230-ix-extintor", ids({"relato": "Caminhão sem extintor.", "tipo_veiculo": "carga"}))

    def test_velocidade(self):
        self.assertEqual(ids({"velocidade_medida": 70, "velocidade_maxima": 60}), {"218-i"})
        self.assertEqual(ids({"velocidade_medida": 72, "velocidade_maxima": 60}), {"218-i"})
        self.assertEqual(ids({"velocidade_medida": 80, "velocidade_maxima": 60}), {"218-ii"})
        grave = analisar({"velocidade_medida": 100, "velocidade_maxima": 60})
        self.assertEqual(grave["infracoes"][0]["id"], "218-iii")
        self.assertEqual(grave["infracoes"][0]["valor_centavos"], 29347 * 3)
        self.assertNotIn("remocao", grave["infracoes"][0]["medidas"])

    def test_lampada_queimada_so_multa(self):
        resultado = analisar({"relato": "Luz de freio queimada."})
        self.assertEqual(resultado["infracoes"][0]["id"], "230-xxii")
        self.assertEqual(resultado["destino"]["tipo"], "multa")

    def test_cnh_vencida_ha_mais_de_30_dias(self):
        self.assertEqual(ids({"relato": "CNH vencida há mais de 30 dias."}), {"162-v"})

    def test_passageiro_sem_capacete_nao_autua_o_condutor(self):
        self.assertEqual(ids({"relato": "Passageiro sem capacete na motocicleta.", "tipo_veiculo": "moto"}), {"244-ii"})

    def test_motorista_sem_cinto_nao_vira_moto(self):
        self.assertEqual(ids({"relato": "Motorista sem cinto."}), {"167-c"})

    def test_cinto_com_palavras_no_meio_e_crianca_na_frente(self):
        relato = (
            "motorista sem estava se o cinto de seguranca "
            "e com uma crianca no banco da frente menor que 10 anos"
        )
        self.assertEqual(ids({"relato": relato}), {"167-c", "168"})

    def test_cinto_afivelado_ou_outro_sem_nao_vira_falta_de_cinto(self):
        self.assertNotIn("167-c", ids({"relato": "Motorista estava com o cinto de seguranca."}))
        self.assertNotIn("167-c", ids({"relato": "Motorista sem documento e usava o cinto."}))

    def test_excesso_de_peso(self):
        resultado = analisar({"itens": ["231-v"], "excesso_kg": 500})
        self.assertEqual(resultado["infracoes"][0]["valor_centavos"], 13016 + 3 * 532)

    def test_quem_nao_tem_cnh_nao_leva_falta_de_porte(self):
        resultado = analisar({"itens": ["162-i", "232"]})
        self.assertEqual({item["id"] for item in resultado["infracoes"]}, {"162-i"})
        self.assertTrue(resultado["alertas"])

    def test_bebida_alcoolica_oferece_opcoes(self):
        opcoes = {item["id"] for item in sugerir("bebida alcoolica")["opcoes"]}
        self.assertIn("277", opcoes)
        self.assertIn("165", opcoes)
        self.assertIn("165-a", opcoes)
        self.assertEqual(sugerir("bebida alcoolica")["pergunta"], "Bebida alcoólica. O que aconteceu?")

    def test_palavra_do_checklist_encontra_a_opcao(self):
        maos = {item["id"] for item in sugerir("mãos", tipo="moto")["opcoes"]}
        self.assertIn("244-vii", maos)
        self.assertNotIn("186-i", maos)
        conduzia = {item["id"] for item in sugerir("conduzia", tipo="moto")["opcoes"]}
        self.assertIn("244-vii", conduzia)

    def test_tipo_de_veiculo_filtra_sugestoes(self):
        carro = {item["id"] for item in sugerir("capacete", tipo="passeio")["opcoes"]}
        self.assertNotIn("244-i", carro)
        self.assertNotIn("244-vii", carro)
        moto = {item["id"] for item in sugerir("capacete", tipo="moto")["opcoes"]}
        self.assertIn("244-i", moto)
        cinto_moto = {item["id"] for item in sugerir("cinto", tipo="moto")["opcoes"]}
        self.assertNotIn("167-c", cinto_moto)
        self.assertNotIn("167-p", cinto_moto)
        self.assertEqual(ids({"relato": "Condutor sem cinto.", "tipo_veiculo": "moto", "itens": ["167-c"]}), set())

    def test_cinto_oferece_condutor_e_passageiro(self):
        opcoes = {item["id"] for item in sugerir("cinto")["opcoes"]}
        self.assertIn("167-c", opcoes)
        self.assertIn("167-p", opcoes)

    def test_comeco_da_palavra_e_flexao_ainda_sugerem(self):
        self.assertIn("165", {item["id"] for item in sugerir("bebi")["opcoes"]})
        alcoolizado = {item["id"] for item in sugerir("estava alcoolizado")["opcoes"]}
        self.assertTrue(alcoolizado & {"165", "277"})
        sem_artigo = {item["id"] for item in sugerir("sem a cnh")["opcoes"]}
        self.assertIn("162-i", sem_artigo)
        self.assertIn("232", sem_artigo)

    def test_ultrapassagem_em_faixa_continua(self):
        opcoes = {item["id"] for item in sugerir("ultrapassagem em faixa continua")["opcoes"]}
        self.assertIn("203-v", opcoes)
        resultado = analisar({"itens": ["203-v"]})
        carta = resultado["infracoes"][0]
        self.assertEqual(carta["valor_centavos"], 29347 * 5)
        self.assertEqual(carta["pontos"], 7)
        self.assertNotIn("remocao", carta["medidas"])

    def test_sem_cnh_e_alcool_oferecem_os_dois_blocos(self):
        dado = sugerir("sem cnh e sob alcool")
        grupos = {grupo["id"]: {item["id"] for item in grupo["opcoes"]} for grupo in dado["grupos"]}
        self.assertIn("habilitacao", grupos)
        self.assertIn("alcool", grupos)
        self.assertIn("162-i", grupos["habilitacao"])
        self.assertTrue(grupos["alcool"] & {"165", "165-a", "277"})
        self.assertIn("mais de um achado", dado["pergunta"])

    def test_substancia_psicoativa_continua_no_artigo_165(self):
        resultado = analisar({"relato": "Exame de droga positivo."})
        carta = resultado["infracoes"][0]
        self.assertEqual(carta["id"], "165-b")
        self.assertEqual(carta["artigo_legivel"], "art. 165")
        self.assertEqual(carta["valor_centavos"], 29347 * 10)
        self.assertEqual(carta["pontos"], 0)

    def test_artigo_165_b_e_o_exame_toxicologico(self):
        resultado = analisar({
            "relato": "Exame toxicológico vencido há mais de 30 dias.",
            "tipo_veiculo": "carga",
        })
        carta = resultado["infracoes"][0]
        self.assertEqual(carta["id"], "165-b-exame")
        self.assertEqual(carta["artigo_legivel"], "art. 165-B")
        self.assertEqual(carta["valor_centavos"], 29347 * 5)
        self.assertEqual(resultado["destino"]["tipo"], "multa")
        self.assertEqual(ids({"relato": "Exame toxicológico vencido.", "tipo_veiculo": "passeio"}), set())

    def test_bloqueio_policial_remove_sem_prazo(self):
        resultado = analisar({"relato": "Transpôs o bloqueio policial."})
        self.assertEqual(resultado["infracoes"][0]["id"], "210")
        self.assertEqual(resultado["destino"]["tipo"], "remocao")
        self.assertNotIn("15 dias", resultado["destino"]["texto"])

    def test_celular_nao_soma_o_inciso_de_uma_mao(self):
        resultado = analisar({"itens": ["252-cel", "252-v"]})
        self.assertEqual({item["id"] for item in resultado["infracoes"]}, {"252-cel"})
        self.assertTrue(resultado["alertas"])

    def test_texto_livre_le_o_relato_e_responde(self):
        relato = (
            "Abordei um carro de passeio. O condutor não possui habilitação. "
            "O passageiro estava sem cinto. Havia película no para-brisa e "
            "o licenciamento do veículo estava vencido. Trafegava a 80 km/h numa via de 60."
        )
        resultado = analisar({"relato": relato, "tipo_veiculo": "passeio"})
        self.assertEqual(
            {item["id"] for item in resultado["infracoes"]},
            {"162-i", "167-p", "230-xvi", "230-v", "218-ii"},
        )
        self.assertIn("Li o texto", resultado["resposta"])
        self.assertIn("art. 162, I", resultado["resposta"])
        self.assertIn("art. 218, II", resultado["resposta"])
        self.assertNotIn("fx-", resultado["resposta"])

    def test_farol_queimado_e_placa_dianteira_mesmo_com_erro(self):
        resultado = analisar({
            "relato": "abordei um carro com a farol queimado e estava sem a placa dianteita",
        })
        self.assertEqual(
            {item["id"] for item in resultado["infracoes"]},
            {"230-xxii", "230-iv"},
        )
        self.assertEqual(resultado["destino"]["tipo"], "remocao")
        self.assertIn("art. 230, IV", resultado["resposta"])
        self.assertIn("art. 230, XXII", resultado["resposta"])

    def test_pneu_careca_com_palavras_no_meio(self):
        resultado = analisar({
            "relato": "o carro foi parado e constatou que o pneu estava careca",
        })
        self.assertEqual({item["id"] for item in resultado["infracoes"]}, {"230-xviii"})
        self.assertEqual(resultado["infracoes"][0]["pontos"], 0)
        self.assertEqual(resultado["destino"]["tipo"], "remocao")
        self.assertIn("art. 230, XVIII", resultado["resposta"])

    def test_dirigindo_alcoolizado_mesmo_com_erro_de_escrita(self):
        resultado = analisar({"relato": "motorias foi pego dirigindo alcolizado"})
        self.assertEqual({item["id"] for item in resultado["infracoes"]}, {"165"})
        carta = resultado["infracoes"][0]
        self.assertEqual(carta["valor_centavos"], 29347 * 10)
        self.assertEqual(carta["pontos"], 0)
        self.assertEqual(carta["pontos_tabela"], 7)
        self.assertEqual(resultado["destino"]["tipo"], "habilitado")
        self.assertIn("art. 165", resultado["resposta"])
        self.assertIn("não computável", resultado["resposta"])
        self.assertIn("os 7 pontos não entram na CNH", resultado["resposta"])
        self.assertIn("suspensão", resultado["resposta"])

    def test_texto_ambiguo_nao_escolhe_sozinho(self):
        resultado = analisar({"relato": "O condutor estava sem CNH."})
        self.assertEqual(resultado["infracoes"], [])
        self.assertIn("não escolhi sozinho", resultado["resposta"])

    def test_placa_aceita_so_os_dois_padroes_brasileiros(self):
        antiga = classificar_placa("abc1234")
        self.assertTrue(antiga["valida"])
        self.assertEqual(antiga["tipo"], "antiga")
        self.assertEqual(antiga["exibicao"], "ABC-1234")
        mercosul = classificar_placa("abc1d23")
        self.assertTrue(mercosul["valida"])
        self.assertEqual(mercosul["tipo"], "mercosul")
        self.assertEqual(mercosul["exibicao"], "ABC1D23")
        self.assertFalse(classificar_placa("ABC1D2")["valida"])
        self.assertFalse(classificar_placa("AB12D23")["valida"])
        self.assertNotIn("I", classificar_placa("ABC1I23")["cru"])
        self.assertFalse(classificar_placa("IOA1B23")["valida"])
        resultado = analisar({
            "relato": "farol queimado",
            "contexto": {"local": "via", "data_hora": "2026-11-04T07:30", "placa": "abc1234", "agente": "1"},
        })
        self.assertNotIn("placa do veículo", resultado["auto"]["faltando"])
        self.assertIn("ABC-1234", resultado["observacao_sugerida"])
        incompleta = analisar({
            "relato": "farol queimado",
            "contexto": {"local": "via", "data_hora": "2026-11-04T07:30", "placa": "ABC12", "agente": "1"},
        })
        self.assertIn("placa do veículo", incompleta["auto"]["faltando"])

    def test_sinais_de_alcool_nao_multam_ainda(self):
        resultado = analisar({"relato": "Cheiro de álcool e fala alterada."})
        self.assertEqual(resultado["infracoes"], [])
        self.assertEqual(resultado["procedimentos"][0]["id"], "277")
        self.assertEqual(resultado["destino"]["tipo"], "procedimento")


if __name__ == "__main__":
    unittest.main()
