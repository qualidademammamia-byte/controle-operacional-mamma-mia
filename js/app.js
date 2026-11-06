/**
 * MAMMA MIA CONTROLE OPERACIONAL — js/app.js (v2: Motorista + Estoque)
 * ------------------------------------------------------------------
 * Telas e lógica do app (sem build: a Vercel publica este arquivo direto).
 *
 * TELAS
 *   login · pin · cadastro (primeiro acesso) · aguardando aprovação
 *   trocar PIN · início (painel do motorista e do estoque) · temperatura
 *   higienização · recebimento (v2) · resultado do recebimento (v2)
 *   histórico · aprovações e PIN temporário (Admin)
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
  const ACOES_COM_FILA = ['registrarTemperatura', 'registrarHigienizacao', 'registrarRecebimento'];

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
  btnSair.addEventListener('click', async function () {
    if (lerFila().length && !confirmarSaidaComFila()) return;
    try { await api('logout'); } catch (e) { /* sai mesmo assim */ }
    encerrarSessaoLocal();
    irRaiz('login');
  });

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
    const temMotorista = meus.rotinas.some(function (r) { return r.id_modelo === 'TEMP_VEICULO' || r.id_modelo === 'HIG_VEICULO'; });

    const [painel, painelEst, pendentes] = await Promise.all([
      api('painelMotorista'),
      temEstoque ? api('painelEstoque') : Promise.resolve(null),
      ehAdmin ? api('listarPendentes').catch(function () { return []; }) : Promise.resolve([])
    ]);

    let html = '<h1>Olá, ' + esc(primeiroNome(meus.nome)) + '</h1>' +
      '<p class="sub">' + esc(dataBR(painel.hoje)) +
      (temMotorista ? ' · semana de ' + esc(dataBR(painel.semana.inicio)) + ' a ' + esc(dataBR(painel.semana.fim)) : '') + '</p>';

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

    // Admin
    if (ehAdmin) {
      html += '<button class="cartao-controle ' + (pendentes.length ? '' : 'feito') + '" id="btn-aprovacoes">' +
        '<div class="info"><div class="titulo">Aprovar cadastros</div>' +
        '<div class="detalhe">' + (pendentes.length ? pendentes.length + ' aguardando' : 'Nenhum pendente') + ' · PIN temporário</div></div>' +
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
    } else if (!ehAdmin && !painelEst) {
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
        } else if (r.id_modelo === 'REC_MP') {
          titulo = 'Recebimento ' + (r.valores.produto || '') +
            (r.valor_num !== null ? ' · ' + String(r.valor_num).replace('.', ',') + ' °C' : '') +
            (r.valores.destino === 'SEGREGADO' ? ' · segregado' : '');
        } else {
          titulo = 'Higienização ' + (r.valores.tipo === 'BAU' ? 'baú' : 'cabine') + (r.valores.motivo === 'EXTRA' ? ' (extra)' : r.valores.motivo === 'REINSPECAO' ? ' (reinspeção)' : '');
        }
        const classe = String(r.status).toLowerCase().replace('aguardando_verificacao', 'aguardando');
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
  // INÍCIO DO APP
  // =================================================================

  if (estado.sessao && estado.sessao.token) {
    if (estado.sessao.pinTemporario) irRaiz('trocarPin', { obrigatorio: true });
    else irRaiz('inicio');
  } else {
    irRaiz('login');
  }
})();
