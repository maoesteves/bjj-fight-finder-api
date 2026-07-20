const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json({ limit: '10mb' }));

function normalizar(nome) {
  return nome.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '').replace(/ +/g, ' ').trim();
}

function corresponde(buscado, linha) {
  var b = normalizar(buscado);
  var l = normalizar(linha);
  if (!b || !l) return false;
  if (l === b || l.indexOf(b) >= 0 || b.indexOf(l) >= 0) return true;
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
  return acertos >= 2;
}

function parseLutas(texto, nomes) {
  var linhas = texto.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
  var lutas = [];
  var matAtual = '';
  var fightInfoAtual = '';
  var aguardandoNome = false;

  for (var i = 0; i < linhas.length; i++) {
    var linha = linhas[i];

    if (/[Mm][Aa][Tt] +[0-9]+/.test(linha) && linha.length < 20) {
      var m = linha.match(/[0-9]+/);
      if (m) matAtual = 'Mat ' + m[0];
      fightInfoAtual = '';
      aguardandoNome = false;
      continue;
    }

    var fi = linha.match(/([0-9]{1,2}:[0-9]{2}\s*(?:AM|PM)?\s*:\s*FIGHT\s+[0-9]+\s*[^)]*\))/i);
    if (fi) { fightInfoAtual = fi[1].trim(); continue; }

    var up = linha.toUpperCase();
    if (up.indexOf('WINNER OF') === 0 || up.indexOf('DEFEATED OF') === 0) { if (!fightInfoAtual) fightInfoAtual = linha; continue; }
    if (up.indexOf('COOKIES') >= 0 || up.indexOf('ACCEPT') >= 0 || up.indexOf('IBJJF') >= 0) continue;
    if (up.indexOf('TITLE') === 0 || up.indexOf('URL SOURCE') === 0 || up.indexOf('MARKDOWN CONTENT') === 0) continue;
    if (up.indexOf('YOUTUBE') >= 0) continue;
    if (/^http/i.test(linha)) continue;

    var linhaClean = linha.replace(/^[*] */, '');
    if (/^[0-9]{1,2}$/.test(linhaClean)) { aguardandoNome = true; continue; }
    if (linha.length < 4) continue;

    if (aguardandoNome && /^[A-Za-z\u00C0-\u024F]/.test(linha)) {
      aguardandoNome = false;
      for (var n = 0; n < nomes.length; n++) {
        if (corresponde(nomes[n], linha)) {
          var jaTem = false;
          for (var z = 0; z < lutas.length; z++) {
            if (corresponde(nomes[n], lutas[z].athlete_name)) { jaTem = true; break; }
          }
          if (!jaTem) lutas.push({ athlete_name: linha, mat: matAtual || '-', fight_info: fightInfoAtual || '-' });
          break;
        }
      }
      continue;
    }
  }

  for (var nb = 0; nb < nomes.length; nb++) {
    var jaAchou = false;
    for (var z = 0; z < lutas.length; z++) {
      if (corresponde(nomes[nb], lutas[z].athlete_name)) { jaAchou = true; break; }
    }
    if (jaAchou) continue;
    for (var i2 = 0; i2 < linhas.length; i2++) {
      var l2 = linhas[i2];
      if (l2.length < 4 || /^[0-9*]/.test(l2)) continue;
      if (corresponde(nomes[nb], l2)) {
        lutas.push({ athlete_name: l2.replace(/^[0-9]+ +/, '').replace(/^[*] */, '').trim(), mat: matAtual || '-', fight_info: fightInfoAtual || '-' });
        break;
      }
    }
  }

  var vistos = {};
  var unicas = [];
  for (var i = 0; i < lutas.length; i++) {
    var chave = lutas[i].athlete_name + '|' + lutas[i].mat;
    if (!vistos[chave]) { vistos[chave] = true; unicas.push(lutas[i]); }
  }
  return unicas;
}

app.get('/buscar-lutas-v2', async function(req, res) {
  var url = req.query.url;
  var names = req.query.names ? req.query.names.split(',') : [];
  if (!url || names.length === 0) {
    return res.status(400).json({ error: 'URL e names (separados por virgula) obrigatorios' });
  }
  try {
    var response = await axios.get('https://r.jina.ai/' + url, {
      headers: { 'Accept': 'text/plain', 'Accept-Language': 'pt-BR,pt;q=0.9' },
      timeout: 60000
    });
    var texto = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    var lutas = parseLutas(texto, names);
    var encontrados = [];
    for (var i = 0; i < lutas.length; i++) encontrados.push(lutas[i].athlete_name);
    var naoEncontrados = [];
    for (var i = 0; i < names.length; i++) {
      var achou = false;
      for (var j = 0; j < encontrados.length; j++) {
        if (corresponde(names[i], encontrados[j])) { achou = true; break; }
      }
      if (!achou) naoEncontrados.push(names[i]);
    }
    res.json({ total_athletes: lutas.length, total_fights: lutas.length, not_found: naoEncontrados, fights: lutas });
  } catch (error) {
    res.status(500).json({ error: 'Erro de comunicacao com Jina.', detail: error.message });
  }
});

app.post('/buscar-lutas-v2', async function(req, res) {
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
    var lutas = parseLutas(texto, names);
    var encontrados = [];
    for (var i = 0; i < lutas.length; i++) encontrados.push(lutas[i].athlete_name);
    var naoEncontrados = [];
    for (var i = 0; i < names.length; i++) {
      var achou = false;
      for (var j = 0; j < encontrados.length; j++) {
        if (corresponde(names[i], encontrados[j])) { achou = true; break; }
      }
      if (!achou) naoEncontrados.push(names[i]);
    }
    res.json({ total_athletes: lutas.length, total_fights: lutas.length, not_found: naoEncontrados, fights: lutas });
  } catch (error) {
    console.error('Erro:', error.message);
    res.status(500).json({ error: 'Erro de comunicacao com Jina.', detail: error.message });
  }
});

app.get('/health', function(req, res) {
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder - v31' });
});

app.listen(PORT, '0.0.0.0', function() {
  console.log('BJJ Fight Finder v31 rodando na porta ' + PORT);
});
