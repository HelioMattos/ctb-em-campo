const form = document.querySelector("#abordagem");
const resultadoEl = document.querySelector("#resultado");
const sugestoesEl = document.querySelector("#sugestoes");
const escolhidosEl = document.querySelector("#escolhidos");
const botao = document.querySelector("#analisar");
const especiais = new Set();
const escolhidos = new Map();
let ultimaSugestao = { grupos: [], opcoes: [], pergunta: "" };
let timerSugestao = 0;
let sugestaoSeq = 0;
let analiseSeq = 0;
let ensinar = false;

const EXEMPLO = "Condutor não possui CNH, passageiro sem cinto, película no para-brisa e licenciamento vencido.";
const EXEMPLO_TEXTO = "Abordei um carro de passeio. O condutor não possui CNH. O passageiro estava sem cinto. Havia película no para-brisa e o licenciamento do veículo estava vencido.";
const PASSOS = {
  texto: [
    "Escreva o que aconteceu, como você contaria o fato.",
    "O sistema lê o texto, separa o que dá para confirmar e responde com artigo, multa e medida.",
    "Clique em Analisar o texto. Local, placa e matrícula só entram quando for preencher o auto.",
  ],
  palavras: [
    "Escreva palavras do que viu, como sem CNH ou sem cinto.",
    "Quando aparecerem opções, inclua cada achado. Pode ser mais de um.",
    "Clique em Ver o que fazer. Sem o texto, a consulta não abre.",
  ],
};

function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function horaLocal() {
  const agora = new Date();
  agora.setMinutes(agora.getMinutes() - agora.getTimezoneOffset());
  return agora.toISOString().slice(0, 16);
}

form.data_hora.value = horaLocal();

function modoTexto() {
  return form.modo.value === "texto";
}

function marcados() {
  return [...escolhidos.keys()];
}

function rotuloBotao() {
  return modoTexto() ? "Analisar o texto" : "Ver o que fazer";
}

function aplicarModo(limparEscolhas) {
  const texto = modoTexto();
  const passos = document.querySelector("#passos");
  passos.innerHTML = PASSOS[texto ? "texto" : "palavras"].map((item) => `<li>${item}</li>`).join("");
  document.querySelector("#rotulo-relato").textContent = texto ? "Texto da abordagem" : "Palavras-chave";
  form.relato.rows = texto ? 4 : 3;
  form.relato.placeholder = texto
    ? "Conte o que viu. Ex.: o condutor não possui CNH, o passageiro estava sem cinto e o licenciamento do veículo estava vencido."
    : "Comece a escrever. Ex.: sem CNH e sob efeito de álcool";
  document.querySelector("#dica-modo").textContent = texto
    ? "O sistema lê esse texto e responde. Você não precisa escolher o artigo."
    : "As opções aparecem enquanto você escreve. Inclua cada achado que aconteceu.";
  if (texto) {
    sugestoesEl.hidden = true;
    sugestoesEl.innerHTML = "";
    if (limparEscolhas) {
      escolhidos.clear();
      desenharEscolhidos();
    }
  } else {
    buscarSugestoes();
  }
  atualizarBotao();
}

function pedido() {
  const dados = new FormData(form);
  const agora = ensinar;
  ensinar = false;
  return {
    relato: dados.get("relato") || "",
    tipo_veiculo: tipoAtual(),
    itens: [...marcados(), ...especiais],
    aprender: agora && modoTexto(),
    contexto: {
      local: dados.get("local"),
      data_hora: dados.get("data_hora"),
      placa: dados.get("placa"),
      agente: dados.get("agente"),
    },
  };
}

function desenharEscolhidos() {
  escolhidosEl.innerHTML = [...escolhidos.values()].map((item) => `
    <span class="chip">${esc(item.titulo)}<button type="button" data-remover="${esc(item.id)}" aria-label="Tirar">×</button></span>
  `).join("");
  escolhidosEl.querySelectorAll("[data-remover]").forEach((botaoTirar) => {
    botaoTirar.addEventListener("click", () => {
      escolhidos.delete(botaoTirar.dataset.remover);
      desenharEscolhidos();
    });
  });
}

function gruposDaSugestao(dado) {
  if (dado.grupos && dado.grupos.length) return dado.grupos;
  if (dado.opcoes && dado.opcoes.length) {
    return [{ id: "geral", pergunta: dado.pergunta || "Escolha o que aconteceu", opcoes: dado.opcoes }];
  }
  return [];
}

function acharOpcao(id) {
  for (const grupo of gruposDaSugestao(ultimaSugestao)) {
    const item = (grupo.opcoes || []).find((opcao) => opcao.id === id);
    if (item) return item;
  }
  return null;
}

function desenharSugestoes(dado) {
  ultimaSugestao = dado;
  const grupos = gruposDaSugestao(dado).filter((grupo) => (grupo.opcoes || []).length);
  if (!grupos.length) {
    sugestoesEl.hidden = true;
    sugestoesEl.innerHTML = "";
    return;
  }
  sugestoesEl.hidden = false;
  sugestoesEl.innerHTML = `
    <p class="aviso-multi">Dá para incluir mais de um achado na mesma abordagem.</p>
    ${grupos.map((grupo) => `
      <section class="grupo-sugestao">
        <p>${esc(grupo.pergunta)}</p>
        ${grupo.opcoes.map((item) => {
          const incluido = escolhidos.has(item.id);
          return `
            <button type="button" class="opcao${incluido ? " escolhida" : ""}" data-sugerir="${esc(item.id)}" aria-pressed="${incluido}">
              <span>${esc(item.titulo)}</span>
              <small>${incluido ? "Incluído" : esc(item.artigo)}</small>
            </button>
          `;
        }).join("")}
      </section>
    `).join("")}
  `;
  sugestoesEl.querySelectorAll("[data-sugerir]").forEach((botaoOpcao) => {
    botaoOpcao.addEventListener("click", () => {
      const item = acharOpcao(botaoOpcao.dataset.sugerir);
      if (!item) return;
      if (escolhidos.has(item.id)) escolhidos.delete(item.id);
      else escolhidos.set(item.id, { id: item.id, titulo: item.titulo, artigo: item.artigo });
      desenharEscolhidos();
      desenharSugestoes(ultimaSugestao);
    });
  });
}

