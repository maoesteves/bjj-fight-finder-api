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

  // Verifica se o nome do atleta aparece em alguma parte da linha
  if (e.includes(b)) return true;
  if (b.includes(e)) return true;

  // Verificação por partes do nome (ignorando palavras muito curtas)
  const pb = b.split(' ').filter(w => w.length > 2);
  const pe = e.split(' ');
  if (pb.length === 0) return false;
  let acertos = 0;
  for (const palavra of pb) {
    if (pe.some(p => p.includes(palavra))) acertos++;
  }
  return acertos >= Math.min(pb.length, 2);
}

app.post('/buscar-lutas', async (req, res) => {
  const { url, names } = req.body;
  if (!url || !names || names.length === 0) {
    return res.status(400).json({ error: 'URL do torneio e nomes dos atletas são obrigatórios' });
  }

  try {
    // Usa o Jina AI Reader para obter o conteúdo renderizado (com JavaScript executado)
    const jinaUrl = `https://r.jina.ai/${url}`;
    
    const response = await axios.get(jinaUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9'
      },
      timeout: 30000
    });

    // Extrai o texto puro
    let texto = response.data;
    if (typeof texto === 'object') texto = JSON.stringify(texto);
    
    // Remove HTML tags se houver
    texto = texto.replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/\n\s*\n/g, '\n');

    const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);
    
    let matAtual = '';
    const resultados = [];

    for (const linha of linhas) {
      // Verifica se a linha contém MAT
      const m = linha.match(/[Mm][Aa][Tt]\s*(\d+)/);
      if (m && linha.length < 20) { matAtual = `Mat ${m[1]}`; }
      
      // Pula linhas que sabemos que não são atletas
      if (linha.match(/^(Winner|Defeated|Vencedor|Derrotado|Filter|Days|Day|Cookies|MANAGE|REJECT|ACCEPT)/i)) continue;
      if (linha.match(/^(Home|Mats|Áreas|Live|Transmissão)/i)) continue;
      if (linha.match(/^(English|Português)/i)) continue;
      if (linha.match(/^(By Division|By Team|By Athlete)/i)) continue;
      if (linha.match(/^(IBJJF|BJJCOMPSYSTEM|BJJCOMP)/i)) continue;
      if (linha.length < 5) continue;

      // Verifica cada nome buscado
      for (const nomeBuscado of names) {
        if (corresponde(nomeBuscado, linha)) {
          // Extrai informações da linha
          let nomeAtleta = '';
          let equipe = '';
          
          // Tenta extrair: {hora} {round} {divisao} {numero} {nome} {equipe}
          // ou formato simplificado: {numero} {nome} {equipe}
          
          const matchFormat1 = linha.match(/\d{1,2}:\d{2}\s*:\s*(?:FIGHT|LUTA)\s+\d+\s*\([^)]+\)\s+(.+?)\s+\d+\s+(.+)/);
          const matchFormat2 = linha.match(/^\s*\d+\s+(.+)/);

          if (matchFormat1) {
            nomeAtleta = matchFormat1[2].trim();
          } else if (matchFormat2) {
            const resto = matchFormat2[1].trim();
            // Separa nome da equipe
            const palavras = resto.split(' ');
            // Procura por indicadores de equipe
            let idxEquipe = -1;
            for (let j = palavras.length - 1; j >= 0; j--) {
              const p = palavras[j].toLowerCase();
              if (['team', 'bjj', 'jiu-jitsu', 'jitsu', 'academy', 'club', 'school', 'association', 
                   'checkmat', 'alliance', 'gracie', 'atos', 'renzo', 'nova', 'uniao', 'brothers',
                   'constrictor', 'rhino', 'dream', 'art', 'bareia', 'guigo', 'ryan', 'equipe',
                   'liga'].some(k => p.includes(k))) {
                idxEquipe = j;
                break;
              }
            }
            if (idxEquipe > 0 && idxEquipe < palavras.length - 1) {
              nomeAtleta = palavras.slice(0, idxEquipe).join(' ');
              equipe = palavras.slice(idxEquipe).join(' ');
            } else {
              nomeAtleta = resto;
            }
          }

          if (nomeAtleta) {
            resultados.push({
              athlete_name: nomeAtleta,
              search_name: nomeBuscado,
              mat: matAtual || '-',
              time: '-',
              division: '-',
              team: equipe || '-'
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
      const chave = `${l.athlete_name}|${l.mat}`;
      if (!vistos.has(chave)) { vistos.add(chave); lutasUnicas.push(l); }
    }

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
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder API - v6' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BJJ Fight Finder API v6 rodando na porta ${PORT}`);
});
