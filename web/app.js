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
    "Preencha local, data e hora, placa e matrícula. A resposta sai ao clicar em Analisar o texto.",
  ],
  palavras: [
    "Escreva palavras do que viu, como sem CNH ou sem cinto.",
    "Quando aparecerem opções, inclua cada achado. Pode ser mais de um.",
    "Preencha local, data e hora, placa e matrícula. O resultado sai ao clicar em Ver o que fazer.",
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
  form.relato.rows = texto ? 8 : 4;
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
    tipo_veiculo: dados.get("tipo_veiculo"),
    itens: [...marcados(), ...especiais],
    reincidencia_alcool: dados.get("reincidencia_alcool") === "on",
    velocidade_medida: dados.get("velocidade_medida"),
    velocidade_maxima: dados.get("velocidade_maxima"),
    excesso_kg: dados.get("excesso_kg"),
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
  return new FormData(form).get("tipo_veiculo") || "passeio";
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

form.querySelectorAll("input[name=tipo_veiculo]").forEach((radio) => {
  radio.addEventListener("change", () => {
    tirarIncompativeis();
    buscarSugestoes();
  });
});

form.querySelectorAll("input[name=modo]").forEach((radio) => {
  radio.addEventListener("change", () => aplicarModo(true));
});

document.querySelector("#exemplo").addEventListener("click", () => {
  form.relato.value = modoTexto() ? EXEMPLO_TEXTO : EXEMPLO;
  form.relato.focus();
  buscarSugestoes();
});

document.querySelector("#limpar").addEventListener("click", () => {
  form.reset();
  especiais.clear();
  escolhidos.clear();
  desenharEscolhidos();
  sugestoesEl.hidden = true;
  form.data_hora.value = horaLocal();
  form.querySelector("input[value=passeio]").checked = true;
  resultadoEl.innerHTML = `<div class="vazio"><h2>A resposta aparece aqui</h2><p>Escreva o texto ou marque as palavras-chave. Preencha local, data e hora, placa e matrícula.</p></div>`;
  atualizarPlaca();
  reiniciarLocal();
  aplicarModo(false);
});

form.placa.addEventListener("input", atualizarPlaca);

const dicaLocal = document.querySelector("#dica-local");
const opcoesRua = document.querySelector("#opcoes-rua");
const listaCidades = document.querySelector("#lista-cidades");
let municipiosCarregados = [];
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
    ? "No celular, a busca usa o GPS. Neste computador, usa a localização do computador. É preciso autorizar."
    : "Escolha o estado e o município. Ao digitar a rua, as opções vêm da base de CEP dos Correios.";
}

async function carregarMunicipios() {
  const uf = form.uf.value;
  const seq = ++municipioSeq;
  municipiosCarregados = [];
  listaCidades.innerHTML = "";
  form.cidade.value = "";
  form.cidade.disabled = true;
  form.rua.value = "";
  form.rua.disabled = true;
  ruaEscolhida = null;
  limparOpcoesRua();
  definirLocal("");
  if (!uf) {
    form.cidade.placeholder = "Escolha o estado antes";
    return;
  }
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
    listaCidades.innerHTML = municipiosCarregados.map((nome) => `<option value="${esc(nome)}"></option>`).join("");
    form.cidade.disabled = false;
    form.cidade.placeholder = "Digite o município";
    dicaLocal.classList.remove("erro");
    dicaLocal.textContent = "Agora o município e, em seguida, o começo da rua.";
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
      if (dado.uf) {
        form.uf.value = dado.uf;
        await carregarMunicipios();
      }
      if (dado.cidade) {
        form.cidade.value = dado.cidade;
        form.cidade.disabled = false;
      }
      form.rua.disabled = false;
      form.rua.value = dado.logradouro || "";
      form.numero.value = dado.numero || "";
      ruaEscolhida = {
        logradouro: dado.logradouro || "",
        bairro: dado.bairro || "",
        cep: dado.cep || "",
        cidade: dado.cidade || form.cidade.value,
        uf: dado.uf || form.uf.value,
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
  municipiosCarregados = [];
  listaCidades.innerHTML = "";
  ruaEscolhida = null;
  limparOpcoesRua();
  form.cidade.disabled = true;
  form.cidade.placeholder = "Escolha o estado antes";
  form.rua.disabled = true;
  form.local.value = "";
  form.querySelector("input[name=modo_local][value=manual]").checked = true;
  document.querySelector("#painel-aparelho").hidden = true;
  dicaLocal.classList.remove("ok", "erro");
  dicaLocal.textContent = "Escolha o estado e o município. Ao digitar a rua, as opções vêm da base de CEP dos Correios.";
  atualizarBotao();
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

const faltaDadosEl = document.querySelector("#falta-dados");
const CAMPOS_OBRIGATORIOS = ["local", "data_hora", "placa", "agente"];
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
  campo.setCustomValidity(info.valida || !info.cru ? "" : "Informe a placa inteira, antiga ou Mercosul.");
}

function camposObrigatoriosOk() {
  return CAMPOS_OBRIGATORIOS.every((nome) => {
    const valor = String(form.elements[nome].value || "").trim();
    if (!valor) return false;
    if (nome === "placa") return placaBrasil(valor).valida;
    return true;
  });
}

function atualizarBotao() {
  const ok = camposObrigatoriosOk();
  const placa = placaBrasil(form.placa.value);
  botao.disabled = consultando || !ok;
  faltaDadosEl.hidden = ok || consultando;
  if (placa.cru && !placa.valida) {
    faltaDadosEl.textContent = "Complete a placa no padrão antigo (ABC-1234) ou Mercosul (ABC1D23).";
  } else {
    faltaDadosEl.textContent = "Preencha local, data e hora, placa e matrícula para liberar o botão.";
  }
  if (!consultando) botao.textContent = rotuloBotao();
}

CAMPOS_OBRIGATORIOS.forEach((nome) => {
  form.elements[nome].addEventListener("input", atualizarBotao);
  form.elements[nome].addEventListener("change", atualizarBotao);
});
atualizarBotao();

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!camposObrigatoriosOk()) return;
  await analisar(true);
});

