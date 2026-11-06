/**
 * MAMMA MIA CONTROLE OPERACIONAL — js/app.js (v10: menu com atalho para a OS e equipe por setor)
 * ------------------------------------------------------------------
 * Telas e lógica do app (sem build: a Vercel publica este arquivo direto).
 *
 * TELAS
 *   login · pin · cadastro (primeiro acesso) · aguardando aprovação
 *   trocar PIN · início (painéis de motorista, estoque, cocção e higiene)
 *   temperatura · higienização · recebimento · resultado do recebimento
 *   cocção · resultado da cocção · monitoramento de higiene (v4)
 *   histórico · aprovações e PIN temporário (Admin)
 *   pessoas e acessos (Admin, v5)
 *   fila de verificação · NCs · avançar NC (Qualidade, v6)
 *   gerar PDF por ficha e mês (Qualidade, v7)
 *   BPF da produção usa a mesma tela de checklist do monitoramento (v8)
 *
 * A cocção precisa de internet: cada nova medição depende da anterior,
 * por isso ela não entra na fila offline.
 *
 * FILA OFFLINE
 *   Temperatura e higienização feitas sem internet ficam guardadas no
 *   celular (localStorage) e são enviadas sozinhas quando a conexão volta.
 *   Cada registro leva um id_cliente para o servidor não duplicar.
 */
