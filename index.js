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
    // NAO codificar a URL - Jina funciona melhor com URL crua
    let targetUrl = url;
    if (!targetUrl.startsWith('https://r.jina.ai/')) {
      targetUrl = 'https://r.jina.ai/' + targetUrl;
    }
    
    const response = await axios.get(targetUrl, {
      headers: { 'Accept': 'text/plain', 'Accept-Language': 'pt-BR,pt;q=0.9' },
      timeout: 60000
    });

    let texto = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    const linhas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const lutas = [];
    let matAtual = '';
    let fightAtual = '';
    let aguardandoNome = false;
    let ultimoNumero = '';

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];

      // Captura tatame
      if (/^[Mm][Aa][Tt]\s+\d+$/.test(linha) || /^\*\s*[Mm][Aa][Tt]\s+\d+/.test(linha)) {
        const m = linha.match(/(\d+)/);
        if (m) {
          matAtual = 'Mat ' + m[1];
          fightAtual = '';
          aguardandoNome = false;
        }
        continue;
      }

      // Captura FIGHT com horario - formato: "+ 12:25 PM: FIGHT 1 (SF)"
      const fm = linha.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)\s*:\s*FIGHT\s+\d+\s*\([^)]+\))/i);
      if (fm) {
        fightAtual = fm[1];
        aguardandoNome = false;
        continue;
      }

      // Linhas de divisao/categoria (Adult, Male, BLUE, etc) - ignorar
      if (/^(Adult|Juvenile|Master|Male|Female|Winner|Defeated)/i.test(linha)) continue;
      if (/^(Cookies|MANAGE|REJECT|ACCEPT|IBJJF|English|Portugues|Filter|Home|Live|Youtube)/i.test(linha)) continue;
      if (/^(Transmissao|Utilizamos|Acesse|Central|Termos|Politica)/i.test(linha)) continue;
      if (/youtube|google|cdn|https?:\/\//i.test(linha)) continue;
      if (/^
```/.test(linha) || /^\+/.test(linha) || /^\*/.test(linha)) continue;

      // Linha composta apenas por um numero (ex: "5" ou "  5  ")
      const somenteNumero = linha.match(/^(\d+)$/);
      if (somenteNumero) {
        ultimoNumero = somenteNumero[1];
        aguardandoNome = true;
        continue;
      }

      // Se estamos aguardando um nome de atleta, a proxima linha NAO-numerica
      // que parece um nome de pessoa é o atleta
      if (aguardandoNome && linha.length >= 5 && /^[A-Za-z\u00C0-\u024F]/.test(linha)) {
        const nomeAtleta = linha;
        
        // Verifica se corresponde a algum nome buscado
        for (const nomeBuscado of names) {
          if (corresponde(nomeBuscado, nomeAtleta)) {
            lutas.push({
              athlete_name: nomeAtleta,
              mat: matAtual || '-',
              fight: fightAtual || '-'
            });
            break;
          }
        }
        aguardandoNome = false;
        continue;
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
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder - v19' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('BJJ Fight Finder v19 rodando na porta ' + PORT);
});