const SEM_MOTO = new Set(["167-c", "167-p", "168", "230-ii", "230-xvi", "230-xix", "250-i", "250-ii", "231-vii", "231-iv", "231-v", "231-viii", "230-xx"]);
const SO_MOTO = new Set(["250-moto", "244-i", "244-ii", "244-iii", "244-v", "244-vii", "244-viii", "244-x", "244-xi"]);

function tipoAtual() {
  const texto = semAcento(form.relato.value);
  if (/\b(motocicleta|motoneta|ciclomotor|moto)\b/.test(texto)) return "moto";
  if (/\b(onibus|micro-onibus|van|coletivo)\b/.test(texto)) return "coletivo";
  const especie = form.especie.value;
  if (especie === "Carga" || especie === "Misto") return "carga";
  return "passeio";
}

function compativelComTipo(id) {
  if (tipoAtual() === "moto") return !SEM_MOTO.has(id);
  return !SO_MOTO.has(id);
}

function tirarIncompativeis() {
  let mudou = false;
  for (const id of [...escolhidos.keys()]) {
    if (!compativelComTipo(id)) {
      escolhidos.delete(id);
      mudou = true;
    }
  }
  if (mudou) desenharEscolhidos();
}

async function buscarSugestoes() {
  if (modoTexto()) return;
  const texto = form.relato.value.trim();
  const seq = ++sugestaoSeq;
  if (texto.length < 3) {
    sugestoesEl.hidden = true;
    sugestoesEl.innerHTML = "";
    return;
  }
  try {
    const resposta = await fetch("/api/sugerir?q=" + encodeURIComponent(texto) + "&tipo=" + encodeURIComponent(tipoAtual()));
    if (seq !== sugestaoSeq) return;
    if (!resposta.ok) return;
    desenharSugestoes(await resposta.json());
  } catch (erro) {
    if (seq !== sugestaoSeq) return;
  }
}

form.relato.addEventListener("input", () => {
  clearTimeout(timerSugestao);
  timerSugestao = setTimeout(buscarSugestoes, 180);
});

form.especie.addEventListener("change", () => {
  tirarIncompativeis();
  buscarSugestoes();
});

form.querySelectorAll("input[name=modo]").forEach((radio) => {
  radio.addEventListener("change", () => aplicarModo(true));
});

document.querySelector("#exemplo").addEventListener("click", () => {
  form.relato.value = modoTexto() ? EXEMPLO_TEXTO : EXEMPLO;
  form.relato.focus();
  buscarSugestoes();
  atualizarBotao();
});

document.querySelector("#limpar").addEventListener("click", () => {
  form.reset();
  especiais.clear();
  escolhidos.clear();
  desenharEscolhidos();
  sugestoesEl.hidden = true;
  form.data_hora.value = horaLocal();
  resultadoEl.hidden = true;
  resultadoEl.innerHTML = "";
  document.querySelector("#auto-impresso").hidden = true;
  document.querySelector("#auto-impresso").innerHTML = "";
  atualizarPlaca();
  reiniciarLocal();
  aplicarModo(false);
});

form.placa.addEventListener("input", atualizarPlaca);

const dicaLocal = document.querySelector("#dica-local");
const opcoesRua = document.querySelector("#opcoes-rua");
const listaCidades = document.querySelector("#lista-cidades");
let municipiosCarregados = [];
let codigosMunicipio = {};
let ruaEscolhida = null;
let timerRua = 0;
let ruaSeq = 0;
let municipioSeq = 0;

function modoAparelho() {
  return form.modo_local.value === "aparelho";
}

function definirLocal(texto) {
  form.local.value = texto || "";
  form.local.dispatchEvent(new Event("input", { bubbles: true }));
}

function limparOpcoesRua() {
  opcoesRua.hidden = true;
  opcoesRua.innerHTML = "";
}

function comporLocal() {
  if (!ruaEscolhida || !ruaEscolhida.logradouro) {
    definirLocal("");
    return;
  }
  const numero = form.numero.value.trim();
  const pedacos = [numero ? `${ruaEscolhida.logradouro}, ${numero}` : ruaEscolhida.logradouro];
  if (ruaEscolhida.bairro) pedacos.push(ruaEscolhida.bairro);
  if (ruaEscolhida.cidade && ruaEscolhida.uf) pedacos.push(`${ruaEscolhida.cidade}/${ruaEscolhida.uf}`);
  if (ruaEscolhida.cep) pedacos.push(`CEP ${ruaEscolhida.cep}`);
  definirLocal(pedacos.join(", "));
  dicaLocal.textContent = form.local.value;
  dicaLocal.classList.add("ok");
  dicaLocal.classList.remove("erro");
}

function aplicarModoLocal() {
  document.querySelector("#painel-aparelho").hidden = !modoAparelho();
  if (form.local.value) return;
  dicaLocal.classList.remove("ok", "erro");
  dicaLocal.textContent = modoAparelho()
    ? "No celular, a busca usa o GPS. Neste computador, usa a localização do computador. O município continua Saquarema/RJ."
    : "O trabalho está em Saquarema/RJ. Digite a rua. As opções vêm da base de CEP dos Correios.";
}

function fixarSaquarema() {
  form.uf.value = "RJ";
  form.uf.disabled = true;
  form.cidade.value = "Saquarema";
  form.cidade.disabled = true;
  form.rua.disabled = !cidadeValida();
}

