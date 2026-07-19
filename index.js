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

function corresponde(buscado, encontrado) {
  const b = normalizar(buscado);
  const e = normalizar(encontrado);
  if (!b || !e) return false;
  if (e.includes(b) || b.includes(e)) return true;
  const pb = b.split(' ').filter(w => w.length > 2);
  if (pb.length === 0) return false;
  let acertos = 0;
  for (const palavra of pb) {
    if (e.includes(palavra)) acertos++;
  }
  return acertos >= Math.min(pb.length, Math.ceil(pb.length * 0.5));
}

app.post('/buscar-lutas', async (req, res) => {
  const { url, names } = req.body;
  if (!url || !names || names.length === 0) {
    return res.status(400).json({ error: 'URL do torneio e nomes dos atletas são obrigatórios' });
  }

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 30000
    });

    // Extrai texto puro
    let texto = response.data
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '\n')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '\n')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/\n\s*\n/g, '\n');

    const linhas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 3);
    
    let matAtual = '';
    const resultados = [];

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];

      // Captura mat atual
      const m = linha.match(/^(?:\*\s*)?(?:[Mm][Aa][Tt]|[Aa]rea)\s*(\d+)/);
      if (m) { matAtual = `Mat ${m[1]}`; continue; }

      // Verifica se a linha contém algum dos nomes buscados
      for (const nomeBuscado of names) {
        if (corresponde(nomeBuscado, linha)) {
          // Ignora linhas de winner/defeated
          if (linha.match(/^(Winner|Defeated|Vencedor|Derrotado|W\/|D\/)/i)) continue;
          if (linha.match(/FIGHT|LUTA/i) && !linha.match(/^\d+\s+/)) continue;
          
          // Extrai o nome do atleta da linha
          const matchNumero = linha.match(/^(\d+)\s+(.+)/);
          if (matchNumero) {
            const nomeAtleta = matchNumero[2].trim();
            
            // Pega contexto: olha linhas anteriores para mat, hora, round e divisão
            let hora = '', round = '', divisao = '';
            for (let j = Math.max(0, i - 10); j < i; j++) {
              const ant = linhas[j];
              const h = ant.match(/(\d{1,2}:\d{2})\s*:\s*(?:FIGHT|LUTA)\s+(\d+)\s*\(([^)]+)\)/i);
              if (h) { hora = h[1]; round = `Luta ${h[2]} (${h[3]})`; }
              if (ant.includes('/') && ant.match(/(?:Male|Female)/i)) { divisao = ant; }
            }

            resultados.push({
              athlete_name: nomeAtleta,
              search_name: nomeBuscado,
              fight_round: round || '-',
              mat: matAtual || '-',
              day: '-',
              time: hora || '-',
              division: divisao || '-',
              team: '-'
            });
          }
          break;
        }
      }
    }

    // Remove duplicatas
    const vistos = new Set();
    const lutasUnicas = [];
    for (const l of resultados) {
      const chave = `${l.athlete_name}|${l.mat}|${l.time}`;
      if (!vistos.has(chave)) { vistos.add(chave); lutasUnicas.push(l); }
    }

    // Atletas não encontrados
    const encontrados = [...new Set(lutasUnicas.map(l => l.search_name))];
    const naoEncontrados = names.filter(n =>
      !encontrados.some(e => corresponde(e, n) || corresponde(n, e))
    );

    res.json({
      total_athletes: [...new Set(lutasUnicas.map(l => l.athlete_name))].length,
      total_fights: lutasUnicas.length,
      not_found: naoEncontrados,
      fights: lutasUnicas
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
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder API - v4' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BJJ Fight Finder API v4 rodando na porta ${PORT}`);
});
