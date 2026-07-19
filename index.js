const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Normaliza nome: remove acentos, caracteres especiais, caixa baixa
function normalizar(nome) {
  return nome
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Verifica se o nome buscado corresponde ao nome encontrado (flexível)
function corresponde(buscado, encontrado) {
  const b = normalizar(buscado);
  const e = normalizar(encontrado);
  if (!b || !e) return false;
  if (e.includes(b) || b.includes(e)) return true;
  const pb = b.split(' ').filter(w => w.length > 2);
  const pe = e.split(' ');
  if (pb.length === 0) return false;
  let acertos = 0;
  for (const palavra of pb) {
    if (pe.some(p => p.includes(palavra) || palavra.includes(p))) acertos++;
  }
  return acertos >= Math.min(pb.length, 2);
}

app.post('/buscar-lutas', async (req, res) => {
  const { url, names } = req.body;

  if (!url || !names || names.length === 0) {
    return res.status(400).json({ error: 'URL do torneio e nomes dos atletas são obrigatórios' });
  }

  let browser = null;
  try {
    // Inicia o navegador Chromium com flags leves (funciona em 512MB RAM)
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      locale: 'pt-BR'
    });

    const page = await context.newPage();
    
    // Navega até a página do torneio e espera o conteúdo carregar
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

    // Aguarda um tempo extra para garantir que o React terminou de renderizar
    await page.waitForTimeout(3000);

    // Extrai TODO o texto visível da página
    const textoCompleto = await page.evaluate(() => document.body.innerText);

    // Fecha o navegador
    await browser.close();
    browser = null;

    // Processa o texto linha por linha
    const linhas = textoCompleto.split('\n').map(l => l.trim()).filter(l => l);

    let areaAtual = '';
    let horaAtual = '';
    let roundAtual = '';
    let divisaoAtual = '';
    let diaAtual = '';
    const lutas = [];

    // Primeiro, identifica o dia do evento
    for (const linha of linhas) {
      const matchDia = linha.match(/dia\s+(\d+)/i);
      if (matchDia) {
        diaAtual = `Dia ${matchDia[1]}`;
        break;
      }
    }

    let dentroDeLuta = false;
    let contaLinha = 0;
    let numeroAtleta = '';
    let nomeAtleta = '';

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];

      // Identifica Área/Mat (português e inglês)
      const matchArea = linha.match(/^(?:\*\s*)?(?:[áÁ]rea|mat)\s*(\d+)/i);
      if (matchArea) {
        areaAtual = `Mat ${matchArea[1]}`;
        continue;
      }

      // Identifica horário de luta (português e inglês)
      const matchLuta = linha.match(/(\d{1,2}:\d{2})\s*:\s*(?:luta|fight)\s+(\d+)\s*\(([^)]+)\)/i);
      if (matchLuta) {
        horaAtual = matchLuta[1];
        roundAtual = `Luta ${matchLuta[2]} (${matchLuta[3]})`;
        dentroDeLuta = true;
        contaLinha = 0;
        continue;
      }

      // Identifica linha de divisão (ex: "Teen 3 / Male / YELLOW / Middle")
      if (linha.includes('/') && (linha.match(/male|female|masculino|feminino/i) || linha.match(/(white|blue|purple|brown|black|yellow|grey|orange|green)/i))) {
        divisaoAtual = linha;
        continue;
      }

      // Identifica linha de número de atleta (linha que é só um número)
      const matchNumero = linha.match(/^(\d+)$/);
      if (matchNumero && dentroDeLuta) {
        numeroAtleta = matchNumero[1];
        contaLinha = 0;
        continue;
      }

      // Se temos um número de atleta e a próxima linha é o nome...
      if (numeroAtleta && linha.length > 2 && !linha.match(/^\d+$/) && !linha.match(/luta|fight|área|mat|dia|filter|youtube|winner|defeated/i)) {
        if (contaLinha === 0) {
          nomeAtleta = linha;
          contaLinha = 1;
          continue;
        } else if (contaLinha === 1 && linha !== nomeAtleta) {
          // A linha seguinte ao nome é a equipe
          const equipeAtleta = linha;

          // Verifica se corresponde a algum nome buscado
          for (const nomeBuscado of names) {
            if (corresponde(nomeBuscado, nomeAtleta)) {
              lutas.push({
                athlete_name: nomeAtleta,
                search_name: nomeBuscado,
                fight_round: roundAtual || '-',
                mat: areaAtual || '-',
                day: diaAtual || '-',
                time: horaAtual || '-',
                division: divisaoAtual || '-',
                team: equipeAtleta || '-'
              });
            }
          }

          numeroAtleta = '';
          nomeAtleta = '';
          contaLinha = 0;
        }
      }
    }

    // Também procura por atletas no formato compacto (nome e equipe na mesma linha)
    for (const linha of linhas) {
      const matchAtleta = linha.match(/^\s*\d+\s+([A-Za-zÀ-ÿ\s]+)/);
      if (matchAtleta && linha.length > 10 && !linha.includes('FIGHT') && !linha.includes('LUTA') && !linha.includes('Mat') && !linha.includes('Área')) {
        const nomeCompleto = matchAtleta[1].trim();
        for (const nomeBuscado of names) {
          if (!lutas.some(l => l.search_name === nomeBuscado) && corresponde(nomeBuscado, nomeCompleto)) {
            // Verifica se não é uma linha de winner/defeated
            if (!nomeCompleto.match(/winner|defeated|atleta|competidor/i)) {
              lutas.push({
                athlete_name: nomeCompleto,
                search_name: nomeBuscado,
                fight_round: '-',
                mat: areaAtual || '-',
                day: diaAtual || '-',
                time: '-',
                division: '-',
                team: '-'
              });
            }
          }
        }
      }
    }

    // Identifica atletas não encontrados
    const encontrados = [...new Set(lutas.map(l => l.search_name))];
    const naoEncontrados = names.filter(n =>
      !encontrados.some(e => corresponde(e, n) || corresponde(n, e))
    );

    const atletasUnicos = [...new Set(lutas.map(l => l.athlete_name))];

    res.json({
      total_athletes: atletasUnicos.length,
      total_fights: lutas.length,
      not_found: naoEncontrados,
      fights: lutas
    });

  } catch (error) {
    console.error('Erro:', error.message);
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    res.status(500).json({
      error: 'Erro de comunicação com o servidor. Verifique sua conexão e tente novamente.',
      detail: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder API - Playwright' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BJJ Fight Finder API rodando na porta ${PORT}`);
});
