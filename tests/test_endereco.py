import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ctb.endereco import endereco_por_coordenada, montar_local, municipios, ruas, sem_acento


class Endereco(unittest.TestCase):
    def test_texto_do_local_junta_rua_numero_e_cep(self):
        texto = montar_local("Avenida Atlântica", "500", "Copacabana", "Rio de Janeiro", "rj", "22010-000")
        self.assertEqual(
            texto,
            "Avenida Atlântica, 500, Copacabana, Rio de Janeiro/RJ, CEP 22010-000",
        )

    def test_busca_curta_nao_consulta_a_rede(self):
        self.assertEqual(ruas("RJ", "Rio de Janeiro", "at")["opcoes"], [])
        self.assertIn("estado", ruas("XX", "Rio", "atlantica")["erro"])
        self.assertEqual(municipios("ZZ")["municipios"], [])

    def test_ponto_invalido_nao_consulta_a_rede(self):
        self.assertIn("não serve", endereco_por_coordenada("abc", "1")["erro"])
        self.assertIn("fora do Brasil", endereco_por_coordenada("0", "0")["erro"])

    def test_estado_sem_acento_casa_com_a_sigla(self):
        self.assertEqual(sem_acento("São Paulo"), "sao paulo")


if __name__ == "__main__":
    unittest.main()