(function () {
  'use strict';

  // =================================================================
  // CONFIGURAÇÃO
  // =================================================================

  const API_URL = '/api/gas';
  const CHAVE_SESSAO = 'co_sessao';
  const CHAVE_ULTIMO_USUARIO = 'co_ultimo_usuario';
  const CHAVE_FILA = 'co_fila';
  const FOTO_LADO_MAX = 1280;
  const FOTO_QUALIDADE = 0.7;
  const INTERVALO_SYNC_MS = 60000;
  const ACOES_COM_FILA = ['registrarTemperatura', 'registrarHigienizacao', 'registrarRecebimento', 'registrarHigiene'];

  const DEPARTAMENTOS = [
    ['MOTORISTA', 'Motorista'],
    ['ESTOQUE', 'Estoque'],
    ['PRODUCAO', 'Produção'],
    ['COCCAO', 'Cocção'],
    ['MANUTENCAO', 'Manutenção'],
    ['GERAL', 'Geral']
  ];
  const CONTROLES = [
    ['HIG_BAU', 'Higienização do baú'],
    ['HIG_CABINE', 'Higienização da cabine'],
    ['TEMP_VEICULO', 'Temperatura']
  ];
  const TIPOS_CARGA = [
    ['CONGELADO', 'Congelado'],
    ['REFRIGERADO', 'Refrigerado'],
    ['RESFRIADO', 'Resfriado']
  ];
  const CONSERVACOES = [
    ['CONGELADO', 'Congelado'],
    ['REFRIGERADO', 'Refrigerado'],
    ['CARNE_RESFRIADA', 'Carne resfriada'],
    ['PESCADO_RESFRIADO', 'Pescado resfriado'],
    ['AMBIENTE', 'Ambiente (seco)']
  ];
  const UNIDADES_MEDIDA = [
    ['KG', 'kg'], ['L', 'L'], ['CX', 'cx'], ['PC', 'pç'], ['PAC', 'pac'], ['BALDE', 'balde'], ['UN', 'un']
  ];
  const NOMES_MOTIVO_REC = {
    TEMPERATURA_ACIMA: 'temperatura acima do limite',
    VALIDADE_VENCIDA: 'validade vencida',
    EMBALAGEM_DANIFICADA: 'embalagem danificada'
  };
  const NOMES_STATUS = {
    REMEDIR: 'Medir de novo',
    IMPORTADO: 'Importado',
    CONFORME: 'Conforme',
    NAO_CONFORME: 'Não conforme',
    AGUARDANDO_VERIFICACAO: 'Aguardando verificação',
    SUBSTITUIDO: 'Substituído',
    FEITO: 'Feito',
    PENDENTE: 'Pendente'
  };

  // =================================================================
  // ESTADO
  // =================================================================

  const estado = {
    sessao: lerLocal(CHAVE_SESSAO, null),   // { token, usuario, pinTemporario }
    meusDados: null,
    pilha: []                               // [{ tela, params }]
  };

  // App de Ordem de Serviço (manutenção), aberto pelo menu
  const URL_OS = 'https://script.google.com/macros/s/AKfycbxN_cFnGJpZgwVaCAegqB0HwrBsw_wKQd56wXyeq3RK5LZbumHrFaudxu9VjQMPBuOauQ/exec?tela=';

  const NOMES_SETOR = {
    MOTORISTA: 'Motorista',
    ESTOQUE: 'Estoque',
    PRODUCAO: 'Produção',
    COCCAO: 'Cocção',
    MANUTENCAO: 'Manutenção',
    GERAL: 'Geral / Higiene'
  };

  const app = document.getElementById('app');
  const btnVoltar = document.getElementById('btn-voltar');
  const btnSair = document.getElementById('btn-sair');
  const topoUsuario = document.getElementById('topo-usuario');
  const faixaOffline = document.getElementById('faixa-offline');
  const toastEl = document.getElementById('toast');

  // =================================================================
  // UTILITÁRIOS
  // =================================================================

  function lerLocal(chave, padrao) {
    try {
      const v = localStorage.getItem(chave);
      return v ? JSON.parse(v) : padrao;
    } catch (e) {
      return padrao;
    }
  }

  function gravarLocal(chave, valor) {
    try {
      if (valor === null || valor === undefined) localStorage.removeItem(chave);
      else localStorage.setItem(chave, JSON.stringify(valor));
      return true;
    } catch (e) {
      return false;
    }
  }

  function esc(texto) {
    return String(texto === null || texto === undefined ? '' : texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function hojeISO(deslocamentoDias) {
    const d = new Date();
    if (deslocamentoDias) d.setDate(d.getDate() + deslocamentoDias);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dia;
  }

  function dataBR(iso) {
    if (!iso) return '';
    const p = String(iso).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso);
  }

  function horaBR(isoDataHora) {
    const t = String(isoDataHora || '').split('T')[1];
    return t ? t.slice(0, 5) : '';
  }

  function primeiroNome(nome) {
    return String(nome || '').split(' ')[0];
  }

  function temPerfil(perfil) {
    const u = estado.sessao && estado.sessao.usuario;
    return !!(u && u.perfis && (u.perfis.indexOf(perfil) !== -1 || u.perfis.indexOf('ADMIN') !== -1));
  }

  let toastTimer = null;
  function toast(mensagem, tipo) {
    toastEl.textContent = mensagem;
    toastEl.className = 'toast visivel' + (tipo ? ' ' + tipo : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 4200);
  }

  function carregando(texto) {
    app.innerHTML = '<div class="carregando"><div class="giro"></div>' + esc(texto || 'Carregando…') + '</div>';
  }

  function aviso(tipo, texto) {
    return '<div class="aviso ' + tipo + '">' + esc(texto) + '</div>';
  }

  function $(seletor) { return app.querySelector(seletor); }
  function $$(seletor) { return Array.prototype.slice.call(app.querySelectorAll(seletor)); }

  /** Liga um grupo de botões .opcao (escolha única ou múltipla). */
  function ligarOpcoes(grupo, multipla, aoMudar) {
    $$('[data-grupo="' + grupo + '"] .opcao').forEach(function (b) {
      b.addEventListener('click', function () {
        if (multipla) {
          b.classList.toggle('marcada');
        } else {
          $$('[data-grupo="' + grupo + '"] .opcao').forEach(function (o) { o.classList.remove('marcada'); });
          b.classList.add('marcada');
        }
        if (aoMudar) aoMudar();
      });
    });
  }

  function valorOpcao(grupo) {
    const b = $('[data-grupo="' + grupo + '"] .opcao.marcada');
    return b ? b.getAttribute('data-valor') : '';
  }

  function valoresOpcoes(grupo) {
    return $$('[data-grupo="' + grupo + '"] .opcao.marcada').map(function (b) { return b.getAttribute('data-valor'); });
  }

  function htmlOpcoes(grupo, lista, marcados) {
    marcados = marcados || [];
    return '<div class="opcoes" data-grupo="' + grupo + '">' +
      lista.map(function (item) {
        const marcada = marcados.indexOf(item[0]) !== -1 ? ' marcada' : '';
        return '<button type="button" class="opcao' + marcada + '" data-valor="' + esc(item[0]) + '">' + esc(item[1]) + '</button>';
      }).join('') +
      '</div>';
  }

  function travarBotao(botao, texto) {
    botao.disabled = true;
    botao.setAttribute('data-texto', botao.textContent);
    botao.textContent = texto || 'Enviando…';
  }

  function destravarBotao(botao) {
    botao.disabled = false;
    botao.textContent = botao.getAttribute('data-texto') || botao.textContent;
  }

  // =================================================================
  // API
  // =================================================================

  function erroDe(codigo, mensagem) {
    const e = new Error(mensagem);
    e.codigo = codigo;
    return e;
  }

  function ehErroDeRede(e) {
    return e && (e.codigo === 'SEM_CONEXAO' || e.codigo === 'TEMPO_ESGOTADO');
  }

  /** Chama o proxy. Lança erro com .codigo quando ok = false. */
  async function api(acao, dados) {
    let resposta;
    try {
      const r = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao: acao,
          token: estado.sessao ? estado.sessao.token : '',
          dados: dados || {}
        })
      });
      if (r.status === 413) throw erroDe('MUITO_GRANDE', 'Envio muito grande. Tire a foto de novo.');
      resposta = await r.json();
    } catch (e) {
      if (e.codigo) throw e;
      throw erroDe('SEM_CONEXAO', 'Sem conexão com o servidor.');
    }

    if (!resposta || resposta.ok !== true) {
      const erro = (resposta && resposta.erro) || {};
      const e = erroDe(erro.codigo || 'ERRO', erro.mensagem || 'Erro inesperado.');
      if (e.codigo === 'SESSAO_EXPIRADA' || e.codigo === 'INATIVO') {
        encerrarSessaoLocal();
        toast(e.message, 'erro');
        irRaiz('login');
      } else if (e.codigo === 'TROCAR_PIN') {
        if (estado.sessao) {
          estado.sessao.pinTemporario = true;
          gravarLocal(CHAVE_SESSAO, estado.sessao);
        }
        irRaiz('trocarPin', { obrigatorio: true });
      }
      throw e;
    }
    return resposta.dados;
  }

  // =================================================================
  // FILA OFFLINE
  // =================================================================

  function lerFila() { return lerLocal(CHAVE_FILA, []); }

  function guardarNaFila(acao, dados) {
    const fila = lerFila();
    fila.push({ acao: acao, dados: dados, guardado_em: new Date().toISOString() });
    const ok = gravarLocal(CHAVE_FILA, fila);
    atualizarFaixa();
    return ok;
  }

  let sincronizando = false;
  async function sincronizarFila() {
    if (sincronizando || !estado.sessao || !navigator.onLine) return;
    let fila = lerFila();
    if (!fila.length) return;

    sincronizando = true;
    let enviados = 0;
    try {
      while (fila.length) {
        const item = fila[0];
        try {
          await api(item.acao, item.dados);
          enviados++;
        } catch (e) {
          if (ehErroDeRede(e) || e.codigo === 'SESSAO_EXPIRADA' || e.codigo === 'OCUPADO' || e.codigo === 'TROCAR_PIN') {
            break; // tenta de novo mais tarde
          }
          // Erro de regra (ex.: já registrado): não adianta reenviar
          toast('Um registro guardado não foi aceito: ' + e.message, 'erro');
        }
        fila.shift();
        gravarLocal(CHAVE_FILA, fila);
      }
    } finally {
      sincronizando = false;
      atualizarFaixa();
    }
    if (enviados) {
      toast(enviados + (enviados === 1 ? ' registro guardado foi enviado.' : ' registros guardados foram enviados.'), 'ok');
      if (telaAtual() === 'inicio') render();
    }
  }

  function atualizarFaixa() {
    const pendentes = lerFila().length;
    let texto = '';
    if (!navigator.onLine) {
      texto = 'Sem internet.' + (pendentes ? ' ' + pendentes + ' registro(s) guardado(s) no celular.' : ' Os registros ficam guardados e são enviados depois.');
    } else if (pendentes) {
      texto = pendentes + ' registro(s) aguardando envio…';
    }
    faixaOffline.textContent = texto;
    faixaOffline.classList.toggle('visivel', !!texto);
  }

  window.addEventListener('online', function () { atualizarFaixa(); sincronizarFila(); });
  window.addEventListener('offline', atualizarFaixa);
  setInterval(sincronizarFila, INTERVALO_SYNC_MS);

  /**
   * Envia um registro. Se faltar conexão, guarda na fila.
   * Retorna { enviado: true, dados } ou { guardado: true }.
   */
  async function enviarRegistro(acao, dados) {
    dados.id_cliente = dados.id_cliente || uuid();
    dados.hora_informada = dados.hora_informada || new Date().toISOString();
    try {
      const resultado = await api(acao, dados);
      return { enviado: true, dados: resultado };
    } catch (e) {
      if (ehErroDeRede(e) && ACOES_COM_FILA.indexOf(acao) !== -1) {
        if (guardarNaFila(acao, dados)) return { guardado: true };
        throw erroDe('SEM_ESPACO', 'Sem internet e sem espaço no celular para guardar. Tente de novo com internet.');
      }
      throw e;
    }
  }

  // =================================================================
  // NAVEGAÇÃO
  // =================================================================

  const TELAS = {};

  function telaAtual() {
    const topo = estado.pilha[estado.pilha.length - 1];
    return topo ? topo.tela : '';
  }

  function ir(tela, params) {
    estado.pilha.push({ tela: tela, params: params || {} });
    render();
  }

  function irRaiz(tela, params) {
    estado.pilha = [{ tela: tela, params: params || {} }];
    render();
  }

  function voltar() {
    if (estado.pilha.length > 1) {
      estado.pilha.pop();
      render();
    }
  }

  function render() {
    const topo = estado.pilha[estado.pilha.length - 1];
    if (!topo) return;
    window.scrollTo(0, 0);

    btnVoltar.hidden = estado.pilha.length <= 1;
    btnSair.hidden = !estado.sessao;
    topoUsuario.textContent = estado.sessao && estado.sessao.usuario ? estado.sessao.usuario.nome : '';
    atualizarFaixa();

    const fn = TELAS[topo.tela];
    if (!fn) { app.innerHTML = aviso('erro', 'Tela não encontrada.'); return; }
    Promise.resolve(fn(topo.params)).catch(function (e) {
      if (e && (e.codigo === 'SESSAO_EXPIRADA' || e.codigo === 'TROCAR_PIN' || e.codigo === 'INATIVO')) return;
      app.innerHTML = aviso('erro', (e && e.message) || 'Erro ao abrir a tela.') +
        '<button class="btn btn-secundario" id="btn-tentar">Tentar de novo</button>';
      $('#btn-tentar').addEventListener('click', render);
    });
  }

  btnVoltar.addEventListener('click', voltar);
  // O botão do cabeçalho abre o menu (o "Sair" fica dentro do menu)
  btnSair.textContent = 'Menu';
  btnSair.setAttribute('aria-label', 'Abrir o menu');
  btnSair.addEventListener('click', function () {
    const topo = estado.pilha[estado.pilha.length - 1];
    if (topo && topo.tela === 'menu') { voltar(); return; }
    ir('menu');
  });

  async function sair() {
    if (lerFila().length && !confirmarSaidaComFila()) return;
    try { await api('logout'); } catch (e) { /* sai mesmo assim */ }
    encerrarSessaoLocal();
    irRaiz('login');
  }

  function abrirOs() {
    const janela = window.open(URL_OS, '_blank', 'noopener');
    if (!janela) window.location.href = URL_OS;   // celular que bloqueia nova aba
  }

  function confirmarSaidaComFila() {
    toast('Há registros guardados sem envio. Conecte à internet antes de sair.', 'erro');
    return false;
  }

  function encerrarSessaoLocal() {
    estado.sessao = null;
    estado.meusDados = null;
    gravarLocal(CHAVE_SESSAO, null);
  }

  // =================================================================
  // TELA: LOGIN (lista de nomes)
  // =================================================================

  TELAS.login = async function () {
    carregando();
    const ultimo = lerLocal(CHAVE_ULTIMO_USUARIO, null);
    let nomes = [];
    let erroLista = '';
    try {
      nomes = await api('listarNomesLogin');
    } catch (e) {
      erroLista = ehErroDeRede(e) ? 'Sem internet. Conecte-se para entrar.' : e.message;
    }

    app.innerHTML =
      '<h1>Entrar</h1>' +
      '<p class="sub">Toque no seu nome.</p>' +
      (erroLista ? aviso('erro', erroLista) : '') +
      (ultimo ? '<button class="item-lista" data-id="' + esc(ultimo.id) + '" data-nome="' + esc(ultimo.nome) + '"><strong>Continuar como ' + esc(ultimo.nome) + '</strong><span>›</span></button><h2>Outra pessoa</h2>' : '') +
      (nomes.length > 8 ? '<div class="campo"><input id="busca" type="search" placeholder="Buscar nome" autocomplete="off"></div>' : '') +
      '<div class="lista" id="lista-nomes">' +
      nomes.map(function (u) {
        return '<button class="item-lista" data-id="' + esc(u.id) + '" data-nome="' + esc(u.nome) + '" data-status="' + esc(u.status) + '">' +
          '<span>' + esc(u.nome) + '</span>' +
          (u.status === 'PENDENTE' ? '<span class="etiqueta aguardando">aguardando</span>' : '<span>›</span>') +
          '</button>';
      }).join('') +
      '</div>' +
      '<button class="btn btn-secundario" id="btn-primeiro-acesso" style="margin-top:20px">Primeiro acesso: fazer meu cadastro</button>' +
      '<p class="rodape">Mamma Mia Salgados · Controle Operacional</p>';

    $$('.item-lista').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.getAttribute('data-status') === 'PENDENTE') { ir('aguardando'); return; }
        ir('pin', { id: b.getAttribute('data-id'), nome: b.getAttribute('data-nome') });
      });
    });

    const busca = $('#busca');
    if (busca) {
      busca.addEventListener('input', function () {
        const termo = busca.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        $$('#lista-nomes .item-lista').forEach(function (b) {
          const nome = b.getAttribute('data-nome').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
          b.style.display = nome.indexOf(termo) !== -1 ? '' : 'none';
        });
      });
    }

    $('#btn-primeiro-acesso').addEventListener('click', function () { ir('cadastro'); });
  };

  // =================================================================
  // TELA: PIN
  // =================================================================

  TELAS.pin = function (p) {
    app.innerHTML =
      '<h1>Olá, ' + esc(primeiroNome(p.nome)) + '</h1>' +
      '<p class="sub">Digite seu PIN de 4 números.</p>' +
      '<div id="msg"></div>' +
      '<div class="campo"><input id="pin" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="current-password"></div>' +
      '<button class="btn btn-principal" id="btn-entrar">Entrar</button>' +
      '<p class="sub" style="margin-top:16px">Esqueceu o PIN? Peça um PIN temporário à Qualidade.</p>';

    const campo = $('#pin');
    const botao = $('#btn-entrar');
    campo.focus();

    async function entrar() {
      const pin = campo.value.trim();
      if (!/^\d{4}$/.test(pin)) { $('#msg').innerHTML = aviso('erro', 'O PIN tem 4 números.'); return; }
      travarBotao(botao, 'Entrando…');
      try {
        const r = await api('login', { id_usuario: p.id, pin: pin });
        estado.sessao = { token: r.token, usuario: r.usuario, pinTemporario: r.pinTemporario };
        gravarLocal(CHAVE_SESSAO, estado.sessao);
        gravarLocal(CHAVE_ULTIMO_USUARIO, { id: r.usuario.id, nome: r.usuario.nome });
        if (r.pinTemporario) irRaiz('trocarPin', { obrigatorio: true });
        else irRaiz('inicio');
        sincronizarFila();
      } catch (e) {
        destravarBotao(botao);
        if (e.codigo === 'AGUARDANDO_APROVACAO') { ir('aguardando'); return; }
        campo.value = '';
        campo.focus();
        $('#msg').innerHTML = aviso('erro', ehErroDeRede(e) ? 'Sem internet. Conecte-se para entrar.' : e.message);
      }
    }

    botao.addEventListener('click', entrar);
    campo.addEventListener('input', function () { if (campo.value.length === 4) entrar(); });
  };

  // =================================================================
  // TELA: CADASTRO (primeiro acesso)
  // =================================================================

  TELAS.cadastro = async function () {
    carregando();
    const unidades = await api('listarUnidades');

    app.innerHTML =
      '<h1>Primeiro acesso</h1>' +
      '<p class="sub">Preencha seus dados. A Qualidade confere e libera seu acesso.</p>' +
      '<div id="msg"></div>' +

      '<div class="card">' +
      '<h2 style="margin-top:0">Seus dados</h2>' +
      '<div class="campo"><label for="nome">Nome completo</label><input id="nome" autocomplete="name" placeholder="Nome e sobrenome"></div>' +
      '<div class="campo"><label for="telefone">Telefone (opcional)</label><input id="telefone" type="tel" inputmode="tel" placeholder="(11) 90000-0000"></div>' +
      '<div class="campo"><label for="unidade">Unidade</label><select id="unidade"><option value="">Escolha…</option>' +
      unidades.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.id + ' — ' + u.nome) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="campo"><label for="departamento">Departamento</label><select id="departamento">' +
      DEPARTAMENTOS.map(function (d) { return '<option value="' + d[0] + '">' + d[1] + '</option>'; }).join('') +
      '</select></div>' +
      '</div>' +

      '<div class="card" id="bloco-veiculo">' +
      '<h2 style="margin-top:0">Seu veículo</h2>' +
      '<div class="campo"><label for="placa">Placa</label><input id="placa" autocapitalize="characters" placeholder="ABC1D23" maxlength="8"></div>' +
      '<div class="campo"><label for="marca">Marca</label><input id="marca" placeholder="Ex.: Renault"></div>' +
      '<div class="campo"><label for="modelo">Modelo</label><input id="modelo" placeholder="Ex.: Master"></div>' +
      '<div class="campo"><label>Quais controles este veículo tem?</label>' + htmlOpcoes('controles', CONTROLES) +
      '<div class="ajuda">Pode marcar mais de um.</div></div>' +
      '<div class="campo" id="bloco-carga" hidden><label>Tipo de carga</label>' + htmlOpcoes('carga', TIPOS_CARGA, ['CONGELADO']) + '</div>' +
      '</div>' +

      '<div class="card">' +
      '<h2 style="margin-top:0">Crie seu PIN</h2>' +
      '<div class="campo"><label for="pin1">PIN de 4 números</label><input id="pin1" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password"></div>' +
      '<div class="campo"><label for="pin2">Repita o PIN</label><input id="pin2" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password"></div>' +
      '<div class="ajuda">Não use números repetidos ou em sequência (1111, 1234).</div>' +
      '</div>' +

      '<button class="btn btn-principal" id="btn-enviar">Enviar cadastro</button>';

    const selDepto = $('#departamento');
    function atualizarVeiculo() {
      $('#bloco-veiculo').hidden = selDepto.value !== 'MOTORISTA';
    }
    function atualizarCarga() {
      $('#bloco-carga').hidden = valoresOpcoes('controles').indexOf('TEMP_VEICULO') === -1;
    }
    selDepto.addEventListener('change', atualizarVeiculo);
    ligarOpcoes('controles', true, atualizarCarga);
    ligarOpcoes('carga', false);
    atualizarVeiculo();
    atualizarCarga();

    const botao = $('#btn-enviar');
    botao.addEventListener('click', async function () {
      const departamento = selDepto.value;
      const dados = {
        nome: $('#nome').value,
        telefone: $('#telefone').value,
        id_unidade: $('#unidade').value,
        departamento: departamento,
        pin: $('#pin1').value,
        pinConfirmacao: $('#pin2').value
      };
      if (departamento === 'MOTORISTA') {
        const controles = valoresOpcoes('controles');
        dados.veiculo = {
          placa: $('#placa').value,
          marca: $('#marca').value,
          modelo: $('#modelo').value,
          controles: controles,
          tipo_carga: controles.indexOf('TEMP_VEICULO') !== -1 ? valorOpcao('carga') : ''
        };
      }

      travarBotao(botao);
      try {
        await api('autocadastro', dados);
        irRaiz('aguardando', { recemCadastrado: true });
      } catch (e) {
        destravarBotao(botao);
        $('#msg').innerHTML = aviso('erro', ehErroDeRede(e) ? 'Sem internet. Conecte-se e envie de novo.' : e.message);
        window.scrollTo(0, 0);
      }
    });
  };

  // =================================================================
  // TELA: AGUARDANDO APROVAÇÃO
  // =================================================================

  TELAS.aguardando = function (p) {
    app.innerHTML =
      '<h1>' + (p.recemCadastrado ? 'Cadastro enviado' : 'Aguardando aprovação') + '</h1>' +
      aviso('info', 'A Qualidade vai conferir seus dados e liberar seu acesso. Depois disso, entre com seu nome e o PIN que você criou.') +
      '<button class="btn btn-principal" id="btn-ok">Voltar para a tela de entrada</button>';
    $('#btn-ok').addEventListener('click', function () { irRaiz('login'); });
  };

  // =================================================================
  // TELA: TROCAR PIN
  // =================================================================

  TELAS.trocarPin = function (p) {
    app.innerHTML =
      '<h1>' + (p.obrigatorio ? 'Crie seu PIN' : 'Trocar PIN') + '</h1>' +
      (p.obrigatorio ? aviso('alerta', 'Você entrou com um PIN temporário. Crie um PIN novo para continuar.') : '') +
      '<div id="msg"></div>' +
      '<div class="campo"><label for="atual">' + (p.obrigatorio ? 'PIN temporário' : 'PIN atual') + '</label><input id="atual" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4"></div>' +
      '<div class="campo"><label for="novo1">Novo PIN</label><input id="novo1" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password"></div>' +
      '<div class="campo"><label for="novo2">Repita o novo PIN</label><input id="novo2" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password"></div>' +
      '<button class="btn btn-principal" id="btn-salvar">Salvar PIN</button>';

    const botao = $('#btn-salvar');
    botao.addEventListener('click', async function () {
      travarBotao(botao, 'Salvando…');
      try {
        await api('trocarPin', { pinAtual: $('#atual').value, pinNovo: $('#novo1').value, pinConfirmacao: $('#novo2').value });
        estado.sessao.pinTemporario = false;
        gravarLocal(CHAVE_SESSAO, estado.sessao);
        toast('PIN alterado.', 'ok');
        irRaiz('inicio');
      } catch (e) {
        destravarBotao(botao);
        $('#msg').innerHTML = aviso('erro', e.message);
      }
    });
  };

  // =================================================================
  // TELA: INÍCIO
  // =================================================================

  TELAS.inicio = async function () {
    carregando();
    const ehAdmin = temPerfil('ADMIN');

    const meus = await api('meusDados');
    estado.meusDados = meus;
    const temEstoque = meus.rotinas.some(function (r) { return r.id_modelo === 'REC_MP'; });
    const temCoccao = meus.rotinas.some(function (r) { return r.id_modelo === 'COC_TEMP'; });
    const temHigiene = meus.rotinas.some(function (r) { return r.id_modelo === 'MON_HIGIENE' || r.id_modelo === 'BPF_PRODUCAO'; });
    const temMotorista = meus.rotinas.some(function (r) { return r.id_modelo === 'TEMP_VEICULO' || r.id_modelo === 'HIG_VEICULO'; });

    const ehQualidade = temPerfil('QUALIDADE');
    const [painel, painelEst, painelCoc, painelHig, pendentes, resumoQ] = await Promise.all([
      api('painelMotorista'),
      temEstoque ? api('painelEstoque') : Promise.resolve(null),
      temCoccao ? api('painelCoccao') : Promise.resolve(null),
      temHigiene ? api('painelHigiene') : Promise.resolve(null),
      ehAdmin ? api('listarPendentes').catch(function () { return []; }) : Promise.resolve([]),
      ehQualidade ? api('resumoQualidade').catch(function () { return null; }) : Promise.resolve(null)
    ]);

    let html = '<h1>Olá, ' + esc(primeiroNome(meus.nome)) + '</h1>' +
      '<p class="sub">' + esc(dataBR(painel.hoje)) +
      (temMotorista ? ' · semana de ' + esc(dataBR(painel.semana.inicio)) + ' a ' + esc(dataBR(painel.semana.fim)) : '') + '</p>';

    // Checklists: monitoramento de higiene e BPF da produção
    if (painelHig) {
      let tituloAtual = '';
      // Monitoramento primeiro, depois BPF (agrupa os cartões por checklist)
      painelHig.areas.sort(function (x, y) { return (x.id_modelo === 'BPF_PRODUCAO') - (y.id_modelo === 'BPF_PRODUCAO'); });
      painelHig.areas.forEach(function (a, i) {
        const nome = a.nome || 'Monitoramento de higiene';
        if (nome !== tituloAtual) { html += '<h2>' + esc(nome) + '</h2>'; tituloAtual = nome; }
        const feitas = a.verificacoes.filter(function (v) { return v.feita; }).length;
        const detalhe = a.verificacoes.map(function (v) {
          return v.verificacao + 'ª ' + (v.feita ? '✓ ' + v.hora_inicio + '–' + v.hora_fim : 'pendente');
        }).join(' · ') + (a.ncsAbertas ? ' · ' + a.ncsAbertas + ' NC(s) aberta(s)' : '');
        const tudoFeito = feitas === a.verificacoes.length;
        html += '<button class="cartao-controle ' + (a.ncsAbertas ? 'nc' : (tudoFeito ? 'feito' : '')) + '" data-hig="' + i + '">' +
          '<div class="info"><div class="titulo">' + esc(a.id_modelo === 'BPF_PRODUCAO' ? 'BPF' : 'Monitoramento') + ' — ' + esc(a.id_unidade) + '</div>' +
          '<div class="detalhe">' + esc(detalhe) + '</div></div>' +
          '<span class="etiqueta ' + (tudoFeito ? 'feito' : 'pendente') + '">' + feitas + '/' + a.verificacoes.length + '</span></button>';
      });
    }

    // Estoque
    if (painelEst) {
      html += '<h2>Recebimento</h2>';
      painelEst.areas.forEach(function (a, i) {
        const detalhe = a.recebidosHoje + (a.recebidosHoje === 1 ? ' recebimento hoje' : ' recebimentos hoje') +
          (a.segregadosHoje ? ' · ' + a.segregadosHoje + ' segregado(s)' : '');
        html += '<button class="cartao-controle ' + (a.segregadosHoje ? 'nc' : 'feito') + '" data-area="' + i + '">' +
          '<div class="info"><div class="titulo">Novo recebimento — ' + esc(a.id_unidade) + '</div>' +
          '<div class="detalhe">' + esc(detalhe) + '</div></div>' +
          '<span class="seta">+</span></button>';
      });
      if (painelEst.recentes.length) {
        html += '<div class="card"><strong>Recebidos hoje</strong>' +
          painelEst.recentes.map(function (r) {
            const v = r.valores || {};
            const seg = v.destino === 'SEGREGADO';
            return '<div class="linha-hist"><div>' + esc(v.produto || '') +
              '<div class="quando">' + esc(v.fornecedor || '') + ' · ' + esc(horaBR(r.carimbo_servidor)) +
              (r.valor_num !== null ? ' · ' + esc(String(r.valor_num).replace('.', ',')) + ' °C' : '') + '</div></div>' +
              '<span class="etiqueta ' + (seg ? 'nc' : 'conforme') + '">' + (seg ? 'Segregado' : 'Liberado') + '</span></div>';
          }).join('') + '</div>';
      }
    }

    // Cocção
    if (painelCoc) {
      html += '<h2>Cocção</h2>';
      painelCoc.abertas.forEach(function (c, i) {
        html += '<button class="cartao-controle" data-coc-aberta="' + i + '">' +
          '<div class="info"><div class="titulo">' + esc(c.preparacao) + ' — em andamento</div>' +
          '<div class="detalhe">Início ' + esc(c.hora_inicio) + ' · última ' + esc(String(c.ultima_temperatura).replace('.', ',')) +
          ' °C · mínimo ' + esc(c.minimo) + ' °C</div></div>' +
          '<span class="etiqueta pendente">Medir de novo</span></button>';
      });
      painelCoc.areas.forEach(function (a, i) {
        html += '<button class="cartao-controle feito" data-coc-area="' + i + '">' +
          '<div class="info"><div class="titulo">Nova cocção — ' + esc(a.id_unidade) + '</div>' +
          '<div class="detalhe">Mínimo ' + esc(painelCoc.minimo) + ' °C no centro geométrico</div></div>' +
          '<span class="seta">+</span></button>';
      });
      if (painelCoc.concluidasHoje.length) {
        html += '<div class="card"><strong>Cocções de hoje</strong>' +
          painelCoc.concluidasHoje.map(function (c) {
            const ok = c.situacao === 'CONCLUIDA';
            return '<div class="linha-hist"><div>' + esc(c.preparacao) +
              '<div class="quando">' + esc(c.hora_inicio) + '–' + esc(c.hora_fim) + ' · ' +
              esc(c.temperaturas.map(function (t) { return String(t.temperatura).replace('.', ','); }).join(' › ')) + ' °C</div></div>' +
              '<span class="etiqueta ' + (ok ? 'conforme' : 'nc') + '">' + (ok ? 'Conforme' : 'Abaixo do mínimo') + '</span></div>';
          }).join('') + '</div>';
      }
    }

    // Qualidade: fila e NCs
    if (resumoQ) {
      html += '<button class="cartao-controle ' + (resumoQ.fila ? '' : 'feito') + '" id="btn-fila">' +
        '<div class="info"><div class="titulo">Fila de verificação</div>' +
        '<div class="detalhe">' + (resumoQ.fila ? resumoQ.fila + ' registro(s) aguardando você' : 'Nada aguardando') + '</div></div>' +
        '<span class="etiqueta ' + (resumoQ.fila ? 'aguardando' : 'feito') + '">' + resumoQ.fila + '</span></button>' +
        '<button class="cartao-controle ' + (resumoQ.ncsVencidas ? 'nc' : (resumoQ.ncsAbertas ? '' : 'feito')) + '" id="btn-ncs">' +
        '<div class="info"><div class="titulo">Não conformidades</div>' +
        '<div class="detalhe">' + resumoQ.ncsAbertas + ' aberta(s)' + (resumoQ.ncsVencidas ? ' · ' + resumoQ.ncsVencidas + ' com prazo vencido' : '') + '</div></div>' +
        '<span class="etiqueta ' + (resumoQ.ncsVencidas ? 'nc' : (resumoQ.ncsAbertas ? 'pendente' : 'feito')) + '">' + resumoQ.ncsAbertas + '</span></button>' +
        '<button class="cartao-controle feito" id="btn-pdf">' +
        '<div class="info"><div class="titulo">PDF das fichas</div>' +
        '<div class="detalhe">Para Vigilância, clientes e auditorias · uma ficha por mês, com as NCs</div></div>' +
        '<span class="seta">›</span></button>';
    }

    // Admin
    if (ehAdmin) {
      html += '<button class="cartao-controle ' + (pendentes.length ? '' : 'feito') + '" id="btn-aprovacoes">' +
        '<div class="info"><div class="titulo">Aprovar cadastros</div>' +
        '<div class="detalhe">' + (pendentes.length ? pendentes.length + ' aguardando' : 'Nenhum pendente') + ' · PIN temporário</div></div>' +
        '<span class="seta">›</span></button>' +
        '<button class="cartao-controle feito" id="btn-acessos">' +
        '<div class="info"><div class="titulo">Pessoas e acessos</div>' +
        '<div class="detalhe">Ligar e desligar os controles de cada pessoa</div></div>' +
        '<span class="seta">›</span></button>';
    }

    // NCs para refazer
    if (painel.ncs.length) {
      html += '<h2>Refazer</h2>';
      painel.ncs.forEach(function (nc) {
        html += '<button class="cartao-controle nc" data-nc="' + esc(nc.id_nc) + '">' +
          '<div class="info"><div class="titulo">Refazer higienização</div>' +
          '<div class="detalhe">' + esc(nc.descricao || nc.acao_corretiva || '') + '</div></div>' +
          '<span class="etiqueta nc">Não conforme</span></button>';
      });
    }

    // Controles
    if (painel.cartoes.length) {
      html += '<h2>Controles</h2>';
      painel.cartoes.forEach(function (c, i) {
        const feito = c.situacao === 'FEITO';
        let detalhe = c.placa || '';
        if (feito && c.registro) {
          if (c.controle === 'TEMP_VEICULO') detalhe += ' · ' + String(c.registro.valor_num).replace('.', ',') + ' °C às ' + horaBR(c.registro.carimbo_servidor);
          else detalhe += ' · feito em ' + dataBR(c.registro.data_ref);
        }
        html += '<button class="cartao-controle ' + (feito ? 'feito' : '') + '" data-i="' + i + '">' +
          '<div class="info"><div class="titulo">' + esc(c.titulo) + '</div><div class="detalhe">' + esc(detalhe) + '</div></div>' +
          '<span class="etiqueta ' + (feito ? 'feito' : 'pendente') + '">' + (feito ? 'Feito' : 'Pendente') + '</span></button>';
      });
    } else if (!ehAdmin && !painelEst && !painelCoc && !painelHig) {
      html += aviso('info', 'Nenhum controle liberado para você ainda. Fale com a Qualidade.');
    }

    html += '<button class="btn btn-secundario" id="btn-historico" style="margin-top:20px">Meu histórico</button>' +
      '<button class="btn-link" id="btn-trocar-pin">Trocar meu PIN</button>';

    app.innerHTML = html;

    $$('.cartao-controle[data-i]').forEach(function (b) {
      b.addEventListener('click', function () {
        const c = painel.cartoes[Number(b.getAttribute('data-i'))];
        if (c.controle === 'TEMP_VEICULO') {
          if (c.situacao === 'FEITO') { toast('A temperatura deste turno já foi registrada.'); return; }
          ir('temperatura', { id_ativo: c.id_ativo, placa: c.placa, turno: c.turno });
        } else {
          ir('higienizacao', { id_ativo: c.id_ativo, placa: c.placa, tipo: c.tipo, extra: c.situacao === 'FEITO' });
        }
      });
    });

    $$('.cartao-controle[data-hig]').forEach(function (b) {
      b.addEventListener('click', function () {
        const a = painelHig.areas[Number(b.getAttribute('data-hig'))];
        ir('monitoramento', { id_ativo: a.id_ativo, id_unidade: a.id_unidade, id_modelo: a.id_modelo || 'MON_HIGIENE' });
      });
    });

    $$('.cartao-controle[data-coc-area]').forEach(function (b) {
      b.addEventListener('click', function () {
        const a = painelCoc.areas[Number(b.getAttribute('data-coc-area'))];
        ir('coccao', { id_ativo: a.id_ativo, id_unidade: a.id_unidade });
      });
    });

    $$('.cartao-controle[data-coc-aberta]').forEach(function (b) {
      b.addEventListener('click', function () {
        const c = painelCoc.abertas[Number(b.getAttribute('data-coc-aberta'))];
        ir('coccao', { id_ativo: c.id_ativo, id_coccao: c.id_coccao, preparacao: c.preparacao, hora_inicio: c.hora_inicio, temperaturas: c.temperaturas, minimo: c.minimo });
      });
    });

    $$('.cartao-controle[data-area]').forEach(function (b) {
      b.addEventListener('click', function () {
        const a = painelEst.areas[Number(b.getAttribute('data-area'))];
        ir('recebimento', { id_ativo: a.id_ativo, id_unidade: a.id_unidade });
      });
    });

    $$('.cartao-controle[data-nc]').forEach(function (b) {
      b.addEventListener('click', function () {
        ir('higienizacao', { id_nc: b.getAttribute('data-nc') });
      });
    });

    const btnAprov = $('#btn-aprovacoes');
    if (btnAprov) btnAprov.addEventListener('click', function () { ir('aprovacoes'); });
    const btnAcessos = $('#btn-acessos');
    if (btnAcessos) btnAcessos.addEventListener('click', function () { ir('acessos'); });
    const btnFila = $('#btn-fila');
    if (btnFila) btnFila.addEventListener('click', function () { ir('fila'); });
    const btnPdf = $('#btn-pdf');
    if (btnPdf) btnPdf.addEventListener('click', function () { ir('pdf'); });
    const btnNcs = $('#btn-ncs');
    if (btnNcs) btnNcs.addEventListener('click', function () { ir('ncs', { situacao: 'ABERTAS' }); });
    $('#btn-historico').addEventListener('click', function () { ir('historico'); });
    $('#btn-trocar-pin').addEventListener('click', function () { ir('trocarPin', { obrigatorio: false }); });

    sincronizarFila();
  };

  // =================================================================
  // TELA: TEMPERATURA
  // =================================================================

  TELAS.temperatura = function (p) {
    const rotina = (estado.meusDados && estado.meusDados.rotinas || []).filter(function (r) {
      return String(r.ativo.id) === String(p.id_ativo) && r.id_modelo === 'TEMP_VEICULO';
    })[0];
    const tipoCarga = rotina ? rotina.ativo.tipo_carga : '';
    let negativo = tipoCarga === 'CONGELADO' || !tipoCarga;

    app.innerHTML =
      '<h1>Temperatura</h1>' +
      '<p class="sub">Veículo ' + esc(p.placa || '') + (tipoCarga ? ' · carga ' + esc(tipoCarga.toLowerCase()) : '') + '</p>' +
      '<div id="msg"></div>' +
      '<div class="campo"><label>Turno</label>' + htmlOpcoes('turno', [['MANHA', 'Manhã'], ['TARDE', 'Tarde']], [p.turno || (new Date().getHours() < 12 ? 'MANHA' : 'TARDE')]) + '</div>' +
      '<div class="campo"><label for="temp">Temperatura (°C)</label>' +
      '<div style="display:flex;gap:10px">' +
      '<button type="button" class="opcao" id="btn-sinal" style="min-width:72px;font-size:28px">' + (negativo ? '−' : '+') + '</button>' +
      '<input id="temp" class="grande" type="text" inputmode="decimal" placeholder="18,0" autocomplete="off">' +
      '</div>' +
      '<div class="ajuda">Toque em − / + para trocar o sinal. Use vírgula para decimal.</div></div>' +
      '<div class="campo"><label for="obs">Observação</label><textarea id="obs" placeholder="Obrigatória se a temperatura estiver fora da faixa"></textarea></div>' +
      '<button class="btn btn-principal" id="btn-salvar">Registrar temperatura</button>';

    ligarOpcoes('turno', false);
    const btnSinal = $('#btn-sinal');
    btnSinal.addEventListener('click', function () {
      negativo = !negativo;
      btnSinal.textContent = negativo ? '−' : '+';
    });

    const campo = $('#temp');
    campo.addEventListener('input', function () {
      // Aceita só números e uma vírgula/ponto
      let v = campo.value.replace(/[^0-9.,]/g, '').replace('.', ',');
      const partes = v.split(',');
      if (partes.length > 2) v = partes[0] + ',' + partes.slice(1).join('');
      campo.value = v;
    });
    campo.focus();

    const botao = $('#btn-salvar');
    botao.addEventListener('click', async function () {
      const texto = campo.value.trim();
      if (!texto || isNaN(Number(texto.replace(',', '.')))) {
        $('#msg').innerHTML = aviso('erro', 'Digite a temperatura.');
        return;
      }
      const valor = (negativo ? -1 : 1) * Number(texto.replace(',', '.'));

      travarBotao(botao, 'Registrando…');
      try {
        const r = await enviarRegistro('registrarTemperatura', {
          id_ativo: p.id_ativo,
          turno: valorOpcao('turno'),
          temperatura: valor,
          observacao: $('#obs').value
        });
        if (r.guardado) {
          toast('Sem internet: registro guardado no celular. Será enviado sozinho.', 'ok');
        } else if (r.dados.duplicado) {
          toast('Este registro já tinha sido enviado.', 'ok');
        } else if (r.dados.registro.status === 'CONFORME') {
          toast('Registrado: ' + String(valor).replace('.', ',') + ' °C · Conforme', 'ok');
        } else {
          toast('Registrado. Fora da faixa: enviado para a Qualidade.', 'erro');
        }
        irRaiz('inicio');
      } catch (e) {
        destravarBotao(botao);
        $('#msg').innerHTML = aviso(e.codigo === 'OBSERVACAO_OBRIGATORIA' ? 'alerta' : 'erro', e.message);
        if (e.codigo === 'OBSERVACAO_OBRIGATORIA') $('#obs').focus();
      }
    });
  };

  // =================================================================
  // TELA: HIGIENIZAÇÃO
  // =================================================================

  TELAS.higienizacao = function (p) {
    const rotinas = (estado.meusDados && estado.meusDados.rotinas || []).filter(function (r) {
      return r.id_modelo === 'HIG_VEICULO';
    });
    const veiculos = [];
    rotinas.forEach(function (r) {
      if (!veiculos.some(function (v) { return v.id === r.ativo.id; })) veiculos.push(r.ativo);
    });
    const tiposPermitidos = function (idAtivo) {
      return rotinas.filter(function (r) { return String(r.ativo.id) === String(idAtivo); })
        .map(function (r) { return r.janelas[0]; });
    };

    const idAtivoInicial = p.id_ativo || (veiculos[0] && veiculos[0].id) || '';
    const tipos = [['BAU', 'Baú'], ['CABINE', 'Cabine']].filter(function (t) {
      return tiposPermitidos(idAtivoInicial).indexOf(t[0]) !== -1;
    });
    let fotoBase64 = '';

    app.innerHTML =
      '<h1>' + (p.id_nc ? 'Refazer higienização' : 'Higienização') + '</h1>' +
      '<p class="sub">' + (p.placa ? 'Veículo ' + esc(p.placa) : 'Escolha o veículo e o tipo') + '</p>' +
      (p.id_nc ? aviso('alerta', 'Esta higienização é a reinspeção de uma não conformidade.') : '') +
      (p.extra ? aviso('info', 'A higienização desta semana já foi feita. Este registro vai como extra.') : '') +
      '<div id="msg"></div>' +
      (veiculos.length > 1 && !p.id_ativo
        ? '<div class="campo"><label for="veiculo">Veículo</label><select id="veiculo">' +
          veiculos.map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.placa + ' — ' + (v.descricao || '')) + '</option>'; }).join('') +
          '</select></div>'
        : '') +
      '<div class="campo"><label>O que foi higienizado</label>' + htmlOpcoes('tipo', tipos, [p.tipo || (tipos[0] && tipos[0][0])]) + '</div>' +
      '<div class="campo"><label for="data">Data da higienização</label><input id="data" type="date" value="' + hojeISO() + '" min="' + hojeISO(-7) + '" max="' + hojeISO() + '"></div>' +
      (p.id_nc ? '' : '<div class="campo"><label>Motivo</label>' + htmlOpcoes('motivo', [['ROTINA_SEMANAL', 'Rotina semanal'], ['EXTRA', 'Extra']], [p.extra ? 'EXTRA' : 'ROTINA_SEMANAL']) + '</div>') +
      '<div class="campo"><label for="foto">Foto (opcional)</label><input id="foto" type="file" accept="image/*" capture="environment"><img id="preview" class="foto-preview" hidden alt="Foto da higienização"></div>' +
      '<div class="campo"><label for="obs">Observação (opcional)</label><textarea id="obs"></textarea></div>' +
      '<button class="btn btn-principal" id="btn-salvar">Registrar higienização</button>';

    ligarOpcoes('tipo', false);
    if (!p.id_nc) ligarOpcoes('motivo', false);

    $('#foto').addEventListener('change', async function (ev) {
      const arquivo = ev.target.files && ev.target.files[0];
      if (!arquivo) return;
      try {
        fotoBase64 = await reduzirFoto(arquivo);
        const prev = $('#preview');
        prev.src = fotoBase64;
        prev.hidden = false;
      } catch (e) {
        fotoBase64 = '';
        $('#msg').innerHTML = aviso('erro', 'Não foi possível ler a foto. Tente de novo.');
      }
    });

    const botao = $('#btn-salvar');
    botao.addEventListener('click', async function () {
      const selVeiculo = $('#veiculo');
      const idAtivo = selVeiculo ? selVeiculo.value : idAtivoInicial;
      const tipo = valorOpcao('tipo');
      if (!idAtivo || !tipo) {
        $('#msg').innerHTML = aviso('erro', 'Escolha o veículo e o que foi higienizado.');
        return;
      }

      travarBotao(botao, 'Registrando…');
      try {
        const dados = {
          id_ativo: idAtivo,
          tipo: tipo,
          data_higienizacao: $('#data').value,
          motivo: p.id_nc ? 'ROTINA_SEMANAL' : valorOpcao('motivo'),
          observacao: $('#obs').value
        };
        if (p.id_nc) dados.id_nc = p.id_nc;
        if (fotoBase64) {
          dados.foto_base64 = fotoBase64;
          dados.foto_mime = 'image/jpeg';
        }

        const r = await enviarRegistro('registrarHigienizacao', dados);
        if (r.guardado) toast('Sem internet: registro guardado no celular. Será enviado sozinho.', 'ok');
        else if (r.dados.duplicado) toast('Este registro já tinha sido enviado.', 'ok');
        else toast('Higienização registrada. Aguardando verificação da Qualidade.', 'ok');
        irRaiz('inicio');
      } catch (e) {
        destravarBotao(botao);
        $('#msg').innerHTML = aviso('erro', e.message);
        window.scrollTo(0, 0);
      }
    });
  };

  /** Reduz a foto para no máximo 1280 px e JPEG 70% (cerca de 200–400 KB). */
  function reduzirFoto(arquivo) {
    return new Promise(function (resolve, reject) {
      const leitor = new FileReader();
      leitor.onerror = reject;
      leitor.onload = function () {
        const img = new Image();
        img.onerror = reject;
        img.onload = function () {
          let w = img.width;
          let h = img.height;
          const escala = Math.min(1, FOTO_LADO_MAX / Math.max(w, h));
          w = Math.round(w * escala);
          h = Math.round(h * escala);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', FOTO_QUALIDADE));
        };
        img.src = leitor.result;
      };
      leitor.readAsDataURL(arquivo);
    });
  }

  // =================================================================
  // TELA: RECEBIMENTO (Estoque)
  // =================================================================

  TELAS.recebimento = async function (p) {
    carregando();
    const catalogo = await api('catalogoRecebimento').catch(function (e) {
      if (ehErroDeRede(e)) return { fornecedores: [], produtos: [] }; // sem internet: digita livre
      throw e;
    });
    const produtosPorNome = {};
    catalogo.produtos.forEach(function (pr) { produtosPorNome[String(pr.nome).toUpperCase()] = pr; });

    let negativo = false;
    let fotoBase64 = '';
    const idCliente = uuid();   // o mesmo id se for preciso reenviar (ex.: confirmar validade)

    app.innerHTML =
      '<h1>Novo recebimento</h1>' +
      '<p class="sub">Área de recebimento · ' + esc(p.id_unidade || '') + '</p>' +
      '<div id="msg"></div>' +

      '<div class="campo"><label for="fornecedor">Fornecedor</label>' +
      '<input id="fornecedor" list="lista-fornecedores" autocomplete="off" autocapitalize="characters" placeholder="Digite ou escolha">' +
      '<datalist id="lista-fornecedores">' + catalogo.fornecedores.map(function (f) { return '<option value="' + esc(f) + '">'; }).join('') + '</datalist></div>' +

      '<div class="campo"><label for="produto">Produto</label>' +
      '<input id="produto" list="lista-produtos" autocomplete="off" autocapitalize="characters" placeholder="Digite ou escolha">' +
      '<datalist id="lista-produtos">' + catalogo.produtos.map(function (pr) { return '<option value="' + esc(pr.nome) + '">'; }).join('') + '</datalist></div>' +

      '<div class="campo"><label>Conservação</label>' + htmlOpcoes('conservacao', CONSERVACOES) + '</div>' +

      '<div class="campo" id="bloco-temp" hidden><label for="temp">Temperatura do produto (°C)</label>' +
      '<div style="display:flex;gap:10px">' +
      '<button type="button" class="opcao" id="btn-sinal" style="min-width:72px;font-size:28px">+</button>' +
      '<input id="temp" class="grande" type="text" inputmode="decimal" placeholder="0,0" autocomplete="off">' +
      '</div><div class="ajuda">Toque em − / + para trocar o sinal.</div></div>' +

      '<div class="campo"><label for="validade">Validade</label><input id="validade" type="date"></div>' +

      '<div class="campo"><label for="qtd">Quantidade recebida</label>' +
      '<input id="qtd" type="text" inputmode="decimal" placeholder="Ex.: 92,5" autocomplete="off"></div>' +
      '<div class="campo"><label>Unidade</label>' + htmlOpcoes('unidade', UNIDADES_MEDIDA) + '</div>' +

      '<div class="campo"><label>Embalagem íntegra?</label>' + htmlOpcoes('embalagem', [['SIM', 'Sim'], ['NAO', 'Não']]) + '</div>' +

      '<div class="campo"><label for="nf">Nº da nota fiscal (opcional)</label><input id="nf" inputmode="numeric" autocomplete="off"></div>' +
      '<div class="campo"><label for="lote">Lote (opcional)</label><input id="lote" autocapitalize="characters" autocomplete="off"></div>' +
      '<div class="campo"><label for="foto">Foto do rótulo (opcional)</label><input id="foto" type="file" accept="image/*" capture="environment"><img id="preview" class="foto-preview" hidden alt="Foto do rótulo"></div>' +
      '<div class="campo"><label for="obs">Observação</label><textarea id="obs" placeholder="Obrigatória se o produto for segregado"></textarea></div>' +

      '<button class="btn btn-principal" id="btn-salvar">Registrar recebimento</button>';

    // Conservação: mostra/esconde temperatura e sugere o sinal
    function aoMudarConservacao() {
      const c = valorOpcao('conservacao');
      $('#bloco-temp').hidden = !c || c === 'AMBIENTE';
      negativo = c === 'CONGELADO';
      $('#btn-sinal').textContent = negativo ? '−' : '+';
    }
    ligarOpcoes('conservacao', false, aoMudarConservacao);
    ligarOpcoes('unidade', false);
    ligarOpcoes('embalagem', false);

    function marcarOpcao(grupo, valor) {
      $$('[data-grupo="' + grupo + '"] .opcao').forEach(function (o) {
        o.classList.toggle('marcada', o.getAttribute('data-valor') === valor);
      });
    }

    // Produto conhecido: preenche conservação e unidade sozinho
    $('#produto').addEventListener('change', function () {
      const conhecido = produtosPorNome[$('#produto').value.trim().toUpperCase()];
      if (!conhecido) return;
      if (conhecido.conservacao) { marcarOpcao('conservacao', conhecido.conservacao); aoMudarConservacao(); }
      if (conhecido.unidade_medida) marcarOpcao('unidade', conhecido.unidade_medida);
    });

    $('#btn-sinal').addEventListener('click', function () {
      negativo = !negativo;
      $('#btn-sinal').textContent = negativo ? '−' : '+';
    });

    ['#temp', '#qtd'].forEach(function (sel) {
      const campo = $(sel);
      campo.addEventListener('input', function () {
        let v = campo.value.replace(/[^0-9.,]/g, '').replace('.', ',');
        const partes = v.split(',');
        if (partes.length > 2) v = partes[0] + ',' + partes.slice(1).join('');
        campo.value = v;
      });
    });

    $('#foto').addEventListener('change', async function (ev) {
      const arquivo = ev.target.files && ev.target.files[0];
      if (!arquivo) return;
      try {
        fotoBase64 = await reduzirFoto(arquivo);
        $('#preview').src = fotoBase64;
        $('#preview').hidden = false;
      } catch (e) {
        fotoBase64 = '';
        $('#msg').innerHTML = aviso('erro', 'Não foi possível ler a foto. Tente de novo.');
      }
    });

    function montarDados(confirmarValidade) {
      const conservacao = valorOpcao('conservacao');
      const embalagem = valorOpcao('embalagem');
      const textoTemp = $('#temp').value.trim();
      const dados = {
        id_ativo: p.id_ativo,
        fornecedor: $('#fornecedor').value,
        produto: $('#produto').value,
        conservacao: conservacao,
        temperatura: conservacao && conservacao !== 'AMBIENTE' && textoTemp
          ? (negativo ? -1 : 1) * Number(textoTemp.replace(',', '.'))
          : '',
        validade: $('#validade').value,
        quantidade: $('#qtd').value.replace(',', '.'),
        unidade_medida: valorOpcao('unidade'),
        embalagem_integra: embalagem === 'SIM' ? true : (embalagem === 'NAO' ? false : null),
        nota_fiscal: $('#nf').value,
        lote: $('#lote').value,
        observacao: $('#obs').value,
        id_cliente: idCliente
      };
      if (confirmarValidade) dados.confirmarValidadeVencida = true;
      if (fotoBase64) { dados.foto_base64 = fotoBase64; dados.foto_mime = 'image/jpeg'; }
      return dados;
    }

    function validarLocal(d) {
      if (!d.fornecedor.trim()) return 'Informe o fornecedor.';
      if (!d.produto.trim()) return 'Informe o produto.';
      if (!d.conservacao) return 'Escolha a conservação.';
      if (d.conservacao !== 'AMBIENTE' && (d.temperatura === '' || isNaN(d.temperatura))) return 'Digite a temperatura do produto.';
      if (!d.validade) return 'Informe a validade.';
      if (!d.quantidade || isNaN(Number(d.quantidade)) || Number(d.quantidade) <= 0) return 'Informe a quantidade.';
      if (!d.unidade_medida) return 'Escolha a unidade da quantidade.';
      if (d.embalagem_integra === null) return 'Informe se a embalagem está íntegra.';
      return '';
    }

    const botao = $('#btn-salvar');

    async function salvar(confirmarValidade) {
      const dados = montarDados(confirmarValidade);
      const erroLocal = validarLocal(dados);
      if (erroLocal) { $('#msg').innerHTML = aviso('erro', erroLocal); window.scrollTo(0, 0); return; }

      travarBotao(botao, 'Registrando…');
      try {
        const r = await enviarRegistro('registrarRecebimento', dados);
        if (r.guardado) {
          toast('Sem internet: recebimento guardado no celular. Será enviado sozinho.', 'ok');
          irRaiz('inicio');
          return;
        }
        estado.pilha.pop();
        ir('resultadoRecebimento', {
          produto: dados.produto.trim().toUpperCase(),
          id_ativo: p.id_ativo,
          id_unidade: p.id_unidade,
          duplicado: r.dados.duplicado,
          avaliacao: r.dados.avaliacao || null
        });
      } catch (e) {
        destravarBotao(botao);
        if (e.codigo === 'CONFIRMAR_VALIDADE') {
          $('#msg').innerHTML = aviso('alerta', e.message) +
            '<div id="msg-obs"></div>' +
            '<button class="btn btn-perigo" id="btn-confirmar-validade">A validade está certa: registrar como segregado</button>' +
            '<button class="btn btn-secundario" id="btn-corrigir-validade">Corrigir a validade</button>';
          $('#btn-confirmar-validade').addEventListener('click', function () {
            if (!$('#obs').value.trim()) {
              $('#msg-obs').innerHTML = aviso('erro', 'Antes de confirmar, escreva na observação (no fim da tela) o que foi feito com o produto. Ex.: segregado na câmara, fornecedor avisado.');
              $('#obs').focus();
              return;
            }
            salvar(true);
          });
          $('#btn-corrigir-validade').addEventListener('click', function () { $('#msg').innerHTML = ''; $('#validade').focus(); });
        } else {
          $('#msg').innerHTML = aviso(e.codigo === 'OBSERVACAO_OBRIGATORIA' ? 'alerta' : 'erro', e.message);
          if (e.codigo === 'OBSERVACAO_OBRIGATORIA') $('#obs').focus();
        }
        window.scrollTo(0, 0);
      }
    }

    botao.addEventListener('click', function () { salvar(false); });
  };

  // =================================================================
  // TELA: RESULTADO DO RECEBIMENTO
  // =================================================================

  TELAS.resultadoRecebimento = function (p) {
    const a = p.avaliacao;
    let html;

    if (p.duplicado || !a) {
      html = '<h1>Recebimento registrado</h1>' + aviso('ok', 'Este recebimento já estava registrado.');
    } else if (a.conforme) {
      html = '<h1>Liberado</h1>' +
        '<div class="aviso ok" style="font-size:20px;text-align:center"><strong>' + esc(p.produto) + '</strong><br>Conforme. Pode armazenar.</div>';
    } else {
      html = '<h1>Segregar</h1>' +
        '<div class="aviso erro" style="font-size:20px;text-align:center"><strong>' + esc(p.produto) + '</strong><br>' +
        'NÃO CONFORME: separe o produto e identifique como segregado.</div>' +
        aviso('alerta', 'Motivo: ' + a.motivos.map(function (m) { return NOMES_MOTIVO_REC[m] || m; }).join(', ') +
          (a.limite !== null && a.motivos.indexOf('TEMPERATURA_ACIMA') !== -1 ? ' (limite ' + String(a.limite).replace('.', ',') + ' °C)' : '') +
          '. A Qualidade vai avaliar.');
    }

    html += '<button class="btn btn-principal" id="btn-novo">Novo recebimento</button>' +
      '<button class="btn btn-secundario" id="btn-inicio">Voltar ao início</button>';
    app.innerHTML = html;

    $('#btn-novo').addEventListener('click', function () {
      estado.pilha.pop();
      ir('recebimento', { id_ativo: p.id_ativo, id_unidade: p.id_unidade });
    });
    $('#btn-inicio').addEventListener('click', function () { irRaiz('inicio'); });
  };

  // =================================================================
  // TELA: COCÇÃO (nova cocção ou nova medição)
  // =================================================================

  function horaAgora() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  TELAS.coccao = async function (p) {
    const continuacao = !!p.id_coccao;
    let catalogo = { preparacoes: [], minimo: p.minimo || 74 };
    if (!continuacao) {
      carregando();
      catalogo = await api('catalogoCoccao');
    }
    const minimo = continuacao ? p.minimo : catalogo.minimo;
    const idCliente = uuid();

    let html = '<h1>' + (continuacao ? 'Nova medição' : 'Nova cocção') + '</h1>';
    if (continuacao) {
      html += '<p class="sub"><strong>' + esc(p.preparacao) + '</strong> · início ' + esc(p.hora_inicio) + '</p>' +
        '<div class="card"><strong>Medições anteriores</strong>' +
        (p.temperaturas || []).map(function (t, i) {
          return '<div class="linha-hist"><div>' + (i + 1) + 'ª medição<div class="quando">' + esc(t.hora || '') + '</div></div>' +
            '<span class="etiqueta pendente">' + esc(String(t.temperatura).replace('.', ',')) + ' °C</span></div>';
        }).join('') + '</div>';
    } else {
      html += '<p class="sub">Cocção · ' + esc(p.id_unidade || '') + ' · mínimo ' + esc(minimo) + ' °C no centro geométrico</p>';
    }

    html += '<div id="msg"></div>';
    if (!continuacao) {
      html += '<div class="campo"><label for="preparacao">Alimento/Preparação</label>' +
        '<input id="preparacao" list="lista-preparacoes" autocomplete="off" autocapitalize="characters" placeholder="Digite ou escolha">' +
        '<datalist id="lista-preparacoes">' + catalogo.preparacoes.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist></div>' +
        '<div class="campo"><label for="inicio">Horário de início</label><input id="inicio" type="time" value="' + horaAgora() + '"></div>';
    }
    html += '<div class="campo"><label for="temp">Temperatura no centro geométrico (°C)</label>' +
      '<input id="temp" class="grande" type="text" inputmode="decimal" placeholder="' + esc(minimo) + ',0" autocomplete="off">' +
      '<div class="ajuda">Meça no ponto mais grosso/central do alimento.</div></div>' +
      '<div class="campo"><label for="obs">Observação (opcional)</label><textarea id="obs"></textarea></div>' +
      '<button class="btn btn-principal" id="btn-salvar">Registrar temperatura</button>';

    app.innerHTML = html;

    const campo = $('#temp');
    campo.addEventListener('input', function () {
      let v = campo.value.replace(/[^0-9.,]/g, '').replace('.', ',');
      const partes = v.split(',');
      if (partes.length > 2) v = partes[0] + ',' + partes.slice(1).join('');
      campo.value = v;
    });
    if (continuacao) campo.focus();

    const botao = $('#btn-salvar');
    botao.addEventListener('click', async function () {
      const texto = campo.value.trim();
      if (!continuacao && !$('#preparacao').value.trim()) { $('#msg').innerHTML = aviso('erro', 'Informe o alimento ou a preparação.'); return; }
      if (!continuacao && !$('#inicio').value) { $('#msg').innerHTML = aviso('erro', 'Informe o horário de início.'); return; }
      if (!texto || isNaN(Number(texto.replace(',', '.')))) { $('#msg').innerHTML = aviso('erro', 'Digite a temperatura.'); return; }

      const dados = {
        id_ativo: p.id_ativo,
        temperatura: Number(texto.replace(',', '.')),
        observacao: $('#obs').value,
        id_cliente: idCliente,
        hora_informada: new Date().toISOString()
      };
      if (continuacao) {
        dados.id_coccao = p.id_coccao;
      } else {
        dados.preparacao = $('#preparacao').value;
        dados.hora_inicio = $('#inicio').value;
      }

      travarBotao(botao, 'Registrando…');
      try {
        const r = await api('registrarCoccao', dados);
        estado.pilha.pop();
        ir('resultadoCoccao', { coccao: r.coccao, id_ativo: p.id_ativo, id_unidade: p.id_unidade, temperaturasAntes: p.temperaturas || [] });
      } catch (e) {
        destravarBotao(botao);
        $('#msg').innerHTML = aviso('erro', ehErroDeRede(e)
          ? 'Sem internet. A cocção precisa de conexão para registrar. Anote a temperatura e a hora e registre assim que a internet voltar.'
          : e.message);
        window.scrollTo(0, 0);
      }
    });
  };

  // =================================================================
  // TELA: RESULTADO DA COCÇÃO
  // =================================================================

  TELAS.resultadoCoccao = function (p) {
    const c = p.coccao;
    const temps = (p.temperaturasAntes || []).map(function (t) { return t.temperatura; }).concat([c.temperatura]);
    const sequencia = temps.map(function (t) { return String(t).replace('.', ','); }).join(' › ') + ' °C';

    let html;
    if (c.atingiu) {
      html = '<h1>Conforme</h1>' +
        '<div class="aviso ok" style="font-size:20px;text-align:center"><strong>' + esc(c.preparacao) + '</strong><br>' +
        esc(String(c.temperatura).replace('.', ',')) + ' °C · atingiu o mínimo de ' + esc(c.minimo) + ' °C.<br>Cocção concluída.</div>' +
        '<p class="sub" style="text-align:center">' + esc(c.hora_inicio) + '–' + esc(c.hora_fim) + ' · ' + esc(sequencia) + '</p>' +
        '<button class="btn btn-principal" id="btn-nova">Nova cocção</button>' +
        '<button class="btn btn-secundario" id="btn-inicio">Voltar ao início</button>';
    } else {
      html = '<h1>Continue a cocção</h1>' +
        '<div class="aviso alerta" style="font-size:20px;text-align:center"><strong>' + esc(c.preparacao) + '</strong><br>' +
        esc(String(c.temperatura).replace('.', ',')) + ' °C · abaixo do mínimo de ' + esc(c.minimo) + ' °C.<br>Continue cozinhando e meça de novo.</div>' +
        '<p class="sub" style="text-align:center">' + c.numero_medicao + 'ª medição · ' + esc(sequencia) + '</p>' +
        '<button class="btn btn-principal" id="btn-medir">Medir de novo</button>' +
        '<button class="btn btn-secundario" id="btn-inicio">Voltar ao início (a cocção fica aberta)</button>' +
        '<button class="btn-link" id="btn-encerrar" style="color:var(--vermelho)">Encerrar sem atingir ' + esc(c.minimo) + ' °C</button>' +
        '<div id="bloco-encerrar" hidden class="card" style="margin-top:8px">' +
        '<div id="msg-enc"></div>' +
        '<div class="campo"><label for="obs-enc">Por que a cocção foi encerrada abaixo do mínimo?</label><textarea id="obs-enc"></textarea></div>' +
        '<button class="btn btn-perigo" id="btn-confirmar-enc">Confirmar encerramento (vai para a Qualidade)</button></div>';
    }
    app.innerHTML = html;

    $('#btn-inicio').addEventListener('click', function () { irRaiz('inicio'); });

    const btnNova = $('#btn-nova');
    if (btnNova) btnNova.addEventListener('click', function () {
      estado.pilha.pop();
      ir('coccao', { id_ativo: p.id_ativo, id_unidade: p.id_unidade });
    });

    const btnMedir = $('#btn-medir');
    if (btnMedir) btnMedir.addEventListener('click', function () {
      estado.pilha.pop();
      ir('coccao', {
        id_ativo: p.id_ativo,
        id_unidade: p.id_unidade,
        id_coccao: c.id_coccao,
        preparacao: c.preparacao,
        hora_inicio: c.hora_inicio,
        minimo: c.minimo,
        temperaturas: (p.temperaturasAntes || []).concat([{ temperatura: c.temperatura, hora: c.hora_fim }])
      });
    });

    const btnEnc = $('#btn-encerrar');
    if (btnEnc) btnEnc.addEventListener('click', function () {
      $('#bloco-encerrar').hidden = false;
      btnEnc.hidden = true;
      $('#obs-enc').focus();
    });

    const btnConf = $('#btn-confirmar-enc');
    if (btnConf) btnConf.addEventListener('click', async function () {
      travarBotao(btnConf, 'Encerrando…');
      try {
        await api('encerrarCoccaoAbaixo', { id_coccao: c.id_coccao, observacao: $('#obs-enc').value, id_cliente: uuid() });
        toast('Cocção encerrada abaixo do mínimo. Enviada para a Qualidade.', 'erro');
        irRaiz('inicio');
      } catch (e) {
        destravarBotao(btnConf);
        $('#msg-enc').innerHTML = aviso('erro', e.message);
      }
    });
  };

  // =================================================================
  // TELA: MONITORAMENTO DE HIGIENE (checklist por setor)
  // =================================================================

  TELAS.monitoramento = async function (p) {
    carregando();
    const idModelo = p.id_modelo || 'MON_HIGIENE';
    const dados = await api('checklistHigiene', { id_ativo: p.id_ativo, id_modelo: idModelo });
    const horaInicio = horaAgora();       // início = quando o checklist foi aberto
    const idCliente = uuid();
    const pendentesHoje = dados.hoje.filter(function (v) { return !v.feita; });
    const totalItens = dados.setores.reduce(function (n, s) { return n + s.itens.length; }, 0);

    const estiloBtn = 'min-height:44px;padding:6px;font-size:15px';
    let html = '<h1>' + esc(dados.nome || 'Monitoramento de higiene') + '</h1>' +
      '<p class="sub">' + esc(p.id_unidade || '') + ' · início ' + esc(horaInicio) + ' · C = Conforme · NC = Não Conforme · SA = Sem Atividade</p>';

    if (!pendentesHoje.length) {
      app.innerHTML = html + aviso('ok', 'As ' + dados.vezesPorDia + ' verificações de hoje já foram registradas nesta área.') +
        '<button class="btn btn-secundario" id="btn-voltar-inicio">Voltar ao início</button>';
      $('#btn-voltar-inicio').addEventListener('click', function () { irRaiz('inicio'); });
      return;
    }

    if (dados.ncsAbertas.length) {
      html += '<div class="aviso alerta"><strong>' + dados.ncsAbertas.length + ' NC(s) aberta(s) nesta área:</strong><br>' +
        dados.ncsAbertas.slice(0, 5).map(function (n) { return esc(n.item) + ' — ' + esc(n.descricao); }).join('<br>') +
        (dados.ncsAbertas.length > 5 ? '<br>…' : '') + '</div>';
    }

    html += '<div id="msg"></div>' +
      '<div class="campo"><label>Qual verificação do dia?</label>' +
      htmlOpcoes('verif', pendentesHoje.map(function (v) { return [String(v.verificacao), v.verificacao + 'ª verificação']; }), [String(pendentesHoje[0].verificacao)]) +
      '</div>' +
      '<div class="aviso info" id="progresso">0 de ' + totalItens + ' itens respondidos</div>';

    dados.setores.forEach(function (s) {
      html += '<div class="card" data-setor="' + esc(s.id) + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px">' +
        '<strong>' + esc(s.id + '. ' + s.nome) + '</strong>' +
        '<button type="button" class="opcao" data-tudo-c="' + esc(s.id) + '" style="' + estiloBtn + ';min-width:96px">Tudo C</button></div>';
      s.itens.forEach(function (it) {
        html += '<div class="linha-hist" style="flex-wrap:wrap" data-item="' + it.numero + '">' +
          '<div style="flex:1;min-width:160px"><strong>' + it.numero + '.</strong> ' + esc(it.texto) + '</div>' +
          '<div class="opcoes" data-grupo="item-' + it.numero + '" style="grid-template-columns:repeat(3,56px);gap:6px">' +
          ['C', 'NC', 'SA'].map(function (r) {
            return '<button type="button" class="opcao" data-valor="' + r + '" style="' + estiloBtn + '">' + r + '</button>';
          }).join('') +
          '</div>' +
          '<div data-nc-bloco="' + it.numero + '" hidden style="width:100%;margin-top:10px">' +
          '<div class="campo"><label>Não conformidade</label><textarea data-nc-desc="' + it.numero + '" style="min-height:64px"></textarea></div>' +
          '<div class="campo"><label>Ação imediata</label><textarea data-nc-acao="' + it.numero + '" style="min-height:64px"></textarea></div>' +
          '<div class="campo"><label>Responsável pela ação imediata</label><input data-nc-resp="' + it.numero + '" autocomplete="off"></div>' +
          '</div></div>';
      });
      html += '</div>';
    });

    html += '<div class="campo"><label for="obs">Observação geral (opcional)</label><textarea id="obs"></textarea></div>' +
      '<button class="btn btn-principal" id="btn-salvar">Registrar verificação</button>';
    app.innerHTML = html;

    ligarOpcoes('verif', false);

    function atualizarProgresso() {
      let respondidos = 0;
      let ncs = 0;
      dados.setores.forEach(function (s) {
        s.itens.forEach(function (it) {
          const v = valorOpcao('item-' + it.numero);
          if (v) respondidos++;
          if (v === 'NC') ncs++;
          app.querySelector('[data-nc-bloco="' + it.numero + '"]').hidden = v !== 'NC';
        });
      });
      const el = $('#progresso');
      el.textContent = respondidos + ' de ' + totalItens + ' itens respondidos' + (ncs ? ' · ' + ncs + ' NC' : '');
      el.className = 'aviso ' + (respondidos === totalItens ? (ncs ? 'alerta' : 'ok') : 'info');
    }

    dados.setores.forEach(function (s) {
      s.itens.forEach(function (it) { ligarOpcoes('item-' + it.numero, false, atualizarProgresso); });
    });

    $$('[data-tudo-c]').forEach(function (b) {
      b.addEventListener('click', function () {
        const setor = dados.setores.filter(function (s) { return s.id === b.getAttribute('data-tudo-c'); })[0];
        setor.itens.forEach(function (it) {
          // Não troca um item que já está como NC ou SA
          if (valorOpcao('item-' + it.numero)) return;
          $$('[data-grupo="item-' + it.numero + '"] .opcao').forEach(function (o) {
            o.classList.toggle('marcada', o.getAttribute('data-valor') === 'C');
          });
        });
        atualizarProgresso();
      });
    });

    const botao = $('#btn-salvar');
    botao.addEventListener('click', async function () {
      const respostas = {};
      const ncs = {};
      const faltando = [];
      let erroNc = '';

      dados.setores.forEach(function (s) {
        s.itens.forEach(function (it) {
          const v = valorOpcao('item-' + it.numero);
          if (!v) { faltando.push(it.numero); return; }
          respostas[String(it.numero)] = v;
          if (v === 'NC') {
            const nc = {
              descricao: app.querySelector('[data-nc-desc="' + it.numero + '"]').value.trim(),
              acao_imediata: app.querySelector('[data-nc-acao="' + it.numero + '"]').value.trim(),
              resp_acao_imediata: app.querySelector('[data-nc-resp="' + it.numero + '"]').value.trim()
            };
            if (!erroNc && (!nc.descricao || !nc.acao_imediata || !nc.resp_acao_imediata)) {
              erroNc = 'Item ' + it.numero + ': preencha a não conformidade, a ação imediata e o responsável.';
            }
            ncs[String(it.numero)] = nc;
          }
        });
      });

      if (faltando.length) {
        $('#msg').innerHTML = aviso('erro', 'Faltam ' + faltando.length + ' item(ns) sem resposta: ' + faltando.slice(0, 12).join(', ') + (faltando.length > 12 ? '…' : '') + '.');
        window.scrollTo(0, 0);
        return;
      }
      if (erroNc) { $('#msg').innerHTML = aviso('erro', erroNc); window.scrollTo(0, 0); return; }

      travarBotao(botao, 'Registrando…');
      try {
        const r = await enviarRegistro('registrarHigiene', {
          id_modelo: idModelo,
          id_ativo: p.id_ativo,
          verificacao: Number(valorOpcao('verif')),
          hora_inicio: horaInicio,
          respostas: respostas,
          ncs: ncs,
          observacao: $('#obs').value,
          id_cliente: idCliente
        });
        if (r.guardado) {
          toast('Sem internet: verificação guardada no celular. Será enviada sozinha.', 'ok');
        } else if (r.dados.duplicado) {
          toast('Esta verificação já tinha sido enviada.', 'ok');
        } else {
          const t = r.dados.monitoramento.totais;
          const abertas = r.dados.monitoramento.ncsAbertas;
          toast('Registrada: ' + t.C + ' C · ' + t.NC + ' NC · ' + t.SA + ' SA' + (abertas.length ? ' · ' + abertas.join(', ') + ' aberta(s)' : ''), t.NC ? 'erro' : 'ok');
        }
        irRaiz('inicio');
      } catch (e) {
        destravarBotao(botao);
        $('#msg').innerHTML = aviso('erro', e.message);
        window.scrollTo(0, 0);
      }
    });
  };

  // =================================================================
  // TELA: HISTÓRICO
  // =================================================================

  TELAS.historico = async function () {
    carregando();
    const lista = await api('meuHistorico', { dias: 30 });
    const fila = lerFila();

    let html = '<h1>Meu histórico</h1><p class="sub">Últimos 30 dias</p>';

    if (fila.length) {
      html += '<div class="card"><strong>Guardados no celular (' + fila.length + ')</strong>' +
        fila.map(function (item) {
          const d = item.dados;
          const titulo = item.acao === 'registrarTemperatura'
            ? 'Temperatura ' + String(d.temperatura).replace('.', ',') + ' °C'
            : item.acao === 'registrarRecebimento'
              ? 'Recebimento ' + String(d.produto || '').toUpperCase()
              : item.acao === 'registrarHigiene'
                ? (d.id_modelo === 'BPF_PRODUCAO' ? 'BPF ' : 'Monitoramento ') + d.verificacao + 'ª verificação'
                : 'Higienização ' + (d.tipo === 'BAU' ? 'baú' : 'cabine');
          return '<div class="linha-hist"><div>' + esc(titulo) + '<div class="quando">' + esc(new Date(item.guardado_em).toLocaleString('pt-BR')) + '</div></div>' +
            '<span class="etiqueta pendente">Não enviado</span></div>';
        }).join('') + '</div>';
    }

    if (!lista.length) {
      html += aviso('info', 'Nenhum registro nos últimos 30 dias.');
    } else {
      html += '<div class="card">' + lista.map(function (r) {
        let titulo;
        if (r.id_modelo === 'TEMP_VEICULO') {
          titulo = 'Temperatura ' + (r.turno === 'MANHA' ? 'manhã' : 'tarde') + ' · ' + String(r.valor_num).replace('.', ',') + ' °C';
        } else if (r.id_modelo === 'MON_HIGIENE' || r.id_modelo === 'BPF_PRODUCAO') {
          const t = r.valores.totais || {};
          titulo = (r.id_modelo === 'BPF_PRODUCAO' ? 'BPF ' : 'Monitoramento ') + (r.valores.verificacao || r.turno) + 'ª verificação · ' + (t.C || 0) + ' C · ' + (t.NC || 0) + ' NC · ' + (t.SA || 0) + ' SA';
        } else if (r.id_modelo === 'COC_TEMP') {
          titulo = 'Cocção ' + (r.valores.preparacao || '') + ' · ' + String(r.valor_num).replace('.', ',') + ' °C' +
            (r.valores.encerramento ? ' (encerrada)' : r.valores.numero_medicao > 1 ? ' (' + r.valores.numero_medicao + 'ª medição)' : '');
        } else if (r.id_modelo === 'REC_MP') {
          titulo = 'Recebimento ' + (r.valores.produto || '') +
            (r.valor_num !== null ? ' · ' + String(r.valor_num).replace('.', ',') + ' °C' : '') +
            (r.valores.destino === 'SEGREGADO' ? ' · segregado' : '');
        } else {
          titulo = 'Higienização ' + (r.valores.tipo === 'BAU' ? 'baú' : 'cabine') + (r.valores.motivo === 'EXTRA' ? ' (extra)' : r.valores.motivo === 'REINSPECAO' ? ' (reinspeção)' : '');
        }
        const classe = String(r.status).toLowerCase().replace('aguardando_verificacao', 'aguardando').replace('remedir', 'pendente').replace('importado', 'substituido');
        return '<div class="linha-hist"><div>' + esc(titulo) +
          '<div class="quando">' + esc(dataBR(r.data_ref)) + (horaBR(r.carimbo_servidor) ? ' · ' + esc(horaBR(r.carimbo_servidor)) : '') + '</div></div>' +
          '<span class="etiqueta ' + esc(classe) + '">' + esc(NOMES_STATUS[r.status] || r.status) + '</span></div>';
      }).join('') + '</div>';
    }

    app.innerHTML = html;
  };

  // =================================================================
  // TELA: APROVAÇÕES (Admin)
  // =================================================================

  TELAS.aprovacoes = async function () {
    carregando();
    const [pendentes, pessoas] = await Promise.all([api('listarPendentes'), api('listarNomesLogin')]);
    const ativos = pessoas.filter(function (u) { return u.status === 'ATIVO'; });

    let html = '<h1>Aprovar cadastros</h1><div id="msg"></div>';

    if (!pendentes.length) {
      html += aviso('ok', 'Nenhum cadastro aguardando aprovação.');
    }

    pendentes.forEach(function (u, i) {
      const v = u.veiculos[0];
      html += '<div class="card" data-card="' + i + '">' +
        '<strong style="font-size:19px">' + esc(u.nome) + '</strong>' +
        '<div class="sub" style="margin:4px 0 12px">' + esc(u.departamento) + ' · ' + esc(u.unidade) +
        (u.telefone ? ' · ' + esc(u.telefone) : '') + '</div>';

      if (v && v.tipo === 'AREA') {
        html += '<div class="aviso info">Área: <strong>' + esc(v.descricao || v.id_ativo) + '</strong></div>';
      } else if (v) {
        html += '<div class="aviso ' + (v.veiculo_novo ? 'info' : 'alerta') + '">' +
          (v.veiculo_novo ? 'Veículo novo: ' : 'Vinculado a veículo já cadastrado: ') +
          '<strong>' + esc(v.placa) + '</strong> ' + esc([v.marca, v.modelo].filter(Boolean).join(' ')) + '</div>';
        if (v.veiculo_novo) {
          html += '<div class="campo"><label>Controles do veículo</label>' + htmlOpcoes('controles-' + i, CONTROLES, v.controles) + '</div>' +
            '<div class="campo" data-carga="' + i + '"' + (v.controles.indexOf('TEMP_VEICULO') === -1 ? ' hidden' : '') + '><label>Tipo de carga</label>' +
            htmlOpcoes('carga-' + i, TIPOS_CARGA, [v.tipo_carga || 'CONGELADO']) + '</div>';
        }
      }

      html += '<button class="btn btn-principal" data-aprovar="' + i + '">Aprovar</button>' +
        '<div data-recusa="' + i + '" hidden style="margin-top:12px"><div class="campo"><label>Motivo da recusa</label><textarea data-motivo="' + i + '"></textarea></div>' +
        '<button class="btn btn-perigo" data-confirmar-recusa="' + i + '">Confirmar recusa</button></div>' +
        '<button class="btn-link" data-recusar="' + i + '">Recusar</button>' +
        '</div>';
    });

    html += '<h2>PIN temporário</h2>' +
      '<div class="card"><p class="sub">Para quem esqueceu o PIN. A pessoa entra com ele e cria um novo.</p>' +
      '<div class="campo"><select id="pessoa-pin"><option value="">Escolha a pessoa…</option>' +
      ativos.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.nome) + '</option>'; }).join('') +
      '</select></div>' +
      '<button class="btn btn-secundario" id="btn-gerar-pin">Gerar PIN temporário</button>' +
      '<div id="pin-gerado"></div></div>';

    app.innerHTML = html;

    pendentes.forEach(function (u, i) {
      const v = u.veiculos[0];
      if (v && v.veiculo_novo) {
        ligarOpcoes('controles-' + i, true, function () {
          app.querySelector('[data-carga="' + i + '"]').hidden = valoresOpcoes('controles-' + i).indexOf('TEMP_VEICULO') === -1;
        });
        ligarOpcoes('carga-' + i, false);
      }

      app.querySelector('[data-aprovar="' + i + '"]').addEventListener('click', async function (ev) {
        const botao = ev.currentTarget;
        const dados = { id_usuario: u.id_usuario };
        if (v && v.veiculo_novo) {
          const controles = valoresOpcoes('controles-' + i);
          dados.ajustesVeiculo = {
            id_ativo: v.id_ativo,
            controles: controles,
            tipo_carga: controles.indexOf('TEMP_VEICULO') !== -1 ? valorOpcao('carga-' + i) : ''
          };
        }
        travarBotao(botao, 'Aprovando…');
        try {
          await api('aprovarCadastro', dados);
          toast(primeiroNome(u.nome) + ' aprovado(a).', 'ok');
          render();
        } catch (e) {
          destravarBotao(botao);
          $('#msg').innerHTML = aviso('erro', e.message);
          window.scrollTo(0, 0);
        }
      });

      app.querySelector('[data-recusar="' + i + '"]').addEventListener('click', function (ev) {
        app.querySelector('[data-recusa="' + i + '"]').hidden = false;
        ev.currentTarget.hidden = true;
      });

      app.querySelector('[data-confirmar-recusa="' + i + '"]').addEventListener('click', async function (ev) {
        const botao = ev.currentTarget;
        travarBotao(botao, 'Recusando…');
        try {
          await api('recusarCadastro', { id_usuario: u.id_usuario, motivo: app.querySelector('[data-motivo="' + i + '"]').value });
          toast('Cadastro recusado.');
          render();
        } catch (e) {
          destravarBotao(botao);
          $('#msg').innerHTML = aviso('erro', e.message);
          window.scrollTo(0, 0);
        }
      });
    });

    $('#btn-gerar-pin').addEventListener('click', async function (ev) {
      const botao = ev.currentTarget;
      const id = $('#pessoa-pin').value;
      if (!id) { $('#pin-gerado').innerHTML = aviso('erro', 'Escolha a pessoa.'); return; }
      travarBotao(botao, 'Gerando…');
      try {
        const r = await api('gerarPinTemporario', { id_usuario: id });
        $('#pin-gerado').innerHTML = '<div class="aviso ok" style="text-align:center">PIN temporário:<br><strong style="font-size:36px;letter-spacing:8px">' + esc(r.pinTemporario) + '</strong><br>Passe para a pessoa. Ela vai criar um PIN novo ao entrar.</div>';
      } catch (e) {
        $('#pin-gerado').innerHTML = aviso('erro', e.message);
      } finally {
        destravarBotao(botao);
      }
    });
  };

  // =================================================================
  // TELA: PESSOAS E ACESSOS (Admin)
  // =================================================================

  // =================================================================
  // TELA: MENU (atalhos, OS e equipe por setor)
  // =================================================================

  TELAS.menu = async function () {
    const u = (estado.sessao && estado.sessao.usuario) || {};
    const ehAdmin = !!(u.perfis && u.perfis.indexOf('ADMIN') !== -1);

    let html = '<h1>Menu</h1>' +
      '<p class="sub">' + esc(u.nome || '') + '</p>' +
      '<h2>Atalhos</h2>' +
      '<button class="cartao-controle feito" id="menu-os">' +
      '<div class="info"><div class="titulo">Ordem de Serviço</div>' +
      '<div class="detalhe">Abrir uma OS de manutenção (abre o app de OS)</div></div>' +
      '<span class="seta">↗</span></button>' +
      '<button class="cartao-controle feito" id="menu-historico">' +
      '<div class="info"><div class="titulo">Meu histórico</div>' +
      '<div class="detalhe">Os seus registros dos últimos 30 dias</div></div>' +
      '<span class="seta">›</span></button>' +
      '<button class="cartao-controle feito" id="menu-pin">' +
      '<div class="info"><div class="titulo">Trocar meu PIN</div>' +
      '<div class="detalhe">Escolha um novo PIN de 4 números</div></div>' +
      '<span class="seta">›</span></button>' +
      (ehAdmin ? '<h2>Equipe por setor</h2><div id="menu-equipe"><div class="carregando"><div class="giro"></div>Carregando…</div></div>' : '') +
      '<button class="btn btn-secundario" id="menu-sair" style="margin-top:24px">Sair</button>';

    app.innerHTML = html;

    $('#menu-os').addEventListener('click', abrirOs);
    $('#menu-historico').addEventListener('click', function () { ir('historico'); });
    $('#menu-pin').addEventListener('click', function () { ir('trocarPin', { obrigatorio: false }); });
    $('#menu-sair').addEventListener('click', sair);

    if (!ehAdmin) return;

    const alvo = $('#menu-equipe');
    try {
      const dados = await api('listarAcessos');
      const setores = {};
      dados.pessoas.forEach(function (p) {
        const deps = p.departamentos && p.departamentos.length ? p.departamentos : ['SEM_SETOR'];
        deps.forEach(function (d) {
          (setores[d] = setores[d] || []).push(p);
        });
      });
      const ordem = Object.keys(NOMES_SETOR).concat(['SEM_SETOR']).filter(function (d) { return setores[d]; })
        .concat(Object.keys(setores).filter(function (d) { return !NOMES_SETOR[d] && d !== 'SEM_SETOR'; }));

      if (!ordem.length) { alvo.innerHTML = aviso('info', 'Nenhuma pessoa ativa cadastrada.'); return; }

      alvo.innerHTML = ordem.map(function (d) {
        const nome = NOMES_SETOR[d] || (d === 'SEM_SETOR' ? 'Sem setor' : d);
        return '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center">' +
          '<strong>' + esc(nome) + '</strong><span class="etiqueta aguardando">' + setores[d].length + '</span></div>' +
          setores[d].map(function (p) {
            const perfis = (p.perfis || []).filter(function (x) { return x !== 'OPERADOR'; });
            return '<div class="linha-hist"><div>' + esc(p.nome) +
              '<div class="quando">' + esc((p.unidades || []).join(', ') || '—') + ' · ' +
              p.acessos.length + (p.acessos.length === 1 ? ' controle' : ' controles') +
              (perfis.length ? ' · ' + esc(perfis.join(', ').toLowerCase()) : '') + '</div></div></div>';
          }).join('') + '</div>';
      }).join('') +
        '<button class="btn btn-secundario" id="menu-acessos">Gerenciar acessos</button>';
      $('#menu-acessos').addEventListener('click', function () { ir('acessos'); });
    } catch (e) {
      alvo.innerHTML = aviso('erro', e.message || 'Não foi possível carregar a equipe.');
    }
  };

  TELAS.acessos = async function () {
    carregando();
    const dados = await api('listarAcessos');
    const grupos = [];
    dados.opcoes.forEach(function (o) {
      let g = grupos.filter(function (x) { return x.nome === o.grupo; })[0];
      if (!g) { g = { nome: o.grupo, opcoes: [] }; grupos.push(g); }
      g.opcoes.push(o);
    });

    function chave(idAtivo, controle) { return idAtivo + '|' + controle; }
    function rotuloAcesso(a) {
      const o = dados.opcoes.filter(function (x) { return x.id_ativo === a.id_ativo && x.controle === a.controle; })[0];
      return o ? o.rotulo : a.controle + ' — ' + a.id_ativo;
    }

    let html = '<h1>Pessoas e acessos</h1>' +
      '<p class="sub">Toque na pessoa e ligue ou desligue os controles. Cada toque já salva.</p>' +
      '<div class="campo"><input id="busca" type="search" placeholder="Buscar nome" autocomplete="off"></div>';

    dados.pessoas.forEach(function (p, i) {
      html += '<div class="card" data-pessoa="' + i + '" data-nome="' + esc(p.nome) + '">' +
        '<button type="button" class="item-lista" data-abrir="' + i + '" style="border:none;padding:0;min-height:0">' +
        '<span><strong>' + esc(p.nome) + '</strong><br><span class="sub" style="font-size:14px">' +
        esc([p.departamentos.join(', '), p.unidades.join(', ')].filter(Boolean).join(' · ')) + '</span></span>' +
        '<span class="seta">›</span></button>' +
        '<div class="sub" style="font-size:14px;margin:8px 0 0" data-resumo="' + i + '">' +
        (p.acessos.length ? esc(p.acessos.map(rotuloAcesso).join(' · ')) : 'Nenhum controle ligado') + '</div>' +
        '<div data-painel="' + i + '" hidden style="margin-top:12px">' +
        grupos.map(function (g) {
          return '<div class="campo"><label>' + esc(g.nome) + '</label><div class="opcoes">' +
            g.opcoes.map(function (o) {
              const ligado = p.acessos.some(function (a) { return a.id_ativo === o.id_ativo && a.controle === o.controle; });
              return '<button type="button" class="opcao' + (ligado ? ' marcada' : '') + '" data-p="' + i + '" data-k="' + esc(chave(o.id_ativo, o.controle)) + '" style="font-size:15px">' +
                esc(o.rotulo.split(' — ')[1] || o.rotulo) + '</button>';
            }).join('') +
            '</div></div>';
        }).join('') +
        '</div></div>';
    });

    app.innerHTML = html;

    $('#busca').addEventListener('input', function () {
      const termo = $('#busca').value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      $$('[data-pessoa]').forEach(function (c) {
        const nome = c.getAttribute('data-nome').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        c.style.display = nome.indexOf(termo) !== -1 ? '' : 'none';
      });
    });

    $$('[data-abrir]').forEach(function (b) {
      b.addEventListener('click', function () {
        const painel = app.querySelector('[data-painel="' + b.getAttribute('data-abrir') + '"]');
        painel.hidden = !painel.hidden;
      });
    });

    $$('.opcao[data-k]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (b.disabled) return;
        const i = Number(b.getAttribute('data-p'));
        const pessoa = dados.pessoas[i];
        const partes = b.getAttribute('data-k').split('|');
        const ligar = !b.classList.contains('marcada');

        b.disabled = true;
        b.classList.toggle('marcada', ligar);
        try {
          await api('definirAcesso', { id_usuario: pessoa.id, id_ativo: partes[0], controle: partes[1], ligar: ligar });
          if (ligar) {
            pessoa.acessos.push({ id_ativo: partes[0], controle: partes[1] });
          } else {
            pessoa.acessos = pessoa.acessos.filter(function (a) { return !(a.id_ativo === partes[0] && a.controle === partes[1]); });
          }
          app.querySelector('[data-resumo="' + i + '"]').textContent =
            pessoa.acessos.length ? pessoa.acessos.map(rotuloAcesso).join(' · ') : 'Nenhum controle ligado';
          toast(primeiroNome(pessoa.nome) + ': ' + (ligar ? 'ligado ' : 'desligado ') + rotuloAcesso({ id_ativo: partes[0], controle: partes[1] }), 'ok');
        } catch (e) {
          b.classList.toggle('marcada', !ligar);   // desfaz
          toast(e.message, 'erro');
        } finally {
          b.disabled = false;
        }
      });
    });
  };

  // =================================================================
  // TELA: FILA DE VERIFICAÇÃO (Qualidade)
  // =================================================================

  TELAS.fila = async function () {
    carregando();
    const fila = await api('filaVerificacao');

    let html = '<h1>Fila de verificação</h1>' +
      '<p class="sub">C aceita e fecha o registro. N/C abre uma não conformidade.</p><div id="msg"></div>';
    if (!fila.length) {
      app.innerHTML = html + aviso('ok', 'Nada aguardando verificação.');
      return;
    }

    fila.forEach(function (r, i) {
      html += '<div class="card" data-reg="' + i + '">' +
        '<div style="display:flex;justify-content:space-between;gap:10px"><strong>' + esc(r.modelo) + '</strong>' +
        '<span class="etiqueta aguardando">' + esc(dataBR(r.data_ref)) + '</span></div>' +
        '<div style="font-size:18px;margin:6px 0">' + esc(r.titulo) + '</div>' +
        '<div class="sub" style="margin:0 0 6px;font-size:14px">' + esc(r.detalhe) + '</div>' +
        '<div class="sub" style="margin:0;font-size:14px">' + esc(r.ativo) + ' · ' + esc(r.id_unidade) + ' · ' + esc(r.autor_nome) + (r.carimbo ? ' · ' + esc(r.carimbo) : '') + '</div>' +
        (r.observacao ? '<div class="aviso info" style="margin:10px 0 0">Obs.: ' + esc(r.observacao) + '</div>' : '') +
        (r.evidencia_url ? '<a href="' + esc(r.evidencia_url) + '" target="_blank" rel="noopener" class="btn-link" style="display:block;text-align:left">Ver foto</a>' : '') +
        (r.reinspecao_de ? '<div class="aviso alerta" style="margin:10px 0 0">Reinspeção da ' + esc(r.reinspecao_de) + '</div>' : '');

      if (r.proprio) {
        html += aviso('alerta', 'Você registrou este item. Outra pessoa da Qualidade precisa verificar.');
      } else {
        html += '<div class="opcoes" style="margin-top:12px">' +
          '<button type="button" class="btn btn-principal" data-c="' + i + '" style="margin:0">C — Conforme</button>' +
          '<button type="button" class="btn btn-perigo" data-nc="' + i + '" style="margin:0">N/C</button></div>' +
          '<div data-nc-form="' + i + '" hidden style="margin-top:12px">' +
          '<div class="campo"><label>Não conformidade</label><textarea data-desc="' + i + '" style="min-height:64px"></textarea></div>' +
          '<div class="campo"><label>Ação imediata</label><textarea data-ai="' + i + '" style="min-height:64px"></textarea></div>' +
          '<div class="campo"><label>Responsável pela ação imediata</label><input data-resp="' + i + '" autocomplete="off" value="' + esc(r.autor_nome) + '"></div>' +
          '<button type="button" class="btn btn-perigo" data-confirmar-nc="' + i + '">Abrir não conformidade</button></div>' +
          '<div data-erro="' + i + '"></div>';
      }
      html += '</div>';
    });
    app.innerHTML = html;

    async function decidir(i, resultado, botao) {
      const r = fila[i];
      const dados = { id_registro: r.id_registro, resultado: resultado };
      if (resultado === 'NC') {
        dados.descricao = app.querySelector('[data-desc="' + i + '"]').value;
        dados.acao_imediata = app.querySelector('[data-ai="' + i + '"]').value;
        dados.resp_acao_imediata = app.querySelector('[data-resp="' + i + '"]').value;
      }
      travarBotao(botao, 'Salvando…');
      try {
        const res = await api('verificarRegistro', dados);
        toast(resultado === 'C' ? 'Verificado: Conforme.' : 'NC aberta: ' + res.nc.id_nc, resultado === 'C' ? 'ok' : 'erro');
        render();
      } catch (e) {
        destravarBotao(botao);
        app.querySelector('[data-erro="' + i + '"]').innerHTML = aviso('erro', e.message);
      }
    }

    $$('[data-c]').forEach(function (b) {
      b.addEventListener('click', function () { decidir(Number(b.getAttribute('data-c')), 'C', b); });
    });
    $$('[data-nc]').forEach(function (b) {
      b.addEventListener('click', function () {
        const form = app.querySelector('[data-nc-form="' + b.getAttribute('data-nc') + '"]');
        form.hidden = !form.hidden;
      });
    });
    $$('[data-confirmar-nc]').forEach(function (b) {
      b.addEventListener('click', function () { decidir(Number(b.getAttribute('data-confirmar-nc')), 'NC', b); });
    });
  };

  // =================================================================
  // TELA: NÃO CONFORMIDADES (Qualidade)
  // =================================================================

  const NOMES_ETAPA = {
    VERIFICAR_AI: 'Verificar ação imediata',
    PLANEJAR: 'Planejar ação',
    EFICACIA: 'Avaliar eficácia',
    ENCERRADA: 'Encerrada'
  };

  TELAS.ncs = async function (p) {
    carregando();
    const situacao = p.situacao || 'ABERTAS';
    const lista = await api('listarNcs', { situacao: situacao });

    let html = '<h1>Não conformidades</h1>' +
      htmlOpcoes('situacao', [['ABERTAS', 'Abertas'], ['ENCERRADAS', 'Encerradas (60 dias)']], [situacao]) +
      '<div style="height:12px"></div>';

    if (!lista.length) {
      html += aviso('ok', situacao === 'ABERTAS' ? 'Nenhuma NC aberta.' : 'Nenhuma NC encerrada nos últimos 60 dias.');
    }

    lista.forEach(function (n, i) {
      const classe = n.prazo_vencido ? 'nc' : (n.etapa === 'ENCERRADA' ? 'feito' : '');
      html += '<button class="cartao-controle ' + classe + '" data-abrir-nc="' + i + '" style="align-items:flex-start">' +
        '<div class="info"><div class="titulo">' + esc(n.id_nc) + ' · ' + esc(n.origem) + ' · ' + esc(n.id_unidade) + '</div>' +
        '<div style="font-size:15px;margin:4px 0">' + esc(n.item) + '</div>' +
        '<div class="detalhe">' + esc(n.descricao) + '</div>' +
        '<div class="detalhe">Aberta em ' + esc(dataBR(n.aberta_em)) +
        (n.prazo ? ' · prazo ' + esc(dataBR(n.prazo)) + (n.prazo_vencido ? ' (VENCIDO)' : '') : '') + '</div></div>' +
        '<span class="etiqueta ' + (n.etapa === 'ENCERRADA' ? 'feito' : (n.prazo_vencido ? 'nc' : 'pendente')) + '">' + esc(NOMES_ETAPA[n.etapa] || n.etapa) + '</span></button>';
    });
    app.innerHTML = html;

    ligarOpcoes('situacao', false, function () {
      estado.pilha[estado.pilha.length - 1].params = { situacao: valorOpcao('situacao') };
      render();
    });
    $$('[data-abrir-nc]').forEach(function (b) {
      b.addEventListener('click', function () { ir('nc', { nc: lista[Number(b.getAttribute('data-abrir-nc'))] }); });
    });
  };

  // =================================================================
  // TELA: UMA NC (detalhe + próxima etapa)
  // =================================================================

  TELAS.nc = function (p) {
    const n = p.nc;
    const linha = function (rotulo, valor) {
      return valor ? '<div class="linha-hist"><div class="quando" style="min-width:120px">' + esc(rotulo) + '</div><div style="flex:1;text-align:right">' + esc(valor) + '</div></div>' : '';
    };

    let html = '<h1>' + esc(n.id_nc) + '</h1>' +
      '<p class="sub">' + esc(n.origem) + ' · ' + esc(n.id_unidade) + ' · aberta em ' + esc(dataBR(n.aberta_em)) + ' por ' + esc(n.aberta_por) + '</p>' +
      '<div class="card">' +
      linha('Item', n.item) +
      linha('Não conformidade', n.descricao) +
      linha('Ação imediata', n.acao_imediata + (n.resp_acao_imediata ? ' (' + n.resp_acao_imediata + ')' : '')) +
      linha('Verificação AI', n.verificacao_ai === 'A' ? 'Atendida' : '') +
      linha('Ação planejada', n.acao_planejada ? n.acao_planejada + ' (' + n.resp_acao_planejada + ')' : '') +
      linha('Prazo', n.prazo ? dataBR(n.prazo) + (n.prazo_vencido ? ' — VENCIDO' : '') : '') +
      linha('Eficácia', n.eficacia === 'E' ? 'Eficiente' : '') +
      linha('Encerrada em', n.encerrada_em ? dataBR(n.encerrada_em) : '') +
      '</div><div id="msg"></div>';

    const campoPlano = function (prefixo) {
      return '<div class="campo"><label>' + prefixo + 'Ação planejada</label><textarea id="plano"></textarea></div>' +
        '<div class="campo"><label>Responsável</label><input id="resp-plano" autocomplete="off"></div>' +
        '<div class="campo"><label>Prazo</label><input id="prazo" type="date" min="' + hojeISO() + '"></div>';
    };

    if (n.etapa === 'VERIFICAR_AI') {
      html += '<h2>Verificação da ação imediata</h2>' +
        htmlOpcoes('res', [['A', 'A — Atendida'], ['NA', 'NA — Não Atendida']]) +
        '<div id="bloco-na" hidden style="margin-top:12px">' +
        '<div class="campo"><label>Nova ação imediata</label><textarea id="nova-ai"></textarea></div>' +
        '<div class="campo"><label>Responsável</label><input id="resp-ai" autocomplete="off"></div></div>';
    } else if (n.etapa === 'PLANEJAR') {
      html += '<h2>Ação planejada</h2>' + campoPlano('');
    } else if (n.etapa === 'EFICACIA') {
      html += '<h2>Eficácia da ação planejada</h2>';
      if (n.exige_reinspecao && n.reinspecao_status !== 'CONFORME') {
        html += aviso('alerta', n.id_reinspecao
          ? 'A reinspeção (' + n.id_reinspecao + ') ainda não foi verificada como C na fila.'
          : 'Esta NC exige reinspeção: o motorista precisa refazer a higienização pelo app (cartão "Refazer").');
      }
      html += htmlOpcoes('res', [['E', 'E — Eficiente'], ['NE', 'NE — Não Eficiente']]) +
        '<div id="bloco-ne" hidden style="margin-top:12px">' + campoPlano('Nova ') + '</div>';
    }

    if (n.etapa !== 'ENCERRADA') {
      html += '<button class="btn btn-principal" id="btn-salvar">Salvar</button>';
    }
    app.innerHTML = html;
    if (n.etapa === 'ENCERRADA') return;

    if (n.etapa === 'VERIFICAR_AI') ligarOpcoes('res', false, function () { $('#bloco-na').hidden = valorOpcao('res') !== 'NA'; });
    if (n.etapa === 'EFICACIA') ligarOpcoes('res', false, function () { $('#bloco-ne').hidden = valorOpcao('res') !== 'NE'; });

    const botao = $('#btn-salvar');
    botao.addEventListener('click', async function () {
      const dados = { id_nc: n.id_nc, etapa: n.etapa };
      if (n.etapa === 'VERIFICAR_AI' || n.etapa === 'EFICACIA') {
        dados.resultado = valorOpcao('res');
        if (!dados.resultado) { $('#msg').innerHTML = aviso('erro', 'Escolha uma opção.'); return; }
      }
      if (n.etapa === 'VERIFICAR_AI' && dados.resultado === 'NA') {
        dados.nova_acao_imediata = $('#nova-ai').value;
        dados.resp_acao_imediata = $('#resp-ai').value;
      }
      if (n.etapa === 'PLANEJAR' || (n.etapa === 'EFICACIA' && dados.resultado === 'NE')) {
        dados.acao_planejada = $('#plano').value;
        dados.resp_acao_planejada = $('#resp-plano').value;
        dados.prazo = $('#prazo').value;
      }

      travarBotao(botao, 'Salvando…');
      try {
        const r = await api('avancarNc', dados);
        toast(r.status === 'ENCERRADA' ? n.id_nc + ' encerrada.' : n.id_nc + ': ' + (NOMES_ETAPA[r.etapa] || r.etapa) + '.', 'ok');
        voltar();
      } catch (e) {
        destravarBotao(botao);
        $('#msg').innerHTML = aviso('erro', e.message);
        window.scrollTo(0, 0);
      }
    });
  };

  // =================================================================
  // TELA: GERAR PDF (Qualidade)
  // =================================================================

  const gerados = [];   // PDFs gerados nesta sessão do app

  TELAS.pdf = async function () {
    carregando();
    const fichas = await api('listarFichasPdf');
    const mesAtual = hojeISO().slice(0, 7);

    const grupos = [];
    fichas.forEach(function (f, i) {
      let g = grupos.filter(function (x) { return x.nome === f.grupo; })[0];
      if (!g) { g = { nome: f.grupo, itens: [] }; grupos.push(g); }
      g.itens.push({ f: f, i: i });
    });

    let html = '<h1>PDF das fichas</h1>' +
      '<p class="sub">Para apresentar à Vigilância, a clientes ou em auditorias. Escolha a ficha e o mês. O PDF fica salvo no Drive, na pasta "Controle Operacional — PDFs".</p>' +
      '<div id="msg"></div>' +
      '<div class="campo"><label for="ficha">Ficha</label><select id="ficha">' +
      grupos.map(function (g) {
        return '<optgroup label="' + esc(g.nome) + '">' +
          g.itens.map(function (x) { return '<option value="' + x.i + '">' + esc(x.f.rotulo) + '</option>'; }).join('') +
          '</optgroup>';
      }).join('') +
      '</select></div>' +
      '<div class="campo"><label for="mes">Mês</label><input id="mes" type="month" value="' + mesAtual + '" max="' + mesAtual + '"></div>' +
      '<button class="btn btn-principal" id="btn-gerar">Gerar PDF</button>' +
      '<div id="lista-gerados"></div>';
    app.innerHTML = html;

    function desenharGerados() {
      $('#lista-gerados').innerHTML = gerados.length
        ? '<h2>Gerados agora</h2><div class="card">' + gerados.map(function (g) {
          return '<div class="linha-hist"><div>' + esc(g.nome) +
            '<div class="quando">' + g.registros + ' registro(s) · ' + g.ncs + ' NC(s)</div></div>' +
            '<a class="btn btn-secundario" style="width:auto;margin:0;padding:10px 14px" href="' + esc(g.url) + '" target="_blank" rel="noopener">Abrir</a></div>';
        }).join('') + '</div>'
        : '';
    }
    desenharGerados();

    const botao = $('#btn-gerar');
    botao.addEventListener('click', async function () {
      const f = fichas[Number($('#ficha').value)];
      const periodo = $('#mes').value;
      if (!f || !periodo) { $('#msg').innerHTML = aviso('erro', 'Escolha a ficha e o mês.'); return; }

      travarBotao(botao, 'Gerando PDF… (pode levar alguns segundos)');
      $('#msg').innerHTML = '';
      try {
        const r = await api('gerarPdf', { ficha: f.ficha, id_ativo: f.id_ativo, periodo: periodo });
        gerados.unshift(r);
        desenharGerados();
        $('#msg').innerHTML = r.registros
          ? aviso('ok', 'PDF pronto: ' + r.nome)
          : aviso('alerta', 'PDF gerado, mas não há registros desta ficha em ' + periodo + '. Confira a ficha e o mês.');
      } catch (e) {
        $('#msg').innerHTML = aviso('erro', e.message);
      } finally {
        destravarBotao(botao);
      }
    });
  };

  // =================================================================
  // INÍCIO DO APP
  // =================================================================

  if (estado.sessao && estado.sessao.token) {
    if (estado.sessao.pinTemporario) irRaiz('trocarPin', { obrigatorio: true });
    else irRaiz('inicio');
  } else {
    irRaiz('login');
  }
})();
