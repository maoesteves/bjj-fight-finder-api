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

function corresponde(buscado, linha) {
  const b = normalizar(buscado);
  const l = normalizar(linha);
  if (!b || !l) return false;
  if (l.includes(b)) return true;
  const pb = b.split(' ').filter(w => w.length > 2);
  if (pb.length === 0) return false;
  let acertos = 0;
  for (const p of pb) {
    if (l.includes(p)) acertos++;
  }
  return acertos >= 1;
}

app.post('/buscar-lutas', async (req, res) => {
  const { url, names } = req.body;
  if (!url || !names || names.length === 0) {
    return res.status(400).json({ error: 'URL e nomes obrigatórios' });
  }
  try {
    const jinaUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;
    console.log('Buscando:', jinaUrl.substring(0, 80));

    const response = await axios.get(jinaUrl, {
      headers: {
        'Accept': 'text/plain',
        'Accept-Language': 'pt-BR,pt;q=0.9'
      },
      timeout: 45000
    });

    let texto = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    const linhas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 3);
    console.log(`Total de linhas: ${linhas.length}`);

    let matAtual = '';
    const lutas = [];

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];

      const mm = linha.match(/[Mm][Aa][Tt]\s*(\d+)/);
      if (mm && linha.length < 30) matAtual = `Mat ${mm[1]}`;

      if (linha.match(/^(Winner|Defeated|Vencedor|Derrotado|Cookies|MANAGE|REJECT|ACCEPT|IBJJF|BJJCOMPSYSTEM|English|Português|By |Filter|Home|Live|Youtube|Day\s+\d|Transmissão|Utilizamos|Acesse|Central|Termos|Política)/i)) continue;
      if (linha.match(/youtube|google|cdn|https?:\/\//i)) continue;
      if (linha.length < 6) continue;

      for (const nomeBuscado of names) {
        if (!corresponde(nomeBuscado, linha)) continue;

        let nomeAtleta = linha.replace(/^\s*\d+\s+/, '').replace(/\s*FIGHT\s+\d+.+$/i, '').trim();
        if (nomeAtleta.length < 4) continue;

        let hora = '';
        for (let j = Math.max(0, i - 10); j < i; j++) {
          const h = linhas[j].match(/(\d{1,2}:\d{2})\s*:\s*(?:FIGHT|LUTA)/i);
          if (h) { hora = h[1]; break; }
        }

        lutas.push({
          athlete_name: nomeAtleta,
          mat: matAtual || '-',
          day: '-',
          time: hora || '-'
        });
        break;
      }
    }

    const vistos = new Set();
    const lutasUnicas = [];
    for (const l of lutas) {
      const chave = `${l.athlete_name}|${l.mat}|${l.time}`;
      if (!vistos.has(chave)) { vistos.add(chave); lutasUnicas.push(l); }
    }

    const encontrados = [...new Set(lutasUnicas.map(l => l.athlete_name))];
    const naoEncontrados = names.filter(n =>
      !encontrados.some(e => corresponde(e, n))
    );

    console.log(`Encontrados: ${lutasUnicas.length}, Não encontrados: ${naoEncontrados.length}`);
    res.json({
      total_athletes: lutasUnicas.length,
      total_fights: lutasUnicas.length,
      not_found: naoEncontrados,
      fights: lutasUnicas
    });

  } catch (error) {
    console.error('Erro:', error.message);
    res.status(500).json({
      error: 'Erro de comunicação com o servidor.',
      detail: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder - v10' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`BJJ Fight Finder v10 rodando na porta ${PORT}`);
});