async function carregarMunicipios() {
  const uf = "RJ";
  const seq = ++municipioSeq;
  municipiosCarregados = [];
  codigosMunicipio = {};
  listaCidades.innerHTML = "";
  form.uf.value = uf;
  form.uf.disabled = true;
  form.cidade.value = "Saquarema";
  form.cidade.disabled = true;
  form.rua.value = "";
  form.rua.disabled = true;
  ruaEscolhida = null;
  limparOpcoesRua();
  definirLocal("");
  form.cidade.placeholder = "Carregando municípios…";
  try {
    const resposta = await fetch("/api/municipios?uf=" + encodeURIComponent(uf));
    const dado = await resposta.json();
    if (seq !== municipioSeq) return;
    if (dado.erro) {
      dicaLocal.textContent = dado.erro;
      dicaLocal.classList.add("erro");
      form.cidade.placeholder = "Não foi possível carregar";
      return;
    }
    municipiosCarregados = dado.municipios || [];
    codigosMunicipio = dado.codigos || {};
    listaCidades.innerHTML = municipiosCarregados.map((nome) => `<option value="${esc(nome)}"></option>`).join("");
    fixarSaquarema();
    form.cidade.placeholder = "Saquarema";
    dicaLocal.classList.remove("erro");
    dicaLocal.textContent = "Saquarema/RJ já está definido. Digite a rua.";
  } catch (erro) {
    if (seq !== municipioSeq) return;
    form.cidade.placeholder = "Não foi possível carregar";
    dicaLocal.textContent = "Não consegui carregar os municípios.";
    dicaLocal.classList.add("erro");
  }
}

function cidadeValida() {
  const nome = form.cidade.value.trim().toLocaleLowerCase("pt-BR");
  if (!nome) return "";
  return municipiosCarregados.find((item) => item.toLocaleLowerCase("pt-BR") === nome) || "";
}

function liberarRua() {
  const ok = Boolean(form.uf.value && cidadeValida());
  form.rua.disabled = !ok;
  if (!ok) {
    form.rua.value = "";
    ruaEscolhida = null;
    limparOpcoesRua();
    definirLocal("");
  }
}

async function buscarRuas() {
  const cidade = cidadeValida();
  const texto = form.rua.value.trim();
  const seq = ++ruaSeq;
  if (ruaEscolhida && texto === ruaEscolhida.logradouro) {
    limparOpcoesRua();
    comporLocal();
    return;
  }
  ruaEscolhida = null;
  definirLocal("");
  if (!cidade || texto.length < 3) {
    limparOpcoesRua();
    if (cidade && texto.length > 0) dicaLocal.textContent = "Digite pelo menos 3 letras da rua.";
    return;
  }
  try {
    const url = "/api/ruas?uf=" + encodeURIComponent(form.uf.value)
      + "&cidade=" + encodeURIComponent(cidade)
      + "&q=" + encodeURIComponent(texto);
    const resposta = await fetch(url);
    if (seq !== ruaSeq) return;
    const dado = await resposta.json();
    const opcoes = dado.opcoes || [];
    if (!opcoes.length) {
      limparOpcoesRua();
      dicaLocal.textContent = dado.erro || "Nenhuma rua com esse nome nesse município.";
      dicaLocal.classList.add("erro");
      dicaLocal.classList.remove("ok");
      return;
    }
    dicaLocal.classList.remove("erro");
    dicaLocal.textContent = "Escolha a rua na lista.";
    opcoesRua.hidden = false;
    opcoesRua.innerHTML = opcoes.map((item, indice) => `
      <button type="button" data-rua="${indice}">
        ${esc(item.logradouro)}
        <small>${esc([item.bairro, item.cep].filter(Boolean).join(" · "))}</small>
      </button>
    `).join("");
    opcoesRua._itens = opcoes;
    opcoesRua.querySelectorAll("[data-rua]").forEach((botaoRua) => {
      botaoRua.addEventListener("click", () => {
        ruaEscolhida = opcoesRua._itens[Number(botaoRua.dataset.rua)];
        form.rua.value = ruaEscolhida.logradouro;
        limparOpcoesRua();
        comporLocal();
      });
    });
  } catch (erro) {
    if (seq !== ruaSeq) return;
    dicaLocal.textContent = "Não consegui consultar as ruas agora.";
    dicaLocal.classList.add("erro");
  }
}

