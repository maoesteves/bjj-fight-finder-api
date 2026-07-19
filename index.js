const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function normalizar(nome) {
  return nome.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function corresponde(buscado, texto) {
  const b = normalizar(buscado);
  const t = normalizar(texto);
  if (!b || !t) return false;
  if (t.includes(b)) return true;
  const pb = b.split(' ').filter(w => w.length > 2);
  if (pb.length === 0) return false;
  let acertos = 0;
  for (const p of pb) {
    if (t.includes(p)) acertos++;
  }
  return acertos >= Math.min(pb.length, Math.ceil(pb.length * 0.5));
}

app.post('/buscar-lutas', async (req, res) => {
  const { url, names } = req.body;
  if (!url || !names || names.length === 0) {
    return res.status(400).json({ error: 'URL do torneio e nomes dos atletas são obrigatórios' });
  }

  try {
    // Usa Jina AI Reader para renderizar o JavaScript da página
    const jinaUrl = `https://r.jina.ai/${url}`;
    const response = await axios.get(jinaUrl, {
      headers: { 'Accept': 'text/plain', 'Accept-Language': 'pt-BR,pt;q=0.9' },
      timeout: 30000
    });

    let texto = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    const linhas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 5);
    
    let matAtual = '';
    let diaAtual = '';
    const resultados = [];

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];

      // Captura mat/área atual
      const mm = linha.match(/[Mm][Aa][Tt]\s*(\d+)/);
      if (mm && linha.length < 25) { matAtual = `Mat ${mm[1]}`; }

      // Captura o dia
      if (linha.match(/[Dd]ay\s+\d+/)) { diaAtual = linha; }

      // Pula linhas que NÃO são de atletas
      if (linha.match(/^(Winner|Defeated|Vencedor|Derrotado|Filter|Cookies|MANAGE|REJECT|ACCEPT|Home|Mats|Áreas|Live|IBJJF|BJJCOMPSYSTEM|BJJCOMP)/i)) continue;
      if (linha.match(/^(English|Português|By Division|By Team|By Athlete)/i)) continue;
      if (linha.match(/youtube|google|facebook|twitter|instagram|linkedin/i)) continue;

      // Verifica se a linha contém algum nome buscado
      for (const nomeBuscado of names) {
        if (corresponde(nomeBuscado, linha)) {
          resultados.push({
            line: linha.substring(0, 200),
            search_name: nomeBuscado,
            mat: matAtual || '-'
          });
          break;
        }
      }
    }

    // Agrupa por nome buscado e remove duplicatas
    const lutasAgrupadas = {};
    for (const r of resultados) {
      if (!lutasAgrupadas[r.search_name]) lutasAgrupadas[r.search_name] = [];
      const chave = r.line;
      if (!lutasAgrupadas[r.search_name].some(l => l.line === chave)) {
        lutasAgrupadas[r.search_name].push({ line: r.line, mat: r.mat });
      }
    }

    const fights = [];
    for (const [searchName, linhasEncontradas] of Object.entries(lutasAgrupadas)) {
      for (const l of linhasEncontradas) {
        fights.push({
          athlete_name: searchName,
          search_name: searchName,
          match: l.line,
          mat: l.mat,
          day: diaAtual || '-'
        });
      }
    }

    const encontrados = Object.keys(lutasAgrupadas);
    const naoEncontrados = names.filter(n => !encontrados.some(e => corresponde(e, n)));

    res.json({
      total_fights: fights.length,
      total_athletes: encontrados.length,
      not_found: naoEncontrados,
      debug_linhas_total: linhas.length,
      fights: fights
    });

  } catch (error) {
    console.error('Erro:', error.message);
    res.status(500).json({
      error: 'Erro de comunicação com o servidor. Verifique sua conexão e tente novamente.',
      detail: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder API - v7' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BJJ Fight Finder API v7 rodando na porta ${PORT}`);
});
