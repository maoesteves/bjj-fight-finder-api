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

app.post('/buscar-lutas', async function(req, res) {
  var url = req.body.url;
  var names = req.body.names;
  if (!url || !names || names.length === 0) {
    return res.status(400).json({ error: 'URL e nomes obrigatorios' });
  }
  try {
    // TENTATIVA 1: Jina
    var texto = '';
    try {
      var r1 = await axios.get('https://r.jina.ai/' + url, {
        headers: { 'Accept': 'text/plain', 'Accept-Language': 'pt-BR,pt;q=0.9' },
        timeout: 30000
      });
      texto = typeof r1.data === 'string' ? r1.data : JSON.stringify(r1.data);
    } catch(e) {
      console.log('Jina falhou, tentando HTML direto');
    }

    // TENTATIVA 2: Se Jina nao deu certo ou veio muito pequeno, pega HTML direto
    if (!texto || texto.length < 500) {
      var r2 = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 30000
      });
      var html = typeof r2.data === 'string' ? r2.data : JSON.stringify(r2.data);
      // Extrai texto do HTML - tira tags e normaliza
      texto = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ').replace(/[ \t]+/g, '\n');
    }

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
      if (up.indexOf('WINNER OF') === 0 || up.indexOf('DEFEATED OF') === 0) continue;
      if (up.indexOf('COOKIES') >= 0 || up.indexOf('ACCEPT') >= 0 || up.indexOf('IBJJF') >= 0) continue;
      if (up.indexOf('YOUTUBE') >= 0 || /^http/i.test(linha)) continue;

      var linhaClean = linha.replace(/^[*] */, '');
      if (/^[0-9]{1,2}$/.test(linhaClean)) { aguardandoNome = true; continue; }
      if (linha.length < 4) continue;

      if (aguardandoNome && /^[A-Za-z\u00C0-\u024F]/.test(linha)) {
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

    // FALLBACK: procura cada nome em TODAS as linhas
    for (var nb = 0; nb < names.length; nb++) {
      var jaAchou = false;
      for (var z = 0; z < lutas.length; z++) {
        if (corresponde(names[nb], lutas[z].athlete_name)) { jaAchou = true; break; }
      }
      if (jaAchou) continue;
      for (var i2 = 0; i2 < linhas.length; i2++) {
        var l2 = linhas[i2];
        if (l2.length < 4 || /^[0-9*]/.test(l2)) continue;
        if (corresponde(names[nb], l2)) {
          lutas.push({ athlete_name: l2.replace(/^[0-9]+ +/, '').trim(), mat: matAtual || '-' });
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

    res.json({ total_athletes: lutasUnicas.length, total_fights: lutasUnicas.length, not_found: naoEncontrados, fights: lutasUnicas, debug: { linhas_total: linhas.length, linhas_amostra: linhas.slice(0, 30) } });
  } catch (error) {
    console.error('Erro:', error.message);
    res.status(500).json({ error: 'Erro de comunicacao com o servidor.', detail: error.message });
  }
});

app.get('/debug', async function(req, res) {
  var url = req.query.url || 'https://www.bjjcompsystem.com/tournaments/3262/tournament_days/4913';
  var results = {};
  try {
    var r1 = await axios.get('https://r.jina.ai/' + url, {
      headers: { 'Accept': 'text/plain', 'Accept-Language': 'pt-BR,pt;q=0.9' },
      timeout: 30000
    });
    results.jina = (typeof r1.data === 'string' ? r1.data : JSON.stringify(r1.data)).substring(0, 3000);
  } catch(e) { results.jina = 'ERRO: ' + e.message; }
  try {
    var r2 = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 30000
    });
    var html = typeof r2.data === 'string' ? r2.data : JSON.stringify(r2.data);
    results.html_tamanho = html.length;
    results.html_inicio = html.substring(0, 2000);
    results.html_fim = html.substring(html.length - 500);
  } catch(e) { results.html = 'ERRO: ' + e.message; }
  res.json(results);
});

app.get('/health', function(req, res) {
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder - v30' });
});

app.listen(PORT, '0.0.0.0', function() {
  console.log('BJJ Fight Finder v30 rodando na porta ' + PORT);
});