function usarAparelho() {
  if (!navigator.geolocation) {
    dicaLocal.textContent = "Este navegador não informa a localização. Digite o endereço.";
    dicaLocal.classList.add("erro");
    return;
  }
  dicaLocal.classList.remove("ok", "erro");
  dicaLocal.textContent = "Buscando a localização do aparelho…";
  navigator.geolocation.getCurrentPosition(async (posicao) => {
    try {
      const resposta = await fetch(
        "/api/onde?lat=" + encodeURIComponent(posicao.coords.latitude)
        + "&lon=" + encodeURIComponent(posicao.coords.longitude)
      );
      const dado = await resposta.json();
      if (dado.erro) {
        dicaLocal.textContent = dado.erro;
        dicaLocal.classList.add("erro");
        return;
      }
      fixarSaquarema();
      form.rua.value = dado.logradouro || "";
      form.numero.value = dado.numero || "";
      ruaEscolhida = {
        logradouro: dado.logradouro || "",
        bairro: dado.bairro || "",
        cep: dado.cep || "",
        cidade: "Saquarema",
        uf: "RJ",
      };
      if (ruaEscolhida.logradouro) comporLocal();
      else definirLocal(dado.local || "");
      dicaLocal.textContent = form.local.value
        ? `${form.local.value}. Confira a rua e o número.`
        : "Achei o ponto, mas confira o endereço.";
      dicaLocal.classList.add("ok");
      dicaLocal.classList.remove("erro");
    } catch (erro) {
      dicaLocal.textContent = "Não consegui transformar o ponto em endereço. Digite a rua.";
      dicaLocal.classList.add("erro");
    }
  }, () => {
    dicaLocal.textContent = "A localização não foi autorizada ou não pôde ser lida. Digite o endereço.";
    dicaLocal.classList.add("erro");
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
}

function reiniciarLocal() {
  ruaEscolhida = null;
  limparOpcoesRua();
  form.local.value = "";
  form.querySelector("input[name=modo_local][value=manual]").checked = true;
  document.querySelector("#painel-aparelho").hidden = true;
  dicaLocal.classList.remove("ok", "erro");
  atualizarBotao();
  carregarMunicipios();
}

form.querySelectorAll("input[name=modo_local]").forEach((radio) => {
  radio.addEventListener("change", aplicarModoLocal);
});
form.uf.addEventListener("change", carregarMunicipios);
form.cidade.addEventListener("input", () => {
  liberarRua();
  if (cidadeValida()) dicaLocal.textContent = "Digite o começo da rua para ver as opções.";
});
form.rua.addEventListener("input", () => {
  clearTimeout(timerRua);
  timerRua = setTimeout(buscarRuas, 280);
});
form.numero.addEventListener("input", () => {
  if (ruaEscolhida) comporLocal();
});
document.querySelector("#usar-local").addEventListener("click", usarAparelho);
aplicarModoLocal();
carregarMunicipios();
mostrarProximoAuto();

const faltaDadosEl = document.querySelector("#falta-dados");
let consultando = false;

function placaBrasil(valor) {
  const bruto = String(valor || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const letrasMercosul = "ABCDEFGHJKLMNPRSTUVWXYZ";
  let cru = "";
  for (const caractere of bruto) {
    const posicao = cru.length;
    if (posicao >= 7) break;
    if (posicao < 3) {
      if (caractere >= "A" && caractere <= "Z") cru += caractere;
    } else if (posicao === 3) {
      if (caractere >= "0" && caractere <= "9") cru += caractere;
    } else if (posicao === 4) {
      if (caractere >= "0" && caractere <= "9") cru += caractere;
      else if (letrasMercosul.includes(caractere)) cru += caractere;
    } else if (caractere >= "0" && caractere <= "9") {
      cru += caractere;
    }
  }
  const mercosul = cru.length >= 5 && cru[4] >= "A" && cru[4] <= "Z";
  if (mercosul) {
    const letrasOk = [...cru.slice(0, 3), cru[4]].every((letra) => letrasMercosul.includes(letra));
    const valida = cru.length === 7 && letrasOk;
    let aviso = "Placa Mercosul. Faltam números.";
    if (!letrasOk) aviso = "Placa Mercosul não usa as letras I, O nem Q.";
    else if (valida) aviso = "Placa Mercosul.";
    return { cru, exibicao: cru, tipo: "mercosul", valida, aviso };
  }
  if (cru.length >= 5) {
    const valida = cru.length === 7;
    return {
      cru,
      exibicao: `${cru.slice(0, 3)}-${cru.slice(3)}`,
      tipo: "antiga",
      valida,
      aviso: valida ? "Placa antiga." : "Placa antiga. Faltam números.",
    };
  }
  let aviso = "Antiga: ABC-1234. Mercosul: ABC1D23.";
  if (cru.length > 0 && cru.length < 3) aviso = "Comece com 3 letras.";
  else if (cru.length === 3) aviso = "Agora um número.";
  else if (cru.length === 4) aviso = "Letra em seguida: Mercosul. Número: placa antiga.";
  return { cru, exibicao: cru, tipo: "", valida: false, aviso };
}

function atualizarPlaca() {
  const campo = form.placa;
  const info = placaBrasil(campo.value);
  if (campo.value !== info.exibicao) campo.value = info.exibicao;
  const dica = document.querySelector("#dica-placa");
  dica.textContent = info.aviso;
  dica.classList.toggle("ok", info.valida);
  dica.classList.toggle("erro", Boolean(info.cru) && info.cru.length === 7 && !info.valida);
  campo.setCustomValidity("");
}

function temTexto() {
  return Boolean(String(form.relato.value || "").trim());
}

function atualizarBotao() {
  const ok = temTexto();
  botao.disabled = consultando || !ok;
  faltaDadosEl.hidden = ok || consultando;
  faltaDadosEl.textContent = "Escreva o texto da abordagem para liberar a consulta.";
  if (!consultando) botao.textContent = rotuloBotao();
}

form.relato.addEventListener("input", atualizarBotao);
atualizarBotao();

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!temTexto()) return;
  await analisar(true);
});

async function analisar(rolar) {
  if (!temTexto()) return;
  const seq = ++analiseSeq;
  consultando = true;
  atualizarBotao();
  botao.textContent = "Pesquisando…";
  mostrarPesquisa();
  const inicio = Date.now();
  try {
    const resposta = await fetch("/api/analisar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pedido()),
    });
    const dado = await resposta.json();
    await esperarPesquisa(inicio);
    if (seq !== analiseSeq) return;
    desenhar(dado, rolar);
  } catch (erro) {
    await esperarPesquisa(inicio);
    if (seq !== analiseSeq) return;
    resultadoEl.innerHTML = `<div class="aviso"><h2>Não foi possível consultar</h2><p>O programa local não respondeu. Abra de novo pelo arquivo iniciar.bat.</p></div>`;
  } finally {
    if (seq === analiseSeq) {
      consultando = false;
      atualizarBotao();
    }
  }
}

