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
  const palavrasBuscadas = b.split(' ').filter(w => w.length > 3);
  const palavrasEncontradas = e.split(' ');
  if (palavrasBuscadas.length === 0) return false;
  let acertos = 0;
  for (const pb of palavrasBuscadas) {
    if (palavrasEncontradas.some(pe => pe.includes(pb) || pb.includes(pe))) acertos++;
  }
  return acertos >= Math.min(palavrasBuscadas.length, Math.ceil(palavrasBuscadas.length * 0.6));
}

function extrairTexto(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|tr|li|h[1-6]|section|article|pre|code)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\t/g, ' ')
    .split('\n').map(l => l.trim()).filter(l => l.length > 0);
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

    // Extrai linhas de texto puro do HTML
    const linhas = extrairTexto(response.data);
    
    let matAtual = '';
    let horaAtual = '';
    let roundAtual = '';
    let divisaoAtual = '';
    const lutas = [];

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];

      // Identifica MAT/Área: "Mat 1", "* Mat 2", "Área 1"
      const m = linha.match(/^(?:\*\s*)?(?:[Mm][Aa][Tt]|[Áá]rea)\s*(\d+)/);
      if (m) { matAtual = `Mat ${m[1]}`; continue; }

      // Identifica luta com horário: "+ 15:12: FIGHT 12 (SF)" ou "+ 14:15: LUTA 2 (SF)"
      const l = linha.match(/^\+?\s*(\d{1,2}:\d{2})\s*:\s*(?:FIGHT|LUTA)\s+(\d+)\s*\(([^)]+)\)/i);
      if (l) { horaAtual = l[1]; roundAtual = `Luta ${l[2]} (${l[3]})`; continue; }

      // Identifica divisão: "Pee-Wee 3 / Male / GREY / Middle"
      const d = linha.match(/^[A-Za-zÀ-ÿ0-9\s-]+\s*\/\s*(?:Male|Female|Masculino|Feminino)\s*\/\s*(?:White|Blue|Purple|Brown|Black|Yellow|Grey|Orange|Green|Branca|Azul|Roxa|Marrom|Preta|Amarela|Cinza|Laranja|Verde)\s*\/\s*\w+/i);
      if (d) { divisaoAtual = linha; continue; }

      // Remove linhas de winner/defeated
      if (linha.match(/^(Winner|Defeated|Vencedor|Derrotado)/i)) continue;
      if (linha.match(/FIGHT|LUTA/i) && !linha.match(/^\d+/)) continue;

      // Identifica linha de atleta: "2 Murilo Hilsdorf de Moura RC Kairós Jiu-Jitsu School"
      const a = linha.match(/^(\d+)\s+(.+)/);
      if (a) {
        const resto = a[2].trim();
        // Filtra linhas que NÃO são de atleta
        if (resto.length < 5) continue;
        if (resto.match(/^(Winner|Defeated|Vencedor|Derrotado|FIGHT|LUTA)/i)) continue;

        // O nome do atleta é o que antecede palavras-chave de equipe
        const nomeAtleta = resto;

        // Verifica correspondência
        for (const nomeBuscado of names) {
          if (corresponde(nomeBuscado, nomeAtleta)) {
            lutas.push({
              athlete_name: nomeAtleta,
              search_name: nomeBuscado,
              fight_round: roundAtual || '-',
              mat: matAtual || '-',
              day: '19/07/2026',
              time: horaAtual || '-',
              division: divisaoAtual || '-',
              team: '-'
            });
            break;
          }
        }
      }
    }

    // Remove duplicatas (mesmo atleta na mesma luta)
    const lutasUnicas = [];
    const vistos = new Set();
    for (const l of lutas) {
      const chave = `${l.athlete_name}|${l.mat}|${l.time}`;
      if (!vistos.has(chave)) {
        vistos.add(chave);
        lutasUnicas.push(l);
      }
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
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder API - v3' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BJJ Fight Finder API v3 rodando na porta ${PORT}`);
});
