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
    .replace(/[^a-z0-9 ]/g, '').replace(/ +/g, ' ').trim();
}

function corresponde(buscado, linha) {
  var b = normalizar(buscado);
  var l = normalizar(linha);
  if (!b || !l) return false;
  if (l === b) return true;
  if (l.indexOf(b) >= 0 || b.indexOf(l) >= 0) return true;
  var pb = b.split(' ').filter(function(w) { return w.length > 2; });
  var pl = l.split(' ').filter(function(w) { return w.length > 2; });
  if (pb.length === 0 || pl.length === 0) return false;
  var acertos = 0;
  for (var i = 0; i < pb.length; i++) {
    for (var j = 0; j < pl.length; j++) {
      if (pb[i] === pl[j]) { acertos++; break; }
    }
  }
  if (pb.length === 1) return pb[0] === pl[0];
  return acertos >= 2 && acertos >= Math.ceil(Math.min(pb.length, pl.length) / 2);
}

app.post('/buscar-lutas', async function(req, res) {
  var url = req.body.url;
  var names = req.body.names;
  if (!url || !names || names.length === 0) {
    return res.status(400).json({ error: 'URL e nomes obrigatorios' });
  }
  try {
    var response = await axios.get('https://r.jina.ai/' + url, {
      headers: { 'Accept': 'text/plain', 'Accept-Language': 'pt-BR,pt;q=0.9' },
      timeout: 60000
    });
    var texto = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    var linhas = texto.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });

    var lutas = [];
    var matAtual = '';
    var aguardandoNome = false;

    for (var i = 0; i < linhas.length; i++) {
      var linha = linhas[i];

      if (/[Mm][Aa][Tt] +[0-9]+/.test(linha) && linha.length < 20) {
        var m = linha.match(/[0-9]+/);
        if (m) matAtual = 'Mat ' + m[0];
        aguardandoNome = false;
        continue;
      }

      var up = linha.toUpperCase();
      if (up.indexOf('WINNER OF') === 0) continue;
      if (up.indexOf('DEFEATED OF') === 0) continue;
      if (up.indexOf('COOKIES') >= 0) continue;
      if (up.indexOf('ACCEPT') >= 0) continue;
      if (up.indexOf('IBJJF') >= 0) continue;
      if (up.indexOf('TITLE') === 0) continue;
      if (up.indexOf('URL SOURCE') === 0) continue;
      if (up.indexOf('MARKDOWN CONTENT') === 0) continue;
      if (up.indexOf('YOUTUBE') >= 0) continue;
      if (up.indexOf('TRANSMISSAO') >= 0) continue;
      if (up.indexOf('UTILIZAMOS') >= 0) continue;
      if (up.indexOf('ACESSE') >= 0) continue;
      if (up.indexOf('POLITICA') >= 0) continue;
      if (/^http/i.test(linha)) continue;

      var linhaNum = linha.replace(/^[*] */, '');
      if (/^[0-9]+$/.test(linhaNum) && linhaNum.length <= 3) {
        aguardandoNome = true;
        continue;
      }

      if (linha.length < 4) continue;

      if (aguardandoNome && /^[A-Za-z]/.test(linha)) {
        aguardandoNome = false;
        for (var n = 0; n < names.length; n++) {
          if (corresponde(names[n], linha)) {
            var jaTem = false;
            for (var z = 0; z < lutas.length; z++) {
              if (corresponde(names[n], lutas[z].athlete_name)) { jaTem = true; break; }
            }
            if (!jaTem) lutas.push({ athlete_name: linha, mat: matAtual || '-' });
            break;
          }
        }
        continue;
      }
    }

    var vistos = {};
    var lutasUnicas = [];
    for (var l = 0; l < lutas.length; l++) {
      var luta = lutas[l];
      var chave = luta.athlete_name + '|' + luta.mat;
      if (!vistos[chave]) { vistos[chave] = true; lutasUnicas.push(luta); }
    }

    var encontrados = [];
    for (var le = 0; le < lutasUnicas.length; le++) encontrados.push(lutasUnicas[le].athlete_name);
    var naoEncontrados = [];
    for (var ne = 0; ne < names.length; ne++) {
      var achou = false;
      for (var en = 0; en < encontrados.length; en++) {
        if (corresponde(names[ne], encontrados[en])) { achou = true; break; }
      }
      if (!achou) naoEncontrados.push(names[ne]);
    }
    res.json({ total_athletes: lutasUnicas.length, total_fights: lutasUnicas.length, not_found: naoEncontrados, fights: lutasUnicas });
  } catch (error) {
    console.error('Erro:', error.message);
    res.status(500).json({ error: 'Erro de comunicacao com o servidor.', detail: error.message });
  }
});

app.get('/debug', async function(req, res) {
  var url = req.query.url || 'https://www.bjjcompsystem.com/tournaments/3262/tournament_days/4913';
  try {
    var response = await axios.get('https://r.jina.ai/' + url, {
      headers: { 'Accept': 'text/plain', 'Accept-Language': 'pt-BR,pt;q=0.9' },
      timeout: 60000
    });
    var texto = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    var linhas = texto.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
    var nomes = [];
    for (var i = 0; i < linhas.length; i++) {
      var l = linhas[i];
      if (/^[A-Za-z]/.test(l) && l.length >= 4 && !l.match(/^(Winner|Defeated|Cookies|MANAGE|REJECT|ACCEPT|IBJJF|ENGLISH|PORTUGUES|FILTER|HOME|LIVE|YOUTUBE|ADULT|JUVENILE|MASTER|MALE|FEMALE|TRANSMISSAO|UTILIZAMOS|ACESSE|CENTRAL|TERMOS|POLITICA|Title|URL|Markdown)/i)) {
        nomes.push(l);
      }
    }
    res.json({ total_lines: linhas.length, sample_20: linhas.slice(0, 20), possible_names: nomes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', function(req, res) {
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder - v28' });
});

app.listen(PORT, '0.0.0.0', function() {
  console.log('BJJ Fight Finder v28 rodando na porta ' + PORT);
});
