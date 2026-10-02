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

const EXEMPLO = "Condutor não possui CNH, passageiro sem cinto, película no para-brisa e licenciamento vencido.";

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

function marcados() {
  return [...escolhidos.keys()];
}

function pedido() {
  const dados = new FormData(form);
  return {
    relato: dados.get("relato") || "",
    tipo_veiculo: dados.get("tipo_veiculo"),
    itens: [...marcados(), ...especiais],
    reincidencia_alcool: dados.get("reincidencia_alcool") === "on",
    velocidade_medida: dados.get("velocidade_medida"),
    velocidade_maxima: dados.get("velocidade_maxima"),
    excesso_kg: dados.get("excesso_kg"),
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

async function buscarSugestoes() {
  const texto = form.relato.value.trim();
  const seq = ++sugestaoSeq;
  if (texto.length < 3) {
    sugestoesEl.hidden = true;
    sugestoesEl.innerHTML = "";
    return;
  }
  try {
    const resposta = await fetch("/api/sugerir?q=" + encodeURIComponent(texto));
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

document.querySelector("#exemplo").addEventListener("click", () => {
  form.relato.value = EXEMPLO;
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
  resultadoEl.innerHTML = `<div class="vazio"><h2>A conduta aparece aqui</h2><p>Ela aparece depois de Ver o que fazer, com local, data e hora, placa e matrícula preenchidos.</p></div>`;
  atualizarBotao();
});

const faltaDadosEl = document.querySelector("#falta-dados");
const CAMPOS_OBRIGATORIOS = ["local", "data_hora", "placa", "agente"];
let consultando = false;

function camposObrigatoriosOk() {
  return CAMPOS_OBRIGATORIOS.every((nome) => String(form.elements[nome].value || "").trim());
}

function atualizarBotao() {
  const ok = camposObrigatoriosOk();
  botao.disabled = consultando || !ok;
  faltaDadosEl.hidden = ok || consultando;
  if (!consultando) botao.textContent = "Ver o que fazer";
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
  if (id === "nao-autuar-cnh" || id === "nao-extintor") {
    especiais.add(id);
  } else if (!escolhidos.has(id)) {
    escolhidos.set(id, { id, titulo: rotulo || id, artigo: "" });
    desenharEscolhidos();
  }
}

function desenhar(dado, rolar) {
  const infracoes = (dado.infracoes || []).map(carta).join("");
  const procedimentos = (dado.procedimentos || []).map(carta).join("");
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

  resultadoEl.innerHTML = `
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
  const pontos = item.orientacao ? "Sem pontos neste passo" : `${item.pontos} pontos`;
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

