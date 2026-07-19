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
    .replace(/[^a-z0-9s]/g, '').replace(/s+/g, ' ').trim();
}

function corresponde(buscado, linha) {
  var b = normalizar(buscado);
  var l = normalizar(linha);
  if (!b || !l) return false;
  if (l.indexOf(b) >= 0) return true;
  var pb = b.split(' ').filter(function(w) { return w.length > 2; });
  if (pb.length === 0) return false;
  for (var p = 0; p < pb.length; p++) {
    if (l.indexOf(pb[p]) >= 0) return true;
  }
  return false;
}

app.post('/buscar-lutas', async function(req, res) {
  var url = req.body.url;
  var names = req.body.names;
  if (!url || !names || names.length === 0) {
    return res.status(400).json({ error: 'URL e nomes obrigatorios' });
  }
  try {
    var targetUrl = 'https://r.jina.ai/' + url;

    var response = await axios.get(targetUrl, {
      headers: { 'Accept': 'text/plain', 'Accept-Language': 'pt-BR,pt;q=0.9' },
      timeout: 60000
    });

    var texto = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    var linhas = texto.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });

    var lutas = [];
    var matAtual = '';
    var fightAtual = '';
    var aguardandoNome = false;

    for (var i = 0; i < linhas.length; i++) {
      var linha = linhas[i];

      if (/^[Mm][Aa][Tt]s+\d+$/.test(linha) || /^[*]s*[Mm][Aa][Tt]s+\d+/.test(linha)) {
        var m = linha.match(/(d+)/);
        if (m) {
          matAtual = 'Mat ' + m[1];
          fightAtual = '';
          aguardandoNome = false;
        }
        continue;
      }

      var fm = linha.match(/(d{1,2}:d{2}s*(?:AM|PM)s*:s*FIGHTs+d+s*([^)]+))/i);
      if (fm) {
        fightAtual = fm[1];
        aguardandoNome = false;
        continue;
      }

      var linhaUp = linha.toUpperCase();
      if (/^(ADULT|JUVENILE|MASTER|MALE|FEMALE|WINNER|DEFEATED)/i.test(linha)) continue;
      if (/^(COOKIES|MANAGE|REJECT|ACCEPT|IBJJF|ENGLISH|PORTUGUES|FILTER|HOME|LIVE|YOUTUBE)/i.test(linha)) continue;
      if (/^(TRANSMISSAO|UTILIZAMOS|ACESSE|CENTRAL|TERMOS|POLITICA)/i.test(linha)) continue;
      if (/youtube|google|cdn|https?:\/\//i.test(linha)) continue;
      if (linhaUp.indexOf('WINNER OF') === 0) continue;
      if (linhaUp.indexOf('DEFEATED OF') === 0) continue;
      if (linha.indexOf('
```') >= 0) continue;
      if (linha.indexOf('+ ') === 0) continue;

      var somenteNumero = linha.match(/^(d+)$/);
      if (somenteNumero) {
        aguardandoNome = true;
        continue;
      }

      if (aguardandoNome && linha.length >= 5 && /^[A-Za-z\u00C0-\u024F]/.test(linha)) {
        var nomeAtleta = linha;

        for (var n = 0; n < names.length; n++) {
          if (corresponde(names[n], nomeAtleta)) {
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

    var vistos = {};
    var lutasUnicas = [];
    for (var l = 0; l < lutas.length; l++) {
      var luta = lutas[l];
      var chave = luta.athlete_name + '|' + luta.mat;
      if (!vistos[chave]) {
        vistos[chave] = true;
        lutasUnicas.push(luta);
      }
    }

    var nomesEncontrados = [];
    for (var le = 0; le < lutasUnicas.length; le++) {
      nomesEncontrados.push(lutasUnicas[le].athlete_name);
    }

    var naoEncontrados = [];
    for (var ne = 0; ne < names.length; ne++) {
      var achou = false;
      for (var en = 0; en < nomesEncontrados.length; en++) {
        if (corresponde(names[ne], nomesEncontrados[en])) {
          achou = true;
          break;
        }
      }
      if (!achou) naoEncontrados.push(names[ne]);
    }

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

app.get('/health', function(req, res) {
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder - v21' });
});

app.listen(PORT, '0.0.0.0', function() {
  console.log('BJJ Fight Finder v21 rodando na porta ' + PORT);
});