async function analisar(rolar) {
  if (!camposObrigatoriosOk()) return;
  const seq = ++analiseSeq;
  consultando = true;
  atualizarBotao();
  botao.textContent = "Consultando o CTB…";
  try {
    const resposta = await fetch("/api/analisar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pedido()),
    });
    const dado = await resposta.json();
    if (seq !== analiseSeq) return;
    desenhar(dado, rolar);
  } catch (erro) {
    if (seq !== analiseSeq) return;
    resultadoEl.innerHTML = `<div class="aviso"><h2>Não foi possível consultar</h2><p>O programa local não respondeu. Abra de novo pelo arquivo iniciar.bat.</p></div>`;
  } finally {
    if (seq === analiseSeq) {
      consultando = false;
      atualizarBotao();
    }
  }
}

function escolher(id, rotulo) {
  ensinar = true;
  if (id === "nao-autuar-cnh" || id === "nao-extintor") {
    especiais.add(id);
  } else if (!escolhidos.has(id)) {
    escolhidos.set(id, { id, titulo: rotulo || id, artigo: "" });
    desenharEscolhidos();
  }
  if (camposObrigatoriosOk()) analisar(false);
}

function desenhar(dado, rolar) {
  const infracoes = (dado.infracoes || []).map(carta).join("");
  const procedimentos = (dado.procedimentos || []).map(carta).join("");
  const apoio = !(dado.infracoes || []).length && (dado.opcoes_texto || []).length ? `
    <article class="duvida">
      <h3>Não fechei sozinho</h3>
      <p>Clique no que aconteceu. Eu guardo esse jeito de escrever e, na próxima, reconheço sozinho.</p>
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

  const leitura = String(dado.resposta || "").split(/\n\n+/).filter(Boolean)
    .map((paragrafo) => `<p>${esc(paragrafo)}</p>`).join("");
  resultadoEl.innerHTML = `
    ${leitura ? `<article class="leitura"><h2>Resposta</h2>${leitura}</article>` : ""}
    <div class="faixa destino-${esc(dado.destino.tipo)}">
      <h2>${esc(dado.destino.titulo)}</h2>
      <p class="resumo">${esc(dado.resumo)}</p>
    </div>
    <ol class="plano">${plano}</ol>
    ${faltaAuto}
    ${duvidas}
    ${apoio}
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
      <button type="button" class="secundario" id="copiar">Copiar observações</button>
      <button type="button" class="secundario" id="imprimir">Imprimir</button>
    </div>
  `;
  resultadoEl.querySelectorAll(".opcao").forEach((botaoOpcao) => {
    botaoOpcao.addEventListener("click", () => escolher(botaoOpcao.dataset.id, botaoOpcao.textContent.trim()));
  });
  document.querySelector("#copiar").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(dado.observacao_sugerida);
      document.querySelector("#copiar").textContent = "Copiado";
    } catch (erro) {
      document.querySelector("#copiar").textContent = "Selecione o texto acima";
    }
  });
  document.querySelector("#imprimir").addEventListener("click", () => window.print());
  if (rolar) resultadoEl.scrollIntoView({ behavior: "smooth", block: "start" });
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

