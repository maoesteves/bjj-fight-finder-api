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
    var response = await axios.get('https://r.jina.ai/' + url, {
      headers: { 'Accept': 'text/plain', 'Accept-Language': 'pt-BR,pt;q=0.9' },
      timeout: 60000
    });
    var texto = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    var linhas = texto.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 2; });
    var lutas = [];
    var matAtual = '';
    var fightAtual = '';
    var aguardandoNome = false;
    for (var i = 0; i < linhas.length; i++) {
      var linha = linhas[i];
      if (/[Mm][Aa][Tt]s+\d+/.test(linha) && linha.length < 30) {
        var m = linha.match(/(d+)/);
        if (m) { matAtual = 'Mat ' + m[1]; }
        fightAtual = '';
        aguardandoNome = false;
        continue;
      }
      var fm = linha.match(/(d{1,2}:d{2}s*(?:AM|PM)s*:s*FIGHTs+d+s*([^)]+))/i);
      if (fm) { fightAtual = fm[1]; aguardandoNome = false; continue; }
      var up = linha.toUpperCase();
      if (up.indexOf('WINNER OF') === 0) continue;
      if (up.indexOf('DEFEATED OF') === 0) continue;
      if (up.indexOf('COOKIES') >= 0) continue;
      if (up.indexOf('ACCEPT') >= 0) continue;
      if (up.indexOf('IBJJF') >= 0) continue;
      if (up.indexOf('ENGLISH') === 0) continue;
      if (up.indexOf('PORTUGUES') === 0) continue;
      if (up.indexOf('FILTER') === 0) continue;
      if (up.indexOf('HOME') === 0) continue;
      if (up.indexOf('LIVE') === 0) continue;
      if (up.indexOf('YOUTUBE') >= 0) continue;
      if (up.indexOf('ADULT') === 0) continue;
      if (up.indexOf('JUVENILE') === 0) continue;
      if (up.indexOf('MASTER') === 0) continue;
      if (up.indexOf('MALE') === 0) continue;
      if (up.indexOf('FEMALE') === 0) continue;
      if (up.indexOf('TRANSMISSAO') >= 0) continue;
      if (up.indexOf('UTILIZAMOS') >= 0) continue;
      if (up.indexOf('ACESSE') >= 0) continue;
      if (up.indexOf('CENTRAL') >= 0) continue;
      if (up.indexOf('TERMOS') >= 0) continue;
      if (up.indexOf('POLITICA') >= 0) continue;
      if (up.indexOf('WHITE') === 0) continue;
      if (up.indexOf('BLUE') === 0) continue;
      if (up.indexOf('PURPLE') === 0) continue;
      if (up.indexOf('BROWN') === 0) continue;
      if (up.indexOf('BLACK') === 0) continue;
      if (up.indexOf('FEATHER') === 0) continue;
      if (up.indexOf('LIGHT') === 0) continue;
      if (up.indexOf('MIDDLE') === 0) continue;
      if (up.indexOf('MEDIUM') === 0) continue;
      if (up.indexOf('HEAVY') === 0) continue;
      if (up.indexOf('SUPER') === 0) continue;
      if (up.indexOf('ULTRA') === 0) continue;
      if (up.indexOf('OPEN') === 0) continue;
      if (up.indexOf('TITLE') === 0) continue;
      if (up.indexOf('URL SOURCE') === 0) continue;
      if (up.indexOf('MARKDOWN CONTENT') === 0) continue;
      if (/^http/i.test(linha)) continue;
      if (linha.length < 4) continue;
      var sn = linha.match(/^(d+)$/);
      if (sn) { aguardandoNome = true; continue; }
      if (aguardandoNome && /^[A-Za-z]/.test(linha) && linha.length >= 4) {
        for (var n = 0; n < names.length; n++) {
          if (corresponde(names[n], linha)) {
            var jaTem = false;
            for (var z = 0; z < lutas.length; z++) {
              if (corresponde(names[n], lutas[z].athlete_name)) { jaTem = true; break; }
            }
            if (!jaTem) {
              lutas.push({ athlete_name: linha, mat: matAtual || '-', fight: fightAtual || '-' });
            }
            break;
          }
        }
        aguardandoNome = false;
        continue;
      }
      for (var n2 = 0; n2 < names.length; n2++) {
        if (corresponde(names[n2], linha) && linha.length >= 4) {
          var jaTem2 = false;
          for (var z2 = 0; z2 < lutas.length; z2++) {
            if (corresponde(names[n2], lutas[z2].athlete_name)) { jaTem2 = true; break; }
          }
          if (!jaTem2) {
            lutas.push({ athlete_name: linha.replace(/^d+s+/, '').trim(), mat: matAtual || '-', fight: fightAtual || '-' });
          }
          break;
        }
      }
    }
    var vistos = {};
    var lutasUnicas = [];
    for (var l = 0; l < lutas.length; l++) {
      var luta = lutas[l];
      var chave = luta.athlete_name + '|' + luta.mat;
      if (!vistos[chave]) { vistos[chave] = true; lutasUnicas.push(luta); }
    }
    var nomesEncontrados = [];
    for (var i = 0; i < lutasUnicas.length; i++) { nomesEncontrados.push(lutasUnicas[i].athlete_name); }
    var naoEncontrados = [];
    for (var i = 0; i < names.length; i++) {
      var achou = false;
      for (var j = 0; j < nomesEncontrados.length; j++) {
        if (corresponde(names[i], nomesEncontrados[j])) { achou = true; break; }
      }
      if (!achou) naoEncontrados.push(names[i]);
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
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder - v26' });
});

app.listen(PORT, '0.0.0.0', function() {
  console.log('BJJ Fight Finder v26 rodando na porta ' + PORT);
});
