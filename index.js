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
  for (const p of pb) { if (l.includes(p)) acertos++; }
  return acertos >= 1;
}

app.post('/buscar-lutas', async (req, res) => {
  const { url, names } = req.body;
  if (!url || !names || names.length === 0) {
    return res.status(400).json({ error: 'URL e nomes obrigatorios' });
  }
  try {
    const jinaUrl = 'https://r.jina.ai/' + encodeURIComponent(url);
    const response = await axios.get(jinaUrl, {
      headers: { 'Accept': 'text/plain', 'Accept-Language': 'pt-BR,pt;q=0.9' },
      timeout: 45000
    });

    let texto = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    const linhas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 2);

    const cronograma = {};
    const atletasNoCodigo = {};
    const atletasNoFight = {};

    let matAtual = '';
    let fightAtual = '';

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];

      const mm = linha.match(/[Mm][Aa][Tt]\s*(\d+)/);
      if (mm && linha.length < 30) {
        matAtual = 'Mat ' + mm[1];
        if (!cronograma[matAtual]) cronograma[matAtual] = [];
        if (!atletasNoCodigo[matAtual]) atletasNoCodigo[matAtual] = [];
        fightAtual = '';
        continue;
      }

      const fm = linha.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)\s*:\s*FIGHT\s+\d+\s*\([^)]+\))/i);
      if (fm) {
        fightAtual = fm[1];
        if (matAtual) cronograma[matAtual].push(fightAtual);
        continue;
      }

      if (linha.match(/^(Winner|Defeated|Vencedor|Derrotado|Cookies|MANAGE|REJECT|ACCEPT|IBJJF|BJJCOMPSYSTEM|English|Portugues|By|Filter|Home|Live|Youtube|Day\s+\d|Transmissao|Utilizamos|Acesse|Central|Termos|Politica)/i)) continue;
      if (linha.match(/youtube|google|cdn|https?:\/\//i)) continue;
      if (linha.length < 5) continue;

      const atletaMatch = linha.match(/^(\d+)\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F\s.]+?)(?:\s+(?:[A-Za-z\u00C0-\u024F].+))?$/);
      if (atletaMatch) {
        const nomeCompleto = atletaMatch[2].trim();
        if (nomeCompleto.length < 4) continue;
        const nomeNorm = normalizar(nomeCompleto);

        if (fightAtual) {
          atletasNoFight[nomeNorm] = {
            nomeCompleto: nomeCompleto,
            mat: matAtual || '-',
            fight: fightAtual
          };
        } else {
          atletasNoCodigo[matAtual || '-'].push({
            nomeCompleto: nomeCompleto,
            nomeNorm: nomeNorm
          });
        }
      }
    }

    const lutas = [];
    const encontrados = new Set();

    for (const nomeBuscado of names) {
      let achado = null;

      for (const info of Object.values(atletasNoFight)) {
        if (corresponde(nomeBuscado, info.nomeCompleto)) {
          achado = { athlete_name: info.nomeCompleto, mat: info.mat, fight: info.fight };
          break;
        }
      }

      if (!achado) {
        for (const [matKey, atletas] of Object.entries(atletasNoCodigo)) {
          for (const atl of atletas) {
            if (corresponde(nomeBuscado, atl.nomeCompleto)) {
              const fights = cronograma[matKey] || [];
              achado = {
                athlete_name: atl.nomeCompleto,
                mat: matKey,
                fight: fights.length > 0 ? fights.join(' | ') : '-'
              };
              break;
            }
          }
          if (achado) break;
        }
      }

      if (achado) {
        encontrados.add(nomeBuscado);
        lutas.push(achado);
      }
    }

    const vistos = new Set();
    const lutasUnicas = [];
    for (const l of lutas) {
      const chave = l.athlete_name + '|' + l.mat;
      if (!vistos.has(chave)) { vistos.add(chave); lutasUnicas.push(l); }
    }

    const naoEncontrados = names.filter(n => !encontrados.has(n));

    res.json({
      total_athletes: lutasUnicas.length,
      total_fights: lutasUnicas.length,
      not_found: naoEncontrados,
      fights: lutasUnicas
    });

  } catch (error) {
    console.error('Erro:', error.message);
    res.status(500).json({ error: 'Erro de comunicacao com o servidor.', detail: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder - v17' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('BJJ Fight Finder v17 rodando na porta ' + PORT);
});