function mostrarPesquisa() {
  document.querySelector("#auto-impresso").hidden = true;
  resultadoEl.hidden = false;
  resultadoEl.innerHTML = `
    <div class="pesquisa" role="status">
      <p>Pesquisando no Código de Trânsito…</p>
      <div class="barra" aria-hidden="true"><span></span></div>
    </div>
  `;
  resultadoEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function esperarPesquisa(inicio) {
  const falta = 900 - (Date.now() - inicio);
  if (falta <= 0) return Promise.resolve();
  return new Promise((resolver) => setTimeout(resolver, falta));
}

function escolher(id, rotulo) {
  ensinar = true;
  if (id === "nao-autuar-cnh" || id === "nao-extintor") {
    especiais.add(id);
  } else if (!escolhidos.has(id)) {
    escolhidos.set(id, { id, titulo: rotulo || id, artigo: "" });
    desenharEscolhidos();
  }
  if (temTexto()) analisar(false);
}

function partirDataHora(valor) {
  if (!valor || !valor.includes("T")) return { data: valor || "", hora: "" };
  const [diaIso, hora] = valor.split("T");
  const [ano, mes, dia] = diaIso.split("-");
  return { data: `${dia}/${mes}/${ano}`, hora: (hora || "").slice(0, 5) };
}

function codigoDoMunicipio() {
  const nome = cidadeValida();
  return (nome && codigosMunicipio[nome]) || "";
}

function logradouroDoAuto() {
  if (ruaEscolhida && ruaEscolhida.logradouro) {
    const numero = form.numero.value.trim();
    const base = numero ? `${ruaEscolhida.logradouro}, ${numero}` : ruaEscolhida.logradouro;
    return ruaEscolhida.bairro ? `${base}, ${ruaEscolhida.bairro}` : base;
  }
  return form.local.value.trim();
}

function semAcento(texto) {
  return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const ROTULOS_DETRAN = [
  ["marca", "marca / modelo"],
  ["marca", "marca/modelo"],
  ["licenciamento", "licenciamento"],
  ["proprietario", "proprietario"],
  ["especie", "especie"],
  ["combustivel", "combustivel"],
  ["ano_fabricacao", "ano de fabricacao"],
  ["ano_modelo", "ano do modelo"],
  ["categoria", "categoria"],
  ["municipio", "municipio"],
  ["cor", "cor"],
  ["capacidade", "capacidade / potencia / cilindradas"],
  ["observacoes", "observacoes / restricoes"],
  ["marca", "marca"],
].sort((a, b) => b[1].length - a[1].length);

function rotuloDetran(linha) {
  const base = semAcento(linha).replace(/:$/, "");
  return ROTULOS_DETRAN.find(([, rotulo]) => base === rotulo || base.startsWith(`${rotulo}:`));
}

function lerConsultaDetran(bruto) {
  const linhas = String(bruto || "").split(/\r?\n/).map((linha) => linha.trim()).filter(Boolean);
  const achados = {};
  linhas.forEach((linha, indice) => {
    const item = rotuloDetran(linha);
    if (!item) return;
    const [chave, rotulo] = item;
    const base = semAcento(linha);
    let valor = "";
    if (base.startsWith(`${rotulo}:`)) {
      const corte = linha.indexOf(":");
      valor = corte >= 0 ? linha.slice(corte + 1).trim() : "";
    } else if (linhas[indice + 1] && !rotuloDetran(linhas[indice + 1])) {
      valor = linhas[indice + 1];
    }
    if (!valor || valor === "—" || valor === "-" || /^[*]+$/.test(valor)) return;
    achados[chave] = valor;
  });
  return achados;
}

const ESPECIES_CONSULTA = {
  passageiro: "Passageiro",
  carga: "Carga",
  misto: "Misto",
  especial: "Especial",
};

function especieDaConsulta(valor) {
  const chave = semAcento(valor).split(/[^a-z]+/).find(Boolean) || "";
  return ESPECIES_CONSULTA[chave] || "";
}

function complementoVeiculo() {
  if (!form.proprietario.value.trim()) return "";
  return `proprietário na consulta: ${form.proprietario.value.trim()}`;
}

function colocarConsultaNoAuto() {
  const dados = lerConsultaDetran(form.consulta_detran.value);
  const dica = document.querySelector("#dica-detran");
  const especie = especieDaConsulta(dados.especie);
  if (!dados.marca && !especie && !dados.proprietario) {
    dica.textContent = "Não reconheci os dados. Copie o resultado da consulta, com os nomes dos campos, e cole de novo.";
    dica.classList.add("erro");
    dica.classList.remove("ok");
    return;
  }
  if (dados.marca) form.marca.value = dados.marca;
  if (especie) form.especie.value = especie;
  if (dados.proprietario) form.proprietario.value = dados.proprietario;
  const postos = [dados.marca, especie, dados.proprietario].filter(Boolean);
  dica.textContent = `Entrou no auto: ${postos.join(", ")}. O chassi não é copiado. O proprietário não substitui o condutor.`;
  dica.classList.add("ok");
  dica.classList.remove("erro");
}

document.querySelector("#colar-detran").addEventListener("click", colocarConsultaNoAuto);

function campoAuto(rotulo, valor, largo) {
  const texto = String(valor || "").trim();
  return `<div class="auto-campo${largo ? " largo" : ""}"><span>${esc(rotulo)}</span><strong>${esc(texto)}</strong></div>`;
}

function folhaDoAuto(item, numero) {
  const placa = placaBrasil(form.placa.value);
  const quando = partirDataHora(form.data_hora.value);
  const obs = [
    `Veículo placa ${placa.exibicao || "não informada"}, em ${form.local.value.trim() || "local não informado"}, ${quando.data} ${quando.hora}.`,
    item.tipificacao,
    `Medida na via: ${item.medida_texto}`,
    complementoVeiculo(),
  ].filter(Boolean).join(" ");
  return `
    <article class="folha-auto">
      <header class="auto-topo">
        <div>
          <strong>PREFEITURA MUNICIPAL DE SAQUAREMA</strong>
          <span>AUTO DE INFRAÇÃO E Notificação de Autuação</span>
        </div>
        <div class="auto-numero">
          <span>IDENTIFICAÇÃO DA AUTUAÇÃO</span>
          <strong>${esc(numero)}</strong>
        </div>
      </header>
      <section class="auto-secao">
        <h2>2 - IDENTIFICAÇÃO DO VEÍCULO</h2>
        <div class="auto-linha">
          ${campoAuto("PLACA", placa.exibicao)}
          ${campoAuto("ESPÉCIE", form.especie.value)}
          ${campoAuto("MARCA", form.marca.value)}
        </div>
      </section>
      <section class="auto-secao">
        <h2>3 - IDENTIFICAÇÃO DO CONDUTOR</h2>
        <div class="auto-linha">${campoAuto("NOME", form.condutor.value, true)}</div>
        <div class="auto-linha">
          ${campoAuto("Nº REGISTRO CNH / PPO", form.cnh.value, true)}
          ${campoAuto("UF", form.uf_cnh.value.toUpperCase())}
          ${campoAuto("CPF", form.cpf.value)}
        </div>
      </section>
      <section class="auto-secao">
        <h2>4 - IDENTIFICAÇÃO DO LOCAL, DATA E HORA DO COMETIMENTO DA INFRAÇÃO</h2>
        <div class="auto-linha">
          ${campoAuto("LOGRADOURO", logradouroDoAuto(), true)}
          ${campoAuto("DATA", quando.data)}
          ${campoAuto("HORA", quando.hora)}
        </div>
        <div class="auto-linha">
          ${campoAuto("CÓD. MUNIC.", codigoDoMunicipio())}
          ${campoAuto("NOME DO MUNICÍPIO", form.cidade.value, true)}
          ${campoAuto("UF", form.uf.value)}
        </div>
      </section>
      <section class="auto-secao">
        <h2>5 - TIPIFICAÇÃO DA INFRAÇÃO</h2>
        <div class="auto-linha">
          ${campoAuto("CÓD. / DESD.", item.artigo_legivel)}
          ${campoAuto("DESCRIÇÃO DA INFRAÇÃO", item.tipificacao, true)}
        </div>
        <div class="auto-linha">
          ${campoAuto("EQUIPAMENTO / INSTRUMENTO DE AFERIÇÃO — Nº", "")}
          ${campoAuto("MODELO", "")}
          ${campoAuto("MARCA", "")}
        </div>
        <div class="auto-linha">
          ${campoAuto("MEDIÇÃO REALIZADA", "")}
          ${campoAuto("LIMITE REGULAMENTADO", "")}
          ${campoAuto("VALOR CONSIDERADO", "")}
        </div>
        <p class="auto-obs"><span class="auto-campo" style="padding:0"><span>OBSERVAÇÕES</span></span>${esc(obs)}</p>
      </section>
      <section class="auto-secao">
        <h2>6 - IDENTIFICAÇÃO DA AUTORIDADE OU AGENTE AUTUADOR</h2>
        <div class="auto-linha">
          ${campoAuto("Nº DE IDENTIFICAÇÃO", form.agente.value)}
          ${campoAuto("ASSINATURA DA AUTORIDADE OU AGENTE AUTUADOR", "", true)}
        </div>
      </section>
      <section class="auto-secao">
        <h2>7 - IDENTIFICAÇÃO DO EMBARCADOR OU EXPEDIDOR</h2>
        <div class="auto-linha">${campoAuto("NOME", "", true)}</div>
        <div class="auto-linha">${campoAuto("CPF / CNPJ", "")}</div>
      </section>
      <section class="auto-secao">
        <h2>8 - IDENTIFICAÇÃO DO TRANSPORTADOR</h2>
        <div class="auto-linha">${campoAuto("NOME", "", true)}</div>
        <div class="auto-linha">${campoAuto("CPF / CNPJ", "")}</div>
      </section>
      <section class="auto-secao">
        <h2>9 - ASSINATURA DO INFRATOR OU CONDUTOR</h2>
        <div class="auto-linha">${campoAuto("ASSINATURA", "")}</div>
      </section>
      <p class="auto-rodape">OBS. NAS INFRAÇÕES DE RESPONSABILIDADE DO CONDUTOR, QUANDO ESSE ASSINAR O AUTO DE INFRAÇÃO, SERÁ CONSIDERADO NOTIFICADO DA AUTUAÇÃO E TERÁ O PRAZO MÁXIMO DE 15 DIAS PARA APRESENTAÇÃO DA DEFESA PRÉVIA.</p>
      <p class="auto-vias">1ª VIA SÉPIA PROCESSAMENTO, 2ª VIA VERMELHA USUÁRIO E 3ª VIA VERDE ARQUIVAMENTO</p>
    </article>
  `;
}

const COLUNAS_CUPOM = 32;

function linhasDe(texto) {
  const palavras = String(texto || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const linhas = [];
  let atual = "";
  palavras.forEach((palavra) => {
    if (palavra.length > COLUNAS_CUPOM) {
      if (atual) linhas.push(atual);
      for (let i = 0; i < palavra.length; i += COLUNAS_CUPOM) linhas.push(palavra.slice(i, i + COLUNAS_CUPOM));
      atual = "";
      return;
    }
    const proximo = atual ? `${atual} ${palavra}` : palavra;
    if (proximo.length > COLUNAS_CUPOM) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = proximo;
    }
  });
  if (atual) linhas.push(atual);
  return linhas;
}

function centralizarCupom(texto) {
  const curto = String(texto || "").trim().slice(0, COLUNAS_CUPOM);
  const margem = Math.max(0, Math.floor((COLUNAS_CUPOM - curto.length) / 2));
  return `${" ".repeat(margem)}${curto}`;
}

function campoCupom(rotulo, valor) {
  const texto = String(valor || "").replace(/\s+/g, " ").trim();
  if (!texto) return [`${rotulo}:`];
  const junto = `${rotulo}: ${texto}`;
  if (junto.length <= COLUNAS_CUPOM) return [junto];
  return [`${rotulo}:`, ...linhasDe(texto)];
}

function cupomDoAuto(item, numero) {
  const placa = placaBrasil(form.placa.value);
  const quando = partirDataHora(form.data_hora.value);
  const pontos = item.lanca_pontos === true && item.pontos
    ? String(item.pontos)
    : "nao lanca na CNH";
  const linhas = [
    centralizarCupom("PREFEITURA DE SAQUAREMA"),
    centralizarCupom("AUTO DE INFRACAO"),
    centralizarCupom("Notificacao de Autuacao"),
    "=".repeat(COLUNAS_CUPOM),
    ...campoCupom("AUTO", numero),
    "-".repeat(COLUNAS_CUPOM),
    centralizarCupom("VEICULO"),
    ...campoCupom("PLACA", placa.exibicao),
    ...campoCupom("ESPECIE", form.especie.value),
    ...campoCupom("MARCA", form.marca.value),
    ...(form.proprietario.value.trim() ? campoCupom("PROPRIET.", form.proprietario.value) : []),
    "-".repeat(COLUNAS_CUPOM),
    centralizarCupom("CONDUTOR"),
    ...campoCupom("NOME", form.condutor.value),
    ...campoCupom("CNH", form.cnh.value),
    ...campoCupom("UF CNH", form.uf_cnh.value.toUpperCase()),
    ...campoCupom("CPF", form.cpf.value),
    "-".repeat(COLUNAS_CUPOM),
    centralizarCupom("LOCAL E HORA"),
    ...linhasDe(logradouroDoAuto() || form.local.value),
    ...campoCupom("DATA", quando.data),
    ...campoCupom("HORA", quando.hora),
    ...campoCupom("MUNICIPIO", `${form.cidade.value} ${form.uf.value}`.trim()),
    ...campoCupom("COD.MUNIC", codigoDoMunicipio()),
    "-".repeat(COLUNAS_CUPOM),
    centralizarCupom("INFRACAO"),
    ...campoCupom("CODIGO", item.artigo_legivel),
    ...linhasDe(item.tipificacao),
    ...campoCupom("NATUREZA", item.natureza_rotulo),
    ...campoCupom("MULTA", item.valor),
    ...campoCupom("PONTOS", pontos),
  ];
  linhas.push(...linhasDe(`Medida: ${item.medida_texto || ""}`));
  linhas.push("-".repeat(COLUNAS_CUPOM));
  linhas.push(...campoCupom("AGENTE", form.agente.value));
  linhas.push("ASS. AGENTE:");
  linhas.push("_".repeat(COLUNAS_CUPOM));
  linhas.push("ASS. INFRATOR:");
  linhas.push("_".repeat(COLUNAS_CUPOM));
  linhas.push("-".repeat(COLUNAS_CUPOM));
  linhas.push(...linhasDe("Se o condutor assinar, fica notificado e tem 15 dias para a defesa previa."));
  return linhas.map((linha) => linha.slice(0, COLUNAS_CUPOM)).join("\n");
}

const numerosDoResultado = new WeakMap();

async function reservarNumeros(dado, quantidade) {
  if (numerosDoResultado.has(dado)) return numerosDoResultado.get(dado);
  const resposta = await fetch("/api/reservar-autos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantidade }),
  });
  if (!resposta.ok) throw new Error("numero");
  const info = await resposta.json();
  if (!Array.isArray(info.numeros) || info.numeros.length < quantidade) throw new Error("numero");
  const numeros = info.numeros.slice(0, quantidade);
  numerosDoResultado.set(dado, numeros);
  mostrarProximoAuto();
  return numeros;
}

async function mostrarProximoAuto() {
  const alvo = document.querySelector("#numero-auto");
  if (!alvo) return;
  try {
    const resposta = await fetch("/api/proximo-auto");
    if (!resposta.ok) return;
    const info = await resposta.json();
    if (info.numero) alvo.textContent = info.numero;
  } catch (erro) {
    /* o número aparece quando o servidor responder */
  }
}

async function preencherAuto(dado) {
  const folhas = (dado.infracoes || []).filter((item) => !item.orientacao);
  const painel = document.querySelector("#auto-impresso");
  if (!folhas.length) {
    painel.hidden = true;
    painel.innerHTML = "";
    return;
  }
  let numeros;
  try {
    numeros = await reservarNumeros(dado, folhas.length);
  } catch (erro) {
    painel.hidden = false;
    painel.innerHTML = `<p class="dica-placa erro">Não consegui gerar o número do auto. Tente de novo.</p>`;
    return;
  }
  painel.hidden = false;
  painel.innerHTML = `
    <div class="auto-acoes nao-imprime">
      <p>${folhas.length === 1 ? "Um auto preenchido." : `${folhas.length} autos, um por infração.`} O número sai sozinho. O cupom usa linha mais curta para não cortar a direita na térmica. Embarcador e transportador em branco ficam fora do rolo. O auto largo continua abaixo.</p>
      <button type="button" class="principal" id="imprimir-cupom">Imprimir cupom</button>
      <button type="button" class="secundario" id="imprimir-auto">Imprimir o auto largo</button>
    </div>
    ${folhas.map((item, indice) => `<pre class="cupom">${esc(cupomDoAuto(item, numeros[indice]))}</pre>`).join("")}
    ${folhas.map((item, indice) => folhaDoAuto(item, numeros[indice])).join("")}
  `;
  document.querySelector("#imprimir-cupom").addEventListener("click", () => {
    document.body.classList.add("imprimir-cupom");
    document.body.classList.remove("imprimir-auto");
    window.print();
    document.body.classList.remove("imprimir-cupom");
  });
  document.querySelector("#imprimir-auto").addEventListener("click", () => {
    document.body.classList.add("imprimir-auto");
    document.body.classList.remove("imprimir-cupom");
    window.print();
    document.body.classList.remove("imprimir-auto");
  });
  painel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function desenhar(dado, rolar) {
  const infracoes = (dado.infracoes || []).map(carta).join("");
  const procedimentos = (dado.procedimentos || []).map(carta).join("");
  const apoio = !(dado.infracoes || []).length && (dado.opcoes_texto || []).length ? `
    <article class="duvida">
      <h3>Não achei nada com esse texto</h3>
      <p>Por acaso é alguma destas opções abaixo?</p>
      ${dado.opcoes_texto.map((opcao) => `<button type="button" class="opcao" data-id="${esc(opcao.id)}">${esc(opcao.titulo)}</button>`).join("")}
    </article>
  ` : "";
  const duvidas = (dado.duvidas || []).map((duvida) => `
    <article class="duvida">
      <h3>Confirme antes de autuar</h3>
      <p>${esc(duvida.pergunta)}</p>
      ${duvida.opcoes.map((opcao) => `<button type="button" class="opcao" data-id="${esc(opcao.id)}">${esc(opcao.rotulo)}</button>`).join("")}
    </article>
  `).join("");
  const orientacoes = (dado.orientacoes || []).map((item) => `
    <article class="aviso"><h3>${esc(item.titulo)}</h3><p>${esc(item.texto)}</p></article>
  `).join("");
  const alertas = (dado.alertas || []).map((texto) => `<article class="aviso"><p>${esc(texto)}</p></article>`).join("");
  const plano = (dado.plano || []).map((passo) => `<li>${esc(passo)}</li>`).join("");
  const auto = dado.auto || { faltando: [], prontos: [] };
  const faltaAuto = auto.faltando.length
    ? `<article class="aviso nao-imprime"><h3>Ainda falta no auto</h3><p>${esc(auto.faltando.join(", "))}.</p></article>`
    : `<article class="aviso"><h3>Dados do art. 280 preenchidos</h3><p>${esc(auto.prontos.join(", "))}.</p></article>`;

  const juntar = (dado.infracoes || []).length ? `
    <article class="juntar nao-imprime">
      <h3>Lembrou de outro fato?</h3>
      <p>Escreva só o que faltou. Ele entra junto com o que já está nesta abordagem.</p>
      <textarea id="fato-extra" rows="2" placeholder="Ex.: também estava sem cinto"></textarea>
      <button type="button" class="principal" id="juntar-fato">Juntar nesta abordagem</button>
    </article>
  ` : "";
  const leitura = String(dado.resposta || "").split(/\n\n+/).filter(Boolean)
    .map((paragrafo) => `<p>${esc(paragrafo)}</p>`).join("");
  resultadoEl.innerHTML = `
    ${juntar}
    ${apoio}
    ${leitura ? `<article class="leitura"><h2>Resposta</h2>${leitura}</article>` : ""}
    <div class="faixa destino-${esc(dado.destino.tipo)}">
      <h2>${esc(dado.destino.titulo)}</h2>
      <p class="resumo">${esc(dado.resumo)}</p>
    </div>
    <ol class="plano">${plano}</ol>
    ${faltaAuto}
    ${duvidas}
    ${orientacoes}
    ${alertas}
    ${procedimentos}
    ${infracoes || `<article class="aviso"><p>Nenhuma multa confirmada ainda.</p></article>`}
    <div class="totais">
      <div><span>Multas desta abordagem</span><strong>${esc(dado.totais.multa)}</strong></div>
      <div><span>Pontos do condutor</span><strong>${esc(dado.totais.pontos_condutor)}</strong></div>
    </div>
    <p class="obs" style="padding: 0 18px;">${esc(dado.totais.pontos_observacao)}</p>
    <h3 style="padding: 8px 18px 0;">Texto para o campo de observações</h3>
    <p class="copiavel" id="obs">${esc(dado.observacao_sugerida)}</p>
    <div class="ferramentas">
      ${(dado.infracoes || []).length && modoTexto() ? `<button type="button" class="secundario" id="guardar-caso">Guardar este caso para eu aprender</button>` : ""}
      <button type="button" class="secundario" id="copiar">Copiar observações</button>
      <button type="button" class="secundario" id="imprimir">Imprimir a análise</button>
      ${(dado.infracoes || []).length ? `<button type="button" class="secundario" id="ver-auto">Preencher o auto</button>` : ""}
    </div>
    <p class="dica-placa" id="aviso-aprendizado">${dado.aprendizado && dado.aprendizado.casos ? `${dado.aprendizado.casos} caso(s) confirmado(s) no aprendizado local.` : "Nenhum caso confirmado ainda. Quando a resposta estiver certa, guarde o caso."}</p>
  `;
  resultadoEl.querySelectorAll(".opcao").forEach((botaoOpcao) => {
    botaoOpcao.addEventListener("click", () => escolher(botaoOpcao.dataset.id, botaoOpcao.textContent.trim()));
  });
  const juntarFato = document.querySelector("#juntar-fato");
  if (juntarFato) {
    juntarFato.addEventListener("click", () => {
      const extra = document.querySelector("#fato-extra").value.trim();
      if (!extra) return;
      const atual = form.relato.value.trim();
      form.relato.value = atual ? `${atual}. ${extra}` : extra;
      form.relato.dispatchEvent(new Event("input", { bubbles: true }));
      analisar(true);
    });
  }
  document.querySelector("#copiar").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(dado.observacao_sugerida);
      document.querySelector("#copiar").textContent = "Copiado";
    } catch (erro) {
      document.querySelector("#copiar").textContent = "Selecione o texto acima";
    }
  });
  document.querySelector("#imprimir").addEventListener("click", () => {
    document.body.classList.remove("imprimir-auto");
    window.print();
  });
  const verAuto = document.querySelector("#ver-auto");
  if (verAuto) verAuto.addEventListener("click", () => preencherAuto(dado));
  const guardar = document.querySelector("#guardar-caso");
  if (guardar) {
    guardar.addEventListener("click", async () => {
      guardar.disabled = true;
      guardar.textContent = "Guardando…";
      try {
        const resposta = await fetch("/api/aprender", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            relato: form.relato.value,
            ids: (dado.infracoes || []).map((item) => item.id),
          }),
        });
        const info = await resposta.json();
        const aviso = document.querySelector("#aviso-aprendizado");
        if (info.erro) {
          guardar.disabled = false;
          guardar.textContent = "Guardar este caso para eu aprender";
          if (aviso) aviso.textContent = info.erro;
          return;
        }
        guardar.textContent = "Caso guardado";
        if (aviso) aviso.textContent = `${info.casos} caso(s) confirmado(s) no aprendizado local. Na próxima vez parecida, eu reconheço sozinho.`;
      } catch (erro) {
        guardar.disabled = false;
        guardar.textContent = "Guardar este caso para eu aprender";
      }
    });
  }
}

