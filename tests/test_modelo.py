import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ctb.modelo import ensinar, prever
from ctb.motor import analisar


class Modelo(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.TemporaryDirectory()
        os.environ["CTB_MODELO"] = str(Path(self.pasta.name) / "modelo.json")

    def tearDown(self):
        os.environ.pop("CTB_MODELO", None)
        self.pasta.cleanup()

    def test_um_caso_ainda_nao_fecha_sozinho(self):
        ensinar("o motorista foi pego dirigindo bebado e zonzo", ["165"])
        self.assertEqual(prever("pessoa dirigindo bebado e zonzo na via")["fechar"], [])

    def test_dois_casos_parecidos_passam_a_fechar_o_artigo(self):
        ensinar("o motorista foi pego dirigindo bebado e zonzo", ["165"])
        ensinar("condutor dirigindo bebado e zonzo de novo", ["165"])
        self.assertEqual(prever("pessoa dirigindo bebado e zonzo na via")["fechar"], ["165"])
        resultado = analisar({"relato": "pessoa dirigindo bebado e zonzo na via"})
        self.assertIn("165", {item["id"] for item in resultado["infracoes"]})
        self.assertIn("já confirmou", resultado["resposta"])
        self.assertGreaterEqual(resultado["aprendizado"]["casos"], 2)

    def test_texto_de_outro_fato_nao_herda_o_caso(self):
        ensinar("o motorista foi pego dirigindo bebado e zonzo", ["165"])
        ensinar("condutor dirigindo bebado e zonzo de novo", ["165"])
        self.assertEqual(prever("farol queimado e lampada apagada")["fechar"], [])


if __name__ == "__main__":
    unittest.main()
