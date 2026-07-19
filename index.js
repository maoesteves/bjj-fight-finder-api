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
  return acertos >= Math.ceil(pb.length * 0.5);
}

app.post('/buscar-lutas', async (req, res) => {
  const { url, names } = req.body;
  if (!url || !names || names.length === 0) {
    return res.status(400).json({ error: 'URL obrigatória' });
  }

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9'
      },
      timeout: 30000
    });

    // Extrai texto puro
    let texto = response.data
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '\n')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|tr|li|h[1-6]|section|article|pre|code|span)>/gi, '\n')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/
```/g, '\n')
      .replace(/\n\s*\n\s*\n/g, '\n');

    const linhas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let matAtual = '';
    const lutas = [];

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];

      // Captura Mat (ex: "Mat 1", "* Mat 2")
      const mm = linha.match(/^[\*\s]*[Mm][Aa][Tt]\s*(\d+)/);
      if (mm) { matAtual = `Mat ${mm[1]}`; continue; }

      // Pula linhas que claramente não são de atletas
      if (linha.includes('//cdn') || linha.includes('//www.youtube')) continue;
      if (linha.length < 5) continue;

      // Verifica se a linha contém o nome buscado
      for (const nomeBuscado of names) {
        if (!corresponde(nomeBuscado, linha)) continue;
        
        // Extrai nome (remove número inicial tipo "2 Murilo..." -> "Murilo...")
        let nomeAtleta = linha.replace(/^\s*\d+\s+/, '').trim();
        if (nomeAtleta.length < 4) continue;

        // Busca hora em linhas próximas (até 8 linhas acima)
        let hora = '';
        for (let j = Math.max(0, i - 8); j < i; j++) {
          const h = linhas[j].match(/(\d{1,2}:\d{2})\s*:/);
          if (h && linhas[j].match(/FIGHT|LUTA/i)) { hora = h[1]; break; }
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

    // Remove duplicatas
    const vistos = new Set();
    const lutasUnicas = [];
    for (const l of lutas) {
      const chave = `${l.athlete_name}|${l.mat}`;
      if (!vistos.has(chave)) { vistos.add(chave); lutasUnicas.push(l); }
    }

    const encontrados = [...new Set(lutasUnicas.map(l => l.athlete_name))];
    const naoEncontrados = names.filter(n =>
      !encontrados.some(e => corresponde(e, n))
    );

    console.log(`Busca: ${names.length} atletas, ${lutasUnicas.length} encontrados`);
    console.log(`Linhas processadas: ${linhas.length}`);

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
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder - v9' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BJJ Fight Finder v9 rodando na porta ${PORT}`);
});
