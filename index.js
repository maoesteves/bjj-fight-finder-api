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
  for (const p of pb) { if (l.includes(p)) return true; }
  return false;
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

    // Estrutura para guardar as informacoes
    const lutas = [];
    let matAtual = '';
    let fightAtual = '';

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];

      // 1. Captura tatame atual
      const mm = linha.match(/[Mm][Aa][Tt]\s+(\d+)/);
      if (mm && linha.length < 30) {
        matAtual = 'Mat ' + mm[1];
        fightAtual = '';
        continue;
      }

      // 2. Captura linha de FIGHT com horario
      const fm = linha.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)\s*:\s*FIGHT\s+\d+\s*\([^)]+\))/i);
      if (fm) {
        fightAtual = fm[1];
        continue;
      }

      // 3. Pula linhas irrelevantes
      const palavrasIgnorar = ['winner', 'defeated', 'vencedor', 'derrotado', 'cookies', 'manage', 'reject', 'accept', 'ibjjf', 'bjjcompsystem', 'english', 'portugues', 'filter', 'home', 'live', 'youtube', 'day ', 'transmissao', 'utilizamos', 'acesse', 'central', 'termos', 'politica', 'adult', 'juvenile', 'master', 'male', 'female', 'black', 'blue', 'purple', 'brown', 'white', 'yellow', 'grey', 'orange', 'green', 'feather', 'light', 'middle', 'medium', 'heavy', 'super', 'ultra', 'rooster', 'open'];
      const linhaLower = linha.toLowerCase();
      let isIrrelevante = false;
      for (const p of palavrasIgnorar) {
        if (linhaLower.startsWith(p)) { isIrrelevante = true; break; }
      }
      if (isIrrelevante) continue;
      if (linha.match(/youtube|google|cdn|https?:\/\//i)) continue;
      if (linha.length < 5) continue;

      // 4. Verifica se a linha comeca com numero (atleta)
      const numMatch = linha.match(/^(\d+)\s+(.+)$/);
      if (!numMatch) continue;

      const nomeCompleto = numMatch[2].trim();
      if (nomeCompleto.length < 5) continue;

      // 5. Verifica se corresponde a algum nome buscado
      for (const nomeBuscado of names) {
        if (corresponde(nomeBuscado, nomeCompleto)) {
          lutas.push({
            athlete_name: nomeCompleto,
            mat: matAtual || '-',
            fight: fightAtual || '-'
          });
          break;
        }
      }
    }

    // Remove duplicatas
    const vistos = new Set();
    const lutasUnicas = [];
    for (const l of lutas) {
      const chave = l.athlete_name + '|' + l.mat;
      if (!vistos.has(chave)) { vistos.add(chave); lutasUnicas.push(l); }
    }

    const encontrados = new Set(lutasUnicas.map(l => l.athlete_name));
    const naoEncontrados = names.filter(n => {
      for (const e of encontrados) {
        if (corresponde(n, e)) return false;
      }
      return true;
    });

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
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder - v18' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('BJJ Fight Finder v18 rodando na porta ' + PORT);
});
