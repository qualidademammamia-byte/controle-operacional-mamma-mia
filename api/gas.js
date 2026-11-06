/**
 * MAMMA MIA CONTROLE OPERACIONAL — api/gas.js (Entrega 4)
 * ------------------------------------------------------------------
 * Proxy da Vercel entre o app (navegador) e o Apps Script.
 *
 * - O navegador chama /api/gas com { acao, token, dados }.
 * - O proxy acrescenta a chave da API (que nunca vai para o navegador)
 *   e repassa para o Apps Script. Isso também evita problemas de CORS.
 * - GET /api/gas faz um "ping": serve para testar no navegador se o
 *   proxy e o Apps Script estão conectados.
 *
 * VARIÁVEIS DE AMBIENTE (Vercel > Settings > Environment Variables)
 *   GAS_URL      URL do app da web do Apps Script (termina em /exec)
 *   GAS_API_KEY  chave gerada pela função gerarChaveApi
 */

const TIMEOUT_MS = 25000;
const TAMANHO_MAX_BYTES = 4 * 1024 * 1024; // limite de corpo das funções da Vercel é 4,5 MB

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const GAS_URL = process.env.GAS_URL;
  const GAS_API_KEY = process.env.GAS_API_KEY;

  if (!GAS_URL || !GAS_API_KEY) {
    return res.status(500).json({
      ok: false,
      erro: { codigo: 'PROXY_SEM_CONFIG', mensagem: 'GAS_URL ou GAS_API_KEY não configuradas na Vercel.' }
    });
  }

  // GET = teste de conexão (ping)
  if (req.method === 'GET') {
    const resposta = await chamarAppsScript(GAS_URL, { acao: 'ping', chave: GAS_API_KEY });
    return res.status(200).json(resposta);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, erro: { codigo: 'METODO_INVALIDO', mensagem: 'Use POST.' } });
  }

  let corpo = req.body;
  if (typeof corpo === 'string') {
    if (corpo.length > TAMANHO_MAX_BYTES) {
      return res.status(413).json({ ok: false, erro: { codigo: 'MUITO_GRANDE', mensagem: 'Envio muito grande. Tire uma foto menor.' } });
    }
    try {
      corpo = JSON.parse(corpo || '{}');
    } catch (e) {
      return res.status(400).json({ ok: false, erro: { codigo: 'JSON_INVALIDO', mensagem: 'Corpo da requisição inválido.' } });
    }
  }
  corpo = corpo || {};

  const acao = typeof corpo.acao === 'string' ? corpo.acao : '';
  if (!/^[a-zA-Z]{2,40}$/.test(acao)) {
    return res.status(400).json({ ok: false, erro: { codigo: 'ACAO_INVALIDA', mensagem: 'Ação inválida.' } });
  }

  const payload = {
    acao: acao,
    token: typeof corpo.token === 'string' ? corpo.token : '',
    dados: corpo.dados && typeof corpo.dados === 'object' ? corpo.dados : {},
    chave: GAS_API_KEY
  };

  const resposta = await chamarAppsScript(GAS_URL, payload);
  return res.status(200).json(resposta);
}

async function chamarAppsScript(url, payload) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TIMEOUT_MS);

  try {
    // O Apps Script responde com um redirecionamento 302; o fetch segue sozinho.
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controle.signal
    });

    const texto = await r.text();
    try {
      return JSON.parse(texto);
    } catch (e) {
      // Normalmente é uma página HTML de erro ou de login do Google
      return {
        ok: false,
        erro: {
          codigo: 'RESPOSTA_INVALIDA',
          mensagem: 'O Apps Script não respondeu em JSON. Confira se a implantação está como "Qualquer pessoa" e se a GAS_URL termina em /exec.'
        }
      };
    }
  } catch (e) {
    const tempoEsgotado = e && e.name === 'AbortError';
    return {
      ok: false,
      erro: {
        codigo: tempoEsgotado ? 'TEMPO_ESGOTADO' : 'SEM_CONEXAO',
        mensagem: tempoEsgotado
          ? 'O servidor demorou para responder. Tente de novo.'
          : 'Não foi possível falar com o servidor. Tente de novo.'
      }
    };
  } finally {
    clearTimeout(timer);
  }
}
