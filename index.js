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
    var linhas = texto.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 2; });

    var lutas = [];
    var matAtual = '';
    var fightAtual = '';
    var aguardandoNome = false;
    var nomePendente = '';

    for (var i = 0; i < linhas.length; i++) {
      var linha = linhas[i];

      if (/^[Mm][Aa][Tt]\s+\d+/.test(linha)) {
        var m = linha.match(/(\d+)/);
        if (m) { matAtual = 'Mat ' + m[1]; }
        fightAtual = '';
        aguardandoNome = false;
        nomePendente = '';
        continue;
      }

      var fm = linha.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)\s*:\s*FIGHT\s+\d+\s*\([^)]+\))/i);
      if (fm) {
        fightAtual = fm[1];
        aguardandoNome = false;
        nomePendente = '';
        continue;
      }

      var up = linha.toUpperCase();
      if (up.indexOf('WINNER OF') === 0 || up.indexOf('DEFEATED OF') === 0) continue;
      if (up.indexOf('COOKIES') >= 0 || up.indexOf('MANAGE') >= 0 || up.indexOf('REJECT') >= 0) continue;
      if (up.indexOf('ACCEPT') >= 0 || up.indexOf('IBJJF') >= 0) continue;
      if (up.indexOf('ENGLISH') >= 0 || up.indexOf('PORTUGUES') >= 0) continue;
      if (up.indexOf('FILTER') >= 0 || up.indexOf('HOME') >= 0) continue;
      if (up.indexOf('LIVE') >= 0 || up.indexOf('YOUTUBE') >= 0) continue;
      if (up.indexOf('DAY ') === 0) continue;
      if (up.indexOf('ADULT') === 0 || up.indexOf('JUVENILE') === 0 || up.indexOf('MASTER') === 0) continue;
      if (up.indexOf('MALE') === 0 || up.indexOf('FEMALE') === 0) continue;
      if (up.indexOf('YOUTUBE') >= 0 || up.indexOf('GOOGLE') >= 0 || up.indexOf('HTTPS:') >= 0) continue;
      if (up.indexOf('TRANSMISSAO') >= 0 || up.indexOf('UTILIZAMOS') >= 0) continue;
      if (up.indexOf('ACESSE') >= 0 || up.indexOf('CENTRAL') >= 0 || up.indexOf('TERMOS') >= 0) continue;
      if (up.indexOf('POLITICA') >= 0) continue;
      if (linha.indexOf('+ ') === 0 && up.indexOf('FIGHT') >= 0) continue;

      var somenteNumero = linha.match(/^(\d+)$/);
      if (somenteNumero) {
        aguardandoNome = true;
        nomePendente = '';
        continue;
      }

      // Linha parece nome de pessoa (comeca com letra maiuscula, mais de 3 letras)
      if ((aguardandoNome || linha.length
