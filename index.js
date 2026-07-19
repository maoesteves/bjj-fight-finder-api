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
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
    const jinaUrl = `https://r.jina.ai/${url}`;
    const response = await axios.get(jinaUrl, {
      headers: {
        'Accept': 'text/plain',
        'Accept-Language': 'pt-BR,pt;q=0.9'
      },
      timeout: 30000
    });

    let texto = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    const linhas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 3);

    let matAtual = '';
    let fightData = ''; // armazena a linha com o horário e round
    const lutas = [];

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];

      // Captura Mat (ex: "Mat 1", "Mat 2")
      const mm = linha.match(/(?:^|\s)([Mm][Aa][Tt])\s*(\d+)/);
      if (mm && linha.length < 30 && !linha.match(/youtube|FIGHT|LUTA/i)) {
        matAtual = `Mat ${mm[2]}`;
      }

      // Captura linha de luta: "14:15: FIGHT 2(SF)" ou "14:15: LUTA 2 (SF)"
      // Essas linhas têm formato: {hora}: {FIGHT|LUTA} {num} ({tipo})
      const lutaMatch = linha.match(/(\d{1,2}:\d{2})\s*:\s*(?:FIGHT|LUTA)\s+(\d+)\s*\(([^)]+)\)/i);
      if (lutaMatch) {
        fightData = {
          time: lutaMatch[1],
          round: `Luta ${lutaMatch[2]} (${lutaMatch[3]})`
        };
      }

      // Captura divisão (linha com / e gênero): "Pee-Wee 3 / Male / GREY / Middle"
      let divisaoAtual = '';
      const divMatch = linha.match(/^([A-Za-zÀ-ÿ0-9\s-]+)\s*\/\s*(Male|Female|Masculino|Feminino)\s*\/\s*(White|Blue|Purple|Brown|Black|Yellow|Grey|Orange|Green|Branca|Azul|Roxa|Marrom|Preta|Amarela|Cinza|Laranja|Verde)\s*\/\s*(.+)/i);
      if (divMatch) {
        divisaoAtual = linha;
      }

      // Pula linhas irrelevantes
      if (linha.match(/^(Winner|Defeated|Vencedor|Derrotado|Filter|Cookies|MANAGE|REJECT|ACCEPT|Home|Mats|Áreas|Live|IBJJF|BJJCOMPSYSTEM|BJJCOMP|English|Português|By Division|By Team|By Athlete|Day|Days|Day\s+\d)/i)) continue;
      if (linha.match(/youtube|google|facebook|twitter|instagram|linkedin/i)) continue;
      // Pula linhas que são só URLs
      if (linha.match(/^https?:\/\//)) continue;
      if (linha.match(/^\[\!\[/)) continue;
      if (linha.length < 6) continue;

      // Verifica se a linha contém nome de atleta
      for (const nomeBuscado of names) {
        if (corresponde(nomeBuscado, linha)) {
          // Extrai nome do atleta e equipe
          const matchNumero = linha.match(/^\s*(\d+)\s+(.+)/);
          if (matchNumero) {
            const resto = matchNumero[2].trim();
            const partes = resto.split(' ');
            
            // Tenta separar nome da equipe
            let nomeAtleta = resto;
            let equipe = '-';
            
            const indicadoresEquipe = [
              'team', 'bjj', 'jiu-jitsu', 'jitsu', 'academy', 'club', 'school',
              'association', 'checkmat', 'alliance', 'gracie', 'atos', 'renzo',
              'nova', 'uniao', 'brothers', 'constrictor', 'rhino', 'dream',
              'bareia', 'guigo', 'ryan', 'equipe', 'liga', 'brothers club',
              'roster', 'treinamento', 'escola', 'professores', 'arte suave',
              'jfc', 'js brazilian', 'gym', 'fight', 'team', 'top team',
              'gracie barra', 'gracie humaita', 'rc kairós', 'zr team',
              'gns academy', 'montanha top team', 'otávio de almeida',
              'ct team', 'rbjja', 'carlos', 'pedro', 'mario', 'mestre',
              'c与传统'
            ];

            let idxEquipe = -1;
            for (let j = 0; j < partes.length; j++) {
              const p = partes[j].toLowerCase().replace(/[^a-z0-9áéíóúàâêôãõçü]/g, '');
              if (indicadoresEquipe.some(k => p.includes(k) || k.includes(p))) {
                idxEquipe = j;
                break;
              }
            }

            if (idxEquipe > 0) {
              nomeAtleta = partes.slice(0, idxEquipe).join(' ');
              equipe = partes.slice(idxEquipe).join(' ');
            }

            // Verifica linhas anteriores para obter divisão
            let divisao = '-';
            for (let j = Math.max(0, i - 10); j < i; j++) {
              const ant = linhas[j];
              if (ant.includes('/') && ant.match(/(Male|Female|Masculino|Feminino)/i)) {
                if (ant.match(/(White|Blue|Purple|Brown|Black|Yellow|Grey|Orange|Green|Branca|Azul|Roxa|Marrom|Preta|Amarela|Cinza|Laranja|Verde)/i)) {
                  divisao = ant;
                }
              }
            }

            lutas.push({
              athlete_name: nomeAtleta,
              search_name: nomeBuscado,
              fight_round: fightData ? fightData.round : '-',
              mat: matAtual || '-',
              day: '-',
              time: fightData ? fightData.time : '-',
              division: divisao || '-',
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
    for (const l of lutas) {
      const chave = `${l.athlete_name}|${l.mat}|${l.fight_round}`;
      if (!vistos.has(chave)) {
        vistos.add(chave);
        lutasUnicas.push(l);
      }
    }

    const encontrados = [...new Set(lutasUnicas.map(l => l.search_name))];
    const naoEncontrados = names.filter(n =>
      !encontrados.some(e => corresponde(e, n))
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
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder API - v8' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BJJ Fight Finder API v8 rodando na porta ${PORT}`);
});