function carta(item) {
  const pontos = item.orientacao
    ? "Sem pontos na CNH"
    : item.lanca_pontos === "confirmar"
      ? `${item.pontos} pontos, a confirmar`
      : item.lanca_pontos === false && ["165", "165-a", "165-b", "165-b-exame"].includes(item.id)
        ? `Não computável: os ${item.pontos_tabela} pontos não entram na CNH`
        : item.lanca_pontos === false
          ? "Sem pontos na CNH"
          : `${item.pontos} pontos na CNH`;
  const fator = item.multiplicador > 1 ? ` <span>×${item.multiplicador}</span>` : "";
  const suspensao = item.suspensao ? `<p><strong>Penalidade além da multa.</strong> ${esc(item.suspensao)}.</p>` : "";
  const conduta = (item.conduta || []).map((passo) => `<li>${esc(passo)}</li>`).join("");
  return `
    <article class="carta natureza-${esc(item.natureza)}">
      <p class="artigo">${esc(item.artigo_legivel)}</p>
      <h3>${esc(item.titulo)}</h3>
      <div class="metas">
        <span>${esc(item.natureza_rotulo)}${fator}</span>
        <span class="valor">${esc(item.valor)}</span>
        <span>${esc(pontos)}</span>
        <span>Responsável: ${esc(item.responsavel)}</span>
      </div>
      <p>${esc(item.tipificacao)}</p>
      <p><strong>Penalidade.</strong> ${esc(item.penalidade)}</p>
      <p><strong>Na via.</strong> ${esc(item.medida_texto)}</p>
      ${suspensao}
      <ol class="conduta">${conduta}</ol>
      ${item.observacao ? `<p class="obs">${esc(item.observacao)}</p>` : ""}
      <p class="porque">Origem: ${esc(item.origem)}. ${esc(item.porque)}.</p>
    </article>
  `;
}

